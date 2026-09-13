(() => {
  const SHOW_DELAY_MS = 600;
  const MARGIN = 10;

  const tip = document.createElement('div');
  tip.className = 'app-tooltip';
  document.body.appendChild(tip);

  let showTimer = null;
  let currentTarget = null;

  function findTipTarget(el) {
    while (el && el !== document.body) {
      if (el.hasAttribute && el.hasAttribute('data-tip')) return el;
      el = el.parentElement || el.parentNode;
    }
    return null;
  }

  function positionTip(target) {
    const r = target.getBoundingClientRect();
    tip.style.visibility = 'hidden';
    tip.classList.add('visible');
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.classList.remove('visible');
    tip.style.visibility = '';

    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - tw - MARGIN));

    let top = r.bottom + 8;
    if (top + th > window.innerHeight - MARGIN) top = r.top - th - 8;
    if (top < MARGIN) top = MARGIN;

    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }

  function showTip(target) {
    const text = target.getAttribute('data-tip');
    if (!text) return;
    tip.textContent = text;
    positionTip(target);
    tip.classList.add('visible');
  }

  function hideTip() {
    clearTimeout(showTimer);
    showTimer = null;
    currentTarget = null;
    tip.classList.remove('visible');
  }

  document.addEventListener('mouseover', (e) => {
    const target = findTipTarget(e.target);
    if (target === currentTarget) return;
    hideTip();
    if (!target) return;
    currentTarget = target;
    showTimer = setTimeout(() => showTip(target), SHOW_DELAY_MS);
  });

  document.addEventListener('mouseout', (e) => {
    if (!currentTarget) return;
    const to = e.relatedTarget;
    if (to && currentTarget.contains && currentTarget.contains(to)) return;
    hideTip();
  });

  document.addEventListener('mousedown', hideTip);
  window.addEventListener('blur', hideTip);
  document.addEventListener('scroll', hideTip, true);
})();
