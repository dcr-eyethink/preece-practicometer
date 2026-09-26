// Lightweight rolling stats on MIDI playing feel: note duration, onset-to-onset
// interval, and "blurring" (two or more notes sounding at once — physically
// held or still ringing on the pedal). Off by default; toggled from the small
// chart button in the MIDI readout header, independent of the readout itself.
(() => {
  const M = window.MidiInput;
  const wrap = document.getElementById('midiStats');
  const circle = document.getElementById('midiCircle');
  const toggleBtn = document.getElementById('midiStatsBtn');
  if (!M || !wrap || !circle || !toggleBtn) return;

  const PREF_KEY = 'midiStatsShown';
  const HISTORY = 36;    // samples kept for the sparkline
  const AVG_WINDOW = 16; // samples folded into the rolling-average bar

  let shown = false;
  try { shown = localStorage.getItem(PREF_KEY) === '1'; } catch (e) {}

  const ROWS = [
    { key: 'duration', label: 'Duration', max: 1200, fmt: v => Math.round(v) + 'ms' },
    { key: 'interval', label: 'Interval', max: 1200, fmt: v => Math.round(v) + 'ms' },
    { key: 'blur', label: 'Blurring', max: 4, fmt: v => v.toFixed(1) + '×' }
  ];
  const stats = {};
  ROWS.forEach(r => { stats[r.key] = { values: [], max: r.max }; });

  const onTimes = new Map(); // note -> press timestamp
  let lastOnsetTime = null;

  function push(key, v) {
    const s = stats[key];
    s.values.push(v);
    if (s.values.length > HISTORY) s.values.shift();
  }

  function rollingAvg(key) {
    const slice = stats[key].values.slice(-AVG_WINDOW);
    if (!slice.length) return 0;
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  }

  const rowEls = {};
  ROWS.forEach(r => {
    const row = document.createElement('div');
    row.className = 'midi-stat-row';
    row.setAttribute('data-tip', {
      duration: 'How long each note is held down, on average (bar) and most recently (line).',
      interval: 'Time between one note starting and the next, on average (bar) and most recently (line) — evenness of playing.',
      blur: 'How many notes are sounding together at once — 1 is a clean single line, higher means notes are overlapping or bleeding into each other.'
    }[r.key]);
    row.innerHTML =
      '<div class="midi-stat-label">' + r.label + '</div>' +
      '<div class="midi-stat-bar-track"><div class="midi-stat-bar-fill"></div></div>' +
      '<canvas class="midi-stat-spark" width="56" height="20"></canvas>' +
      '<div class="midi-stat-value">–</div>';
    wrap.appendChild(row);
    rowEls[r.key] = {
      fill: row.querySelector('.midi-stat-bar-fill'),
      canvas: row.querySelector('.midi-stat-spark'),
      value: row.querySelector('.midi-stat-value')
    };
  });

  function drawSpark(key) {
    const s = stats[key];
    const canvas = rowEls[key].canvas;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (s.values.length < 2) return;
    const vals = s.values;
    const max = Math.max(s.max, ...vals);
    ctx.beginPath();
    vals.forEach((v, i) => {
      const x = (i / (HISTORY - 1)) * w;
      const y = h - 1 - (Math.min(v, max) / max) * (h - 2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#3a6fe0';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  function render(key) {
    const r = ROWS.find(rr => rr.key === key);
    const s = stats[key];
    const last = s.values[s.values.length - 1];
    const avg = rollingAvg(key);
    const els = rowEls[key];
    els.fill.style.width = Math.min(100, (avg / s.max) * 100) + '%';
    els.value.textContent = last == null ? '–' : r.fmt(last);
    drawSpark(key);
  }

  function renderAll() { ROWS.forEach(r => render(r.key)); }

  M.onNoteOn(note => {
    const now = performance.now();
    if (lastOnsetTime != null) push('interval', now - lastOnsetTime);
    lastOnsetTime = now;
    onTimes.set(note, now);
    push('blur', M.getHeld().length);
    if (shown) { render('interval'); render('blur'); }
  });

  M.onNoteOff(note => {
    const t0 = onTimes.get(note);
    onTimes.delete(note);
    if (t0 != null) {
      push('duration', performance.now() - t0);
      if (shown) render('duration');
    }
  });

  function applyVisibility() {
    const collapsed = circle.style.display === 'none';
    wrap.style.display = (shown && !collapsed) ? '' : 'none';
    toggleBtn.classList.toggle('active', shown);
    if (shown && !collapsed) renderAll();
  }
  window.MidiStatsSync = applyVisibility;

  toggleBtn.addEventListener('click', () => {
    shown = !shown;
    try { localStorage.setItem(PREF_KEY, shown ? '1' : '0'); } catch (e) {}
    applyVisibility();
  });

  M.onStatus(st => { if (st.state !== 'ready') applyVisibility(); });

  applyVisibility();
})();
