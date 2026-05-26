const { contextBridge, ipcRenderer } = require('electron')

const pendingOpenFileRequests = []
const openFileRequestListeners = new Set()
const aiEditorRequestListeners = new Set()

ipcRenderer.on('mdv:open-file-requested', (_event, filePath) => {
  if (openFileRequestListeners.size === 0) {
    pendingOpenFileRequests.push(filePath)
    return
  }

  for (const listener of openFileRequestListeners) {
    listener(filePath)
  }
})

ipcRenderer.on('mdv:ai-editor-request', (_event, request) => {
  for (const listener of aiEditorRequestListeners) {
    listener(request)
  }
})

contextBridge.exposeInMainWorld('mdvDesktop', {
  platform: process.platform,
  openFile: () => ipcRenderer.invoke('mdv:open-file'),
  readFile: (filePath) => ipcRenderer.invoke('mdv:read-file', filePath),
  saveFile: (payload) => ipcRenderer.invoke('mdv:save-file', payload),
  openAiChat: () => ipcRenderer.invoke('mdv:open-ai-chat'),
  getAiChatContext: () => ipcRenderer.invoke('mdv:ai-chat-get-context'),
  readAiActiveDocument: () => ipcRenderer.invoke('mdv:ai-chat-read-active-document'),
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
  onAiEditorRequest: (callback) => {
    aiEditorRequestListeners.add(callback)

    return () => {
      aiEditorRequestListeners.delete(callback)
    }
  },
  sendAiEditorResponse: (payload) => ipcRenderer.send('mdv:ai-editor-response', payload),
  log: (level, scope, message) => ipcRenderer.send('mdv:log', { level, scope, message }),
  getLogPath: () => ipcRenderer.invoke('mdv:get-log-path'),
})