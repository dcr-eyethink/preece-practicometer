// Tracks app usage behind the scenes: one user_sessions row per app open,
// with a heartbeat (like practice_log's) and a list of which top-bar
// functions got clicked. Admin-only export lives in js/feedback-ui.js.
(function () {
  if (!window.api || !window.Auth) return;

  // Kept identical to index.html's FUNCTION_LABELS (plus the two entries that
  // are top-bar-only, not launchable from a practice list) so a function
  // shows up as the same name in the CSV whether it was opened by clicking
  // its top-bar icon or auto-launched from a practice-list item.
  const FUNCTION_NAMES = {
    practiceListBtn: 'Practice List',
    logBtn: 'Practice Log',
    chordToggleBtn: 'Chord Grid',
    rndToggleBtn: 'Randomiser',
    earEchoIconBtn: 'Ear Training',
    earPlayIconBtn: 'Sing Training',
    csIconBtn: 'Chord Sequences',
    scoresIconBtn: 'Scores'
  };

  const HEARTBEAT_MS = 60000;

  function trackClick(e) {
    const btn = e.target.closest('.app-icon-btn');
    if (!btn || !btn.id) return;
    const name = FUNCTION_NAMES[btn.id];
    if (name) window.api.trackFunctionUsage(name);
  }

  async function begin() {
    try {
      await window.api.startUserSession();
    } catch (err) {
      console.error('Failed to start activity session:', err);
      return;
    }
    document.addEventListener('click', trackClick, true);
    setInterval(() => {
      if (document.visibilityState === 'visible') window.api.touchUserSession();
    }, HEARTBEAT_MS);
    window.addEventListener('beforeunload', () => { window.api.touchUserSession(); });
  }

  window.Auth.getSession().then(session => { if (session) begin(); }).catch(() => {});
})();
