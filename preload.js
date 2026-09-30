const { contextBridge, ipcRenderer } = require('electron');

// Exposes just enough for the top-bar "open other apps" buttons — absent
// entirely on the web build, where window.electronAPI is simply undefined.
contextBridge.exposeInMainWorld('electronAPI', {
  launchApp: (appName) => ipcRenderer.invoke('launch-app', appName),
  saveCredentials: (email, password) => ipcRenderer.invoke('save-credentials', email, password),
  loadCredentials: () => ipcRenderer.invoke('load-credentials'),
  clearCredentials: () => ipcRenderer.invoke('clear-credentials')
});
