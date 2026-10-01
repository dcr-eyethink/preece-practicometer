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
    let { data, error } = await client
      .from(TABLE)
      .select('id, name')
      .eq('archived', false)
      .order('name', { ascending: true });
    if (error && error.code === '42703') {
      // supabase/archive_practice_sets.sql hasn't been run yet on this
      // project — fall back to the unfiltered query rather than breaking
      // every sign-in until it is.
      ({ data, error } = await client.from(TABLE).select('id, name').order('name', { ascending: true }));
    }
    if (error) throw error;
    return data.map(r => ({ name: r.name, path: r.id }));
  }

  // Soft-delete: hides the list from the owner's own view (listSets above)
  // without losing it — an admin can bring it back via adminRestoreSet, see
  // js/admin-ui.js's Restore button.
  async function archiveSet(id) {
    requireClient();
    const { error } = await client.from(TABLE).update({ archived: true }).eq('id', id);
    if (error) throw error;
    return true;
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
    let { data: existingNames, error } = await client
      .from(TABLE)
      .select('name')
      .eq('user_id', userId)
      .eq('archived', false);
    if (error && error.code === '42703') {
      // supabase/archive_practice_sets.sql hasn't been run yet.
      ({ data: existingNames, error } = await client.from(TABLE).select('name').eq('user_id', userId));
    }
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

  // ── Set browser (folders) ──
  const FOLDERS_TABLE = 'set_folders';

  async function listFolders() {
    requireClient();
    const { data, error } = await client
      .from(FOLDERS_TABLE)
      .select('id, name, parent_folder_id, position, trashed')
      .eq('trashed', false)
      .order('position', { ascending: true });
    if (error) throw error;
    return data.map(f => ({ id: f.id, name: f.name, parentFolderId: f.parent_folder_id, position: f.position }));
  }

  // Everything, including trashed folders and archived sets — used to build
  // the Trash view and to walk a folder's descendants before trashing it.
  // Falls back to a flat (folderless) list if supabase/set_browser.sql
  // hasn't been run yet on this project — 42P01 ("relation does not
  // exist") for the brand-new set_folders table, 42703 ("column does not
  // exist") for practice_sets' new folder_id/position columns — rather
  // than breaking the whole set browser until someone runs it.
  async function listAllFoldersAndSets() {
    requireClient();
    let foldersRes = await client.from(FOLDERS_TABLE).select('id, name, parent_folder_id, position, trashed');
    if (foldersRes.error && foldersRes.error.code === '42P01') foldersRes = { data: [] };
    else if (foldersRes.error) throw foldersRes.error;

    let setsRes = await client.from(TABLE).select('id, name, folder_id, position, archived');
    if (setsRes.error && setsRes.error.code === '42703') {
      setsRes = await client.from(TABLE).select('id, name, archived');
    }
    if (setsRes.error) throw setsRes.error;

    return {
      folders: (foldersRes.data || []).map(f => ({ id: f.id, name: f.name, parentFolderId: f.parent_folder_id, position: f.position, trashed: !!f.trashed })),
      sets: (setsRes.data || []).map(s => ({ id: s.id, name: s.name, folderId: s.folder_id || null, position: s.position || 0, archived: !!s.archived }))
    };
  }

  async function createFolder(name, parentFolderId) {
    const userId = await currentUserId();
    const { data, error } = await client
      .from(FOLDERS_TABLE)
      .insert({ user_id: userId, name, parent_folder_id: parentFolderId || null })
      .select('id, name')
      .single();
    if (error) throw error;
    return { id: data.id, name: data.name };
  }

  async function renameFolder(id, name) {
    requireClient();
    const { error } = await client.from(FOLDERS_TABLE).update({ name }).eq('id', id);
    if (error) throw error;
    return true;
  }

  async function moveFolder(id, parentFolderId, position) {
    requireClient();
    const { error } = await client
      .from(FOLDERS_TABLE)
      .update({ parent_folder_id: parentFolderId || null, position: position || 0 })
      .eq('id', id);
    if (error) throw error;
    return true;
  }

  async function moveSet(id, folderId, position) {
    requireClient();
    const { error } = await client
      .from(TABLE)
      .update({ folder_id: folderId || null, position: position || 0 })
      .eq('id', id);
    if (error) throw error;
    return true;
  }

  // ids: ordered array of {id, kind: 'folder'|'set'} siblings in the same
  // container — writes position 0..n-1 so the new order sticks.
  async function reorderSiblings(items) {
    requireClient();
    await Promise.all(items.map((item, i) => {
      const table = item.kind === 'folder' ? FOLDERS_TABLE : TABLE;
      return client.from(table).update({ position: i }).eq('id', item.id);
    }));
    return true;
  }

  // Trashes a folder and everything nested inside it. `tree` is the
  // {folders, sets} result of a recent listAllFoldersAndSets() call — small
  // per-user datasets, so the descendant walk happens client-side rather
  // than with a recursive SQL query.
  async function trashFolder(id, tree) {
    requireClient();
    const descendantFolderIds = [id];
    let frontier = [id];
    while (frontier.length) {
      const next = tree.folders.filter(f => frontier.includes(f.parentFolderId)).map(f => f.id);
      descendantFolderIds.push(...next);
      frontier = next;
    }
    const descendantSetIds = tree.sets.filter(s => descendantFolderIds.includes(s.folderId)).map(s => s.id);
    await Promise.all([
      client.from(FOLDERS_TABLE).update({ trashed: true }).in('id', descendantFolderIds),
      descendantSetIds.length ? client.from(TABLE).update({ archived: true }).in('id', descendantSetIds) : Promise.resolve()
    ]);
    return true;
  }

  // Restoring a folder/set also un-trashes any trashed ancestor folders —
  // otherwise it would reappear nested inside a folder that's still hidden
  // in the Trash. `tree` is a recent listAllFoldersAndSets() result.
  async function restoreAncestorChain(parentFolderId, tree) {
    const trashedAncestorIds = [];
    let cur = parentFolderId;
    while (cur) {
      const folder = tree.folders.find(f => f.id === cur);
      if (!folder) break;
      if (folder.trashed) trashedAncestorIds.push(folder.id);
      cur = folder.parentFolderId;
    }
    if (trashedAncestorIds.length) {
      await client.from(FOLDERS_TABLE).update({ trashed: false }).in('id', trashedAncestorIds);
    }
  }

  async function restoreFolder(id, tree) {
    requireClient();
    const folder = tree.folders.find(f => f.id === id);
    await client.from(FOLDERS_TABLE).update({ trashed: false }).eq('id', id);
    if (folder) await restoreAncestorChain(folder.parentFolderId, tree);
    return true;
  }

  async function restoreSet(id, tree) {
    requireClient();
    const set = tree.sets.find(s => s.id === id);
    await client.from(TABLE).update({ archived: false }).eq('id', id);
    if (set) await restoreAncestorChain(set.folderId, tree);
    return true;
  }

  const setItemNamesCache = new Map();
  async function listSetItemNames(id) {
    if (setItemNamesCache.has(id)) return setItemNamesCache.get(id);
    const data = await readCSV(id);
    const names = (data.rows || []).map(r => r.activity || '(untitled)');
    setItemNamesCache.set(id, names);
    return names;
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
    // A unique-violation here means another concurrent load (e.g. the same
    // brand-new account opened in two tabs at once) already inserted these
    // same-named rows first — nothing went wrong, this racer just lost;
    // report success so the caller reloads and shows what the winner seeded.
    if (error && error.code !== '23505') throw error;
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
    // Same race as cloneFromTemplateAccount above: a unique-violation means
    // another concurrent load already seeded these defaults first.
    if (error && error.code !== '23505') throw error;
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

  // Which of the current user's own practice sets have an item referencing
  // this score — used to warn before deleteScore orphans those items (they'd
  // otherwise silently start showing "Could not load this score." the next
  // time someone opens them, with nothing pointing back at why).
  async function findScoreUsage(scoreId) {
    requireClient();
    const userId = await currentUserId();
    const { data, error } = await client
      .from(TABLE).select('name, rows').eq('user_id', userId).eq('archived', false);
    if (error) throw error;
    const usage = [];
    for (const s of (data || [])) {
      for (const r of (s.rows || [])) {
        if (r.kind === 'score' && r.scoreId === scoreId) {
          usage.push({ setName: s.name, activity: r.activity });
        }
      }
    }
    return usage;
  }

  // Makes sure the signed-in user owns a usable copy of a score referenced
  // by an imported item — reusing it unchanged if they already own it (the
  // only case today, since importing only pulls from your own sets), or
  // cloning the file + row into their own library otherwise. That second
  // path only matters once items/sets can be imported from someone else's
  // account or a shared library, but importing goes through this either way
  // so imported items are always self-contained rather than relying on a
  // scoreId the importer may one day not have read access to. Same cloning
  // technique as adminCopySet below. Returns the scoreId the imported row
  // should use.
  async function ensureOwnScoreCopy(scoreId) {
    requireClient();
    const userId = await currentUserId();
    const { data: score, error } = await client
      .from(SCORES_TABLE).select('id, user_id, name, storage_path, mime_type').eq('id', scoreId).single();
    if (error) throw error;
    if (score.user_id === userId) return scoreId;

    const cleanName = (score.storage_path.split('/').pop()) || 'score';
    const newStoragePath = userId + '/' + Date.now() + '-' + cleanName;
    const { error: copyErr } = await client.storage.from(SCORES_BUCKET).copy(score.storage_path, newStoragePath);
    if (copyErr) throw copyErr;
    const { data: inserted, error: insErr } = await client
      .from(SCORES_TABLE)
      .insert({ user_id: userId, name: score.name, storage_path: newStoragePath, mime_type: score.mime_type })
      .select('id')
      .single();
    if (insErr) throw insErr;
    return inserted.id;
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

  // ── Admin dashboard (dcr@eyethink.org only; RLS enforces server-side too) ──
  // Lets the admin browse every account's practice lists and practice log,
  // and copy or move a practice list (plus any scores its rows reference)
  // into a different account.
  const PROFILES_TABLE = 'profiles';

  async function adminListUsers() {
    requireClient();
    const { data: profiles, error } = await client
      .from(PROFILES_TABLE)
      .select('id, email, created_at')
      .order('email', { ascending: true });
    if (error) throw error;

    const { data: sessions, error: sessErr } = await client
      .from(SESSIONS_TABLE)
      .select('user_id, last_seen_at');
    if (sessErr) throw sessErr;

    const statsByUser = {};
    for (const s of (sessions || [])) {
      const st = statsByUser[s.user_id] || (statsByUser[s.user_id] = { sessionCount: 0, lastSeen: null });
      st.sessionCount++;
      if (!st.lastSeen || s.last_seen_at > st.lastSeen) st.lastSeen = s.last_seen_at;
    }

    return (profiles || []).map(u => {
      const stats = statsByUser[u.id];
      return {
        id: u.id,
        email: u.email,
        createdAt: u.created_at,
        sessionCount: stats ? stats.sessionCount : 0,
        lastSeen: stats ? stats.lastSeen : null
      };
    });
  }

  async function adminListUserSets(userId) {
    requireClient();
    let { data, error } = await client
      .from(TABLE)
      .select('id, name, rows, updated_at, archived')
      .eq('user_id', userId)
      .order('name', { ascending: true });
    if (error && error.code === '42703') {
      // supabase/archive_practice_sets.sql hasn't been run yet — fall back
      // without the archived column rather than breaking the dashboard.
      ({ data, error } = await client
        .from(TABLE).select('id, name, rows, updated_at').eq('user_id', userId).order('name', { ascending: true }));
    }
    if (error) throw error;
    return data.map(s => ({
      id: s.id,
      name: s.name,
      itemCount: (s.rows || []).length,
      updatedAt: s.updated_at,
      archived: !!s.archived
    }));
  }

  // Un-archives a list an owner soft-deleted (see archiveSet above), making
  // it reappear in their own view.
  async function adminRestoreSet(setId) {
    requireClient();
    const { error } = await client.from(TABLE).update({ archived: false }).eq('id', setId);
    if (error) throw error;
    return true;
  }

  async function adminListUserLog(userId) {
    requireClient();
    const { data, error } = await client
      .from(LOG_TABLE)
      .select('id, set_name, started_at, duration_sec, activities, notes')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    return data;
  }

  // Clones one practice set — and any scores its rows reference — into a
  // different account, the same technique cloneFromTemplateAccount uses to
  // seed new sign-ups: score files are physically copied into the target
  // account's own storage folder (rather than just re-pointing at the
  // original file) so the target's ordinary per-user storage policy covers
  // reading them back, with no broader access needed.
  async function adminCopySet(setId, targetUserId) {
    requireClient();
    const { data: set, error: setErr } = await client
      .from(TABLE).select('name, rows').eq('id', setId).single();
    if (setErr) throw setErr;

    const rows = set.rows || [];
    const scoreIds = Array.from(new Set(
      rows.filter(r => r.kind === 'score' && r.scoreId).map(r => r.scoreId)
    ));

    const scoreIdMap = {};
    if (scoreIds.length > 0) {
      const { data: scores, error: scoresErr } = await client
        .from(SCORES_TABLE).select('id, name, storage_path, mime_type').in('id', scoreIds);
      if (scoresErr) throw scoresErr;
      for (const s of scores) {
        const cleanName = (s.storage_path.split('/').pop()) || 'score';
        const newStoragePath = targetUserId + '/' + Date.now() + '-' + cleanName;
        const { error: copyErr } = await client.storage.from(SCORES_BUCKET).copy(s.storage_path, newStoragePath);
        if (copyErr) throw copyErr;
        const { data: inserted, error: insErr } = await client
          .from(SCORES_TABLE)
          .insert({ user_id: targetUserId, name: s.name, storage_path: newStoragePath, mime_type: s.mime_type })
          .select('id')
          .single();
        if (insErr) throw insErr;
        scoreIdMap[s.id] = inserted.id;
      }
    }

    const remappedRows = rows.map(r => {
      if (r.kind === 'score' && r.scoreId && scoreIdMap[r.scoreId]) {
        return Object.assign({}, r, { scoreId: scoreIdMap[r.scoreId] });
      }
      return r;
    });

    const newName = await uniqueName(targetUserId, set.name);
    const { data: newSet, error: insertErr } = await client
      .from(TABLE)
      .insert({ user_id: targetUserId, name: newName, rows: remappedRows })
      .select('id, name')
      .single();
    if (insertErr) throw insertErr;
    return newSet;
  }

  // Copy, then remove the original — the source account's copies of any
  // cloned scores are left in place (other lists there may still use them).
  async function adminMoveSet(setId, targetUserId) {
    const newSet = await adminCopySet(setId, targetUserId);
    const { error } = await client.from(TABLE).delete().eq('id', setId);
    if (error) throw error;
    return newSet;
  }

  // Permanently removes one practice list — e.g. cleaning up an accidental
  // duplicate (see the race-condition guards in cloneFromTemplateAccount/
  // seedDefaultsIfEmpty above). Does not touch any scores its rows reference,
  // since those may still be used by the account's other lists.
  async function adminDeleteSet(setId) {
    requireClient();
    const { error } = await client.from(TABLE).delete().eq('id', setId);
    if (error) throw error;
    return true;
  }

  window.api = {
    listSets, readCSV, saveCSV, renameCSV, duplicateCSV, createSet,
    resizeWindow, getWindowSize, seedDefaultsIfEmpty,
    listScores, uploadScore, renameScore, deleteScore, getScoreUrl, findScoreUsage, ensureOwnScoreCopy,
    startPracticeLog, updatePracticeLog, finishPracticeLog,
    listPracticeLog, updatePracticeLogEntry, deletePracticeLogEntry,
    currentUserEmail, isFeedbackAdmin, submitFeedback, listFeedback,
    startUserSession, touchUserSession, trackFunctionUsage, listUserSessions,
    adminListUsers, adminListUserSets, adminListUserLog, adminCopySet, adminMoveSet, adminDeleteSet,
    listFolders, listAllFoldersAndSets, createFolder, renameFolder, moveFolder, moveSet,
    reorderSiblings, trashFolder, restoreFolder, restoreSet, listSetItemNames,
    archiveSet, adminRestoreSet
  };
})();
