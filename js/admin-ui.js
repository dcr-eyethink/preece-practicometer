(function () {
  const dashboardBtn = document.getElementById('adminDashboardBtn');
  const overlay = document.getElementById('adminOverlay');
  if (!dashboardBtn || !overlay || !window.api || !window.Auth) return;

  const closeBtn = document.getElementById('adminCloseBtn');
  const usersEmpty = document.getElementById('adminUsersEmpty');
  const usersTable = document.getElementById('adminUsersTable');
  const usersTbody = document.getElementById('adminUsersTbody');
  const detailEmpty = document.getElementById('adminDetailEmpty');
  const detailContent = document.getElementById('adminDetailContent');
  const detailEmail = document.getElementById('adminDetailEmail');
  const setsEmpty = document.getElementById('adminSetsEmpty');
  const setsList = document.getElementById('adminSetsList');
  const logEmpty = document.getElementById('adminLogEmpty');
  const logTable = document.getElementById('adminLogTable');
  const logTbody = document.getElementById('adminLogTbody');
  const statusEl = document.getElementById('adminStatus');

  let users = [];
  let selectedUser = null;

  function showStatus(msg, isError) {
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('error', !!isError);
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString();
  }

  function summarizeActivities(list) {
    if (!Array.isArray(list) || list.length === 0) return '—';
    return list.map(a => a.activity + (a.minutes ? ' (' + a.minutes + 'm)' : '')).join(', ');
  }

  function renderUsersTable() {
    usersTbody.innerHTML = '';
    if (users.length === 0) {
      usersEmpty.style.display = 'block';
      usersTable.style.display = 'none';
      return;
    }
    usersEmpty.style.display = 'none';
    usersTable.style.display = '';

    users.forEach(user => {
      const tr = document.createElement('tr');
      if (selectedUser && selectedUser.id === user.id) tr.classList.add('selected');

      const tdEmail = document.createElement('td');
      tdEmail.className = 'admin-user-email';
      tdEmail.textContent = user.email;
      tr.appendChild(tdEmail);

      const tdFirst = document.createElement('td');
      tdFirst.textContent = fmtDate(user.createdAt);
      tr.appendChild(tdFirst);

      const tdLast = document.createElement('td');
      tdLast.textContent = fmtDate(user.lastSeen);
      tr.appendChild(tdLast);

      const tdSessions = document.createElement('td');
      tdSessions.textContent = String(user.sessionCount);
      tr.appendChild(tdSessions);

      tr.addEventListener('click', () => selectUser(user));
      usersTbody.appendChild(tr);
    });
  }

  function renderSets(sets) {
    setsList.innerHTML = '';
    if (sets.length === 0) {
      setsEmpty.style.display = 'block';
      setsList.style.display = 'none';
      return;
    }
    setsEmpty.style.display = 'none';
    setsList.style.display = '';

    const otherUsers = users.filter(u => u.id !== selectedUser.id);

    sets.forEach(set => {
      const li = document.createElement('li');
      li.className = 'admin-set-item' + (set.archived ? ' admin-set-archived' : '');

      const name = document.createElement('span');
      name.className = 'admin-set-name';
      const itemLabel = set.itemCount + (set.itemCount === 1 ? ' item' : ' items');
      const updatedLabel = set.updatedAt ? ', updated ' + new Date(set.updatedAt).toLocaleString() : '';
      const archivedLabel = set.archived ? ' — archived' : '';
      name.textContent = set.name + ' (' + itemLabel + updatedLabel + ')' + archivedLabel;
      li.appendChild(name);

      const select = document.createElement('select');
      select.className = 'admin-set-target';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Copy/move to…';
      select.appendChild(placeholder);
      otherUsers.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = u.email;
        select.appendChild(opt);
      });
      li.appendChild(select);

      function targetOrWarn() {
        const targetId = select.value;
        if (!targetId) {
          showStatus('Choose a destination account first.', true);
          return null;
        }
        const targetUser = otherUsers.find(u => u.id === targetId);
        return { targetId, targetEmail: targetUser ? targetUser.email : targetId };
      }

      const copyBtn = document.createElement('button');
      copyBtn.className = 'btn';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', async () => {
        const target = targetOrWarn();
        if (!target) return;
        try {
          copyBtn.disabled = true;
          await window.api.adminCopySet(set.id, target.targetId);
          showStatus('Copied "' + set.name + '" to ' + target.targetEmail + '.');
        } catch (err) {
          console.error('adminCopySet failed:', err);
          showStatus((err && err.message) || 'Copy failed.', true);
        } finally {
          copyBtn.disabled = false;
        }
      });
      li.appendChild(copyBtn);

      const moveBtn = document.createElement('button');
      moveBtn.className = 'btn';
      moveBtn.textContent = 'Move';
      moveBtn.addEventListener('click', async () => {
        const target = targetOrWarn();
        if (!target) return;
        if (!window.confirm('Move "' + set.name + '" to ' + target.targetEmail + '? It will be removed from ' + selectedUser.email + '.')) return;
        try {
          moveBtn.disabled = true;
          await window.api.adminMoveSet(set.id, target.targetId);
          showStatus('Moved "' + set.name + '" to ' + target.targetEmail + '.');
          loadDetail(selectedUser);
        } catch (err) {
          console.error('adminMoveSet failed:', err);
          showStatus((err && err.message) || 'Move failed.', true);
        } finally {
          moveBtn.disabled = false;
        }
      });
      li.appendChild(moveBtn);

      if (set.archived) {
        const restoreBtn = document.createElement('button');
        restoreBtn.className = 'btn';
        restoreBtn.textContent = 'Restore';
        restoreBtn.addEventListener('click', async () => {
          try {
            restoreBtn.disabled = true;
            await window.api.adminRestoreSet(set.id);
            showStatus('Restored "' + set.name + '" for ' + selectedUser.email + '.');
            loadDetail(selectedUser);
          } catch (err) {
            console.error('adminRestoreSet failed:', err);
            showStatus((err && err.message) || 'Restore failed.', true);
          } finally {
            restoreBtn.disabled = false;
          }
        });
        li.appendChild(restoreBtn);
      }

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn admin-set-delete-btn';
      deleteBtn.innerHTML = '<img src="icons/trash.png" alt="Delete">';
      deleteBtn.setAttribute('title', 'Permanently delete');
      deleteBtn.addEventListener('click', async () => {
        if (!window.confirm('Permanently delete "' + set.name + '" from ' + selectedUser.email + '? This cannot be undone.')) return;
        try {
          deleteBtn.disabled = true;
          await window.api.adminDeleteSet(set.id);
          showStatus('Deleted "' + set.name + '".');
          loadDetail(selectedUser);
        } catch (err) {
          console.error('adminDeleteSet failed:', err);
          showStatus((err && err.message) || 'Delete failed.', true);
        } finally {
          deleteBtn.disabled = false;
        }
      });
      li.appendChild(deleteBtn);

      setsList.appendChild(li);
    });
  }

  function renderLog(entries) {
    logTbody.innerHTML = '';
    if (entries.length === 0) {
      logEmpty.style.display = 'block';
      logTable.style.display = 'none';
      return;
    }
    logEmpty.style.display = 'none';
    logTable.style.display = '';

    entries.forEach(entry => {
      const tr = document.createElement('tr');

      const tdDate = document.createElement('td');
      tdDate.textContent = entry.started_at ? new Date(entry.started_at).toLocaleString() : '—';
      tr.appendChild(tdDate);

      const tdMin = document.createElement('td');
      tdMin.textContent = Math.round((entry.duration_sec || 0) / 60);
      tr.appendChild(tdMin);

      const tdSet = document.createElement('td');
      tdSet.textContent = entry.set_name || '—';
      tr.appendChild(tdSet);

      const tdAct = document.createElement('td');
      tdAct.textContent = summarizeActivities(entry.activities);
      tr.appendChild(tdAct);

      const tdNotes = document.createElement('td');
      tdNotes.textContent = entry.notes || '—';
      tr.appendChild(tdNotes);

      logTbody.appendChild(tr);
    });
  }

  async function loadDetail(user) {
    try {
      const sets = await window.api.adminListUserSets(user.id);
      renderSets(sets);
    } catch (err) {
      console.error('adminListUserSets failed:', err);
      showStatus((err && err.message) || 'Failed to load practice lists.', true);
    }
    try {
      const entries = await window.api.adminListUserLog(user.id);
      renderLog(entries);
    } catch (err) {
      console.error('adminListUserLog failed:', err);
      showStatus((err && err.message) || 'Failed to load practice log.', true);
    }
  }

  function selectUser(user) {
    selectedUser = user;
    renderUsersTable();
    detailEmpty.style.display = 'none';
    detailContent.style.display = '';
    detailEmail.textContent = user.email;
    showStatus('');
    loadDetail(user);
  }

  async function loadUsers() {
    try {
      users = await window.api.adminListUsers();
      renderUsersTable();
    } catch (err) {
      console.error('adminListUsers failed:', err);
      users = [];
      renderUsersTable();
      showStatus((err && err.message) || 'Failed to load users.', true);
    }
  }

  function openDashboard() {
    overlay.style.display = 'flex';
    selectedUser = null;
    detailEmpty.style.display = '';
    detailContent.style.display = 'none';
    showStatus('');
    loadUsers();
  }

  dashboardBtn.addEventListener('click', openDashboard);
  closeBtn.addEventListener('click', () => { overlay.style.display = 'none'; });

  window.Auth.getSession().then(async session => {
    if (!session) return;
    try {
      const email = await window.api.currentUserEmail();
      if (window.api.isFeedbackAdmin(email)) {
        dashboardBtn.style.display = '';
        // Desktop build only — switching the window's URL is meaningless on
        // the web build, where index.html just *is* whatever's deployed.
        const devBtn = document.getElementById('devSiteBtn');
        if (devBtn && window.electronAPI) {
          devBtn.style.display = '';
          devBtn.addEventListener('click', async () => {
            try {
              const onDev = await window.electronAPI.toggleDevSite();
              devBtn.classList.toggle('active', onDev);
              devBtn.setAttribute('data-tip', onDev
                ? 'On your local dev server. Click to switch back to the live site.'
                : 'Switch this window to your local dev server, to test a branch before merging it live. Click again to switch back.');
            } catch (err) {
              console.error('toggleDevSite failed:', err);
            }
          });
        }
      }
    } catch (err) {
      console.error('Admin check failed:', err);
    }
  }).catch(() => {});
})();
