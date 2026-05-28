const { contextBridge, ipcRenderer } = require('electron')

const pendingOpenFileRequests = []
const openFileRequestListeners = new Set()
const aiEditorRequestListeners = new Set()
const windowCloseApprovedListeners = new Set()
const settingsChangedListeners = new Set()
const settingsBootstrap = ipcRenderer.sendSync('mdv:settings-bootstrap')

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

ipcRenderer.on('mdv:settings-changed', (_event, settings) => {
  for (const listener of settingsChangedListeners) {
    listener(settings)
  }
})

ipcRenderer.on('mdv:window-close-approved', () => {
  for (const listener of windowCloseApprovedListeners) {
    listener()
  }
})

contextBridge.exposeInMainWorld('mdvDesktop', {
  platform: process.platform,
  openFile: () => ipcRenderer.invoke('mdv:open-file'),
  readFile: (filePath) => ipcRenderer.invoke('mdv:read-file', filePath),
  saveFile: (payload) => ipcRenderer.invoke('mdv:save-file', payload),
  confirmUnsavedChanges: (payload) => ipcRenderer.invoke('mdv:confirm-unsaved-changes', payload),
  openAiChat: () => ipcRenderer.invoke('mdv:open-ai-chat'),
  openSettingsWindow: () => ipcRenderer.invoke('mdv:open-settings-window'),
  openFetchPermissionsWindow: () => ipcRenderer.invoke('mdv:open-fetch-permissions-window'),
  getAiChatContext: () => ipcRenderer.invoke('mdv:ai-chat-get-context'),
  readAiActiveDocument: () => ipcRenderer.invoke('mdv:ai-chat-read-active-document'),
  readAiActiveSelection: () => ipcRenderer.invoke('mdv:ai-chat-read-active-selection'),
  readAiTarget: (payload) => ipcRenderer.invoke('mdv:ai-chat-read-target', payload),
  grepAiSlice: (payload) => ipcRenderer.invoke('mdv:ai-chat-grep-slice', payload),
  statsAiSlice: (payload) => ipcRenderer.invoke('mdv:ai-chat-stats-slice', payload),
  semanticSearchAiSlice: (payload) => ipcRenderer.invoke('mdv:ai-chat-semantic-search', payload),
  writeAiActiveDocument: (payload) => ipcRenderer.invoke('mdv:ai-chat-write-active-document', payload),
  writeAiActiveSelection: (payload) => ipcRenderer.invoke('mdv:ai-chat-write-active-selection', payload),
  writeAiTarget: (payload) => ipcRenderer.invoke('mdv:ai-chat-write-target', payload),
  listAiBuffers: () => ipcRenderer.invoke('mdv:ai-chat-list-buffers'),
  sendAiChatMessage: (payload) => ipcRenderer.invoke('mdv:ai-chat-send-message', payload),
  settings: {
    getBootstrapSettings: () => settingsBootstrap,
    getSettings: () => ipcRenderer.invoke('mdv:settings-get'),
    migrateLegacyTheme: (themeMode) => ipcRenderer.invoke('mdv:settings-migrate-legacy-theme', themeMode),
    updateSettings: (patch) => ipcRenderer.invoke('mdv:settings-update', patch),
    saveOpenAiApiKey: (apiKey) => ipcRenderer.invoke('mdv:settings-save-openai-api-key', apiKey),
    clearOpenAiApiKey: () => ipcRenderer.invoke('mdv:settings-clear-openai-api-key'),
    saveTavilyApiKey: (apiKey) => ipcRenderer.invoke('mdv:settings-save-tavily-api-key', apiKey),
    clearTavilyApiKey: () => ipcRenderer.invoke('mdv:settings-clear-tavily-api-key'),
    getProviderStatus: () => ipcRenderer.invoke('mdv:settings-provider-status'),
    onSettingsChanged: (callback) => {
      settingsChangedListeners.add(callback)

      return () => {
        settingsChangedListeners.delete(callback)
      }
    },
  },
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
  onWindowCloseApproved: (callback) => {
    windowCloseApprovedListeners.add(callback)

    return () => {
      windowCloseApprovedListeners.delete(callback)
    }
  },
  sendAiEditorResponse: (payload) => ipcRenderer.send('mdv:ai-editor-response', payload),
  log: (level, scope, message) => ipcRenderer.send('mdv:log', { level, scope, message }),
  getLogPath: () => ipcRenderer.invoke('mdv:get-log-path'),
})