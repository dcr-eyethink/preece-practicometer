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

  // Seeds the starter sets + scores (js/default-sets.js, js/default-scores.js)
  // into a brand-new account. Scores are seeded first so their freshly
  // generated ids can resolve the `scoreKey` references in DEFAULT_PRACTICE_SETS'
  // score-kind rows. Returns true if anything was seeded, false if the
  // account already has sets (never re-seeds on top of real content).
  async function seedDefaultsIfEmpty() {
    const userId = await currentUserId();
    const existing = await listSets();
    if (existing.length > 0) return false;

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

  window.api = {
    listSets, readCSV, saveCSV, renameCSV, duplicateCSV, createSet,
    resizeWindow, getWindowSize, seedDefaultsIfEmpty,
    listScores, uploadScore, renameScore, deleteScore, getScoreUrl,
    startPracticeLog, updatePracticeLog, finishPracticeLog,
    listPracticeLog, updatePracticeLogEntry, deletePracticeLogEntry
  };
})();
