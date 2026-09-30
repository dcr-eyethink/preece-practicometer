const { app, BrowserWindow, session, ipcMain, systemPreferences, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

// Remembers the signed-in email/password across launches so the user isn't
// re-prompted every time. Encrypted at rest with Electron's safeStorage,
// which on macOS is backed by the login Keychain (Keychain Access shows the
// key as "Electron Safe Storage" / the app's own entry).
const CREDENTIALS_PATH = () => path.join(app.getPath('userData'), 'saved-credentials.bin');

function saveCredentials(email, password) {
  if (!safeStorage.isEncryptionAvailable()) return false;
  const payload = JSON.stringify({ email, password });
  fs.writeFileSync(CREDENTIALS_PATH(), safeStorage.encryptString(payload));
  return true;
}

function loadCredentials() {
  try {
    const encrypted = fs.readFileSync(CREDENTIALS_PATH());
    if (!safeStorage.isEncryptionAvailable()) return null;
    return JSON.parse(safeStorage.decryptString(encrypted));
  } catch (err) {
    return null;
  }
}

function clearCredentials() {
  try { fs.unlinkSync(CREDENTIALS_PATH()); } catch (err) { /* nothing to remove */ }
}

// Where the app's UI actually lives — defaults to the deployed site, or
// override with PRACTICOMETER_URL (e.g. a local static server) for dev work.
const APP_URL = process.env.PRACTICOMETER_URL || 'https://dcr-eyethink.github.io/preece-practicometer/';

// Desktop-only "open other apps" buttons in the top bar. Fixed allowlist,
// launched via execFile (no shell) so the renderer can never inject an
// arbitrary command even though the window loads a remote page.
const LAUNCHABLE_APPS = ['GarageBand', 'iReal Pro', 'forScore'];

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 826,
    resizable: true,
    acceptFirstMouse: true,
    title: 'Practicometer',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  // Links like target="_blank" (e.g. the welcome video) should open in the
  // user's real browser, not spawn another in-app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.loadURL(APP_URL);
}

app.whenReady().then(async () => {
  // The app is a thin wrapper that just loads a live web page — always
  // fetch it (and its scripts) fresh rather than risking a stale disk-
  // cached copy from a previous launch, since there's no in-app way to
  // "reload" otherwise and web-content fixes wouldn't require a rebuild.
  await session.defaultSession.clearCache();

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
  ipcMain.handle('save-credentials', (e, email, password) => saveCredentials(email, password));
  ipcMain.handle('load-credentials', () => loadCredentials());
  ipcMain.handle('clear-credentials', () => clearCredentials());
  createWindow();
});

app.on('window-all-closed', () => { app.quit(); });

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
