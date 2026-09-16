(function () {
  const logTbody = document.getElementById('logTbody');
  const logEmpty = document.getElementById('logEmpty');
  const logTable = document.getElementById('logTable');
  if (!logTbody) return;

  function fmtDateForInput(iso) {
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function summarizeActivities(list) {
    if (!Array.isArray(list) || list.length === 0) return '—';
    return list.map(a => a.activity + (a.minutes ? ' (' + a.minutes + 'm)' : '')).join(', ');
  }

  async function save(id, fields) {
    try { await window.api.updatePracticeLogEntry(id, fields); }
    catch (err) { console.error('Failed to save practice log edit:', err); }
  }

  async function render() {
    if (!window.api) return;
    let entries;
    try {
      entries = await window.api.listPracticeLog();
    } catch (err) {
      console.error('Failed to load practice log:', err);
      entries = [];
    }
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
      const dateInput = document.createElement('input');
      dateInput.type = 'datetime-local';
      dateInput.value = fmtDateForInput(entry.started_at);
      dateInput.setAttribute('data-tip', 'When this session started — edit if it looks wrong.');
      dateInput.addEventListener('change', () => save(entry.id, { startedAt: new Date(dateInput.value).toISOString() }));
      tdDate.appendChild(dateInput); tr.appendChild(tdDate);

      const tdMin = document.createElement('td');
      const minInput = document.createElement('input');
      minInput.type = 'text'; minInput.className = 'time-input';
      minInput.value = Math.round((entry.duration_sec || 0) / 60);
      minInput.setAttribute('data-tip', 'Minutes practiced.');
      minInput.addEventListener('change', () => save(entry.id, { durationSec: (parseFloat(minInput.value) || 0) * 60 }));
      tdMin.appendChild(minInput); tr.appendChild(tdMin);

      const tdSet = document.createElement('td');
      const setInput = document.createElement('input');
      setInput.type = 'text'; setInput.value = entry.set_name || '';
      setInput.setAttribute('data-tip', 'Which practice set this session was.');
      setInput.addEventListener('change', () => save(entry.id, { setName: setInput.value }));
      tdSet.appendChild(setInput); tr.appendChild(tdSet);

      const tdAct = document.createElement('td');
      tdAct.className = 'log-activities';
      tdAct.textContent = summarizeActivities(entry.activities);
      tdAct.setAttribute('data-tip', 'What was done — recorded automatically as the session ran.');
      tr.appendChild(tdAct);

      const tdNotes = document.createElement('td');
      const notesArea = document.createElement('textarea');
      notesArea.value = entry.notes || '';
      notesArea.rows = 1;
      notesArea.setAttribute('data-tip', 'Your own notes about this session.');
      notesArea.addEventListener('change', () => save(entry.id, { notes: notesArea.value }));
      tdNotes.appendChild(notesArea); tr.appendChild(tdNotes);

      const tdDel = document.createElement('td');
      const del = document.createElement('button');
      del.className = 'del-btn'; del.textContent = '×';
      del.setAttribute('data-tip', 'Delete this log entry.');
      del.addEventListener('click', async () => {
        try {
          await window.api.deletePracticeLogEntry(entry.id);
          tr.remove();
          if (!logTbody.children.length) render();
        } catch (err) { console.error('Failed to delete log entry:', err); }
      });
      tdDel.appendChild(del); tr.appendChild(tdDel);

      logTbody.appendChild(tr);
    });
  }

  window.PracticeLog = { render };
})();
