(function () {
  const client = window.sbClient;

  async function getSession() {
    const { data } = await client.auth.getSession();
    return data.session;
  }

  async function signIn(email, password) {
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async function signUp(email, password) {
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) throw error;
    // If email confirmation is off, Supabase signs the user in immediately
    // and returns a session; otherwise session is null until they confirm.
    return { hasSession: !!data.session };
  }

  async function signOut() {
    await client.auth.signOut();
  }

  window.Auth = { getSession, signIn, signUp, signOut };
})();
