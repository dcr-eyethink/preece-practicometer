const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listSets: () => ipcRenderer.invoke('list-sets'),
  openSet: (filePath) => ipcRenderer.invoke('open-set', filePath),
  readCSV: (filePath) => ipcRenderer.invoke('read-csv', filePath),
  saveCSV: (filePath, data) => ipcRenderer.invoke('save-csv', filePath, data),
  duplicateCSV: (originalPath, data) => ipcRenderer.invoke('duplicate-csv', originalPath, data),
  resizeWindow: (w, h) => ipcRenderer.invoke('resize-window', w, h),
  onLoadFile: (cb) => ipcRenderer.on('load-file', (e, filePath) => cb(filePath))
});
