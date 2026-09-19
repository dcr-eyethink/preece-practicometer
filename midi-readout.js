// Live readout of what's being played on the MIDI keyboard (under the metronome), plus
// turning matching Chord Grid / Circle of 5ths squares green. Built on midi.js.
(() => {
  const M = window.MidiInput;
  const wrap = document.getElementById('midiReadout');
  const circle = document.getElementById('midiCircle');
  const chordEl = document.getElementById('midiChord');
  const notesEl = document.getElementById('midiNotes');
  const hideBtn = document.getElementById('midiHideBtn');
  const label = document.getElementById('midiDeviceLabel');
  if (!M || !wrap) return;

  const PREF_KEY = 'midiReadoutHidden';
  const AFTERGLOW_MS = 1500;
  const C5_TYPES = { note: 'note', maj7: 'maj7', min7: 'min7', dom7: 'dom7' };

  let hidden = false;
  try { hidden = localStorage.getItem(PREF_KEY) === '1'; } catch (e) {}
  let connected = false;
  let shown = [];
  let prevCount = 0;
  let clearTimer = null;

  function applyVisibility() {
    wrap.style.display = connected ? '' : 'none';
    circle.style.display = hidden ? 'none' : '';
    hideBtn.textContent = hidden ? 'show' : 'hide';
  }

  function musical(name) { return window.musicalChord ? window.musicalChord(name) : name; }

  // Turns every grid square that spells the shown notes green; returns how many matched.
  function updateGrid() {
    let count = 0;
    document.querySelectorAll('#chordGrid .chord-cell, #c5Grid .chord-cell').forEach(cell => {
      let match = false;
      if (shown.length) {
        if (cell.dataset.chord) {
          const p = M.parseTriad(cell.dataset.chord);
          match = !!p && M.matchesChord(shown, p.rootName, p.type);
        } else if (cell.dataset.key) {
          match = M.matchesChord(shown, cell.dataset.key, C5_TYPES[cell.dataset.type] || 'note');
        }
      }
      cell.classList.toggle('midi-match', match);
      if (match) count++;
    });
    return count;
  }

  function render() {
    if (!shown.length) {
      circle.className = 'midi-circle idle';
      chordEl.className = 'midi-chord';
      chordEl.textContent = '–';
      notesEl.textContent = '';
      updateGrid();
      return;
    }
    const withOctaves = shown.map(M.noteName).join(' ');
    const pcNames = [...new Set(shown.map(n => M.pcName(n)))].map(musical);
    if (shown.length === 1 || pcNames.length === 1) {
      chordEl.textContent = pcNames[0];
      chordEl.className = 'midi-chord';
    } else {
      const info = M.analyzeChord(shown);
      chordEl.textContent = info ? musical(info.name) : pcNames.join(' ');
      chordEl.className = 'midi-chord' + (info && info.name.length <= 6 ? '' : ' long');
    }
    notesEl.textContent = withOctaves.replace(/([A-G])b/g, '$1♭').replace(/([A-G])#/g, '$1♯');
    circle.className = 'midi-circle playing' + (updateGrid() > 0 ? ' match' : '');
  }

  M.onHeldChange(held => {
    if (held.length === 0) {
      clearTimeout(clearTimer);
      clearTimer = setTimeout(() => { shown = []; render(); }, AFTERGLOW_MS);
    } else {
      clearTimeout(clearTimer);
      // Update on notes being added only, so lifting fingers off a chord one by one
      // doesn't flicker through the partial chords.
      if (held.length > prevCount) { shown = held; render(); }
    }
    prevCount = held.length;
  });

  M.onStatus(st => {
    connected = st.state === 'ready' && st.names.length > 0;
    label.textContent = connected ? 'MIDI · ' + st.names[0] : 'MIDI';
    if (!connected) { shown = []; prevCount = 0; render(); }
    applyVisibility();
  });

  hideBtn.addEventListener('click', () => {
    hidden = !hidden;
    try { localStorage.setItem(PREF_KEY, hidden ? '1' : '0'); } catch (e) {}
    applyVisibility();
  });

  applyVisibility();
  // Only ask for MIDI once someone's signed in (the browser prompts for permission).
  if (window.Auth && window.Auth.getSession) {
    window.Auth.getSession().then(s => { if (s) M.start(); }).catch(() => {});
  }
})();
