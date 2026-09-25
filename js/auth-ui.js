(function () {
  const overlay = document.getElementById('authOverlay');
  const emailInput = document.getElementById('authEmail');
  const passwordInput = document.getElementById('authPassword');
  const errorEl = document.getElementById('authError');
  const signInBtn = document.getElementById('authSignInBtn');
  const signUpBtn = document.getElementById('authSignUpBtn');
  const signOutBtn = document.getElementById('signOutBtn');

  function showError(err) {
    errorEl.textContent = (err && err.message) || 'Something went wrong.';
  }

  if (!window.sbClient) {
    errorEl.textContent = 'Setup needed: copy js/config.example.js to js/config.js and fill in your Supabase project URL + anon key.';
    signInBtn.disabled = true;
    signUpBtn.disabled = true;
    return;
  }

  signInBtn.addEventListener('click', async () => {
    errorEl.textContent = '';
    try {
      await window.Auth.signIn(emailInput.value.trim(), passwordInput.value);
      location.reload();
    } catch (err) {
      showError(err);
    }
  });

  signUpBtn.addEventListener('click', async () => {
    errorEl.textContent = '';
    try {
      const { hasSession } = await window.Auth.signUp(emailInput.value.trim(), passwordInput.value);
      if (hasSession) {
        location.reload();
      } else {
        errorEl.textContent = 'Check your email to confirm your account, then sign in.';
      }
    } catch (err) {
      showError(err);
    }
  });

  [emailInput, passwordInput].forEach(input => {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') signInBtn.click();
    });
  });

  signOutBtn.addEventListener('click', () => {
    const doSignOut = async () => {
      await window.Auth.signOut();
      location.reload();
    };
    if (window.FeedbackUI) {
      window.FeedbackUI.openOnExit(doSignOut);
    } else {
      doSignOut();
    }
  });

  window.Auth.getSession().then(async session => {
    if (!session) return;
    overlay.style.display = 'none';
    try {
      const seeded = await window.api.seedDefaultsIfEmpty();
      if (seeded) location.reload();
    } catch (err) {
      console.error('Seeding starter sets failed:', err);
    }
  });
})();
