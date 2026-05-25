const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mdvDesktop', {
  platform: process.platform,
  openFile: () => ipcRenderer.invoke('mdv:open-file'),
  readFile: (filePath) => ipcRenderer.invoke('mdv:read-file', filePath),
  saveFile: (payload) => ipcRenderer.invoke('mdv:save-file', payload),
  openExternalLink: (href) => ipcRenderer.invoke('mdv:open-external-link', href),
  onMenuAction: (callback) => {
    const wrappedListener = (_event, action) => {
      callback(action)
    }

    ipcRenderer.on('mdv:menu-action', wrappedListener)

    return () => {
      ipcRenderer.removeListener('mdv:menu-action', wrappedListener)
    }
  },
  log: (level, scope, message) => ipcRenderer.send('mdv:log', { level, scope, message }),
  getLogPath: () => ipcRenderer.invoke('mdv:get-log-path'),
})