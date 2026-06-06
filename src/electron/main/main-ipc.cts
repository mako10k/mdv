// @ts-nocheck
function registerMainIpcHandlers(context) {
  const {
    ipcMain,
    BrowserWindow,
    app,
    randomUUID,
    writeLog,
    getMainI18n,
    showOpenDialog,
    findEditorWindowByTrackedFilePath,
    focusWindow,
    readUtf8File,
    emitDebugChannelEvent,
    upsertAutosaveRecovery,
    clearAutosaveRecovery,
    getLatestAutosaveRecovery,
    getAutosaveRecoveryForFile,
    getMdastCapabilities,
    extractHeadingOutline,
    trackCurrentFileForWindow,
    readRelativeAssetAsDataUrl,
    hiddenLaunchRevealTimerByWindowId,
    saveHtmlExportToPath,
    openSettingsWindow,
    openFetchPermissionsWindow,
    openAboutWindow,
    launchStateByWindowId,
    getSettingsState,
    hasPersistedSettings,
    hasReadableSettings,
    getUpdaterStateSnapshot,
    checkForAppUpdates,
    downloadAvailableUpdate,
    installDownloadedUpdate,
    sanitizeSettings,
    mergePlainObjects,
    isPlainObject,
    persistSettings,
    broadcastSettingsChanged,
    normalizeSecret,
    getSecretsState,
    setSecretsState,
    sanitizeSecrets,
    persistSecrets,
    getProviderStatus,
    getAppMetadata,
    getEditorWindowForAiAction,
    requestEditorContext,
    ensureEditorRuntimeState,
    readAiTargetForWindow,
    exactSearchForWindow,
    statsAiSliceForWindow,
    semanticSearchForWindow,
    writeAiTargetForWindow,
    listAiBuffersForWindow,
    requestOpenAiChatResponse,
    emitAiChatStreamEvent,
    openExternalLink,
    ensureDraftWorkspace,
    importImageAsset,
    cleanupImportedAssetFiles,
    cleanupDraftWorkspace,
    saveContentToPath,
    showUnsavedChangesDialog,
    pendingAiEditorRequests,
    isManagedClient,
    pendingServerRequests,
    managedClientId,
    postServerJson,
    logFilePath,
    setSettingsState,
  } = context

  ipcMain.handle('mdv:open-file', async () => {
    const window = BrowserWindow.getFocusedWindow()
    const messages = getMainI18n()
    const result = await showOpenDialog(window, {
      properties: ['openFile'],
      filters: [
        { name: messages.fileDialog.markdownFilter, extensions: ['md', 'markdown', 'txt'] },
        { name: messages.fileDialog.allFilesFilter, extensions: ['*'] },
      ],
    })

    if (result.canceled || result.filePaths.length === 0) {
      writeLog('INFO', 'ipc', 'open-file cancelled')
      return null
    }

    const existingWindow = findEditorWindowByTrackedFilePath(result.filePaths[0])

    if (existingWindow) {
      writeLog('INFO', 'ipc', 'open-file focused existing editor', {
        filePath: result.filePaths[0],
        windowId: existingWindow.id,
      })
      focusWindow(existingWindow)
      return null
    }

    writeLog('INFO', 'ipc', 'open-file selected', result.filePaths[0])
    return readUtf8File(result.filePaths[0])
  })

  ipcMain.handle('mdv:read-file', async (_event, filePath) => {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      writeLog('WARN', 'ipc', 'read-file received invalid path', filePath)
      return null
    }

    writeLog('INFO', 'ipc', 'read-file', filePath)
    return readUtf8File(filePath)
  })

  ipcMain.on('mdv:debug-channel-notify', (event, payload) => {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender)
    const eventType = typeof payload?.type === 'string' && payload.type.trim().length > 0
      ? payload.type.trim()
      : 'renderer:message'

    emitDebugChannelEvent(`renderer:${eventType}`, {
      windowId: sourceWindow?.id ?? null,
      webContentsId: event.sender.id,
      payload: payload?.payload ?? null,
    })
  })

  ipcMain.handle('mdv:autosave-recovery-upsert', async (_event, payload) => {
    const snapshot = payload?.snapshot

    if (!snapshot || typeof snapshot !== 'object') {
      writeLog('WARN', 'ipc', 'autosave-recovery-upsert received invalid payload')
      return null
    }

    writeLog('INFO', 'ipc', 'autosave-recovery-upsert', {
      currentFilePath: snapshot.currentFilePath || null,
      displayTitle: snapshot.displayTitle || null,
    })
    return upsertAutosaveRecovery(snapshot)
  })

  ipcMain.handle('mdv:autosave-recovery-clear', async (_event, payload) => {
    clearAutosaveRecovery(payload)
  })

  ipcMain.handle('mdv:autosave-recovery-latest', async () => getLatestAutosaveRecovery())
  ipcMain.handle('mdv:autosave-recovery-for-file', async (_event, filePath) => getAutosaveRecoveryForFile(filePath))

  ipcMain.handle('mdv:mdast-get-capabilities', async () => {
    writeLog('INFO', 'ipc', 'mdast-get-capabilities')
    return getMdastCapabilities()
  })

  ipcMain.handle('mdv:mdast-extract-heading-outline', async (_event, markdown) => {
    if (typeof markdown !== 'string') {
      writeLog('WARN', 'ipc', 'mdast-extract-heading-outline received invalid markdown payload')
      return []
    }

    writeLog('INFO', 'ipc', 'mdast-extract-heading-outline', { length: markdown.length })
    return extractHeadingOutline(markdown)
  })

  ipcMain.handle('mdv:track-current-file', async (event, filePath) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || window.isDestroyed()) {
      return
    }
    trackCurrentFileForWindow(window, typeof filePath === 'string' ? filePath : null)
  })

  ipcMain.handle('mdv:read-relative-asset-data-url', async (_event, payload) => {
    const baseFilePath = typeof payload?.baseFilePath === 'string' ? payload.baseFilePath : ''
    const source = typeof payload?.source === 'string' ? payload.source : ''

    if (!baseFilePath || !source) {
      writeLog('WARN', 'ipc', 'read-relative-asset-data-url received invalid payload', payload)
      return null
    }

    writeLog('INFO', 'ipc', 'read-relative-asset-data-url', { baseFilePath, source })
    return readRelativeAssetAsDataUrl(baseFilePath, source)
  })

  ipcMain.on('mdv:initial-launch-open-handled', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)

    if (!window || window.isDestroyed() || window.isVisible()) {
      return
    }

    const revealTimer = hiddenLaunchRevealTimerByWindowId.get(window.id)
    if (revealTimer) {
      clearTimeout(revealTimer)
      hiddenLaunchRevealTimerByWindowId.delete(window.id)
    }

    window.show()
    focusWindow(window)
  })

  ipcMain.handle('mdv:export-html', async (event, payload) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    return saveHtmlExportToPath(window ?? undefined, payload)
  })

  ipcMain.handle('mdv:open-settings-window', async (event) => openSettingsWindow(BrowserWindow.fromWebContents(event.sender)))
  ipcMain.handle('mdv:open-fetch-permissions-window', async (event) => openFetchPermissionsWindow(BrowserWindow.fromWebContents(event.sender)))
  ipcMain.handle('mdv:open-about-window', async (event) => openAboutWindow(BrowserWindow.fromWebContents(event.sender)))

  ipcMain.on('mdv:settings-bootstrap', (event) => {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender)
    const launchState = sourceWindow ? launchStateByWindowId.get(sourceWindow.id) : null

    event.returnValue = {
      settings: getSettingsState(),
      hasPersistedSettings,
      hasReadableSettings,
      hasInitialLaunchRequest: Boolean(launchState?.filePath),
      initialPanel: launchState?.initialPanel === 'write' ? 'write' : 'preview',
    }
  })

  ipcMain.handle('mdv:settings-get', async () => getSettingsState())
  ipcMain.handle('mdv:updater-get-state', async () => getUpdaterStateSnapshot())
  ipcMain.handle('mdv:updater-check', async () => checkForAppUpdates({ silent: false }))
  ipcMain.handle('mdv:updater-download', async () => downloadAvailableUpdate())
  ipcMain.handle('mdv:updater-install', async () => ({ started: installDownloadedUpdate() }))

  ipcMain.handle('mdv:settings-migrate-legacy-theme', async (_event, themeMode) => {
    const settingsState = getSettingsState()
    if (hasPersistedSettings || settingsState.general.themeMode !== 'system') {
      return settingsState
    }
    if (themeMode !== 'light' && themeMode !== 'dark') {
      return settingsState
    }

    const nextSettingsState = sanitizeSettings(mergePlainObjects(settingsState, {
      general: { themeMode },
    }))
    setSettingsState(nextSettingsState)
    await persistSettings()
    broadcastSettingsChanged()
    return nextSettingsState
  })

  ipcMain.handle('mdv:settings-update', async (_event, patch) => {
    const nextSettingsState = sanitizeSettings(mergePlainObjects(getSettingsState(), isPlainObject(patch) ? patch : {}))
    setSettingsState(nextSettingsState)
    await persistSettings()
    broadcastSettingsChanged()
    return nextSettingsState
  })

  ipcMain.handle('mdv:settings-save-openai-api-key', async (_event, apiKey) => {
    const normalizedApiKey = normalizeSecret(apiKey)
    if (!normalizedApiKey) {
      throw new Error('OpenAI API key cannot be empty')
    }

    setSecretsState(sanitizeSecrets({
      ...getSecretsState(),
      openaiApiKey: normalizedApiKey,
    }))
    await persistSecrets()
    broadcastSettingsChanged()
    return getProviderStatus()
  })

  ipcMain.handle('mdv:settings-clear-openai-api-key', async () => {
    setSecretsState(sanitizeSecrets({
      ...getSecretsState(),
      openaiApiKey: null,
    }))
    await persistSecrets()
    broadcastSettingsChanged()
    return getProviderStatus()
  })

  ipcMain.handle('mdv:settings-save-tavily-api-key', async (_event, apiKey) => {
    const normalizedApiKey = normalizeSecret(apiKey)
    if (!normalizedApiKey) {
      throw new Error('Tavily API key cannot be empty')
    }

    setSecretsState(sanitizeSecrets({
      ...getSecretsState(),
      tavilyApiKey: normalizedApiKey,
    }))
    await persistSecrets()
    broadcastSettingsChanged()
    return getProviderStatus()
  })

  ipcMain.handle('mdv:settings-clear-tavily-api-key', async () => {
    setSecretsState(sanitizeSecrets({
      ...getSecretsState(),
      tavilyApiKey: null,
    }))
    await persistSecrets()
    broadcastSettingsChanged()
    return getProviderStatus()
  })

  ipcMain.handle('mdv:settings-provider-status', async () => getProviderStatus())
  ipcMain.handle('mdv:get-app-metadata', async () => getAppMetadata())

  ipcMain.handle('mdv:ai-chat-get-context', async (event) => {
    const editorWindow = getEditorWindowForAiAction(BrowserWindow.fromWebContents(event.sender))
    return requestEditorContext(editorWindow)
  })

  ipcMain.handle('mdv:ai-chat-read-active-document', async (event) => {
    const editorWindow = getEditorWindowForAiAction(BrowserWindow.fromWebContents(event.sender))
    const runtimeState = ensureEditorRuntimeState(editorWindow)
    return readAiTargetForWindow(editorWindow, {
      target: { editorId: runtimeState.editorId, span: { kind: 'document' } },
      cursor: null,
    })
  })

  ipcMain.handle('mdv:ai-chat-read-active-selection', async (event) => {
    const editorWindow = getEditorWindowForAiAction(BrowserWindow.fromWebContents(event.sender))
    const runtimeState = ensureEditorRuntimeState(editorWindow)
    return readAiTargetForWindow(editorWindow, {
      target: { editorId: runtimeState.editorId, span: { kind: 'selection' } },
      cursor: null,
    })
  })

  ipcMain.handle('mdv:ai-chat-read-target', async (event, payload) => readAiTargetForWindow(getEditorWindowForAiAction(BrowserWindow.fromWebContents(event.sender)), payload))
  ipcMain.handle('mdv:ai-chat-grep-slice', async (event, payload) => exactSearchForWindow(getEditorWindowForAiAction(BrowserWindow.fromWebContents(event.sender)), payload))
  ipcMain.handle('mdv:ai-chat-stats-slice', async (event, payload) => statsAiSliceForWindow(getEditorWindowForAiAction(BrowserWindow.fromWebContents(event.sender)), payload))
  ipcMain.handle('mdv:ai-chat-semantic-search', async (event, payload) => semanticSearchForWindow(getEditorWindowForAiAction(BrowserWindow.fromWebContents(event.sender)), payload))

  ipcMain.handle('mdv:ai-chat-write-active-document', async (event, payload) => {
    const editorWindow = getEditorWindowForAiAction(BrowserWindow.fromWebContents(event.sender))
    const runtimeState = ensureEditorRuntimeState(editorWindow)
    return writeAiTargetForWindow(editorWindow, {
      destination: { editorId: runtimeState.editorId, span: { kind: 'document' } },
      sources: [{ type: 'literal', text: typeof payload?.content === 'string' ? payload.content : '' }],
      mode: 'replace',
    })
  })

  ipcMain.handle('mdv:ai-chat-write-active-selection', async (event, payload) => {
    const editorWindow = getEditorWindowForAiAction(BrowserWindow.fromWebContents(event.sender))
    const runtimeState = ensureEditorRuntimeState(editorWindow)
    return writeAiTargetForWindow(editorWindow, {
      destination: { editorId: runtimeState.editorId, span: { kind: 'selection' } },
      sources: [{ type: 'literal', text: typeof payload?.content === 'string' ? payload.content : '' }],
      mode: 'replace',
    })
  })

  ipcMain.handle('mdv:ai-chat-write-target', async (event, payload) => writeAiTargetForWindow(getEditorWindowForAiAction(BrowserWindow.fromWebContents(event.sender)), payload))
  ipcMain.handle('mdv:ai-chat-list-buffers', async (event) => listAiBuffersForWindow(getEditorWindowForAiAction(BrowserWindow.fromWebContents(event.sender))))

  ipcMain.handle('mdv:ai-chat-send-message', async (_event, payload) => {
    const sourceWindow = BrowserWindow.fromWebContents(_event.sender)
    const editorWindow = getEditorWindowForAiAction(sourceWindow)
    const settingsState = getSettingsState()
    const requestId = typeof payload?.requestId === 'string' && payload.requestId.trim().length > 0
      ? payload.requestId.trim()
      : randomUUID()

    writeLog('INFO', 'ai-chat', 'OpenAI chat request start', {
      requestId,
      messageCount: Array.isArray(payload?.messages) ? payload.messages.length : 0,
      model: settingsState.ai.openai.model,
    })

    void (async () => {
      try {
        const result = await requestOpenAiChatResponse(editorWindow, payload?.messages, (event) => {
          emitAiChatStreamEvent(sourceWindow, { requestId, ...event })
        })

        writeLog('INFO', 'ai-chat', 'OpenAI chat request completed', {
          requestId,
          responseId: result.responseId,
          model: result.model,
        })

        emitAiChatStreamEvent(sourceWindow, {
          requestId,
          type: 'completed',
          reply: result.reply,
          model: result.model,
          responseId: result.responseId,
        })
      } catch (error) {
        writeLog('ERROR', 'ai-chat', 'OpenAI chat request failed', {
          requestId,
          model: settingsState.ai.openai.model,
          error: error instanceof Error ? error.message : String(error),
        })

        emitAiChatStreamEvent(sourceWindow, {
          requestId,
          type: 'failed',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })()

    return { status: 'started', requestId }
  })

  ipcMain.handle('mdv:open-external-link', async (event, href) => {
    if (typeof href !== 'string' || href.length === 0) {
      writeLog('WARN', 'ipc', 'open-external-link received invalid URL', href)
      return { status: 'blocked' }
    }
    return openExternalLink(BrowserWindow.fromWebContents(event.sender), href)
  })

  ipcMain.handle('mdv:ensure-draft-workspace', async (_event, payload) => {
    const workspace = await ensureDraftWorkspace(payload)
    writeLog('INFO', 'ipc', 'ensure-draft-workspace', { workspaceId: workspace.workspaceId, rootDir: workspace.rootDir })
    return workspace
  })

  ipcMain.handle('mdv:import-image-asset', async (_event, payload) => {
    const result = await importImageAsset(payload)
    if (result) {
      writeLog('INFO', 'ipc', 'import-image-asset', {
        filePath: result.filePath,
        relativePath: result.relativePath,
        markdownFilePath: result.markdownFilePath,
      })
    } else {
      writeLog('WARN', 'ipc', 'import-image-asset returned null')
    }
    return result
  })

  ipcMain.handle('mdv:cleanup-imported-assets', async (_event, payload) => {
    await cleanupImportedAssetFiles(payload?.filePaths)
  })
  ipcMain.handle('mdv:cleanup-draft-workspace', async (_event, payload) => {
    await cleanupDraftWorkspace(payload)
  })
  ipcMain.handle('mdv:save-file', async (_event, payload) => saveContentToPath(BrowserWindow.getFocusedWindow() ?? undefined, payload))
  ipcMain.handle('mdv:confirm-unsaved-changes', async (event, payload) => showUnsavedChangesDialog(BrowserWindow.fromWebContents(event.sender) ?? undefined, payload))

  ipcMain.on('mdv:log', (_event, payload) => {
    const level = typeof payload?.level === 'string' ? payload.level : 'INFO'
    const scope = typeof payload?.scope === 'string' ? payload.scope : 'renderer'
    writeLog(level.toUpperCase(), scope, payload?.message ?? '')
  })

  ipcMain.on('mdv:ai-editor-response', (_event, payload) => {
    const pendingRequest = pendingAiEditorRequests.get(payload?.requestId)
    if (!pendingRequest) {
      return
    }

    clearTimeout(pendingRequest.timeout)
    pendingAiEditorRequests.delete(payload.requestId)

    if (payload?.ok === false) {
      pendingRequest.reject(new Error(payload?.error || 'AI editor request failed'))
      return
    }

    pendingRequest.resolve(payload?.payload ?? null)
  })

  ipcMain.on('mdv:server-command-result', (_event, payload) => {
    if (!isManagedClient() || !payload?.requestId) {
      return
    }

    const pendingRequest = pendingServerRequests.get(payload.requestId)
    if (pendingRequest?.type === 'suspend') {
      pendingServerRequests.delete(payload.requestId)
    }

    void postServerJson(`/api/clients/${encodeURIComponent(managedClientId)}/state`, {
      snapshot: payload.snapshot || null,
      filePath: payload.snapshot?.currentFilePath || null,
      status: payload.type === 'suspend' ? 'suspended' : 'running',
    })

    void postServerJson(`/api/clients/${encodeURIComponent(managedClientId)}/command-result`, payload)

    if (payload.type === 'suspend' && payload.status === 'completed') {
      setTimeout(() => {
        app.quit()
      }, 100)
    }
  })

  ipcMain.handle('mdv:get-log-path', () => logFilePath)
}

export {
  registerMainIpcHandlers,
}
