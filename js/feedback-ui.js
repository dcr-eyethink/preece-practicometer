(function () {
  const btn = document.getElementById('feedbackBtn');
  const overlay = document.getElementById('feedbackOverlay');
  const likedEl = document.getElementById('fbLiked');
  const improveEl = document.getElementById('fbImprove');
  const dislikedEl = document.getElementById('fbDisliked');
  const sendBtn = document.getElementById('fbSendBtn');
  const cancelBtn = document.getElementById('fbCancelBtn');
  const statusEl = document.getElementById('fbStatus');

  function csvField(s) {
    s = s == null ? '' : String(s);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(rows) {
    let out = 'email,liked,improve,disliked,submitted_at\n';
    for (const r of rows) {
      out += [r.user_email, r.liked, r.improve, r.disliked, r.created_at].map(csvField).join(',') + '\n';
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

  function openForm() {
    likedEl.value = ''; improveEl.value = ''; dislikedEl.value = '';
    statusEl.textContent = ''; statusEl.classList.remove('error');
    overlay.style.display = 'flex';
    likedEl.focus();
  }

  function closeForm() {
    overlay.style.display = 'none';
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

  cancelBtn.addEventListener('click', closeForm);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeForm(); });

  sendBtn.addEventListener('click', async () => {
    statusEl.classList.remove('error');
    statusEl.textContent = 'Sending…';
    try {
      await window.api.submitFeedback({
        liked: likedEl.value.trim(),
        improve: improveEl.value.trim(),
        disliked: dislikedEl.value.trim()
      });
      statusEl.textContent = 'Thanks for the feedback!';
      setTimeout(closeForm, 900);
    } catch (err) {
      statusEl.classList.add('error');
      statusEl.textContent = (err && err.message) || 'Something went wrong.';
    }
  });
})();
