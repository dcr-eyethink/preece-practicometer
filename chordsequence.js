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

  const state = { keyIndex: 0, targetSeq: [], guessSeq: [], correctMask: [] };
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
  // Each multi-chord length gets one rung per progression added to its pool
  // (1 -> 4, matching PROGRESSIONS' 4 canned options for that length) instead
  // of jumping straight to the full pool on the first correct answer — the
  // single-chord rungs already worked this way by widening the degree pool.
  const STAIRCASE_LEVELS = [
    { seqLen: 1, pool: [5] },
    { seqLen: 1, pool: [5, 4] },
    { seqLen: 1, pool: [5, 4, 6] },
    { seqLen: 1, pool: [5, 4, 6, 2, 3] },
    { seqLen: 2, progPool: 1 },
    { seqLen: 2, progPool: 2 },
    { seqLen: 2, progPool: 3 },
    { seqLen: 2, progPool: 4 },
    { seqLen: 3, progPool: 1 },
    { seqLen: 3, progPool: 2 },
    { seqLen: 3, progPool: 3 },
    { seqLen: 3, progPool: 4 },
    { seqLen: 4, progPool: 1 },
    { seqLen: 4, progPool: 2 },
    { seqLen: 4, progPool: 3 },
    { seqLen: 4, progPool: 4 },
    { seqLen: 4, progPool: 4, randomizeKey: true }
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
  let answered = false;
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
      const value = state.guessSeq[i];
      const filled = value != null;
      const locked = !!state.correctMask[i];
      slot.className = 'cs-guess-slot' + (filled ? ' filled' : '') + (locked ? ' correct' : '');
      slot.textContent = filled ? DEGREE_INFO[value].roman : '–';
      slot.setAttribute('data-tip', locked
        ? 'Chord ' + (i + 1) + ' — correct, locked in.'
        : 'Your guess for chord ' + (i + 1) + ' of this sequence.');
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
      const nextOpen = state.guessSeq.findIndex(v => v == null);
      if (nextOpen === -1) return;
      state.guessSeq[nextOpen] = degree;
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
    answered = true;
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
      const fullPool = PROGRESSIONS[currentSeqLen];
      const progPool = staircase.active ? STAIRCASE_LEVELS[staircase.level - 1].progPool : null;
      const pool = progPool ? fullPool.slice(0, progPool) : fullPool;
      let seq;
      do { seq = pool[Math.floor(Math.random() * pool.length)]; } while (pool.length > 1 && seq === lastProg);
      lastProg = seq;
      state.targetSeq = seq.slice();
    }
    answered = false;
    state.guessSeq = new Array(currentSeqLen).fill(null);
    state.correctMask = new Array(currentSeqLen).fill(false);
    renderGuessDisplay();
    setStatus(currentSeqLen === 1 ? 'Click the second chord' : 'Rebuild the sequence you just heard');
    playTurnAudio();
  }

  function submitGuess() {
    if (state.guessSeq.some(v => v == null)) return;
    let correct = true;
    state.guessSeq.forEach((d, i) => {
      if (d === state.targetSeq[i]) state.correctMask[i] = true;
      else correct = false;
    });
    recordAttempt(correct);
    stepStaircase(correct);
    if (correct) {
      answered = true;
      setStatus('Correct! ' + state.targetSeq.map(d => DEGREE_INFO[d].roman).join('–'));
      setTimeout(newTurn, 1400);
    } else {
      setStatus('Not quite — the green ones are locked in, fix the rest');
      // Keep locked-correct guesses in place; only the wrong slots reopen.
      state.guessSeq = state.guessSeq.map((d, i) => state.correctMask[i] ? d : null);
      renderGuessDisplay();
      playTurnAudio();
    }
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
      for (let i = state.guessSeq.length - 1; i >= 0; i--) {
        if (state.guessSeq[i] != null && !state.correctMask[i]) {
          state.guessSeq[i] = null;
          break;
        }
      }
      renderGuessDisplay();
    });

    document.getElementById('csSubmitBtn').addEventListener('click', submitGuess);

    function openChordSeqPanel() {
      if (window.showCentralPanel) window.showCentralPanel('chordseq');
      if (window.setActiveTopBarIcon) window.setActiveTopBarIcon('csIconBtn');
      const dims = window.APP_DIMENSIONS;
      if (window.api && window.api.resizeWindow) window.api.resizeWindow(dims ? dims.width2 : 1000, dims ? dims.height : 826);
      ensureInit();
    }
    const csIconBtn = document.getElementById('csIconBtn');
    if (csIconBtn) csIconBtn.addEventListener('click', openChordSeqPanel);
    window.ChordSeq = { open: openChordSeqPanel };

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


  // ===================== MIDI chord answers =====================
  // Play the chord on a MIDI keyboard instead of clicking its button. Notes struck
  // within CHORD_WINDOW_MS of each other count as one chord (so rolled chords work);
  // recognition is by pitch class, so any inversion / octave / doubling is fine.
  const CHORD_WINDOW_MS = 220;
  const PC_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  let midiStarted = false, burstNotes = [], burstTimer = null;

  function setMidiStatus(text) {
    const el = document.getElementById('csMidiStatus');
    if (el) el.textContent = text;
  }

  async function initMidi() {
    if (midiStarted) return;
    midiStarted = true;
    if (!navigator.requestMIDIAccess) { setMidiStatus('MIDI isn’t supported in this browser — use the chord buttons.'); return; }
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      const attach = () => {
        const inputs = Array.from(access.inputs.values());
        inputs.forEach(inp => inp.addEventListener('midimessage', onMidiMessage));
        setMidiStatus(inputs.length
          ? 'MIDI: ' + inputs.map(i => i.name).join(', ') + ' — or play the chord on your keyboard to answer.'
          : 'No MIDI keyboard found — use the chord buttons.');
      };
      attach();
      access.onstatechange = attach;
    } catch (err) {
      setMidiStatus('MIDI access denied — use the chord buttons.');
    }
  }

  function onMidiMessage(e) {
    if ((e.data[0] & 0xf0) !== 0x90 || e.data[2] === 0) return;
    if (getComputedStyle(document.getElementById('chordSeqPanel')).display === 'none') return;
    burstNotes.push(e.data[1]);
    clearTimeout(burstTimer);
    burstTimer = setTimeout(() => { const notes = burstNotes; burstNotes = []; onChordPlayed(notes); }, CHORD_WINDOW_MS);
  }

  function diatonicTriadPcs(degree) {
    return triadFor(48 + KEY_LIST[state.keyIndex].pc, degree).map(m => m % 12);
  }

  function recognizeDiatonic(notes) {
    const pcs = new Set(notes.map(n => n % 12));
    const exact = [1, 2, 3, 4, 5, 6].find(d => {
      const t = diatonicTriadPcs(d);
      return t.length === pcs.size && t.every(pc => pcs.has(pc));
    });
    if (exact) return exact;
    const contained = [1, 2, 3, 4, 5, 6].filter(d => diatonicTriadPcs(d).every(pc => pcs.has(pc)));
    if (contained.length === 1) return contained[0];
    if (contained.length > 1) {
      const bassPc = Math.min(...notes) % 12;
      return contained.find(d => diatonicTriadPcs(d)[0] === bassPc) || null;
    }
    return null;
  }

  function nameAnyTriad(notes) {
    const pcs = new Set(notes.map(n => n % 12));
    if (pcs.size !== 3) return null;
    for (let r = 0; r < 12; r++) {
      if (pcs.has(r) && pcs.has((r + 4) % 12) && pcs.has((r + 7) % 12)) return PC_NAMES[r];
      if (pcs.has(r) && pcs.has((r + 3) % 12) && pcs.has((r + 7) % 12)) return PC_NAMES[r] + 'm';
    }
    return null;
  }

  function onChordPlayed(notes) {
    if (answered || new Set(notes.map(n => n % 12)).size < 3) return;
    const revert = currentSeqLen === 1 ? 'Click the second chord' : 'Rebuild the sequence you just heard';
    const deg = recognizeDiatonic(notes);
    if (!deg) {
      const other = nameAnyTriad(notes);
      flashStatus(other ? 'Heard ' + window.musicalChord(other) + ' — that isn’t one of the chords in this key' : 'Couldn’t recognise that as a chord in this key', revert, 1500);
      return;
    }
    const btn = document.querySelector('#csChordRow .cs-chord-btn[data-degree="' + deg + '"]');
    if (currentSeqLen === 1) { onChordButtonClick(deg, btn); return; }
    if (state.guessSeq.every(v => v != null)) return;
    onChordButtonClick(deg, btn);
    flashStatus('Heard ' + chordDisplayName(deg) + ' (' + DEGREE_INFO[deg].roman + ')', revert, 900);
    if (state.guessSeq.every(v => v != null)) {
      const turnSeq = state.targetSeq;
      setTimeout(() => { if (state.targetSeq === turnSeq && !answered && state.guessSeq.every(v => v != null)) submitGuess(); }, 800);
    }
  }

  function ensureInit() {
    if (initialized) return;
    initialized = true;
    initMidi();
    ensureSamplesLoaded();
    buildChordButtons();
    state.keyIndex = Math.floor(Math.random() * KEY_LIST.length);
    updateKeyDisplay();
    updateScoreDisplay();
    newTurn();
  }

  wireControls();
})();
