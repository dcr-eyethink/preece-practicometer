const { app, BrowserWindow, session, ipcMain, systemPreferences } = require('electron');
const path = require('path');
const { execFile } = require('child_process');

// Where the app's UI actually lives — defaults to the deployed site, or
// override with PRACTICOMETER_URL (e.g. a local static server) for dev work.
const APP_URL = process.env.PRACTICOMETER_URL || 'https://dcr-eyethink.github.io/preece-practicometer/';

// Desktop-only "open other apps" buttons in the top bar. Fixed allowlist,
// launched via execFile (no shell) so the renderer can never inject an
// arbitrary command even though the window loads a remote page.
const LAUNCHABLE_APPS = ['GarageBand', 'iReal Pro', 'forScore'];

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 826,
    resizable: true,
    acceptFirstMouse: true,
    title: 'Preece Practicometer',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  win.loadURL(APP_URL);
}

app.whenReady().then(async () => {
  // setPermissionRequestHandler below only gates the in-page prompt — on
  // macOS the mic never actually works (and the app never even shows up in
  // System Settings > Privacy & Security > Microphone) until the OS-level
  // access is requested through this API.
  if (process.platform === 'darwin' && systemPreferences.askForMediaAccess) {
    await systemPreferences.askForMediaAccess('microphone');
  }
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'midi' || permission === 'midiSysex');
  });
  ipcMain.handle('launch-app', (e, appName) => {
    if (!LAUNCHABLE_APPS.includes(appName)) return;
    execFile('open', ['-a', appName]);
  });
  createWindow();
});

app.on('window-all-closed', () => { app.quit(); });

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
