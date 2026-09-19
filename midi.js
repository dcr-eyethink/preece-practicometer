// Shared MIDI keyboard input for every feature (ear training, chord sequences, the live
// readout under the metronome, chord-grid highlighting). One requestMIDIAccess, one set of
// listeners, and a small chord-analysis toolkit — features subscribe instead of each
// opening MIDI themselves.
(() => {
  const PC_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const ROOT_PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
  const CHORD_WINDOW_MS = 220;

  // Chord types the grids use, as intervals above the root; `optional` may be left out.
  const GRID_TYPES = {
    note: { required: [0], optional: [] },
    maj: { required: [0, 4, 7], optional: [] },
    min: { required: [0, 3, 7], optional: [] },
    maj7: { required: [0, 4, 11], optional: [7] },
    min7: { required: [0, 3, 10], optional: [7] },
    dom7: { required: [0, 4, 10], optional: [7] }
  };

  const keysDown = new Set();   // physically held
  const sustained = new Set(); // released while the pedal was down — still sounding
  let pedalDown = false;
  const noteOnFns = [], heldFns = [], chordFns = [], statusFns = [], pedalFns = [];
  let status = { state: 'idle', names: [] }; // idle | unsupported | denied | ready
  let started = false;
  let burst = [], burstTimer = null;

  function heldNotes() { return [...new Set([...keysDown, ...sustained])].sort((a, b) => a - b); }
  function clearAll() { keysDown.clear(); sustained.clear(); }
  function emitHeld() { const h = heldNotes(); heldFns.forEach(fn => fn(h)); }
  function setStatus(next) {
    status = next;
    statusFns.forEach(fn => fn(status));
  }

  function onMessage(e) {
    const [b0, note, vel] = e.data;
    const cmd = b0 & 0xf0;
    if (cmd === 0x90 && vel > 0) {
      keysDown.add(note);
      sustained.delete(note);
      noteOnFns.forEach(fn => fn(note, vel));
      burst.push(note);
      clearTimeout(burstTimer);
      burstTimer = setTimeout(() => { const notes = burst; burst = []; chordFns.forEach(fn => fn(notes)); }, CHORD_WINDOW_MS);
      emitHeld();
    } else if (cmd === 0x80 || (cmd === 0x90 && vel === 0)) {
      if (!keysDown.delete(note)) return;
      if (pedalDown) sustained.add(note);
      emitHeld();
    } else if (cmd === 0xb0 && note === 64) { // sustain pedal
      const down = vel >= 64;
      if (down === pedalDown) return;
      pedalDown = down;
      pedalFns.forEach(fn => fn(pedalDown));
      if (!down && sustained.size) { sustained.clear(); emitHeld(); }
    } else if (cmd === 0xb0 && (note === 123 || note === 120)) { // all notes / sound off
      if (keysDown.size || sustained.size) { clearAll(); emitHeld(); }
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
        if (!inputs.length && (keysDown.size || sustained.size)) { clearAll(); pedalDown = false; emitHeld(); }
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

  // Cost of each interval above a candidate root; lower = more "structural" to the chord.
  // Picks the most plausible root, preferring the bass note (slash chords cost extra).
  const INTERVAL_COST = { 0: 0, 7: 0, 3: 0, 4: 0, 10: 0, 11: 0.5, 2: 1, 9: 1, 5: 1.5, 6: 2, 8: 2, 1: 3 };

  function nameFromRoot(rootPc, set) {
    const has = i => set.has((rootPc + i) % 12);
    const major = has(4), minor = has(3) && !major;
    const sus = !major && !minor && (has(2) || has(5));
    if (!major && !minor && !sus) return has(7) && set.size === 2 ? PC_NAMES[rootPc] + '5' : null;
    const dimFifth = minor && has(6) && !has(7);
    const augFifth = major && has(8) && !has(7);
    const dim7 = dimFifth && has(9) && !has(10) && !has(11);
    const seventh = has(11) ? 'maj7' : has(10) ? '7' : dim7 ? '7' : null;
    const sixth = !seventh && has(9); // a 6th chord rather than a 13th
    const alts = [];
    if (has(1)) alts.push('♭9');
    if (has(2) && !sus) alts.push('9');
    if (has(3) && major) alts.push('♯9');
    if (has(5) && !sus && (major || minor)) alts.push('11');
    if (has(6) && has(7)) alts.push('♯11');
    if (has(8) && has(7)) alts.push('♭13');
    if (has(9) && seventh && !dim7) alts.push('13');
    if (has(6) && !has(7) && major) alts.push('♭5');
    let q = minor ? 'm' : '';
    if (dimFifth && !seventh) q = 'dim';
    else if (dimFifth && seventh === '7' && has(10)) q = 'm7♭5';
    else if (dim7) q = 'dim7';
    else if (augFifth && !seventh) q = 'aug';
    else if (seventh === 'maj7') q += minor ? '(maj7)' : 'maj7';
    else if (seventh === '7') q += '7';
    if (sus) q = (has(5) ? 'sus4' : 'sus2') + (seventh ? (seventh === 'maj7' ? 'maj7' : '7') : '');
    if (sixth) q += (has(2) ? '6/9' : '6');
    const ext = alts.filter(a => !(sixth && a === '9'));
    const addWord = !seventh && !sixth && ext.length && !dimFifth && !augFifth;
    let out = PC_NAMES[rootPc] + q;
    if (ext.length) out += addWord ? '(add' + ext.join(',') + ')' : '(' + ext.join(',') + ')';
    return out;
  }

  // Names a chord from any voicing (inversions/octaves/doublings ignored). null if unrecognised.
  function analyzeChord(notes) {
    if (!notes.length) return null;
    const sorted = [...notes].sort((a, b) => a - b);
    const bassPc = ((sorted[0] % 12) + 12) % 12;
    const set = pcSet(sorted);
    if (set.size < 2) return null;
    if (set.size === 2) { // only a power chord (root + 5th) counts as a chord
      const [a, b] = [...set];
      const root = (b - a + 12) % 12 === 7 ? a : (a - b + 12) % 12 === 7 ? b : null;
      return root == null ? null : { rootPc: root, bassPc, name: PC_NAMES[root] + '5' + (root !== bassPc ? '/' + PC_NAMES[bassPc] : '') };
    }
    let best = null;
    for (const r of set) {
      const name = nameFromRoot(r, set);
      if (!name) continue;
      let cost = r === bassPc ? 0 : 1.5;
      set.forEach(pc => { cost += INTERVAL_COST[(pc - r + 12) % 12]; });
      if (!best || cost < best.cost) best = { rootPc: r, name, cost };
    }
    if (!best) return null;
    const slash = best.rootPc !== bassPc ? '/' + PC_NAMES[bassPc] : '';
    return { rootPc: best.rootPc, bassPc, name: best.name + slash };
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
    onPedal: fn => subscribe(pedalFns, fn),
    onStatus: fn => { const off = subscribe(statusFns, fn); fn(status); return off; },
    analyzeChord, matchesChord, parseTriad, noteName, pcName: pc => PC_NAMES[((pc % 12) + 12) % 12]
  };
})();
