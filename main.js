const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

function getSetsDir() {
  if (app.isPackaged) {
    // On Mac: exe is inside .app/Contents/MacOS/, practiceSets is next to .app
    // On Windows: exe is in the app folder, practiceSets is next to it
    let exeDir = path.dirname(process.execPath);
    if (process.platform === 'darwin') {
      exeDir = path.resolve(exeDir, '..', '..', '..');
    }
    return path.join(exeDir, 'practiceSets');
  }
  return path.join(__dirname, 'practiceSets');
}

let SETS_DIR;

function createWindow() {
  const win = new BrowserWindow({
    width: 660,
    height: 760,
    resizable: true,
    title: 'Preece Practicometer',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  win.loadFile('index.html');
}

function parseCSV(text) {
  const rows = [];
  let current = '';
  let inQuotes = false;
  const chars = text.trim();
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === '"') {
      if (inQuotes && i + 1 < chars.length && chars[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      rows.push(current);
      current = '';
    } else if ((c === '\n' || c === '\r') && !inQuotes) {
      if (c === '\r' && i + 1 < chars.length && chars[i + 1] === '\n') i++;
      rows.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  rows.push(current);
  const result = [];
  for (let i = 0; i < rows.length; i += 2) {
    if (i + 1 < rows.length) {
      result.push({ activity: rows[i], time: rows[i + 1] });
    }
  }
  return result;
}

function toCSV(data) {
  let out = 'activity,time\n';
  for (const row of data) {
    let act = row.activity;
    if (act.includes(',') || act.includes('"') || act.includes('\n')) {
      act = '"' + act.replace(/"/g, '""') + '"';
    }
    out += act + ',' + row.time + '\n';
  }
  return out;
}

ipcMain.handle('list-sets', () => {
  if (!fs.existsSync(SETS_DIR)) {
    fs.mkdirSync(SETS_DIR, { recursive: true });
    return [];
  }
  return fs.readdirSync(SETS_DIR)
    .filter(f => f.endsWith('.csv') && f !== 'chordgrid.csv')
    .map(f => ({ name: f.replace('.csv', ''), path: path.join(SETS_DIR, f) }));
});

ipcMain.handle('read-csv', (e, filePath) => {
  const text = fs.readFileSync(filePath, 'utf-8');
  const parsed = parseCSV(text);
  if (parsed.length > 0 && parsed[0].activity === 'activity' && parsed[0].time === 'time') {
    parsed.shift();
  }
  return { name: path.basename(filePath, '.csv'), path: filePath, rows: parsed };
});

ipcMain.handle('save-csv', (e, filePath, data) => {
  fs.writeFileSync(filePath, toCSV(data), 'utf-8');
  return true;
});

ipcMain.handle('resize-window', (e, width, height) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) win.setSize(width, Math.max(height, 500), true);
});

ipcMain.handle('duplicate-csv', async (e, originalPath, data) => {
  const dir = path.dirname(originalPath);
  const baseName = path.basename(originalPath, '.csv');
  let newName = baseName + ' copy.csv';
  let counter = 2;
  while (fs.existsSync(path.join(dir, newName))) {
    newName = baseName + ' copy ' + counter + '.csv';
    counter++;
  }
  const newPath = path.join(dir, newName);
  fs.writeFileSync(newPath, toCSV(data), 'utf-8');
  return newPath;
});

app.whenReady().then(() => {
  SETS_DIR = getSetsDir();
  createWindow();
});

app.on('window-all-closed', () => { app.quit(); });

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
