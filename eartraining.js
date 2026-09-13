(() => {
  const KB_LOW = 48;  // C3
  const KB_HIGH = 72; // C5
  const BLACK_PC = new Set([1, 3, 6, 8, 10]);
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  // Diatonic degree -> semitones, quality fixed to the major scale.
  const INTERVAL_SEMITONES = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11, 8: 12 };
  const INTERVAL_LABEL = {
    1: 'Unison', 2: 'Major 2nd', 3: 'Major 3rd', 4: 'Perfect 4th',
    5: 'Perfect 5th', 6: 'Major 6th', 7: 'Major 7th', 8: 'Octave'
  };

  let CENTS_TOLERANCE = 40;
  const REQUIRED_STREAK = 6;

  const state = {
    mode: 'echo',
    activeIntervals: new Set([2, 3, 4, 5, 6, 7]),
    activeDirections: new Set(['up']),
    baseMidi: null,
    intervalNum: null,
    direction: null,
    targetMidi: null,
    turnActive: false,
    running: false
  };

  // Adaptive difficulty ladder: a simple 1-up/1-down staircase (Cornsweet, 1962) — one step
  // harder after every correct response, one step easier after every incorrect response. This
  // converges toward the ~50%-correct point on the listener's psychometric function (the level
  // where they're right about half the time), which is what "harder when right, easier when
  // wrong" means in the adaptive-testing literature. Early rungs narrow the interval/direction
  // pool to the intervals most learners find easiest (5th, 4th) before widening it; later rungs
  // (once everything is unlocked) tighten the pitch-matching tolerance instead.
  const STAIRCASE_LEVELS = [
    { intervals: [5], dirs: ['up'], tolerance: 40 },
    { intervals: [5, 4], dirs: ['up'], tolerance: 40 },
    { intervals: [5, 4], dirs: ['up', 'down'], tolerance: 40 },
    { intervals: [5, 4, 3], dirs: ['up', 'down'], tolerance: 35 },
    { intervals: [5, 4, 3, 6], dirs: ['up', 'down'], tolerance: 35 },
    { intervals: [5, 4, 3, 6, 2], dirs: ['up', 'down'], tolerance: 30 },
    { intervals: [5, 4, 3, 6, 2, 7], dirs: ['up', 'down'], tolerance: 30 },
    { intervals: [5, 4, 3, 6, 2, 7], dirs: ['up', 'down'], tolerance: 25 },
    { intervals: [5, 4, 3, 6, 2, 7], dirs: ['up', 'down'], tolerance: 20 },
    { intervals: [5, 4, 3, 6, 2, 7], dirs: ['up', 'down'], tolerance: 15 }
  ];
  const staircase = { active: false, level: 1, peakLevel: 1 };
  let manualIntervalsSnapshot = null, manualDirectionsSnapshot = null;

  const SCORE_KEY = 'earTrainingScore';
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

  function updateScoreDisplay() {
    const el = document.getElementById('earScore');
    if (!el) return;
    const pct = score.total ? Math.round((score.correct / score.total) * 100) : null;
    let text = `Score: ${score.correct}/${score.total} (${pct === null ? '—' : pct + '%'})`;
    if (score.staircaseBest > 0) text += ` · Best level: ${score.staircaseBest}/${STAIRCASE_LEVELS.length}`;
    el.textContent = text;
  }

  function updateStaircaseStatus() {
    const el = document.getElementById('earStaircaseStatus');
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
  let midiInitStarted = false;
  let matchStreak = 0;
  let lastUserMidi = null;
  let lastUserPitchClass = null;
  let turnTimeout = null;
  let keyRects = {};

  const SHARP_NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];
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
    for (let m = KB_LOW; m <= KB_HIGH; m++) needed.push(m);
    samplesLoadingPromise = Promise.all(needed.map(midi =>
      fetch(sampleFileForMidi(midi))
        .then(r => r.arrayBuffer())
        .then(arr => c.decodeAudioData(arr))
        .then(buf => { sampleBuffers[midi] = buf; })
        .catch(() => {})
    ));
    return samplesLoadingPromise;
  }

  let ctx = null;
  let micStream = null;
  let analyser = null;
  let dataArray = null;
  let rafId = null;
  let midiAccess = null;

  function noteName(midi) {
    return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
  }

  function setStatus(text) {
    const el = document.getElementById('earStatus');
    if (el) el.textContent = text;
  }

  function setMidiStatus(text) {
    const el = document.getElementById('earMidiStatus');
    if (el) el.textContent = text;
  }

  // ===================== Keyboard =====================

  function buildKeyboard() {
    const ns = 'http://www.w3.org/2000/svg';
    const container = document.getElementById('earKeyboardWrap');
    container.innerHTML = '';
    const W = 26, H = 92, BW = 15, BH = 58;

    let whiteCount = 0;
    for (let m = KB_LOW; m <= KB_HIGH; m++) {
      if (!BLACK_PC.has(((m % 12) + 12) % 12)) whiteCount++;
    }
    const totalW = whiteCount * W;

    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${totalW} ${H}`);
    svg.setAttribute('class', 'piano-svg');

    keyRects = {};
    let whiteIndex = 0;
    const whiteX = {};
    for (let m = KB_LOW; m <= KB_HIGH; m++) {
      const pc = ((m % 12) + 12) % 12;
      if (!BLACK_PC.has(pc)) { whiteX[m] = whiteIndex * W; whiteIndex++; }
    }

    for (let m = KB_LOW; m <= KB_HIGH; m++) {
      const pc = ((m % 12) + 12) % 12;
      if (BLACK_PC.has(pc)) continue;
      const r = document.createElementNS(ns, 'rect');
      r.setAttribute('x', whiteX[m]); r.setAttribute('y', 0);
      r.setAttribute('width', W - 1); r.setAttribute('height', H);
      r.setAttribute('rx', 3); r.setAttribute('fill', 'white');
      r.setAttribute('stroke', '#aaa'); r.setAttribute('stroke-width', 1.2);
      r.classList.add('ear-key');
      r.addEventListener('mousedown', () => handleUserNote(m, 'click'));
      svg.appendChild(r);
      keyRects[m] = r;
    }

    whiteIndex = 0;
    for (let m = KB_LOW; m <= KB_HIGH; m++) {
      const pc = ((m % 12) + 12) % 12;
      if (!BLACK_PC.has(pc)) { whiteIndex++; continue; }
      const x = whiteIndex * W - BW / 2;
      const r = document.createElementNS(ns, 'rect');
      r.setAttribute('x', x); r.setAttribute('y', 0);
      r.setAttribute('width', BW); r.setAttribute('height', BH);
      r.setAttribute('rx', 2); r.setAttribute('fill', '#1a1a1a');
      r.setAttribute('stroke', '#000');
      r.classList.add('ear-key');
      r.addEventListener('mousedown', e => { e.stopPropagation(); handleUserNote(m, 'click'); });
      svg.appendChild(r);
      keyRects[m] = r;
    }

    container.appendChild(svg);
  }

  function setKeyState(midi, kind) {
    const r = keyRects[midi];
    if (!r) return;
    const isBlack = BLACK_PC.has(((midi % 12) + 12) % 12);
    let fill;
    if (kind === 'base') fill = isBlack ? '#1a4a8a' : '#cfe0ff';
    else if (kind === 'user') fill = isBlack ? '#a86a10' : '#ffe6b3';
    else if (kind === 'correct') fill = '#27ae60';
    else fill = isBlack ? '#1a1a1a' : 'white';
    r.setAttribute('fill', fill);
  }

  function renderKeyboardHighlights() {
    Object.keys(keyRects).forEach(k => setKeyState(Number(k), null));
    if (state.baseMidi != null) setKeyState(state.baseMidi, 'base');
    if (lastUserPitchClass != null) {
      Object.keys(keyRects).forEach(k => {
        const m = Number(k);
        if (((m % 12) + 12) % 12 === lastUserPitchClass && m !== state.baseMidi) setKeyState(m, 'user');
      });
    } else if (lastUserMidi != null && lastUserMidi !== state.baseMidi) {
      setKeyState(lastUserMidi, 'user');
    }
  }

  // ===================== Dial =====================

  function buildDial() {
    const ns = 'http://www.w3.org/2000/svg';
    const wrap = document.getElementById('earDialWrap');
    wrap.innerHTML = '';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 160 95');
    svg.innerHTML =
      '<path d="M10,85 A70,70 0 0 1 150,85" fill="none" stroke="#e0e0e0" stroke-width="10"/>' +
      '<path d="M62,20.4 A70,70 0 0 1 98,20.4" fill="none" stroke="#bfe6c8" stroke-width="10"/>' +
      '<line id="earDialNeedle" x1="80" y1="85" x2="80" y2="22" stroke="#1a56db" stroke-width="3" stroke-linecap="round"/>' +
      '<circle cx="80" cy="85" r="5" fill="#1a56db"/>' +
      '<text x="6" y="94" font-size="9" fill="#999">flat</text>' +
      '<text x="130" y="94" font-size="9" fill="#999">sharp</text>';
    wrap.appendChild(svg);
  }

  function updateDial(cents) {
    const needle = document.getElementById('earDialNeedle');
    if (!needle) return;
    const clamped = Math.max(-50, Math.min(50, cents));
    const angle = (clamped / 50) * 62;
    needle.setAttribute('transform', `rotate(${angle} 80 85)`);
    const mag = Math.abs(cents);
    needle.setAttribute('stroke', mag <= 15 ? '#27ae60' : (mag <= 35 ? '#f39c12' : '#c0392b'));
  }

  function updatePitchReadout(midi, cents) {
    const el = document.getElementById('earPitchReadout');
    if (!el) return;
    if (midi == null) { el.innerHTML = '—'; updateDial(0); return; }
    const sign = cents > 0 ? '+' : '';
    el.innerHTML = `<span class="note">${noteName(midi)}</span> ${sign}${cents}¢`;
    updateDial(cents);
  }

  // ===================== Audio: tone playback =====================

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }

  function playTone(midi, startTime, dur, peak) {
    const c = getCtx();
    const buf = sampleBuffers[midi];
    if (!buf) return;
    const src = c.createBufferSource();
    const gain = c.createGain();
    src.buffer = buf;
    src.connect(gain); gain.connect(c.destination);
    const vol = window.masterVolume != null ? window.masterVolume : 1;
    gain.gain.setValueAtTime((peak == null ? 0.9 : peak) * vol, startTime);
    src.start(startTime);
  }

  function playIntervalTones(baseMidi, targetMidi, onDone) {
    const c = getCtx();
    if (c.state === 'suspended') c.resume();
    const t = c.currentTime + 0.1;
    const dur = 0.7, gap = 0.25;
    playTone(baseMidi, t, dur);
    playTone(targetMidi, t + dur + gap, dur);
    const totalMs = (dur * 2 + gap + 0.1) * 1000;
    setTimeout(() => { if (onDone) onDone(); }, totalMs);
  }

  // ===================== Audio: pitch detection =====================

  function autoCorrelate(buf, sampleRate) {
    const SIZE = buf.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.008) return -1;

    const minLag = Math.floor(sampleRate / 1000); // ~1000 Hz ceiling
    const maxLag = Math.min(SIZE - 1, Math.ceil(sampleRate / 70)); // ~70 Hz floor

    const corrAt = (lag) => {
      let sum = 0;
      for (let i = 0; i < SIZE - lag; i++) sum += buf[i] * buf[i + lag];
      return sum;
    };

    let bestLag = -1, bestVal = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
      const v = corrAt(lag);
      if (v > bestVal) { bestVal = v; bestLag = lag; }
    }
    if (bestLag <= minLag || bestLag >= maxLag) return sampleRate / bestLag;

    const x1 = corrAt(bestLag - 1), x2 = bestVal, x3 = corrAt(bestLag + 1);
    const a = (x1 + x3 - 2 * x2) / 2;
    const b = (x3 - x1) / 2;
    const T = a !== 0 ? bestLag - b / (2 * a) : bestLag;
    return sampleRate / T;
  }

  async function startListening() {
    try {
      if (!micStream) {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        });
      }
      const c = getCtx();
      if (c.state === 'suspended') await c.resume();
      if (!analyser) {
        const source = c.createMediaStreamSource(micStream);
        analyser = c.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        dataArray = new Float32Array(analyser.fftSize);
      }
      pitchLoop();
    } catch (err) {
      setStatus('Microphone access denied — you can still answer via MIDI or the keyboard.');
    }
  }

  function pitchLoop() {
    if (!state.turnActive) return;
    analyser.getFloatTimeDomainData(dataArray);
    const freq = autoCorrelate(dataArray, getCtx().sampleRate);
    if (freq > 0 && freq < 1500) onPitchDetected(freq); else onSilence();
    rafId = requestAnimationFrame(pitchLoop);
  }

  function stopListening() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function releaseMic() {
    stopListening();
    if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
    analyser = null;
  }

  function onPitchDetected(freq) {
    if (!state.turnActive) return;
    const exact = 69 + 12 * Math.log2(freq / 440);
    const rounded = Math.round(exact);
    const cents = Math.round((exact - rounded) * 100);
    updatePitchReadout(rounded, cents);

    const pc = ((rounded % 12) + 12) % 12;
    lastUserMidi = null;
    lastUserPitchClass = pc;
    renderKeyboardHighlights();

    const targetPc = ((state.targetMidi % 12) + 12) % 12;
    if (pc === targetPc && Math.abs(cents) <= CENTS_TOLERANCE) {
      matchStreak++;
      if (matchStreak >= REQUIRED_STREAK) onCorrect();
    } else {
      matchStreak = 0;
    }
  }

  function onSilence() {
    matchStreak = 0;
    updatePitchReadout(null, 0);
  }

  // ===================== MIDI =====================

  async function initMIDI() {
    if (!navigator.requestMIDIAccess) { setMidiStatus('Web MIDI not supported in this browser.'); return; }
    try {
      midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      attachMidiInputs();
      midiAccess.onstatechange = attachMidiInputs;
    } catch (err) {
      setMidiStatus('MIDI access denied.');
    }
  }

  function attachMidiInputs() {
    const inputs = Array.from(midiAccess.inputs.values());
    inputs.forEach(inp => { inp.onmidimessage = onMIDIMessage; });
    setMidiStatus(inputs.length ? `MIDI: ${inputs.map(i => i.name).join(', ')}` : 'No MIDI device connected.');
  }

  function onMIDIMessage(e) {
    const data = e.data;
    const cmd = data[0] & 0xf0;
    const note = data[1], vel = data[2];
    if (cmd === 0x90 && vel > 0) handleUserNote(note, 'midi');
  }

  // ===================== Game logic =====================

  function feasibleChoices(base) {
    const out = [];
    state.activeDirections.forEach(dir => {
      state.activeIntervals.forEach(iv => {
        const semis = INTERVAL_SEMITONES[iv] * (dir === 'up' ? 1 : -1);
        const target = base + semis;
        if (target >= KB_LOW && target <= KB_HIGH) out.push({ dir, iv, target });
      });
    });
    return out;
  }

  function updateTargetDisplay() {
    const el = document.getElementById('earTargetDisplay');
    if (!el) return;
    if (state.mode === 'play') {
      el.textContent = `${state.intervalNum} — ${INTERVAL_LABEL[state.intervalNum]} ${state.direction === 'up' ? '↑' : '↓'}`;
    } else {
      el.textContent = '';
    }
  }

  function clearFeedback() {
    const el = document.getElementById('earFeedback');
    el.className = 'ear-feedback';
    el.textContent = '';
  }

  function showWrongFeedback() {
    const el = document.getElementById('earFeedback');
    el.className = 'ear-feedback wrong';
    el.textContent = '✗';
  }

  function showCorrectFeedback() {
    const el = document.getElementById('earFeedback');
    el.className = 'ear-feedback correct';
    el.textContent = state.intervalNum + ' — ' + INTERVAL_LABEL[state.intervalNum] +
      ' ' + (state.direction === 'up' ? '↑' : '↓');
  }

  function replayCurrentInterval() {
    if (state.baseMidi == null || state.targetMidi == null) return;
    playIntervalTones(state.baseMidi, state.targetMidi, () => {});
  }

  function applyStaircaseLevel() {
    const cfg = STAIRCASE_LEVELS[staircase.level - 1];
    state.activeIntervals = new Set(cfg.intervals);
    state.activeDirections = new Set(cfg.dirs);
    CENTS_TOLERANCE = cfg.tolerance;
    buildIntervalButtons(); // refresh the (now read-only) checkmarks to show this level's set
    updateStaircaseStatus();
  }

  function enterStaircase() {
    manualIntervalsSnapshot = new Set(state.activeIntervals);
    manualDirectionsSnapshot = new Set(state.activeDirections);
    staircase.active = true;
    staircase.level = 1;
    staircase.peakLevel = 1;
    document.getElementById('earIntervalRow').classList.add('locked');
    document.getElementById('earStaircaseStatus').style.display = 'block';
    applyStaircaseLevel();
  }

  function exitStaircase() {
    staircase.active = false;
    state.activeIntervals = manualIntervalsSnapshot || new Set([2, 3, 4, 5, 6, 7]);
    state.activeDirections = manualDirectionsSnapshot || new Set(['up']);
    CENTS_TOLERANCE = 40;
    document.getElementById('earIntervalRow').classList.remove('locked');
    document.getElementById('earStaircaseStatus').style.display = 'none';
    buildIntervalButtons();
  }

  function handleUserNote(midi, source) {
    if (source === 'click') {
      const c = getCtx();
      if (c.state === 'suspended') c.resume();
      playTone(midi, c.currentTime + 0.02, 0.6, 0.6);
    }
    if (!state.turnActive) return;
    lastUserMidi = midi;
    lastUserPitchClass = null;
    renderKeyboardHighlights();
    if (midi === state.targetMidi) {
      onCorrect();
    } else {
      recordAttempt(false);
      if (staircase.active) {
        staircase.level = Math.max(1, staircase.level - 1);
        applyStaircaseLevel();
      }
      showWrongFeedback();
      const answerDelay = source === 'click' ? 450 : 150;
      setTimeout(() => {
        if (!state.turnActive) return;
        lastUserMidi = null;
        lastUserPitchClass = null;
        Object.keys(keyRects).forEach(k => setKeyState(Number(k), null)); // un-highlight base + guess
        setTimeout(() => {
          if (!state.turnActive) return;
          renderKeyboardHighlights(); // re-light the base note as it plays again
          replayCurrentInterval();
        }, 1000);
      }, answerDelay);
    }
  }

  function onCorrect() {
    if (!state.turnActive) return;
    state.turnActive = false;
    stopListening();
    setKeyState(state.targetMidi, 'correct');
    showCorrectFeedback();
    recordAttempt(true);
    if (staircase.active) {
      staircase.level = Math.min(STAIRCASE_LEVELS.length, staircase.level + 1);
      if (staircase.level > staircase.peakLevel) staircase.peakLevel = staircase.level;
      if (staircase.peakLevel > score.staircaseBest) {
        score.staircaseBest = staircase.peakLevel;
        saveScore();
      }
      applyStaircaseLevel();
      updateScoreDisplay();
    }
    turnTimeout = setTimeout(() => { if (state.running) startTurn(); }, 1600);
  }

  async function startTurn() {
    clearTimeout(turnTimeout);
    let base, choices, tries = 0;
    do {
      base = KB_LOW + Math.floor(Math.random() * (KB_HIGH - KB_LOW + 1));
      choices = feasibleChoices(base);
      tries++;
    } while (choices.length === 0 && tries < 50);
    if (choices.length === 0) { base = KB_LOW; choices = [{ dir: 'up', iv: 2, target: KB_LOW + INTERVAL_SEMITONES[2] }]; }
    const choice = choices[Math.floor(Math.random() * choices.length)];

    state.baseMidi = base;
    state.direction = choice.dir;
    state.intervalNum = choice.iv;
    state.targetMidi = choice.target;
    state.turnActive = true;
    matchStreak = 0;
    lastUserMidi = null;
    lastUserPitchClass = null;

    clearFeedback();
    renderKeyboardHighlights();
    updateTargetDisplay();
    updatePitchReadout(null, 0);

    setStatus('Loading sounds…');
    await ensureSamplesLoaded();
    if (!state.turnActive || state.baseMidi !== base) return; // superseded by a later turn

    if (state.mode === 'echo') {
      setStatus('Listen…');
      playIntervalTones(base, choice.target, () => {
        if (state.turnActive) setStatus('Your turn — sing it or find it on the keyboard');
      });
    } else {
      setStatus('Sing it or find it on the keyboard');
    }
    startListening();
  }

  function stopSession() {
    state.running = false;
    state.turnActive = false;
    clearTimeout(turnTimeout);
    releaseMic();
    clearFeedback();
    updatePitchReadout(null, 0);
    setStatus('Press Play to begin');
  }

  // ===================== UI wiring =====================

  function buildIntervalButtons() {
    const row = document.getElementById('earIntervalRow');
    row.innerHTML = '';

    ['up', 'down'].forEach(dir => {
      const b = document.createElement('button');
      b.className = 'ear-dir-btn' + (state.activeDirections.has(dir) ? ' active' : '');
      b.textContent = dir === 'up' ? '↑' : '↓';
      b.title = dir === 'up' ? 'Ascending intervals' : 'Descending intervals';
      b.addEventListener('click', () => {
        if (staircase.active) return;
        if (state.activeDirections.has(dir)) {
          if (state.activeDirections.size === 1) return;
          state.activeDirections.delete(dir);
          b.classList.remove('active');
        } else {
          state.activeDirections.add(dir);
          b.classList.add('active');
        }
      });
      row.appendChild(b);
    });

    const sep = document.createElement('div');
    sep.className = 'ear-dir-sep';
    row.appendChild(sep);

    for (let i = 2; i <= 7; i++) {
      const b = document.createElement('button');
      b.className = 'ear-num-btn' + (state.activeIntervals.has(i) ? ' active' : '');
      b.textContent = i;
      b.addEventListener('click', () => {
        if (staircase.active) return;
        if (state.activeIntervals.has(i)) {
          if (state.activeIntervals.size === 1) return;
          state.activeIntervals.delete(i);
          b.classList.remove('active');
        } else {
          state.activeIntervals.add(i);
          b.classList.add('active');
        }
      });
      row.appendChild(b);
    }
  }

  function wireControls() {
    document.getElementById('earScoreReset').addEventListener('click', () => {
      score = { correct: 0, total: 0, staircaseBest: 0 };
      saveScore();
      updateScoreDisplay();
    });

    document.getElementById('earStaircaseBtn').addEventListener('click', () => {
      if (staircase.active) exitStaircase(); else enterStaircase();
      document.getElementById('earStaircaseBtn').classList.toggle('active', staircase.active);
    });

    document.querySelectorAll('#earModeRow .ear-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#earModeRow .ear-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.mode = btn.dataset.mode;
        if (state.turnActive) updateTargetDisplay();
      });
    });

    document.getElementById('earPlayBtn').addEventListener('click', () => {
      if (!state.running) {
        state.running = true;
        if (!midiInitStarted) { midiInitStarted = true; initMIDI(); }
        startTurn();
      } else {
        replayCurrentInterval();
      }
    });

    document.getElementById('earStopBtn').addEventListener('click', stopSession);

    function openEarPanel() {
      if (window.hideAllCentralPanels) window.hideAllCentralPanels();
      if (window.setActiveTopBarIcon) window.setActiveTopBarIcon('earIconBtn');
      document.getElementById('setsPanel').style.display = 'none';
      document.getElementById('earPanel').style.display = 'flex';
      const dims = window.APP_DIMENSIONS;
      if (window.api && window.api.resizeWindow) window.api.resizeWindow(dims ? dims.width2 : 1000, dims ? dims.height : 826);
      ensureInit();
    }
    const earIconBtn = document.getElementById('earIconBtn');
    if (earIconBtn) earIconBtn.addEventListener('click', openEarPanel);

    document.getElementById('earBackBtn').addEventListener('click', () => {
      stopSession();
      if (window.hideAllCentralPanels) window.hideAllCentralPanels();
      else {
        document.getElementById('earPanel').style.display = 'none';
        document.getElementById('setsPanel').style.display = '';
        const dims = window.APP_DIMENSIONS;
        if (window.api && window.api.resizeWindow) window.api.resizeWindow(dims ? dims.width2 : 1000, dims ? dims.height : 826);
      }
    });
  }

  function ensureInit() {
    if (initialized) return;
    initialized = true;
    buildIntervalButtons();
    buildKeyboard();
    buildDial();
    renderKeyboardHighlights();
    updateScoreDisplay();
    ensureSamplesLoaded();
  }

  wireControls();

  window.EarTrainer = { stop: stopSession };
})();
