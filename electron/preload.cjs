const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mdvDesktop', {
  platform: process.platform,
  openFile: () => ipcRenderer.invoke('mdv:open-file'),
  readFile: (filePath) => ipcRenderer.invoke('mdv:read-file', filePath),
  saveFile: (payload) => ipcRenderer.invoke('mdv:save-file', payload),
  log: (level, scope, message) => ipcRenderer.send('mdv:log', { level, scope, message }),
  getLogPath: () => ipcRenderer.invoke('mdv:get-log-path'),
})