(function () {
  const btn = document.getElementById('feedbackBtn');
  const overlay = document.getElementById('feedbackOverlay');
  const enjoymentEl = document.getElementById('fbEnjoyment');
  const enjoymentValueEl = document.getElementById('fbEnjoymentValue');
  const likedEl = document.getElementById('fbLiked');
  const improveEl = document.getElementById('fbImprove');
  const dislikedEl = document.getElementById('fbDisliked');
  const sendBtn = document.getElementById('fbSendBtn');
  const cancelBtn = document.getElementById('fbCancelBtn');
  const statusEl = document.getElementById('fbStatus');

  enjoymentEl.addEventListener('input', () => { enjoymentValueEl.textContent = enjoymentEl.value; });

  function csvField(s) {
    s = s == null ? '' : String(s);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(rows) {
    let out = 'email,enjoyment,liked,improve,disliked,submitted_at\n';
    for (const r of rows) {
      out += [r.user_email, r.enjoyment, r.liked, r.improve, r.disliked, r.created_at].map(csvField).join(',') + '\n';
    }
    return out;
  }

  function downloadCSV(filename, text) {
    const blob = new Blob([text], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // When opened from the sign-out button, exitCallback fires after the form
  // closes (Skip or a successful Send) — never before, and never on error, so
  // an admin CSV export never signs anyone out.
  let exitCallback = null;

  function openForm() {
    enjoymentEl.value = '5'; enjoymentValueEl.textContent = '5';
    likedEl.value = ''; improveEl.value = ''; dislikedEl.value = '';
    statusEl.textContent = ''; statusEl.classList.remove('error');
    overlay.style.display = 'flex';
    likedEl.focus();
  }

  function openOnExit(onDone) {
    exitCallback = onDone;
    cancelBtn.textContent = 'Skip & Sign Out';
    sendBtn.textContent = 'Send & Sign Out';
    openForm();
  }

  function closeForm() {
    overlay.style.display = 'none';
    cancelBtn.textContent = 'Cancel';
    sendBtn.textContent = 'Send';
  }

  btn.addEventListener('click', async () => {
    try {
      const email = await window.api.currentUserEmail();
      if (window.api.isFeedbackAdmin(email)) {
        const rows = await window.api.listFeedback();
        downloadCSV('preece-practicometer-feedback.csv', toCSV(rows));
      } else {
        openForm();
      }
    } catch (err) {
      console.error('Feedback button failed:', err);
    }
  });

  cancelBtn.addEventListener('click', () => {
    const cb = exitCallback; exitCallback = null;
    closeForm();
    if (cb) cb();
  });
  overlay.addEventListener('click', e => {
    if (e.target !== overlay) return;
    const cb = exitCallback; exitCallback = null;
    closeForm();
    if (cb) cb();
  });

  sendBtn.addEventListener('click', async () => {
    statusEl.classList.remove('error');
    statusEl.textContent = 'Sending…';
    try {
      // Submitted while the session from openOnExit's caller is still active,
      // so it's tied to the signed-in user's id before Sign Out ever runs.
      await window.api.submitFeedback({
        enjoyment: parseInt(enjoymentEl.value, 10),
        liked: likedEl.value.trim(),
        improve: improveEl.value.trim(),
        disliked: dislikedEl.value.trim()
      });
      statusEl.textContent = 'Thanks for the feedback!';
      const cb = exitCallback; exitCallback = null;
      setTimeout(() => { closeForm(); if (cb) cb(); }, 900);
    } catch (err) {
      statusEl.classList.add('error');
      statusEl.textContent = (err && err.message) || 'Something went wrong.';
    }
  });

  window.FeedbackUI = { openOnExit };
})();
