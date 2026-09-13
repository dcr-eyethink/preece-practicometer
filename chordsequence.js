(() => {
  const KEY_LIST = [
    { name: 'C', pc: 0 }, { name: 'G', pc: 7 }, { name: 'D', pc: 2 }, { name: 'A', pc: 9 },
    { name: 'E', pc: 4 }, { name: 'B', pc: 11 }, { name: 'F#', pc: 6 }, { name: 'Db', pc: 1 },
    { name: 'Ab', pc: 8 }, { name: 'Eb', pc: 3 }, { name: 'Bb', pc: 10 }, { name: 'F', pc: 5 }
  ];

  // Diatonic triads of the major scale (degrees 1-6; vii° omitted).
  const DEGREE_INFO = {
    1: { roman: 'I', semitone: 0, quality: 'maj' },
    2: { roman: 'ii', semitone: 2, quality: 'min' },
    3: { roman: 'iii', semitone: 4, quality: 'min' },
    4: { roman: 'IV', semitone: 5, quality: 'maj' },
    5: { roman: 'V', semitone: 7, quality: 'maj' },
    6: { roman: 'vi', semitone: 9, quality: 'min' }
  };

  const PROGRESSIONS = {
    2: [[5, 1], [4, 1], [2, 5], [1, 4]],
    3: [[2, 5, 1], [1, 4, 5], [6, 4, 1], [1, 6, 4]],
    4: [[1, 5, 6, 4], [6, 4, 1, 5], [1, 6, 4, 5], [2, 5, 1, 6]]
  };

  const state = { keyIndex: 0, targetSeq: [], guessSeq: [] };
  let currentSeqLen = 1;
  let lastSingle = null;
  let lastProg = null;
  const SCORE_KEY = 'chordSequenceScore';
  function loadScore() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SCORE_KEY));
      if (parsed && typeof parsed.correct === 'number' && typeof parsed.total === 'number') {
        if (typeof parsed.staircaseBest !== 'number') parsed.staircaseBest = 0;
        return parsed;
      }
    } catch (e) {}
    return { correct: 0, total: 0, staircaseBest: 0 };
  }
  function saveScore() {
    try { localStorage.setItem(SCORE_KEY, JSON.stringify(score)); } catch (e) {}
  }

  let score = loadScore();

  // Adaptive difficulty ladder: a simple 1-up/1-down staircase (Cornsweet, 1962) — one rung
  // harder after every correct answer, one rung easier after every wrong one. Early rungs
  // restrict the single-chord pool to the most easily-distinguished degrees (V, IV) before
  // widening it; later rungs step up to longer progressions, and the final rung also changes
  // key every turn so the ear can't settle into one tonal center.
  const STAIRCASE_LEVELS = [
    { seqLen: 1, pool: [5] },
    { seqLen: 1, pool: [5, 4] },
    { seqLen: 1, pool: [5, 4, 6] },
    { seqLen: 1, pool: [5, 4, 6, 2, 3] },
    { seqLen: 2 },
    { seqLen: 3 },
    { seqLen: 4 },
    { seqLen: 4, randomizeKey: true }
  ];
  const staircase = { active: false, level: 1, peakLevel: 1 };
  let manualSeqLenSnapshot = null;

  function updateScoreDisplay() {
    const el = document.getElementById('csScore');
    if (!el) return;
    const pct = score.total ? Math.round((score.correct / score.total) * 100) : null;
    let text = `Score: ${score.correct}/${score.total} (${pct === null ? '—' : pct + '%'})`;
    if (score.staircaseBest > 0) text += ` · Best level: ${score.staircaseBest}/${STAIRCASE_LEVELS.length}`;
    el.textContent = text;
  }

  function updateStaircaseStatus() {
    const el = document.getElementById('csStaircaseStatus');
    if (!el) return;
    el.textContent = `Staircase — Level ${staircase.level} of ${STAIRCASE_LEVELS.length}`;
  }

  function recordAttempt(isCorrect) {
    score.total++;
    if (isCorrect) score.correct++;
    saveScore();
    updateScoreDisplay();
  }

  let initialized = false;
  let statusRevertTimer = null;

  let ctx = null;
  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }

  const SHARP_NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];
  const SAMPLE_MIN = 48, SAMPLE_MAX = 75; // covers every root/third/fifth used across all keys
  function sampleFileForMidi(midi) {
    const name = SHARP_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
    return `samples/piano/${name}.mp3`;
  }
  const sampleBuffers = {};
  let samplesLoadingPromise = null;
  function ensureSamplesLoaded() {
    if (samplesLoadingPromise) return samplesLoadingPromise;
    const c = getCtx();
    const needed = [];
    for (let m = SAMPLE_MIN; m <= SAMPLE_MAX; m++) needed.push(m);
    samplesLoadingPromise = Promise.all(needed.map(midi =>
      fetch(sampleFileForMidi(midi))
        .then(r => r.arrayBuffer())
        .then(arr => c.decodeAudioData(arr))
        .then(buf => { sampleBuffers[midi] = buf; })
        .catch(() => {})
    ));
    return samplesLoadingPromise;
  }

  function setStatus(text) {
    clearTimeout(statusRevertTimer);
    document.getElementById('csStatus').textContent = text;
  }
  function flashStatus(text, revertText, ms) {
    clearTimeout(statusRevertTimer);
    document.getElementById('csStatus').textContent = text;
    statusRevertTimer = setTimeout(() => { document.getElementById('csStatus').textContent = revertText; }, ms);
  }

  function triadFor(tonicMidi, degree) {
    const info = DEGREE_INFO[degree];
    const root = tonicMidi + info.semitone;
    const third = root + (info.quality === 'maj' ? 4 : 3);
    const fifth = root + 7;
    return [root, third, fifth];
  }

  function playChordTones(midiNotes, startTime) {
    const c = getCtx();
    midiNotes.forEach(m => {
      const buf = sampleBuffers[m];
      if (!buf) return;
      const src = c.createBufferSource();
      const gain = c.createGain();
      src.buffer = buf;
      src.connect(gain); gain.connect(c.destination);
      const vol = window.masterVolume != null ? window.masterVolume : 1;
      gain.gain.setValueAtTime(0.55 * vol, startTime);
      src.start(startTime);
    });
  }

  async function playTurnAudio() {
    const c = getCtx();
    if (c.state === 'suspended') c.resume();
    await ensureSamplesLoaded();
    const tonicMidi = 48 + KEY_LIST[state.keyIndex].pc;
    const dur = 0.75, gap = 0.15;
    let t = c.currentTime + 0.1;
    if (currentSeqLen === 1) {
      playChordTones(triadFor(tonicMidi, 1), t);
      t += dur + gap;
    }
    state.targetSeq.forEach(deg => {
      playChordTones(triadFor(tonicMidi, deg), t);
      t += dur + gap;
    });
  }

  async function playTonicOnly() {
    const c = getCtx();
    if (c.state === 'suspended') c.resume();
    await ensureSamplesLoaded();
    const tonicMidi = 48 + KEY_LIST[state.keyIndex].pc;
    playChordTones(triadFor(tonicMidi, 1), c.currentTime + 0.05);
  }

  function chordDisplayName(deg) {
    const keyName = KEY_LIST[state.keyIndex].name;
    const names = window.CHORD_DATA ? window.CHORD_DATA[keyName] : null;
    if (!names) return '';
    const raw = names[deg - 1];
    return window.musicalChord ? window.musicalChord(raw) : raw;
  }

  function refreshChordButtonLabels() {
    document.querySelectorAll('#csChordRow .cs-chord-btn').forEach(btn => {
      const deg = Number(btn.dataset.degree);
      btn.innerHTML =
        `<span class="cs-chord-roman">${DEGREE_INFO[deg].roman}</span>` +
        `<span class="cs-chord-name">${chordDisplayName(deg)}</span>`;
    });
  }

  function updateKeyDisplay() {
    document.getElementById('csKeyBtn').innerHTML =
      `Key: ${KEY_LIST[state.keyIndex].name} major<span class="cs-key-hint">(click to change)</span>`;
    refreshChordButtonLabels();
  }

  function renderGuessDisplay() {
    const row = document.getElementById('csGuessRow');
    row.innerHTML = '';
    for (let i = 0; i < currentSeqLen; i++) {
      const slot = document.createElement('div');
      const filled = i < state.guessSeq.length;
      slot.className = 'cs-guess-slot' + (filled ? ' filled' : '');
      slot.textContent = filled ? DEGREE_INFO[state.guessSeq[i]].roman : '–';
      slot.setAttribute('data-tip', 'Your guess for chord ' + (i + 1) + ' of this sequence.');
      row.appendChild(slot);
    }
  }

  function buildChordButtons() {
    const row = document.getElementById('csChordRow');
    row.innerHTML = '';
    [1, 2, 3, 4, 5, 6].forEach(deg => {
      const b = document.createElement('button');
      b.className = 'cs-chord-btn';
      b.dataset.degree = deg;
      b.innerHTML = `<span class="cs-chord-roman">${DEGREE_INFO[deg].roman}</span><span class="cs-chord-name"></span>`;
      b.setAttribute('data-tip', 'Click to answer with this chord — directly in single-chord mode, or added to your guess sequence in 2–4 chord mode.');
      b.addEventListener('click', () => onChordButtonClick(deg, b));
      row.appendChild(b);
    });
  }

  function enterStaircase() {
    manualSeqLenSnapshot = currentSeqLen;
    staircase.active = true;
    staircase.level = 1;
    staircase.peakLevel = 1;
    document.getElementById('csModeRow').classList.add('cs-locked');
    document.getElementById('csKeyBtn').classList.add('cs-locked');
    document.getElementById('csStaircaseStatus').style.display = 'block';
    updateStaircaseStatus();
    newTurn();
  }

  function exitStaircase() {
    staircase.active = false;
    currentSeqLen = manualSeqLenSnapshot || 1;
    document.querySelectorAll('#csModeRow .cs-mode-btn').forEach(b => b.classList.toggle('active', Number(b.dataset.len) === currentSeqLen));
    document.getElementById('csModeRow').classList.remove('cs-locked');
    document.getElementById('csKeyBtn').classList.remove('cs-locked');
    document.getElementById('csStaircaseStatus').style.display = 'none';
    newTurn();
  }

  function stepStaircase(isCorrect) {
    if (!staircase.active) return;
    if (isCorrect) {
      staircase.level = Math.min(STAIRCASE_LEVELS.length, staircase.level + 1);
      if (staircase.level > staircase.peakLevel) staircase.peakLevel = staircase.level;
      if (staircase.peakLevel > score.staircaseBest) {
        score.staircaseBest = staircase.peakLevel;
        saveScore();
        updateScoreDisplay();
      }
    } else {
      staircase.level = Math.max(1, staircase.level - 1);
    }
    updateStaircaseStatus();
  }

  function onChordButtonClick(degree, btnEl) {
    if (currentSeqLen === 1) {
      if (degree === state.targetSeq[0]) onCorrectSingle(degree, btnEl);
      else { recordAttempt(false); stepStaircase(false); flashWrong(btnEl); }
    } else {
      if (state.guessSeq.length >= currentSeqLen) return;
      state.guessSeq.push(degree);
      renderGuessDisplay();
    }
  }

  function flashWrong(btnEl) {
    btnEl.classList.add('wrong');
    setTimeout(() => btnEl.classList.remove('wrong'), 350);
    flashStatus('Not quite — listen again and try another',
      currentSeqLen === 1 ? 'Click the second chord' : 'Rebuild the sequence you just heard', 1200);
    playTurnAudio();
  }

  function onCorrectSingle(degree, btnEl) {
    btnEl.classList.add('correct-flash');
    setStatus('Correct — that was ' + DEGREE_INFO[degree].roman);
    recordAttempt(true);
    stepStaircase(true);
    setTimeout(() => { btnEl.classList.remove('correct-flash'); newTurn(); }, 1300);
  }

  function newTurn() {
    if (staircase.active) {
      const cfg = STAIRCASE_LEVELS[staircase.level - 1];
      currentSeqLen = cfg.seqLen;
      if (cfg.randomizeKey) {
        state.keyIndex = Math.floor(Math.random() * KEY_LIST.length);
        updateKeyDisplay();
      }
    }
    const showGuessUI = currentSeqLen > 1;
    document.getElementById('csGuessRow').style.display = showGuessUI ? 'flex' : 'none';
    document.getElementById('csGuessActions').style.display = showGuessUI ? 'flex' : 'none';

    if (currentSeqLen === 1) {
      const pool = (staircase.active && STAIRCASE_LEVELS[staircase.level - 1].pool) || [2, 3, 4, 5, 6];
      let target;
      do { target = pool[Math.floor(Math.random() * pool.length)]; } while (target === lastSingle && pool.length > 1);
      lastSingle = target;
      state.targetSeq = [target];
    } else {
      const pool = PROGRESSIONS[currentSeqLen];
      let seq;
      do { seq = pool[Math.floor(Math.random() * pool.length)]; } while (pool.length > 1 && seq === lastProg);
      lastProg = seq;
      state.targetSeq = seq.slice();
    }
    state.guessSeq = [];
    renderGuessDisplay();
    setStatus(currentSeqLen === 1 ? 'Click the second chord' : 'Rebuild the sequence you just heard');
    playTurnAudio();
  }

  function wireControls() {
    document.getElementById('csScoreReset').addEventListener('click', () => {
      score = { correct: 0, total: 0, staircaseBest: 0 };
      saveScore();
      updateScoreDisplay();
    });

    document.getElementById('csStaircaseBtn').addEventListener('click', () => {
      if (staircase.active) exitStaircase(); else enterStaircase();
      document.getElementById('csStaircaseBtn').classList.toggle('active', staircase.active);
    });

    document.querySelectorAll('#csModeRow .cs-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (staircase.active) return;
        document.querySelectorAll('#csModeRow .cs-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentSeqLen = Number(btn.dataset.len);
        newTurn();
      });
    });

    document.getElementById('csKeyBtn').addEventListener('click', () => {
      if (staircase.active) return;
      state.keyIndex = Math.floor(Math.random() * KEY_LIST.length);
      updateKeyDisplay();
      newTurn();
    });

    document.getElementById('csPlayBtn').addEventListener('click', playTurnAudio);
    document.getElementById('csReplayTonicBtn').addEventListener('click', playTonicOnly);

    document.getElementById('csDeleteBtn').addEventListener('click', () => {
      state.guessSeq.pop();
      renderGuessDisplay();
    });

    document.getElementById('csSubmitBtn').addEventListener('click', () => {
      if (state.guessSeq.length !== currentSeqLen) return;
      const correct = state.guessSeq.every((d, i) => d === state.targetSeq[i]);
      recordAttempt(correct);
      stepStaircase(correct);
      if (correct) {
        setStatus('Correct! ' + state.targetSeq.map(d => DEGREE_INFO[d].roman).join('–'));
        setTimeout(newTurn, 1400);
      } else {
        setStatus('Not quite — try again');
        state.guessSeq = [];
        renderGuessDisplay();
        playTurnAudio();
      }
    });

    function openChordSeqPanel() {
      if (window.hideAllCentralPanels) window.hideAllCentralPanels();
      if (window.setActiveTopBarIcon) window.setActiveTopBarIcon('csIconBtn');
      document.getElementById('setsPanel').style.display = 'none';
      document.getElementById('chordSeqPanel').style.display = 'flex';
      const dims = window.APP_DIMENSIONS;
      if (window.api && window.api.resizeWindow) window.api.resizeWindow(dims ? dims.width2 : 1000, dims ? dims.height : 826);
      ensureInit();
    }
    const csIconBtn = document.getElementById('csIconBtn');
    if (csIconBtn) csIconBtn.addEventListener('click', openChordSeqPanel);

    document.getElementById('csBackBtn').addEventListener('click', () => {
      if (window.hideAllCentralPanels) window.hideAllCentralPanels();
      else {
        document.getElementById('chordSeqPanel').style.display = 'none';
        document.getElementById('setsPanel').style.display = '';
        const dims = window.APP_DIMENSIONS;
        if (window.api && window.api.resizeWindow) window.api.resizeWindow(dims ? dims.width2 : 1000, dims ? dims.height : 826);
      }
    });
  }

  function ensureInit() {
    if (initialized) return;
    initialized = true;
    ensureSamplesLoaded();
    buildChordButtons();
    state.keyIndex = Math.floor(Math.random() * KEY_LIST.length);
    updateKeyDisplay();
    updateScoreDisplay();
    newTurn();
  }

  wireControls();
})();
