const { contextBridge, ipcRenderer } = require('electron')

const pendingOpenFileRequests = []
const openFileRequestListeners = new Set()

ipcRenderer.on('mdv:open-file-requested', (_event, filePath) => {
  if (openFileRequestListeners.size === 0) {
    pendingOpenFileRequests.push(filePath)
    return
  }

  for (const listener of openFileRequestListeners) {
    listener(filePath)
  }
})

contextBridge.exposeInMainWorld('mdvDesktop', {
  platform: process.platform,
  openFile: () => ipcRenderer.invoke('mdv:open-file'),
  readFile: (filePath) => ipcRenderer.invoke('mdv:read-file', filePath),
  saveFile: (payload) => ipcRenderer.invoke('mdv:save-file', payload),
  openAiChat: () => ipcRenderer.invoke('mdv:open-ai-chat'),
  openExternalLink: (href) => ipcRenderer.invoke('mdv:open-external-link', href),
  onServerCommand: (callback) => {
    const wrappedListener = (_event, command) => {
      callback(command)
    }

    ipcRenderer.on('mdv:server-command', wrappedListener)

    return () => {
      ipcRenderer.removeListener('mdv:server-command', wrappedListener)
    }
  },
  sendServerCommandResult: (payload) => ipcRenderer.send('mdv:server-command-result', payload),
  onOpenFileRequested: (callback) => {
    const wrappedListener = (filePath) => {
      callback(filePath)
    }

    openFileRequestListeners.add(wrappedListener)

    while (pendingOpenFileRequests.length > 0) {
      wrappedListener(pendingOpenFileRequests.shift())
    }

    return () => {
      openFileRequestListeners.delete(wrappedListener)
    }
  },
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