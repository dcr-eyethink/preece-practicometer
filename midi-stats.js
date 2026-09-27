// Lightweight rolling stats on MIDI playing feel: note duration, and the
// timing between one note ending and the next starting. Off by default;
// toggled from the small chart button in the MIDI readout header.
//
// Both rows use the same plot: a small dot for each of the last 8 raw
// values, a mean-±-SD diamond in blue (widest at the mean, tapering to
// points at mean±SD — SD rather than standard error, so the width reflects
// actual note-to-note spread rather than shrinking as more samples land),
// plus a thin vertical tick for every value recorded within the last
// RECENT_WINDOW_MS — not just the single latest one, so playing two-handed
// (which produces two duration values, and two gap values, at essentially
// the same moment) shows a tick for each hand, not just whichever happened
// to be processed last.
//
// The axis zooms to fit the last 16 notes, but only between a small fixed
// set of sizes (50/100/200/400/800/1600ms) rather than continuously, so it
// settles on one of a few recognisable "zoom levels" instead of drifting
// to an arbitrary value. It always includes 0. The current endpoints are
// printed in small text under the axis.
//
// Duration is one-sided. Blur/Gap is signed: for each adjacent pair of
// notes there's a single gap, releaseOfPrevious -> onsetOfNext. Negative
// means the notes overlapped (blurring); positive means there was a gap (a
// clean separation). The rolling mean/SD is one blue diamond over the
// signed values either side of a zero notch; the current-value tick is red
// when it's a blur (negative) and blue when it's a gap (positive).
// Perfectly clean legato playing keeps everything sitting on zero.
//
// Notes aren't simply paired in onset order, though — two hands playing the
// same line an octave (or more) apart would otherwise look like constant
// blurring between the hands. Notes struck within ~50ms of each other form
// a "cluster" (both hands hitting a note together, or a chord); pairing
// only happens ACROSS clusters, one-to-one by sorted pitch position
// (lowest note pairs with the previous cluster's lowest, etc.), so C2+C3
// then D2+D3 pairs C2->D2 and C3->D3, never C2->C3.
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

  const DOT_WINDOW = 8;             // notes shown as dots, and folded into the mean/SD
  const ZOOM_WINDOW = 16;           // notes considered when choosing the axis range
  const RECENT_WINDOW_MS = 100;     // values this fresh all get their own current-value tick
  const SCALE_LEVELS = [50, 100, 200, 400, 800, 1600]; // the only axis sizes it zooms between
  const MAX_INTERVAL_MS = 1000;     // gaps longer than this are a rest, not counted
  const MAX_BLUR_MS = 500;          // overlaps longer than this are intentional, not counted

  // Always starts off — it's a diagnostic add-on, not something to leave
  // running by default, even if it was switched on in an earlier session.
  let shown = false;

  const ROWS = [
    { key: 'duration', label: 'Duration', bipolar: false, fmt: v => Math.round(v) + 'ms' },
    { key: 'timing', label: 'Blur/Gap', bipolar: true, fmt: v => (v >= 0 ? '+' : '−') + Math.round(Math.abs(v)) + 'ms' }
  ];
  const stats = {};
  ROWS.forEach(r => { stats[r.key] = { values: [], times: [] }; });

  function push(key, v) {
    const s = stats[key];
    s.values.push(v);
    s.times.push(performance.now());
    if (s.values.length > ZOOM_WINDOW) { s.values.shift(); s.times.shift(); }
  }

  function meanSD(arr) {
    if (!arr.length) return null;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    if (arr.length < 2) return { mean, sd: 0 };
    const variance = arr.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (arr.length - 1);
    return { mean, sd: Math.sqrt(variance) };
  }

  // The smallest of a fixed set of "zoom levels" that still fits everything
  // in the last 16 notes — so the axis only ever sits at one of a handful
  // of recognisable sizes, rather than drifting to an arbitrary value.
  function scaleFor(allValues) {
    const zoomSlice = allValues.slice(-ZOOM_WINDOW);
    const maxAbs = zoomSlice.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    for (const level of SCALE_LEVELS) if (level >= maxAbs) return level;
    return Math.ceil(maxAbs / 200) * 200; // an escape valve for a genuinely huge outlier
  }

  // Every value recorded within the last RECENT_WINDOW_MS of the newest one
  // — so two-handed playing (which produces two duration/gap values within
  // a few ms of each other) gets a tick for each, not just whichever was
  // processed last.
  function recentValues(s) {
    const n = s.values.length;
    if (!n) return [];
    const cutoff = s.times[n - 1] - RECENT_WINDOW_MS;
    let i = n - 1;
    while (i > 0 && s.times[i - 1] >= cutoff) i--;
    return s.values.slice(i);
  }

  // Notes struck within this long of each other are one "cluster" — e.g.
  // both hands hitting a scale degree (or a chord) near-simultaneously.
  // Notes inside the same cluster are never paired with each other (that's
  // what stops two hands playing the same line in octaves from registering
  // as constant blurring); pairing only happens ACROSS clusters, matching
  // each cluster's notes to the previous cluster's by sorted pitch position
  // (lowest-with-lowest, next-with-next, ...) — so C2-C3 then D2-D3 pairs
  // C2->D2 and C3->D3, not C2->C3 or C3->D2.
  const CLUSTER_WINDOW_MS = 50;

  const onTimes = new Map(); // note -> { onset, offset, pendingNextOnset }
  let clusterNotes = [];     // pending cluster: [{ note, entry }]
  let clusterTimer = null;
  let prevVoices = [];       // previous cluster, sorted by pitch: [{ note, entry }]

  function flushCluster() {
    clusterTimer = null;
    const cluster = clusterNotes.slice().sort((a, b) => a.note - b.note);
    clusterNotes = [];
    const n = Math.min(cluster.length, prevVoices.length);
    for (let i = 0; i < n; i++) {
      const prevEntry = prevVoices[i].entry;
      const newEntry = cluster[i].entry;
      if (prevEntry.offset != null) recordGap(newEntry.onset - prevEntry.offset);
      else prevEntry.pendingNextOnset = newEntry.onset;
    }
    prevVoices = cluster;
  }

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
      ? 'How long each note is held down. Each dot is one of the last 8 notes; the blue diamond is their mean ± standard deviation (widest at the mean); the thin vertical line(s) show whatever was just played — one per hand if you played more than one note at once. The axis zooms to fit the last 16 notes, snapping between a few fixed sizes (50/100/200/400/800/1600ms) and always includes 0 — the small numbers underneath are its current endpoints.'
      : 'Time from one note releasing to the next starting — negative (left of the notch) means the notes overlapped (blurring), positive (right) means there was a gap. Each dot is one of the last 8; the blue diamond is their mean ± standard deviation. The thin vertical line(s) are whatever was just played (red for a blur, blue for a gap) — one per hand if more than one happened at once. The axis snaps between a few fixed sizes, same as Duration. Long rests and deliberately held/overlapping notes are ignored.');
    row.innerHTML =
      '<div class="midi-stat-label">' + r.label + '</div>' +
      '<canvas class="midi-stat-plot" width="140" height="25"></canvas>' +
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

  // Spreads each of the up-to-8 dots evenly through the vertical band
  // (oldest at top) purely so repeated/close values don't sit exactly on
  // top of each other — not a statistical jitter, just legibility.
  function dotY(i, n, midY, halfH) {
    if (n <= 1) return midY;
    return midY - halfH + ((i + 0.5) / n) * (2 * halfH);
  }

  function drawDots(ctx, slice, xForVal, midY, halfH, colorFor) {
    slice.forEach((v, i) => {
      ctx.fillStyle = colorFor(v);
      ctx.beginPath();
      ctx.arc(xForVal(v), dotY(i, slice.length, midY, halfH), 1.7, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function renderPlot(key) {
    const r = ROWS.find(x => x.key === key);
    const canvas = rowEls[key].plot;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const pad = 5;
    const labelStrip = 8; // reserved at the bottom for the endpoint numbers
    const plotH = h - labelStrip;
    const midY = plotH / 2;
    const halfH = plotH / 2 - 1;
    const labelY = h - 1;
    ctx.clearRect(0, 0, w, h);

    const s = stats[key];
    const full = s.values;
    const dotSlice = full.slice(-DOT_WINDOW);
    const recent = recentValues(s);
    const scale = scaleFor(full);

    ctx.font = '7px sans-serif';
    ctx.fillStyle = '#9aa4c0';

    if (r.bipolar) {
      const xForVal = v => w / 2 + Math.max(-1, Math.min(1, v / scale)) * (w / 2 - pad);
      ctx.strokeStyle = '#ccd3ea';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad, midY);
      ctx.lineTo(w - pad, midY);
      ctx.stroke();

      drawDots(ctx, dotSlice, xForVal, midY, halfH, v => v < 0 ? 'rgba(224, 80, 80, 0.5)' : 'rgba(58, 111, 224, 0.5)');

      const stat = meanSD(dotSlice);
      if (stat) drawDiamond(ctx, xForVal(stat.mean), xForVal(stat.mean - stat.sd), xForVal(stat.mean + stat.sd), midY, halfH, 'rgba(58, 111, 224, 0.75)');

      recent.forEach(v => {
        const x = xForVal(v);
        ctx.strokeStyle = v < 0 ? '#c0392b' : '#1a56db';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x, 1);
        ctx.lineTo(x, plotH - 1);
        ctx.stroke();
      });

      // Zero notch drawn last, full plot height, so it stays visible cutting
      // through the diamond/dots rather than being buried under them.
      ctx.strokeStyle = '#5a6fa8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w / 2, plotH);
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.fillText('−' + scale, pad, labelY);
      ctx.textAlign = 'right';
      ctx.fillText('+' + scale, w - pad, labelY);
    } else {
      const xForVal = v => pad + Math.max(0, Math.min(1, v / scale)) * (w - pad * 2);
      ctx.strokeStyle = '#ccd3ea';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad, midY);
      ctx.lineTo(w - pad, midY);
      ctx.stroke();

      drawDots(ctx, dotSlice, xForVal, midY, halfH, () => 'rgba(58, 111, 224, 0.5)');

      const stat = meanSD(dotSlice);
      if (stat) drawDiamond(ctx, xForVal(stat.mean), xForVal(Math.max(0, stat.mean - stat.sd)), xForVal(stat.mean + stat.sd), midY, halfH, 'rgba(58, 111, 224, 0.75)');

      recent.forEach(v => {
        const x = xForVal(v);
        ctx.strokeStyle = '#1a56db';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x, 1);
        ctx.lineTo(x, plotH - 1);
        ctx.stroke();
      });

      ctx.textAlign = 'left';
      ctx.fillText('0', pad, labelY);
      ctx.textAlign = 'right';
      ctx.fillText(String(scale), w - pad, labelY);
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
    onTimes.set(note, entry);
    clusterNotes.push({ note, entry });
    clearTimeout(clusterTimer);
    clusterTimer = setTimeout(flushCluster, CLUSTER_WINDOW_MS);
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

  // Just resyncs the box's 'has-stats' class, without re-rendering the
  // plots — midi-readout.js calls this after every note (its own render()
  // resets the box's whole className, which would otherwise wipe this
  // class), so it must stay cheap and side-effect-free on the actual stats
  // data. The data itself is redrawn directly by the onNoteOn/onNoteOff
  // handlers below, exactly once per note.
  function syncClass() {
    const active = shown && circle.style.display !== 'none';
    circle.classList.toggle('has-stats', active);
  }
  window.MidiStatsSync = syncClass;

  function applyVisibility() {
    const collapsed = circle.style.display === 'none';
    const active = shown && !collapsed;
    wrap.style.display = active ? '' : 'none';
    circle.classList.toggle('has-stats', active);
    toggleBtn.classList.toggle('active', shown);
    if (active) renderAll();
  }

  toggleBtn.addEventListener('click', () => {
    shown = !shown;
    applyVisibility();
  });

  M.onStatus(st => { if (st.state !== 'ready') applyVisibility(); });

  applyVisibility();
})();
