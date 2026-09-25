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

  // Key picker keyboard — a single octave, same visual pattern as the Chord
  // Grid key picker (buildPiano in index.html), scoped to this module.
  const CS_PIANO_WHITES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const CS_PIANO_BLACKS = [{ key: 'Db', x: 26 }, { key: 'Eb', x: 71 }, { key: 'F#', x: 159 }, { key: 'Ab', x: 203 }, { key: 'Bb', x: 247 }];
  const csKeyRects = {};

  function buildKeyKeyboard() {
    const ns = 'http://www.w3.org/2000/svg';
    const container = document.getElementById('csKeyKeyboard');
    container.innerHTML = '';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 308 82');
    svg.setAttribute('class', 'piano-svg');

    CS_PIANO_WHITES.forEach((key, i) => {
      const r = document.createElementNS(ns, 'rect');
      r.setAttribute('x', i * 44 + 1); r.setAttribute('y', 1);
      r.setAttribute('width', 42); r.setAttribute('height', 78);
      r.setAttribute('rx', 3); r.setAttribute('stroke', '#aaa'); r.setAttribute('stroke-width', 1.5);
      r.style.cursor = 'pointer';
      r.setAttribute('data-tip', 'Click to practise in this key.');
      r.addEventListener('mousedown', e => { e.preventDefault(); chooseKeyByName(key); });
      svg.appendChild(r); csKeyRects[key] = r;
    });

    CS_PIANO_BLACKS.forEach(({ key, x }) => {
      const r = document.createElementNS(ns, 'rect');
      r.setAttribute('x', x); r.setAttribute('y', 1);
      r.setAttribute('width', 26); r.setAttribute('height', 50);
      r.setAttribute('rx', 2); r.setAttribute('stroke', '#000'); r.setAttribute('stroke-width', 1);
      r.style.cursor = 'pointer';
      r.setAttribute('data-tip', 'Click to practise in this key.');
      r.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); chooseKeyByName(key); });
      svg.appendChild(r); csKeyRects[key] = r;
    });

    container.appendChild(svg);
    refreshKeyKeyboard();
  }

  function refreshKeyKeyboard() {
    const blackSet = new Set(['Db', 'Eb', 'F#', 'Ab', 'Bb']);
    const currentName = KEY_LIST[state.keyIndex].name;
    Object.entries(csKeyRects).forEach(([key, r]) => {
      const sel = currentName === key;
      r.setAttribute('fill', blackSet.has(key)
        ? (sel ? '#c8a000' : '#1a1a1a')
        : (sel ? '#fff0a0' : 'white'));
    });
  }

  function chooseKeyByName(keyName) {
    if (staircase.active) return;
    const idx = KEY_LIST.findIndex(k => k.name === keyName);
    if (idx === -1) return;
    state.keyIndex = idx;
    updateKeyDisplay();
    newTurn();
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
    document.getElementById('csKeyLabel').textContent = `Key: ${KEY_LIST[state.keyIndex].name} major`;
    refreshChordButtonLabels();
    refreshKeyKeyboard();
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
      slot.textContent = filled ? DEGREE_INFO[value].roman : '?';
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
      b.addEventListener('click', () => onChordButtonClick(deg));
      row.appendChild(b);
    });
  }

  function enterStaircase(startLevel) {
    manualSeqLenSnapshot = currentSeqLen;
    staircase.active = true;
    staircase.level = Math.max(1, Math.min(STAIRCASE_LEVELS.length, startLevel || 1));
    staircase.peakLevel = staircase.level;
    document.getElementById('csModeRow').classList.add('cs-locked');
    document.getElementById('csKeyKeyboard').classList.add('cs-locked');
    document.getElementById('csStaircaseStatus').style.display = 'block';
    updateStaircaseStatus();
    newTurn();
  }

  // Remembers/restores the difficulty a given practice-list item was left
  // at — never the actual chord/progression drawn next, which is always
  // freshly randomized. See saveActiveRowSettings/dispatchActiveRow in
  // index.html.
  function getSettings() {
    return { staircaseActive: staircase.active, level: staircase.level };
  }
  function applySavedSettings(settings) {
    const btn = document.getElementById('csStaircaseBtn');
    if (!settings || !settings.staircaseActive) {
      if (staircase.active) exitStaircase();
      if (btn) btn.classList.remove('active');
      return;
    }
    if (staircase.active) {
      staircase.level = Math.max(1, Math.min(STAIRCASE_LEVELS.length, settings.level || 1));
      staircase.peakLevel = Math.max(staircase.peakLevel, staircase.level);
      updateStaircaseStatus();
    } else {
      enterStaircase(settings.level);
    }
    if (btn) btn.classList.add('active');
  }

  function exitStaircase() {
    staircase.active = false;
    currentSeqLen = manualSeqLenSnapshot || 1;
    document.querySelectorAll('#csModeRow .cs-mode-btn').forEach(b => b.classList.toggle('active', Number(b.dataset.len) === currentSeqLen));
    document.getElementById('csModeRow').classList.remove('cs-locked');
    document.getElementById('csKeyKeyboard').classList.remove('cs-locked');
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

  // Answering always works the same way regardless of sequence length: click
  // chord buttons to fill the guess slots (one slot in Single chord mode,
  // up to four otherwise), then press submit — no more special-cased
  // instant-answer for the single-chord case.
  function onChordButtonClick(degree) {
    if (answered) return;
    const nextOpen = state.guessSeq.findIndex(v => v == null);
    if (nextOpen === -1) return;
    state.guessSeq[nextOpen] = degree;
    renderGuessDisplay();
    // A single chord IS the whole answer — no reason to make the user press
    // submit separately when there's nothing left to build.
    if (currentSeqLen === 1) submitGuess();
  }

  // Briefly flashes the matching answer button green whenever a chord is
  // heard on MIDI, whether or not it ends up being the right guess — pure
  // "I heard that" feedback, same idea as Chord Grid's played-note flash.
  function flashHeardChord(degree) {
    const btn = document.querySelector('#csChordRow .cs-chord-btn[data-degree="' + degree + '"]');
    if (!btn) return;
    btn.classList.remove('correct-flash');
    void btn.offsetWidth;
    btn.classList.add('correct-flash');
    setTimeout(() => btn.classList.remove('correct-flash'), 400);
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

  // Reveals the answer and moves on, without counting it right or wrong —
  // same "no penalty, no credit" semantics as Ear Training's skip button.
  function giveUp() {
    if (answered) return;
    answered = true;
    state.guessSeq = state.targetSeq.slice();
    state.correctMask = state.targetSeq.map(() => true);
    renderGuessDisplay();
    setStatus('That was ' + state.targetSeq.map(d => DEGREE_INFO[d].roman).join('–'));
    setTimeout(newTurn, 1400);
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

    document.getElementById('csPlayBtn').addEventListener('click', playTurnAudio);

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
    document.getElementById('csGiveUpBtn').addEventListener('click', giveUp);

    // settings, when given (dispatched from a practice-list item), come from
    // getSettings()'s own shape — see saveActiveRowSettings in index.html.
    function openChordSeqPanel(settings) {
      if (window.showCentralPanel) window.showCentralPanel('chordseq');
      if (window.setActiveTopBarIcon) window.setActiveTopBarIcon('csIconBtn');
      const dims = window.APP_DIMENSIONS;
      if (window.api && window.api.resizeWindow) window.api.resizeWindow(dims ? dims.width2 : 1000, dims ? dims.height : 826);
      const wasInitialized = initialized;
      ensureInit();
      if (wasInitialized) {
        // A fresh random key every time you start this function, same as a
        // fresh interval/chord — not just the first time the app loads.
        state.keyIndex = Math.floor(Math.random() * KEY_LIST.length);
        updateKeyDisplay();
        if (!(settings && settings.staircaseActive)) newTurn();
      }
      applySavedSettings(settings);
    }
    const csIconBtn = document.getElementById('csIconBtn');
    if (csIconBtn) csIconBtn.addEventListener('click', () => {
      if (window.clearSettingsRowTarget) window.clearSettingsRowTarget();
      openChordSeqPanel();
      if (window.openNotesForFunction) window.openNotesForFunction('chordseq');
    });
    window.ChordSeq = { open: openChordSeqPanel, getSettings };

    document.getElementById('csBackBtn').addEventListener('click', () => {
      if (window.captureActiveRowSettings) window.captureActiveRowSettings();
      if (window.closeFunctionNotes) window.closeFunctionNotes();
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
  // Play the chord on a MIDI keyboard instead of clicking its button (see midi.js).
  // Recognition is by pitch class, so any inversion / octave / doubling is fine.
  function midiStatusText(st) {
    if (st.state === 'unsupported') return 'MIDI isn’t supported in this browser — use the chord buttons.';
    if (st.state === 'denied') return 'MIDI access denied — use the chord buttons.';
    if (st.state === 'ready' && st.names.length) return 'MIDI: ' + st.names.join(', ') + ' — or play the chord on your keyboard to answer.';
    return st.state === 'ready' ? 'No MIDI keyboard found — use the chord buttons.' : '';
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

  function onChordPlayed(notes) {
    if (getComputedStyle(document.getElementById('chordSeqPanel')).display === 'none') return;
    if (answered || new Set(notes.map(n => n % 12)).size < 3) return;
    const revert = currentSeqLen === 1 ? 'Click the second chord' : 'Rebuild the sequence you just heard';
    const deg = recognizeDiatonic(notes);
    if (!deg) {
      const other = window.MidiInput.analyzeChord(notes);
      flashStatus(other ? 'Heard ' + window.musicalChord(other.name) + ' — that isn’t one of the chords in this key' : 'Couldn’t recognise that as a chord in this key', revert, 1500);
      return;
    }
    if (state.guessSeq.every(v => v != null)) return;
    flashHeardChord(deg);
    onChordButtonClick(deg);
    flashStatus('Heard ' + chordDisplayName(deg) + ' (' + DEGREE_INFO[deg].roman + ')', revert, 900);
    if (state.guessSeq.every(v => v != null)) {
      const turnSeq = state.targetSeq;
      setTimeout(() => { if (state.targetSeq === turnSeq && !answered && state.guessSeq.every(v => v != null)) submitGuess(); }, 800);
    }
  }

  window.MidiInput.onChord(onChordPlayed);
  window.MidiInput.onStatus(st => {
    const el = document.getElementById('csMidiStatus');
    if (el) el.textContent = midiStatusText(st);
  });

  function ensureInit() {
    if (initialized) return;
    initialized = true;
    window.MidiInput.start();
    ensureSamplesLoaded();
    buildChordButtons();
    buildKeyKeyboard();
    state.keyIndex = Math.floor(Math.random() * KEY_LIST.length);
    updateKeyDisplay();
    updateScoreDisplay();
    newTurn();
  }

  wireControls();
})();
