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
// What the admin-only "dev" toggle in the top bar (index.html's devSiteBtn)
// switches to and from — a local static server serving an in-progress
// branch, so the live site can be left alone while testing. Override with
// PRACTICOMETER_DEV_URL if that server runs somewhere other than the
// default .claude/launch.json port.
const DEV_URL = process.env.PRACTICOMETER_DEV_URL || 'http://localhost:4173';

// Desktop-only "open other apps" buttons in the top bar. Fixed allowlist,
// launched via execFile (no shell) so the renderer can never inject an
// arbitrary command even though the window loads a remote page.
const LAUNCHABLE_APPS = ['GarageBand', 'iReal Pro', 'forScore'];

// The most recently created window and whether it's currently pointed at
// DEV_URL instead of APP_URL — toggled by the admin-only dev button.
let mainWindow = null;
let onDevSite = false;

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

  mainWindow = win;
  onDevSite = false;
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });
  win.loadURL(APP_URL);
}

// Flips the focused window between the live site and DEV_URL. Always
// re-clears the cache first (same reasoning as the startup clearCache
// below) so switching never serves a stale cached copy of either side.
async function toggleDevSite() {
  if (!mainWindow) return onDevSite;
  onDevSite = !onDevSite;
  await session.defaultSession.clearCache();
  mainWindow.loadURL(onDevSite ? DEV_URL : APP_URL);
  return onDevSite;
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
  ipcMain.handle('toggle-dev-site', () => toggleDevSite());
  createWindow();
});

app.on('window-all-closed', () => { app.quit(); });

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
