// Lightweight rolling stats on MIDI playing feel: note duration, and the
// timing between one note ending and the next starting. Off by default;
// toggled from the small chart button in the MIDI readout header.
//
// Both rows use the same plot: a mean-±-SE diamond in blue (widest at the
// mean, tapering to points at mean±SE) plus a thin vertical tick for the
// most recent value, which switches colour on the Blur/Gap row.
//
// Duration is one-sided (0 up to some max). Blur/Gap is signed: for each
// adjacent pair of notes (in onset order) there's a single gap,
// releaseOfPrevious -> onsetOfNext. Negative means the notes overlapped
// (blurring); positive means there was a gap (a clean separation). The
// rolling mean/SE is one blue diamond over the signed values either side of
// a zero notch; the current-value tick is red when it's a blur (negative)
// and blue when it's a gap (positive). Perfectly clean legato playing keeps
// everything sitting on zero.
//
// A very long gap is just a rest, not a timing issue, and a long overlap is
// a deliberately held chord/legato pedal, not blurring — both are filtered
// out rather than dragging the stats around.
(() => {
  const M = window.MidiInput;
  const wrap = document.getElementById('midiStats');
  const circle = document.getElementById('midiCircle');
  const toggleBtn = document.getElementById('midiStatsBtn');
  if (!M || !wrap || !circle || !toggleBtn) return;

  const PREF_KEY = 'midiStatsShown';
  const AVG_WINDOW = 8;          // samples folded into the rolling mean/SE
  const MAX_INTERVAL_MS = 1000;  // gaps longer than this are a rest, not counted
  const MAX_BLUR_MS = 500;       // overlaps longer than this are intentional, not counted

  let shown = false;
  try { shown = localStorage.getItem(PREF_KEY) === '1'; } catch (e) {}

  const ROWS = [
    { key: 'duration', label: 'Duration', bipolar: false, scale: 1200, fmt: v => Math.round(v) + 'ms' },
    { key: 'timing', label: 'Blur/Gap', bipolar: true, scale: 500, fmt: v => (v >= 0 ? '+' : '−') + Math.round(Math.abs(v)) + 'ms' }
  ];
  const stats = {};
  ROWS.forEach(r => { stats[r.key] = { values: [] }; });

  function push(key, v) {
    const s = stats[key];
    s.values.push(v);
    if (s.values.length > AVG_WINDOW) s.values.shift();
  }

  function meanSE(arr) {
    if (!arr.length) return null;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    if (arr.length < 2) return { mean, se: 0 };
    const variance = arr.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (arr.length - 1);
    return { mean, se: Math.sqrt(variance / arr.length) };
  }

  // Pairs up adjacent notes (by onset order) regardless of pitch, and turns
  // each pair into one signed gap once both ends of the pair are known.
  const onTimes = new Map(); // note -> { onset, offset, pendingNextOnset }
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
      ? 'How long each note is held down. The blue diamond is the mean ± standard error of the last 8 notes (widest at the mean); the thin vertical line is the most recent one.'
      : 'Time from one note releasing to the next starting — negative (left of the notch) means the notes overlapped (blurring), positive (right) means there was a gap. The blue diamond is the mean ± SE of the last 8. The thin vertical line is the most recent one, red for a blur and blue for a gap. Long rests and deliberately held/overlapping notes are ignored.');
    row.innerHTML =
      '<div class="midi-stat-label">' + r.label + '</div>' +
      '<canvas class="midi-stat-plot" width="140" height="20"></canvas>' +
      '<div class="midi-stat-value">–</div>';
    wrap.appendChild(row);
    rowEls[r.key] = {
      plot: row.querySelector('.midi-stat-plot'),
      value: row.querySelector('.midi-stat-value')
    };
  });

  function drawDiamond(ctx, xMid, xLo, xHi, midY, halfH, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(xLo, midY);
    ctx.lineTo(xMid, midY - halfH);
    ctx.lineTo(xHi, midY);
    ctx.lineTo(xMid, midY + halfH);
    ctx.closePath();
    ctx.fill();
  }

  function renderPlot(key) {
    const r = ROWS.find(x => x.key === key);
    const canvas = rowEls[key].plot;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const midY = h / 2;
    const pad = 5;
    const halfH = h / 2 - 2;
    ctx.clearRect(0, 0, w, h);

    const slice = stats[key].values;
    const last = slice[slice.length - 1];

    if (r.bipolar) {
      const xForVal = v => w / 2 + Math.max(-1, Math.min(1, v / r.scale)) * (w / 2 - pad);
      // baseline + a bigger zero notch
      ctx.strokeStyle = '#ccd3ea';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad, midY);
      ctx.lineTo(w - pad, midY);
      ctx.stroke();
      ctx.strokeStyle = '#98a6cc';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(w / 2, midY - 2);
      ctx.lineTo(w / 2, midY + 7);
      ctx.stroke();

      const stat = meanSE(slice);
      if (stat) drawDiamond(ctx, xForVal(stat.mean), xForVal(stat.mean - stat.se), xForVal(stat.mean + stat.se), midY, halfH, 'rgba(58, 111, 224, 0.75)');

      if (last != null) {
        const x = xForVal(last);
        ctx.strokeStyle = last < 0 ? '#c0392b' : '#1a56db';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x, 1);
        ctx.lineTo(x, h - 1);
        ctx.stroke();
      }
    } else {
      const scale = Math.max(r.scale, last || 0);
      const xForVal = v => pad + Math.max(0, Math.min(1, v / scale)) * (w - pad * 2);
      ctx.strokeStyle = '#ccd3ea';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad, midY);
      ctx.lineTo(w - pad, midY);
      ctx.stroke();

      const stat = meanSE(slice);
      if (stat) drawDiamond(ctx, xForVal(stat.mean), xForVal(Math.max(0, stat.mean - stat.se)), xForVal(stat.mean + stat.se), midY, halfH, 'rgba(58, 111, 224, 0.75)');

      if (last != null) {
        const x = xForVal(last);
        ctx.strokeStyle = '#1a56db';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x, 1);
        ctx.lineTo(x, h - 1);
        ctx.stroke();
      }
    }
  }

  function render(key) {
    const r = ROWS.find(x => x.key === key);
    const s = stats[key];
    const last = s.values[s.values.length - 1];
    rowEls[key].value.textContent = last == null ? '–' : r.fmt(last);
    renderPlot(key);
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
