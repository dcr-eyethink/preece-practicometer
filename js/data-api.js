(function () {
  const client = window.sbClient;
  const TABLE = 'practice_sets';

  function requireClient() {
    if (!client) throw new Error('Supabase is not configured yet (see js/config.example.js).');
    return client;
  }

  async function currentUserId() {
    requireClient();
    const { data } = await client.auth.getUser();
    if (!data.user) throw new Error('Not signed in.');
    return data.user.id;
  }

  async function listSets() {
    requireClient();
    const { data, error } = await client
      .from(TABLE)
      .select('id, name')
      .order('name', { ascending: true });
    if (error) throw error;
    return data.map(r => ({ name: r.name, path: r.id }));
  }

  async function readCSV(id) {
    requireClient();
    const { data, error } = await client
      .from(TABLE)
      .select('id, name, rows')
      .eq('id', id)
      .single();
    if (error) throw error;
    return { name: data.name, path: data.id, rows: data.rows || [] };
  }

  async function saveCSV(id, rows) {
    requireClient();
    const { error } = await client
      .from(TABLE)
      .update({ rows, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    return true;
  }

  async function renameCSV(id, newName) {
    const userId = await currentUserId();
    const { data: existing, error: checkErr } = await client
      .from(TABLE)
      .select('id')
      .eq('user_id', userId)
      .eq('name', newName)
      .neq('id', id);
    if (checkErr) throw checkErr;
    if (existing && existing.length > 0) {
      throw new Error('A set with that name already exists.');
    }
    const { error } = await client.from(TABLE).update({ name: newName }).eq('id', id);
    if (error) throw error;
    return id;
  }

  async function uniqueName(userId, base) {
    const { data: existingNames, error } = await client
      .from(TABLE)
      .select('name')
      .eq('user_id', userId);
    if (error) throw error;
    const taken = new Set((existingNames || []).map(r => r.name));
    if (!taken.has(base)) return base;
    let counter = 2;
    while (taken.has(base + ' ' + counter)) counter++;
    return base + ' ' + counter;
  }

  async function duplicateCSV(id, rows, currentName) {
    const userId = await currentUserId();
    const newName = await uniqueName(userId, currentName + ' copy');
    const { data, error } = await client
      .from(TABLE)
      .insert({ user_id: userId, name: newName, rows })
      .select('id, name')
      .single();
    if (error) throw error;
    return { path: data.id, name: data.name };
  }

  async function createSet(name) {
    const userId = await currentUserId();
    const uniqueSetName = await uniqueName(userId, name);
    const { data, error } = await client
      .from(TABLE)
      .insert({ user_id: userId, name: uniqueSetName, rows: [] })
      .select('id, name')
      .single();
    if (error) throw error;
    return { path: data.id, name: data.name };
  }

  function resizeWindow() { /* no-op on the web */ }
  async function getWindowSize() { return [window.innerWidth, window.innerHeight]; }

  // Clones the "template" account's practice sets (and the scores they refer
  // to) into a brand-new account, instead of the static js/default-sets.js
  // seed. Scores are cloned first — reusing the SAME storage file rather than
  // copying bytes (a "read template score files" RLS policy on storage.objects
  // permits that) — so their freshly-inserted ids can remap the scoreId
  // references inside the template's set rows. Returns false (never throws
  // on "nothing to clone") if the template account has no sets yet.
  async function cloneFromTemplateAccount(newUserId, templateUserId) {
    const { data: templateScores, error: scoresErr } = await client
      .from(SCORES_TABLE).select('id, name, storage_path, mime_type').eq('user_id', templateUserId);
    if (scoresErr) throw scoresErr;

    const scoreIdMap = {};
    for (const s of (templateScores || [])) {
      const { data, error } = await client
        .from(SCORES_TABLE)
        .insert({ user_id: newUserId, name: s.name, storage_path: s.storage_path, mime_type: s.mime_type })
        .select('id')
        .single();
      if (error) throw error;
      scoreIdMap[s.id] = data.id;
    }

    const { data: templateSets, error: setsErr } = await client
      .from(TABLE).select('name, rows').eq('user_id', templateUserId);
    if (setsErr) throw setsErr;
    if (!templateSets || templateSets.length === 0) return false;

    const remapRows = (rows) => (rows || []).map(r => {
      if (r.kind === 'score' && r.scoreId && scoreIdMap[r.scoreId]) {
        return Object.assign({}, r, { scoreId: scoreIdMap[r.scoreId] });
      }
      return r;
    });
    const { error } = await client
      .from(TABLE)
      .insert(templateSets.map(s => ({ user_id: newUserId, name: s.name, rows: remapRows(s.rows) })));
    if (error) throw error;
    return true;
  }

  // Seeds a brand-new account: clones the template account (see above) if
  // js/config.js sets templateUserId, otherwise falls back to the static
  // starter sets + scores (js/default-sets.js, js/default-scores.js).
  // Scores are seeded first so their freshly generated ids can resolve the
  // `scoreKey` references in DEFAULT_PRACTICE_SETS' score-kind rows. Returns
  // true if anything was seeded, false if the account already has sets
  // (never re-seeds on top of real content).
  async function seedDefaultsIfEmpty() {
    const userId = await currentUserId();
    const existing = await listSets();
    if (existing.length > 0) return false;

    const templateUserId = window.PRACTICOMETER_CONFIG && window.PRACTICOMETER_CONFIG.templateUserId;
    if (templateUserId) {
      try {
        const seeded = await cloneFromTemplateAccount(userId, templateUserId);
        if (seeded) return true;
      } catch (e) {
        console.warn('Template account clone failed, falling back to static defaults:', e);
      }
    }

    const defaultScores = window.DEFAULT_SCORES || [];
    const scoreIdByKey = {};
    for (const d of defaultScores) {
      const blob = await (await fetch(d.path)).blob();
      const cleanName = (d.name || 'score').replace(/[^A-Za-z0-9._-]/g, '_');
      const ext = (d.path.match(/\.[^./]+$/) || ['.dat'])[0];
      const storagePath = userId + '/' + Date.now() + '-' + cleanName + ext;
      const { error: uploadErr } = await client.storage.from(SCORES_BUCKET)
        .upload(storagePath, blob, { contentType: d.mimeType });
      if (uploadErr) throw uploadErr;
      const { data, error } = await client
        .from(SCORES_TABLE)
        .insert({ user_id: userId, name: d.name, storage_path: storagePath, mime_type: d.mimeType })
        .select('id')
        .single();
      if (error) throw error;
      scoreIdByKey[d.key] = data.id;
    }

    const defaultSets = window.DEFAULT_PRACTICE_SETS || [];
    if (defaultSets.length === 0) return defaultScores.length > 0;
    const resolveRows = (rows) => rows.map(r => {
      if (r.kind === 'score' && r.scoreKey) {
        const { scoreKey, ...rest } = r;
        return Object.assign(rest, { scoreId: scoreIdByKey[scoreKey] });
      }
      return r;
    });
    const { error } = await client
      .from(TABLE)
      .insert(defaultSets.map(s => ({ user_id: userId, name: s.name, rows: resolveRows(s.rows) })));
    if (error) throw error;
    return true;
  }

  // ── Scores library (uploaded PDFs/images, used as practice-list items) ──
  const SCORES_TABLE = 'scores';
  const SCORES_BUCKET = 'scores';

  async function listScores() {
    requireClient();
    const { data, error } = await client
      .from(SCORES_TABLE)
      .select('id, name, mime_type')
      .order('name', { ascending: true });
    if (error) throw error;
    return data;
  }

  async function uploadScore(file, displayName) {
    const userId = await currentUserId();
    const cleanName = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
    const storagePath = userId + '/' + Date.now() + '-' + cleanName;
    const { error: uploadErr } = await client.storage.from(SCORES_BUCKET).upload(storagePath, file);
    if (uploadErr) throw uploadErr;
    const { data, error } = await client
      .from(SCORES_TABLE)
      .insert({ user_id: userId, name: displayName || file.name, storage_path: storagePath, mime_type: file.type || 'application/octet-stream' })
      .select('id, name, mime_type')
      .single();
    if (error) throw error;
    return data;
  }

  async function renameScore(id, newName) {
    requireClient();
    const { error } = await client.from(SCORES_TABLE).update({ name: newName }).eq('id', id);
    if (error) throw error;
    return true;
  }

  async function deleteScore(id) {
    requireClient();
    const { data: score, error: fetchErr } = await client
      .from(SCORES_TABLE).select('storage_path').eq('id', id).single();
    if (fetchErr) throw fetchErr;
    await client.storage.from(SCORES_BUCKET).remove([score.storage_path]);
    const { error } = await client.from(SCORES_TABLE).delete().eq('id', id);
    if (error) throw error;
    return true;
  }

  // Signed URL, regenerated on every call rather than cached — scores are
  // shown only while their practice-list item is active.
  async function getScoreUrl(id) {
    requireClient();
    const { data: score, error: fetchErr } = await client
      .from(SCORES_TABLE).select('storage_path, mime_type, name').eq('id', id).single();
    if (fetchErr) throw fetchErr;
    const { data, error } = await client.storage.from(SCORES_BUCKET).createSignedUrl(score.storage_path, 3600);
    if (error) throw error;
    return { url: data.signedUrl, mimeType: score.mime_type, name: score.name };
  }

  // ── Practice log ──
  // A session is inserted at start and kept fresh with periodic heartbeat
  // updates (see index.html's practice-log wiring) rather than relying on
  // a beforeunload/quit hook — that way a crash, force-quit, or killed tab
  // still leaves a real row with an ended_at/duration accurate to within
  // one heartbeat interval, on both the web and the desktop app alike.
  const LOG_TABLE = 'practice_log';

  async function startPracticeLog(setName) {
    const userId = await currentUserId();
    const { data, error } = await client
      .from(LOG_TABLE)
      .insert({ user_id: userId, set_name: setName, started_at: new Date().toISOString() })
      .select('id')
      .single();
    if (error) throw error;
    return data.id;
  }

  async function updatePracticeLog(id, { durationSec, activities }) {
    requireClient();
    const { error } = await client
      .from(LOG_TABLE)
      .update({ duration_sec: Math.round(durationSec), activities, ended_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  }

  async function finishPracticeLog(id, { durationSec, activities }) {
    return updatePracticeLog(id, { durationSec, activities });
  }

  async function listPracticeLog() {
    requireClient();
    const { data, error } = await client
      .from(LOG_TABLE)
      .select('id, set_name, started_at, ended_at, duration_sec, activities, notes')
      .order('started_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async function updatePracticeLogEntry(id, fields) {
    requireClient();
    const patch = {};
    if (fields.setName !== undefined) patch.set_name = fields.setName;
    if (fields.startedAt !== undefined) patch.started_at = fields.startedAt;
    if (fields.durationSec !== undefined) patch.duration_sec = Math.round(fields.durationSec);
    if (fields.notes !== undefined) patch.notes = fields.notes;
    const { error } = await client.from(LOG_TABLE).update(patch).eq('id', id);
    if (error) throw error;
    return true;
  }

  async function deletePracticeLogEntry(id) {
    requireClient();
    const { error } = await client.from(LOG_TABLE).delete().eq('id', id);
    if (error) throw error;
    return true;
  }

  // ── Feedback ──
  const FEEDBACK_TABLE = 'feedback';
  const ADMIN_EMAIL = 'dcr@eyethink.org';

  async function currentUserEmail() {
    requireClient();
    const { data } = await client.auth.getUser();
    return data.user ? data.user.email : null;
  }

  function isFeedbackAdmin(email) {
    return email === ADMIN_EMAIL;
  }

  async function submitFeedback({ enjoyment, liked, improve, disliked }) {
    // Captures the signed-in user's id/email now, while the session is still
    // active — callers on the sign-out flow must call this BEFORE Auth.signOut().
    const userId = await currentUserId();
    const email = await currentUserEmail();
    const { error } = await client
      .from(FEEDBACK_TABLE)
      .insert({ user_id: userId, user_email: email, enjoyment, liked, improve, disliked });
    if (error) throw error;
    return true;
  }

  // Admin-only (RLS enforces this server-side too): every feedback row,
  // newest first — used to build the CSV export.
  async function listFeedback() {
    requireClient();
    const { data, error } = await client
      .from(FEEDBACK_TABLE)
      .select('user_email, enjoyment, liked, improve, disliked, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  // ── Activity tracking (admin-only CSV export) ──
  // One row per app session: who, when it started, when it was last seen
  // (a heartbeat, same pattern as practice_log), and which top-bar functions
  // got opened. See js/activity-log.js for what calls these.
  const SESSIONS_TABLE = 'user_sessions';
  let currentSessionId = null;
  let currentSessionFunctions = new Set();

  async function startUserSession() {
    const userId = await currentUserId();
    const email = await currentUserEmail();
    const nowIso = new Date().toISOString();
    const { data, error } = await client
      .from(SESSIONS_TABLE)
      .insert({ user_id: userId, user_email: email, started_at: nowIso, last_seen_at: nowIso, functions_used: [] })
      .select('id')
      .single();
    if (error) throw error;
    currentSessionId = data.id;
    currentSessionFunctions = new Set();
    return currentSessionId;
  }

  async function touchUserSession() {
    if (!currentSessionId) return;
    const { error } = await client
      .from(SESSIONS_TABLE)
      .update({ last_seen_at: new Date().toISOString(), functions_used: Array.from(currentSessionFunctions) })
      .eq('id', currentSessionId);
    if (error) console.error('touchUserSession failed:', error);
  }

  // Fire-and-forget: records a function as opened this session (once per
  // distinct name) and immediately syncs it, rather than waiting on the
  // next heartbeat, so a short session still gets its functions_used right.
  function trackFunctionUsage(name) {
    if (!currentSessionId || currentSessionFunctions.has(name)) return;
    currentSessionFunctions.add(name);
    touchUserSession();
  }

  // Admin-only (RLS enforces this server-side too): every session row,
  // newest first — used to build the CSV export.
  async function listUserSessions() {
    requireClient();
    const { data, error } = await client
      .from(SESSIONS_TABLE)
      .select('user_email, started_at, last_seen_at, functions_used')
      .order('user_email', { ascending: true })
      .order('started_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  window.api = {
    listSets, readCSV, saveCSV, renameCSV, duplicateCSV, createSet,
    resizeWindow, getWindowSize, seedDefaultsIfEmpty,
    listScores, uploadScore, renameScore, deleteScore, getScoreUrl,
    startPracticeLog, updatePracticeLog, finishPracticeLog,
    listPracticeLog, updatePracticeLogEntry, deletePracticeLogEntry,
    currentUserEmail, isFeedbackAdmin, submitFeedback, listFeedback,
    startUserSession, touchUserSession, trackFunctionUsage, listUserSessions
  };
})();
