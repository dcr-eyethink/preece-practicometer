(function () {
  const SCORE_DROP_TYPE = 'application/x-practicometer-score';

  const scoresPanel = document.getElementById('scoresPanel');
  const scoresGrid = document.getElementById('scoresGrid');
  const scoresEmpty = document.getElementById('scoresEmpty');
  const scoresUploadStatus = document.getElementById('scoresUploadStatus');
  const uploadInput = document.getElementById('scoreUploadInput');
  const scoresIconBtn = document.getElementById('scoresIconBtn');
  const scoresBackBtn = document.getElementById('scoresBackBtn');

  const scorePanel = document.getElementById('scorePanel');
  const scoreViewer = document.getElementById('scoreViewer');
  const scoreActiveTitle = document.getElementById('scoreActiveTitle');
  const scoreBackBtn = document.getElementById('scoreBackBtn');

  function isImage(mimeType) { return (mimeType || '').startsWith('image/'); }

  // Electron doesn't implement window.prompt() (unlike alert/confirm) — it
  // returns null immediately with no dialog shown, so anything built on it
  // silently does nothing in the desktop app. Used in place of prompt() for
  // renaming: turns `el` into an editable text field pre-filled with
  // `currentValue`, committing on Enter/blur (Escape or an empty result
  // reverts instead).
  function startInlineRename(el, currentValue, onCommit) {
    el.contentEditable = 'true';
    el.textContent = currentValue;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);

    function finish(commit) {
      el.contentEditable = 'false';
      el.removeEventListener('blur', onBlur);
      el.removeEventListener('keydown', onKeydown);
      const newVal = el.textContent.trim();
      if (commit && newVal && newVal !== currentValue) onCommit(newVal);
      else el.textContent = currentValue;
    }
    function onBlur() { finish(true); }
    function onKeydown(e) {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    }
    el.addEventListener('blur', onBlur);
    el.addEventListener('keydown', onKeydown);
  }

  function renderScoreCard(score) {
    const card = document.createElement('div');
    card.className = 'score-card';
    card.draggable = true;
    card.dataset.tip = 'Drag onto the practice list to add it as a timed item.';

    if (isImage(score.mime_type)) {
      const img = document.createElement('img');
      img.className = 'score-thumb';
      img.alt = score.name;
      window.api.getScoreUrl(score.id).then(({ url }) => { img.src = url; }).catch(() => {});
      card.appendChild(img);
    } else {
      const icon = document.createElement('div');
      icon.className = 'score-thumb-icon';
      icon.textContent = '📄';
      card.appendChild(icon);
    }

    const name = document.createElement('div');
    name.className = 'score-name';
    name.textContent = score.name;
    name.dataset.tip = 'Click to rename.';
    name.addEventListener('click', (e) => {
      e.stopPropagation();
      startInlineRename(name, score.name, async newName => {
        await window.api.renameScore(score.id, newName);
        renderScoresGrid();
      });
    });
    card.appendChild(name);

    const del = document.createElement('button');
    del.className = 'score-delete-btn';
    del.textContent = '×';
    del.dataset.tip = 'Delete this score.';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      let usage = [];
      try { usage = await window.api.findScoreUsage(score.id); } catch (err) { console.error('findScoreUsage failed:', err); }
      let msg = 'Delete "' + score.name + '"? This can\'t be undone.';
      if (usage.length > 0) {
        const list = usage.map(u => u.setName + ' → ' + u.activity).join('\n');
        msg = 'Delete "' + score.name + '"? It\'s still used by:\n' + list
          + '\n\nThose items will fail to load until you remove or replace them. This can\'t be undone.';
      }
      if (!confirm(msg)) return;
      await window.api.deleteScore(score.id);
      renderScoresGrid();
    });
    card.appendChild(del);

    card.addEventListener('dragstart', e => {
      e.dataTransfer.setData(SCORE_DROP_TYPE, score.id);
      e.dataTransfer.setData('text/plain', score.name);
      e.dataTransfer.effectAllowed = 'copy';
    });

    return card;
  }

  async function renderScoresGrid() {
    const scores = await window.api.listScores();
    scoresGrid.innerHTML = '';
    scoresEmpty.style.display = scores.length === 0 ? 'block' : 'none';
    scores.forEach(score => scoresGrid.appendChild(renderScoreCard(score)));
  }

  // The scores library lives in the right-hand slot — the same place the
  // practice timer goes — so a practice list stays visible in the middle to
  // drag scores into. Only one of {timer, scores library} shows there at a
  // time; closing the library restores the timer if practice is still running.
  function openScoresPanel() {
    document.getElementById('practicePanel').classList.remove('active');
    scoresPanel.classList.add('active');
    scoresIconBtn.classList.add('active');
    renderScoresGrid();
    if (window.setMobileView) window.setMobileView('scores');
  }
  function closeScoresPanel() {
    scoresPanel.classList.remove('active');
    scoresIconBtn.classList.remove('active');
    const isPracticing = window.isPracticeActive && window.isPracticeActive();
    if (isPracticing) document.getElementById('practicePanel').classList.add('active');
    if (window.setMobileView) window.setMobileView(isPracticing ? 'practice' : 'list');
  }
  if (scoresIconBtn) scoresIconBtn.addEventListener('click', () => {
    if (scoresPanel.classList.contains('active')) closeScoresPanel();
    else openScoresPanel();
  });
  if (scoresBackBtn) scoresBackBtn.addEventListener('click', closeScoresPanel);

  if (uploadInput) {
    uploadInput.addEventListener('change', async () => {
      const file = uploadInput.files[0];
      if (!file) return;
      const defaultName = file.name.replace(/\.[^./]+$/, '');
      uploadInput.value = '';
      scoresUploadStatus.textContent = 'Uploading …';
      try {
        await window.api.uploadScore(file, defaultName);
        scoresUploadStatus.textContent = '';
        renderScoresGrid();
      } catch (err) {
        scoresUploadStatus.textContent = (err && err.message) || 'Upload failed.';
      }
    });
  }

  // Shows the given score full-size in the middle panel (used when a
  // 'score' practice-list row becomes active). Called by loadPracticeItem's
  // dispatch in index.html.
  async function showActive(scoreId) {
    if (window.copyIcon) window.copyIcon('scoresIconBtn', 'scorePanelIcon');
    scoreViewer.innerHTML = '<div class="score-loading">Loading…</div>';
    scoreActiveTitle.textContent = 'Score';
    try {
      const { url, mimeType, name } = await window.api.getScoreUrl(scoreId);
      scoreActiveTitle.textContent = name;
      scoreViewer.innerHTML = '';
      if (isImage(mimeType)) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = name;
        scoreViewer.appendChild(img);
      } else {
        const embed = document.createElement('embed');
        embed.src = url;
        embed.type = mimeType || 'application/pdf';
        scoreViewer.appendChild(embed);
      }
    } catch (err) {
      scoreViewer.innerHTML = '<div class="score-loading">Could not load this score.</div>';
    }
  }

  if (scoreBackBtn) scoreBackBtn.addEventListener('click', () => { if (window.hideAllCentralPanels) window.hideAllCentralPanels(); });

  window.ScoresUI = { showActive, refresh: renderScoresGrid };
})();
