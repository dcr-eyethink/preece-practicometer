// Lightweight rolling stats on MIDI playing feel: note duration, and the
// timing between one note ending and the next starting. Off by default;
// toggled from the small chart button in the MIDI readout header.
//
// For each adjacent pair of notes (in onset order) there's a single signed
// gap: releaseOfPrevious -> onsetOfNext. Negative means the notes overlapped
// (blurring); positive means there was a gap (a clean separation). The two
// are really one measurement, so they share a single zero-centred row:
// blur to the left (red), gap to the right (blue), perfectly clean legato
// playing sits at zero either way.
//
// A very long gap is just a rest, not a timing issue, and a long overlap is
// a deliberately held chord/legato pedal, not blurring — both are filtered
// out rather than dragging the average around.
(() => {
  const M = window.MidiInput;
  const wrap = document.getElementById('midiStats');
  const circle = document.getElementById('midiCircle');
  const toggleBtn = document.getElementById('midiStatsBtn');
  if (!M || !wrap || !circle || !toggleBtn) return;

  const PREF_KEY = 'midiStatsShown';
  const HISTORY = 36;        // samples kept for the sparkline
  const AVG_WINDOW = 16;     // samples folded into the rolling average / variance
  const MAX_INTERVAL_MS = 1000; // gaps longer than this are a rest, not counted
  const MAX_BLUR_MS = 500;      // overlaps longer than this are intentional, not counted

  let shown = false;
  try { shown = localStorage.getItem(PREF_KEY) === '1'; } catch (e) {}

  const ROWS = [
    { key: 'duration', label: 'Duration', kind: 'plain', max: 1200, fmt: v => Math.round(v) + 'ms' },
    { key: 'timing', label: 'Blur/Gap', kind: 'signed', scale: 500, fmt: v => (v >= 0 ? '+' : '−') + Math.round(Math.abs(v)) + 'ms' }
  ];
  const stats = {};
  ROWS.forEach(r => { stats[r.key] = { values: [] }; });

  function push(key, v) {
    const s = stats[key];
    s.values.push(v);
    if (s.values.length > HISTORY) s.values.shift();
  }

  function windowStats(key) {
    const slice = stats[key].values.slice(-AVG_WINDOW);
    if (!slice.length) return { avg: 0, sd: 0 };
    const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
    const variance = slice.reduce((a, b) => a + (b - avg) * (b - avg), 0) / slice.length;
    return { avg, sd: Math.sqrt(variance) };
  }

  // Pairs up adjacent notes (by onset order) regardless of pitch, and turns
  // each pair into one signed gap once both ends of the pair are known.
  const onTimes = new Map(); // note -> { onset, pendingNextOnset }
  let prevEntry = null;

  function recordGap(v) {
    if (v > MAX_INTERVAL_MS || v < -MAX_BLUR_MS) return;
    push('timing', v);
    if (shown) render('timing');
  }

  const rowEls = {};
  ROWS.forEach(r => {
    const row = document.createElement('div');
    row.className = 'midi-stat-row';
    row.setAttribute('data-tip', r.key === 'duration'
      ? 'How long each note is held down, on average (bar, with the shaded band showing typical spread) and most recently (line).'
      : 'Time from one note releasing to the next starting. Left of centre (red) = the notes overlapped — blurring. Right of centre (blue) = there was a gap. Long rests and deliberately held/overlapping notes are ignored.');
    row.innerHTML =
      '<div class="midi-stat-label">' + r.label + '</div>' +
      '<div class="midi-stat-bar-track' + (r.kind === 'signed' ? ' signed' : '') + '">' +
        (r.kind === 'signed' ? '<div class="midi-stat-zero"></div>' : '') +
        '<div class="midi-stat-errbar"></div>' +
        '<div class="midi-stat-bar-fill"></div>' +
      '</div>' +
      '<canvas class="midi-stat-spark" width="42" height="14"></canvas>' +
      '<div class="midi-stat-value">–</div>';
    wrap.appendChild(row);
    rowEls[r.key] = {
      fill: row.querySelector('.midi-stat-bar-fill'),
      err: row.querySelector('.midi-stat-errbar'),
      canvas: row.querySelector('.midi-stat-spark'),
      value: row.querySelector('.midi-stat-value')
    };
  });

  function renderBar(key) {
    const r = ROWS.find(x => x.key === key);
    const els = rowEls[key];
    const { avg, sd } = windowStats(key);
    if (r.kind === 'signed') {
      const pct = v => Math.max(-50, Math.min(50, (v / r.scale) * 50));
      const avgPct = pct(avg);
      els.fill.style.left = (avgPct >= 0 ? 50 : 50 + avgPct) + '%';
      els.fill.style.width = Math.abs(avgPct) + '%';
      els.fill.classList.toggle('neg', avg < 0);
      const loPct = pct(avg - sd), hiPct = pct(avg + sd);
      els.err.style.left = (50 + Math.min(loPct, hiPct)) + '%';
      els.err.style.width = Math.abs(hiPct - loPct) + '%';
    } else {
      const pct = v => Math.max(0, Math.min(100, (v / r.max) * 100));
      els.fill.style.left = '0%';
      els.fill.style.width = pct(avg) + '%';
      const lo = pct(Math.max(0, avg - sd)), hi = pct(avg + sd);
      els.err.style.left = lo + '%';
      els.err.style.width = Math.max(0, hi - lo) + '%';
    }
  }

  function drawSpark(key) {
    const r = ROWS.find(x => x.key === key);
    const s = stats[key];
    const canvas = rowEls[key].canvas;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (r.kind === 'signed') {
      ctx.strokeStyle = '#ccd3ea';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
    }
    if (s.values.length < 2) return;
    const vals = s.values;
    const max = r.kind === 'plain' ? Math.max(r.max, ...vals) : r.scale;
    ctx.beginPath();
    vals.forEach((v, i) => {
      const x = (i / (HISTORY - 1)) * w;
      const clamped = Math.max(-max, Math.min(max, v));
      const y = r.kind === 'signed'
        ? h / 2 - (clamped / max) * (h / 2 - 1)
        : h - 1 - (Math.max(0, clamped) / max) * (h - 2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = r.kind === 'signed' ? '#7a4fd0' : '#3a6fe0';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  function render(key) {
    const r = ROWS.find(x => x.key === key);
    const s = stats[key];
    const last = s.values[s.values.length - 1];
    rowEls[key].value.textContent = last == null ? '–' : r.fmt(last);
    renderBar(key);
    drawSpark(key);
  }

  function renderAll() { ROWS.forEach(r => render(r.key)); }

  M.onNoteOn(note => {
    const now = performance.now();
    const entry = { onset: now, offset: null, pendingNextOnset: null };
    if (prevEntry) {
      if (prevEntry.offset != null) recordGap(now - prevEntry.offset);
      else prevEntry.pendingNextOnset = now;
    }
    onTimes.set(note, entry);
    prevEntry = entry;
  });

  M.onNoteOff(note => {
    const entry = onTimes.get(note);
    if (!entry) return;
    const now = performance.now();
    entry.offset = now;
    push('duration', now - entry.onset);
    if (shown) render('duration');
    if (entry.pendingNextOnset != null) recordGap(entry.pendingNextOnset - now);
    onTimes.delete(note);
  });

  function applyVisibility() {
    const collapsed = circle.style.display === 'none';
    const active = shown && !collapsed;
    wrap.style.display = active ? '' : 'none';
    circle.classList.toggle('has-stats', active);
    toggleBtn.classList.toggle('active', shown);
    if (active) renderAll();
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
