const { app, BrowserWindow, session } = require('electron');

// Where the app's UI actually lives — defaults to the deployed site, or
// override with PRACTICOMETER_URL (e.g. a local static server) for dev work.
const APP_URL = process.env.PRACTICOMETER_URL || 'https://dcr-eyethink.github.io/preece-practicometer/';

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 826,
    resizable: true,
    acceptFirstMouse: true,
    title: 'Preece Practicometer',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  win.loadURL(APP_URL);
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'midi' || permission === 'midiSysex');
  });
  createWindow();
});

app.on('window-all-closed', () => { app.quit(); });

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
