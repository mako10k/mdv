const { contextBridge, ipcRenderer } = require('electron')

const pendingOpenFileRequests = []
const openFileRequestListeners = new Set()
const aiEditorRequestListeners = new Set()
const aiChatStreamListeners = new Set()
const windowCloseApprovedListeners = new Set()
const currentFileChangedListeners = new Set()
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

ipcRenderer.on('mdv:ai-chat-stream-event', (_event, payload) => {
  for (const listener of aiChatStreamListeners) {
    listener(payload)
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

ipcRenderer.on('mdv:current-file-changed', (_event, payload) => {
  for (const listener of currentFileChangedListeners) {
    listener(payload)
  }
})

contextBridge.exposeInMainWorld('mdvDesktop', {
  platform: process.platform,
  e2e: {
    recoveryPromptMode: process.env.MDV_E2E_AUTO_ACCEPT_RECOVERY === '1'
      ? 'accept'
      : process.env.MDV_E2E_AUTO_DECLINE_RECOVERY === '1'
        ? 'decline'
        : 'interactive',
  },
  openFile: () => ipcRenderer.invoke('mdv:open-file'),
  readFile: (filePath) => ipcRenderer.invoke('mdv:read-file', filePath),
  getMdastCapabilities: () => ipcRenderer.invoke('mdv:mdast-get-capabilities'),
  extractMdastHeadingOutline: (markdown) => ipcRenderer.invoke('mdv:mdast-extract-heading-outline', markdown),
  readRelativeAssetAsDataUrl: (payload) => ipcRenderer.invoke('mdv:read-relative-asset-data-url', payload),
  ensureDraftWorkspace: (payload) => ipcRenderer.invoke('mdv:ensure-draft-workspace', payload),
  importImageAsset: (payload) => ipcRenderer.invoke('mdv:import-image-asset', payload),
  cleanupImportedAssets: (payload) => ipcRenderer.invoke('mdv:cleanup-imported-assets', payload),
  cleanupDraftWorkspace: (payload) => ipcRenderer.invoke('mdv:cleanup-draft-workspace', payload),
  saveFile: (payload) => ipcRenderer.invoke('mdv:save-file', payload),
  exportHtml: (payload) => ipcRenderer.invoke('mdv:export-html', payload),
  trackCurrentFile: (filePath) => ipcRenderer.invoke('mdv:track-current-file', filePath),
  autosaveRecoveryUpsert: (payload) => ipcRenderer.invoke('mdv:autosave-recovery-upsert', payload),
  clearAutosaveRecovery: (payload) => ipcRenderer.invoke('mdv:autosave-recovery-clear', payload),
  getLatestAutosaveRecovery: () => ipcRenderer.invoke('mdv:autosave-recovery-latest'),
  getAutosaveRecoveryForFile: (filePath) => ipcRenderer.invoke('mdv:autosave-recovery-for-file', filePath),
  notifyInitialLaunchOpenHandled: () => ipcRenderer.send('mdv:initial-launch-open-handled'),
  confirmUnsavedChanges: (payload) => ipcRenderer.invoke('mdv:confirm-unsaved-changes', payload),
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
  debug: {
    notify: (type, payload) => ipcRenderer.send('mdv:debug-channel-notify', { type, payload }),
  },
  onAiChatStreamEvent: (callback) => {
    aiChatStreamListeners.add(callback)

    return () => {
      aiChatStreamListeners.delete(callback)
    }
  },
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
  onCurrentFileChanged: (callback) => {
    currentFileChangedListeners.add(callback)

    return () => {
      currentFileChangedListeners.delete(callback)
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