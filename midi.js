// Shared MIDI keyboard input for every feature (ear training, chord sequences, the live
// readout under the metronome, chord-grid highlighting). One requestMIDIAccess, one set of
// listeners, and a small chord-analysis toolkit — features subscribe instead of each
// opening MIDI themselves.
(() => {
  const PC_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const ROOT_PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
  const CHORD_WINDOW_MS = 220;

  // Templates for naming a set of pitch classes; first match wins, bass note tried as root first.
  const TEMPLATES = [
    ['', [0, 4, 7]], ['m', [0, 3, 7]], ['dim', [0, 3, 6]], ['aug', [0, 4, 8]],
    ['sus2', [0, 2, 7]], ['sus4', [0, 5, 7]],
    ['7', [0, 4, 7, 10]], ['maj7', [0, 4, 7, 11]], ['m7', [0, 3, 7, 10]],
    ['m7♭5', [0, 3, 6, 10]], ['dim7', [0, 3, 6, 9]], ['m(maj7)', [0, 3, 7, 11]],
    ['6', [0, 4, 7, 9]], ['m6', [0, 3, 7, 9]],
    ['9', [0, 2, 4, 7, 10]], ['maj9', [0, 2, 4, 7, 11]], ['m9', [0, 2, 3, 7, 10]],
    ['7 (no 5)', [0, 4, 10]], ['maj7 (no 5)', [0, 4, 11]], ['m7 (no 5)', [0, 3, 10]],
    ['5', [0, 7]]
  ];

  // Chord types the grids use, as intervals above the root; `optional` may be left out.
  const GRID_TYPES = {
    note: { required: [0], optional: [] },
    maj: { required: [0, 4, 7], optional: [] },
    min: { required: [0, 3, 7], optional: [] },
    maj7: { required: [0, 4, 11], optional: [7] },
    min7: { required: [0, 3, 10], optional: [7] },
    dom7: { required: [0, 4, 10], optional: [7] }
  };

  const held = new Set();
  const noteOnFns = [], heldFns = [], chordFns = [], statusFns = [];
  let status = { state: 'idle', names: [] }; // idle | unsupported | denied | ready
  let started = false;
  let burst = [], burstTimer = null;

  function heldNotes() { return [...held].sort((a, b) => a - b); }
  function emitHeld() { const h = heldNotes(); heldFns.forEach(fn => fn(h)); }
  function setStatus(next) {
    status = next;
    statusFns.forEach(fn => fn(status));
  }

  function onMessage(e) {
    const [b0, note, vel] = e.data;
    const cmd = b0 & 0xf0;
    if (cmd === 0x90 && vel > 0) {
      held.add(note);
      noteOnFns.forEach(fn => fn(note, vel));
      burst.push(note);
      clearTimeout(burstTimer);
      burstTimer = setTimeout(() => { const notes = burst; burst = []; chordFns.forEach(fn => fn(notes)); }, CHORD_WINDOW_MS);
      emitHeld();
    } else if (cmd === 0x80 || (cmd === 0x90 && vel === 0)) {
      if (held.delete(note)) emitHeld();
    } else if (cmd === 0xb0 && (note === 123 || note === 120)) { // all notes / sound off
      if (held.size) { held.clear(); emitHeld(); }
    }
  }

  async function start() {
    if (started) return;
    started = true;
    if (!navigator.requestMIDIAccess) { setStatus({ state: 'unsupported', names: [] }); return; }
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      const attach = () => {
        const inputs = Array.from(access.inputs.values()).filter(i => i.state !== 'disconnected');
        inputs.forEach(inp => inp.addEventListener('midimessage', onMessage));
        if (!inputs.length && held.size) { held.clear(); emitHeld(); }
        setStatus({ state: 'ready', names: inputs.map(i => i.name) });
      };
      attach();
      access.onstatechange = attach;
    } catch (err) {
      setStatus({ state: 'denied', names: [] });
    }
  }

  function subscribe(list, fn) { list.push(fn); return () => { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); }; }

  function pcSet(notes) { return new Set(notes.map(n => ((n % 12) + 12) % 12)); }

  // Names a chord from any voicing (inversions/octaves/doublings ignored). null if unrecognised.
  function analyzeChord(notes) {
    if (!notes.length) return null;
    const sorted = [...notes].sort((a, b) => a - b);
    const bassPc = ((sorted[0] % 12) + 12) % 12;
    const set = pcSet(sorted);
    if (set.size < 2) return null;
    const roots = [bassPc, ...[...set].filter(p => p !== bassPc)];
    for (const r of roots) {
      for (const [sym, iv] of TEMPLATES) {
        if (iv.length === set.size && iv.every(i => set.has((r + i) % 12))) {
          const slash = r !== bassPc ? '/' + PC_NAMES[bassPc] : '';
          return { rootPc: r, bassPc, quality: sym, name: PC_NAMES[r] + sym + slash };
        }
      }
    }
    return null;
  }

  // Do these notes spell the given grid chord (root name + type)? Octave/inversion-agnostic.
  function matchesChord(notes, rootName, type) {
    const spec = GRID_TYPES[type];
    const root = ROOT_PC[rootName];
    if (!spec || root == null || !notes.length) return false;
    const set = pcSet(notes);
    const allowed = new Set([...spec.required, ...spec.optional].map(i => (root + i) % 12));
    if (![...set].every(pc => allowed.has(pc))) return false;
    return spec.required.every(i => set.has((root + i) % 12));
  }

  // Parses a chord-grid label like 'Ebm' / 'F#' into { rootName, type }.
  function parseTriad(label) {
    const m = /^([A-G][b#]?)(m?)$/.exec(label || '');
    return m ? { rootName: m[1], type: m[2] ? 'min' : 'maj' } : null;
  }

  function noteName(midi) { return PC_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1); }

  window.MidiInput = {
    start,
    getStatus: () => status,
    getHeld: heldNotes,
    onNoteOn: fn => subscribe(noteOnFns, fn),
    onHeldChange: fn => subscribe(heldFns, fn),
    onChord: fn => subscribe(chordFns, fn),
    onStatus: fn => { const off = subscribe(statusFns, fn); fn(status); return off; },
    analyzeChord, matchesChord, parseTriad, noteName, pcName: pc => PC_NAMES[((pc % 12) + 12) % 12]
  };
})();
