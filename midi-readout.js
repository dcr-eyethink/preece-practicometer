// Live readout of what's being played on the MIDI keyboard (under the metronome), plus
// turning matching Chord Grid / Randomiser squares green. Built on midi.js.
(() => {
  const M = window.MidiInput;
  const wrap = document.getElementById('midiReadout');
  const circle = document.getElementById('midiCircle');
  const chordEl = document.getElementById('midiChord');
  const notesEl = document.getElementById('midiNotes');
  const hideBtn = document.getElementById('midiHideBtn');
  const showBtn = document.getElementById('midiShowBtn');
  const label = document.getElementById('midiDeviceLabel');
  const unsupportedEl = document.getElementById('midiUnsupported');
  if (!M || !wrap) return;

  const PREF_KEY = 'midiReadoutHidden';
  const AFTERGLOW_MS = 1500;

  let hidden = false;
  try { hidden = localStorage.getItem(PREF_KEY) === '1'; } catch (e) {}
  let connected = false;
  let deviceName = '';
  let pedal = false;
  let shown = [];
  let prevCount = 0;
  let clearTimer = null;

  function applyVisibility() {
    wrap.style.display = connected ? '' : 'none';
    circle.style.display = hidden ? 'none' : '';
    showBtn.style.display = hidden ? '' : 'none';
    wrap.classList.toggle('collapsed', hidden);
  }

  function musical(name) { return window.musicalChord ? window.musicalChord(name) : name; }

  // Turns every grid square that spells the shown notes green; returns how many matched.
  function updateGrid() {
    let count = 0;
    document.querySelectorAll('#chordGrid .chord-cell, #rndGrid .chord-cell').forEach(cell => {
      const match = shown.length > 0 && M.matchesCell(cell, shown);
      cell.classList.toggle('midi-match', match);
      if (match) count++;
    });
    return count;
  }

  function render() {
    if (!shown.length) {
      circle.className = 'midi-box idle';
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
      chordEl.className = 'midi-chord' + (info && info.name.length <= 7 ? '' : ' long');
    }
    notesEl.textContent = withOctaves.replace(/([A-G])b/g, '$1♭').replace(/([A-G])#/g, '$1♯');
    circle.className = 'midi-box playing' + (updateGrid() > 0 ? ' match' : '');
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

  function updateLabel() {
    label.textContent = (pedal ? '● sustain · ' : '') + (deviceName || 'MIDI');
  }
  M.onPedal(down => { pedal = down; updateLabel(); });

  M.onStatus(st => {
    connected = st.state === 'ready' && st.names.length > 0;
    deviceName = connected ? st.names[0] : '';
    if (!connected) pedal = false;
    updateLabel();
    if (!connected) { shown = []; prevCount = 0; render(); }
    if (unsupportedEl) unsupportedEl.style.display = st.state === 'unsupported' ? '' : 'none';
    applyVisibility();
  });

  function setHidden(next) {
    hidden = next;
    try { localStorage.setItem(PREF_KEY, hidden ? '1' : '0'); } catch (e) {}
    applyVisibility();
  }
  hideBtn.addEventListener('click', () => setHidden(true));
  showBtn.addEventListener('click', () => setHidden(false));

  applyVisibility();
  // Only ask for MIDI once someone's signed in (the browser prompts for permission).
  if (window.Auth && window.Auth.getSession) {
    window.Auth.getSession().then(s => { if (s) M.start(); }).catch(() => {});
  }
})();
