(function () {
  const overlay = document.getElementById('authOverlay');
  const emailInput = document.getElementById('authEmail');
  const passwordInput = document.getElementById('authPassword');
  const errorEl = document.getElementById('authError');
  const signInBtn = document.getElementById('authSignInBtn');
  const signUpBtn = document.getElementById('authSignUpBtn');
  const signOutBtn = document.getElementById('signOutBtn');

  const bgLogo = document.getElementById('authBgLogo');
  const mainLogo = document.querySelector('#homePanel .app-logo');
  if (bgLogo && mainLogo && mainLogo.src) {
    bgLogo.style.backgroundImage = `url("${mainLogo.src}")`;
  }

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
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    try {
      await window.Auth.signIn(email, password);
      if (window.electronAPI) window.electronAPI.saveCredentials(email, password);
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
      if (window.electronAPI) window.electronAPI.clearCredentials();
      location.reload();
    };
    if (window.FeedbackUI) {
      window.FeedbackUI.openOnExit(doSignOut);
    } else {
      doSignOut();
    }
  });

  async function afterSignedIn() {
    overlay.style.display = 'none';
    try {
      const seeded = await window.api.seedDefaultsIfEmpty();
      if (seeded) location.reload();
    } catch (err) {
      console.error('Seeding starter sets failed:', err);
    }
  }

  window.Auth.getSession().then(async session => {
    if (session) {
      afterSignedIn();
      return;
    }
    // Desktop build only: try the Keychain-backed saved credentials before
    // falling back to asking the user to sign in by hand.
    if (!window.electronAPI) return;
    const saved = await window.electronAPI.loadCredentials();
    if (!saved) return;
    try {
      await window.Auth.signIn(saved.email, saved.password);
      afterSignedIn();
    } catch (err) {
      window.electronAPI.clearCredentials();
    }
  });
})();
