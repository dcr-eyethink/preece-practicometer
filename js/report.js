// Practice report dashboard: full-window overlay (below the top bar) with
// daily minutes (line chart) and time per practice item (bar chart) for a
// chosen date range. Pure SVG, no dependencies.
(function () {
  const btn = document.getElementById('reportBtn');
  const topBar = document.getElementById('topBar');
  if (!btn || !topBar) return;

  const css = document.createElement('style');
  css.textContent = `
  #reportOverlay { position: fixed; left: 0; right: 0; bottom: 0; background: #fff; z-index: 500; overflow-y: auto; padding: 20px 28px 40px; display: none; }
  #reportOverlay.open { display: block; }
  .rep-head { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 18px; }
  .rep-head h2 { margin: 0; font-size: 20px; flex: 1; min-width: 160px; }
  .rep-head label { font-size: 13px; color: #556; display: flex; align-items: center; gap: 6px; }
  .rep-head input[type=date] { font: inherit; padding: 4px 6px; border: 1px solid #ccd; border-radius: 6px; }
  .rep-quick button { font: inherit; font-size: 12px; padding: 4px 9px; border: 1px solid #ccd; background: #f7f8fa; border-radius: 6px; cursor: pointer; }
  .rep-quick button:hover { background: #e8eeff; border-color: #7090e0; }
  .rep-stats { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 18px; }
  .rep-stat { background: #f7f8fa; border: 1px solid #e0e4ee; border-radius: 10px; padding: 10px 16px; min-width: 120px; }
  .rep-stat b { display: block; font-size: 22px; color: #1a4a8a; }
  .rep-stat span { font-size: 12px; color: #667; }
  .rep-card { border: 1px solid #e0e4ee; border-radius: 12px; padding: 14px 16px 10px; margin-bottom: 18px; }
  .rep-card h3 { margin: 0 0 8px; font-size: 15px; color: #334; }
  .rep-card svg { width: 100%; height: auto; display: block; }
  .rep-empty { color: #888; text-align: center; padding: 30px 0; }
  .rep-tip { position: fixed; pointer-events: none; background: #223; color: #fff; font-size: 12px; padding: 4px 8px; border-radius: 6px; z-index: 600; display: none; }
  `;
  document.head.appendChild(css);

  const overlay = document.createElement('div');
  overlay.id = 'reportOverlay';
  overlay.innerHTML = `
    <div class="rep-head">
      <h2>Practice report</h2>
      <span class="rep-quick">
        <button data-days="7">7 days</button>
        <button data-days="30">30 days</button>
        <button data-days="90">90 days</button>
      </span>
      <label>From <input type="date" id="repFrom"></label>
      <label>To <input type="date" id="repTo"></label>
    </div>
    <div class="rep-stats" id="repStats"></div>
    <div class="rep-card"><h3>Minutes practised per day</h3><div id="repLine"></div></div>
    <div class="rep-card"><h3>Minutes per practice item</h3><div id="repBars"></div></div>`;
  document.body.appendChild(overlay);
  const tip = document.createElement('div');
  tip.className = 'rep-tip';
  document.body.appendChild(tip);

  const fromEl = overlay.querySelector('#repFrom');
  const toEl = overlay.querySelector('#repTo');
  const pad = n => String(n).padStart(2, '0');
  const dayKey = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

  function setRange(days) {
    const to = new Date();
    const from = new Date(); from.setDate(from.getDate() - (days - 1));
    fromEl.value = dayKey(from); toEl.value = dayKey(to);
  }

  function position() { overlay.style.top = topBar.getBoundingClientRect().bottom + 'px'; }
  let open = false;
  function setOpen(v) {
    open = v;
    position();
    overlay.classList.toggle('open', v);
    btn.classList.toggle('active', v);
    if (v) { if (!fromEl.value) setRange(7); render(); }
  }
  btn.addEventListener('click', () => setOpen(!open));
  // Clicking any other top-bar icon leaves the report and lets that click through.
  topBar.addEventListener('click', e => { if (open && !btn.contains(e.target)) setOpen(false); }, true);
  window.addEventListener('resize', () => { if (open) position(); });
  overlay.querySelectorAll('.rep-quick button').forEach(b =>
    b.addEventListener('click', () => { setRange(+b.dataset.days); render(); }));
  fromEl.addEventListener('change', render);
  toEl.addEventListener('change', render);

  const NS = 'http://www.w3.org/2000/svg';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtMin = m => m >= 60 ? Math.floor(m / 60) + 'h ' + Math.round(m % 60) + 'm' : Math.round(m) + 'm';

  // Round the axis maximum up to a tidy value and return tick values.
  function niceAxis(max) {
    if (max <= 0) return { top: 10, ticks: [0, 5, 10] };
    const raw = max / 4, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map(f => f * mag).find(s => s >= raw);
    const ticks = []; for (let v = 0; v <= max + step; v += step) { ticks.push(v); if (v >= max) break; }
    return { top: ticks[ticks.length - 1], ticks };
  }

  function showTip(e, text) {
    tip.textContent = text; tip.style.display = 'block';
    tip.style.left = (e.clientX + 12) + 'px'; tip.style.top = (e.clientY + 12) + 'px';
  }
  const hideTip = () => { tip.style.display = 'none'; };
  function hover(el, text) {
    el.addEventListener('mousemove', e => showTip(e, text));
    el.addEventListener('mouseleave', hideTip);
  }

  function lineChart(host, days) {
    const W = 900, H = 280, L = 44, R = 16, T = 12, B = 34;
    const max = Math.max(...days.map(d => d.min));
    const ax = niceAxis(max);
    const x = i => L + (days.length === 1 ? (W - L - R) / 2 : i * (W - L - R) / (days.length - 1));
    const y = v => T + (H - T - B) * (1 - v / ax.top);
    let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="${NS}" font-size="11" fill="#667">`;
    ax.ticks.forEach(t => {
      s += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="#e6e9f0"/>` +
           `<text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`;
    });
    const every = Math.ceil(days.length / 12);
    days.forEach((d, i) => {
      if (i % every === 0) s += `<text x="${x(i)}" y="${H - 12}" text-anchor="middle">${d.date.getDate()}/${d.date.getMonth() + 1}</text>`;
    });
    s += `<polyline fill="none" stroke="#3b6fd8" stroke-width="2.5" stroke-linejoin="round" points="${days.map((d, i) => x(i) + ',' + y(d.min)).join(' ')}"/>`;
    days.forEach((d, i) => {
      s += `<circle data-i="${i}" cx="${x(i)}" cy="${y(d.min)}" r="${days.length > 40 ? 3 : 4.5}" fill="#3b6fd8" stroke="#fff" stroke-width="1.5"/>`;
    });
    s += '</svg>';
    host.innerHTML = s;
    host.querySelectorAll('circle').forEach(c => {
      const d = days[+c.dataset.i];
      hover(c, d.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) + ': ' + fmtMin(d.min));
    });
  }

  function barChart(host, items) {
    if (!items.length) { host.innerHTML = '<div class="rep-empty">No itemised activity in this period.</div>'; return; }
    const rowH = 26, L = 190, R = 60, T = 6, W = 900, H = T + items.length * rowH + 6;
    const max = Math.max(...items.map(i => i.min));
    let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="${NS}" font-size="12" fill="#334">`;
    items.forEach((it, i) => {
      const y = T + i * rowH, w = Math.max(2, (W - L - R) * it.min / max);
      const label = it.name.length > 28 ? it.name.slice(0, 27) + '…' : it.name;
      s += `<text x="${L - 8}" y="${y + 16}" text-anchor="end">${esc(label)}</text>` +
           `<rect data-i="${i}" x="${L}" y="${y + 3}" width="${w}" height="${rowH - 8}" rx="3" fill="#3b6fd8"/>` +
           `<text x="${L + w + 6}" y="${y + 16}" fill="#667">${fmtMin(it.min)}</text>`;
    });
    s += '</svg>';
    host.innerHTML = s;
    host.querySelectorAll('rect').forEach(r => {
      const it = items[+r.dataset.i];
      hover(r, it.name + ': ' + fmtMin(it.min) + ' (' + it.count + ' session' + (it.count === 1 ? '' : 's') + ')');
    });
  }

  async function render() {
    if (!open) return;
    position();
    const stats = overlay.querySelector('#repStats');
    let entries = [];
    try { entries = await window.api.listPracticeLog(); }
    catch (err) { console.error('Report: failed to load practice log', err); }

    if (!fromEl.value || !toEl.value) setRange(7);
    let from = parseDay(fromEl.value), to = parseDay(toEl.value);
    if (from > to) { [from, to] = [to, from]; }
    const end = new Date(to); end.setDate(end.getDate() + 1);

    const dayMap = new Map(), itemMap = new Map();
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) dayMap.set(dayKey(d), 0);
    let sessions = 0;
    entries.forEach(e => {
      const t = new Date(e.started_at);
      if (t < from || t >= end) return;
      sessions++;
      const k = dayKey(t);
      dayMap.set(k, (dayMap.get(k) || 0) + (e.duration_sec || 0) / 60);
      (Array.isArray(e.activities) ? e.activities : []).forEach(a => {
        const m = parseFloat(a.minutes) || 0;
        if (!a.activity || m <= 0) return;
        const it = itemMap.get(a.activity) || { name: a.activity, min: 0, count: 0 };
        it.min += m; it.count++; itemMap.set(a.activity, it);
      });
    });
    const days = [...dayMap].map(([k, min]) => ({ date: parseDay(k), min: Math.round(min * 10) / 10 }));
    const total = days.reduce((a, d) => a + d.min, 0);
    const active = days.filter(d => d.min > 0).length;
    stats.innerHTML =
      `<div class="rep-stat"><b>${fmtMin(total)}</b><span>total practice</span></div>` +
      `<div class="rep-stat"><b>${sessions}</b><span>sessions</span></div>` +
      `<div class="rep-stat"><b>${active} / ${days.length}</b><span>days practised</span></div>` +
      `<div class="rep-stat"><b>${fmtMin(total / days.length)}</b><span>average per day</span></div>`;
    lineChart(overlay.querySelector('#repLine'), days);
    barChart(overlay.querySelector('#repBars'), [...itemMap.values()].sort((a, b) => b.min - a.min));
  }
})();
