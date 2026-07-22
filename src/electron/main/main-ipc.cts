const { abbreviateInlineDataImageMarkdownInText } = require('./inline-data-url-display.cjs')

type WebContentsLike = {
  id: number
}

type BrowserWindowLike = {
  id: number
  isDestroyed: () => boolean
  isVisible: () => boolean
  show: () => void
}

type BrowserWindowStatic = {
  getFocusedWindow: () => BrowserWindowLike | null
  fromWebContents: (sender: WebContentsLike) => BrowserWindowLike | null
}

type IpcEventLike = {
  sender: WebContentsLike
  returnValue?: unknown
}

type IpcMainLike = {
  handle: (channel: string, handler: (...args: unknown[]) => unknown) => void
  on: (channel: string, handler: (...args: unknown[]) => void) => void
}

type MainI18n = {
  fileDialog: {
    markdownFilter: string
    allFilesFilter: string
  }
}

function formatAiReadPayloadForExternalDisplay(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || typeof (payload as { text?: unknown }).text !== 'string') {
    return payload
  }

  return {
    ...(payload as Record<string, unknown>),
    text: abbreviateInlineDataImageMarkdownInText((payload as { text: string }).text),
  }
}

function formatAiExactSearchPayloadForExternalDisplay(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { matches?: unknown[] }).matches)) {
    return payload
  }

  return {
    ...(payload as Record<string, unknown>),
    matches: (payload as { matches: unknown[] }).matches.map((match) => {
      if (!match || typeof match !== 'object' || typeof (match as { preview?: unknown }).preview !== 'string') {
        return match
      }

      return {
        ...(match as Record<string, unknown>),
        preview: abbreviateInlineDataImageMarkdownInText((match as { preview: string }).preview),
      }
    }),
  }
}

type SettingsState = {
  general: {
    themeMode: string
  }
  editor: {
    fontSizePx: number
  }
  ai: {
    chatFontSizePx: number
    openai: {
      model: string
    }
  }
}

type TypographyAdjustmentResult = {
  changed: boolean
  target: 'editor' | 'chat'
  valuePx: number
  settings: SettingsState
}

type SettingsMutationPlan<Value> = {
  nextState: SettingsState
  changed: boolean
  value: Value
}

type SettingsMutationOutcome<Value> = {
  settings: SettingsState
  changed: boolean
  value: Value
}

type SecretsState = {
  openaiApiKey: string | null
  tavilyApiKey: string | null
}

type ProviderStatus = {
  openaiConfigured: boolean
  tavilyConfigured: boolean
}

type PlainObject = Record<string, unknown>

type LaunchState = {
  filePath?: string | null
  initialPanel?: string | null
}

type EditorRuntimeState = {
  editorId: string
}

type AiChatStreamEvent = Record<string, unknown>
type AiChatResponse = {
  status: 'completed' | 'proposal-pending'
  reply: unknown
  model: string
  responseId: string | null
  proposal?: Record<string, unknown>
}

type DraftWorkspace = {
  workspaceId: string
  rootDir: string
}

type ImportedImageAsset = {
  filePath: string
  relativePath: string
  markdownFilePath: string | null
} | null

type SaveResult = unknown

type PendingAiEditorRequest = {
  timeout: ReturnType<typeof setTimeout>
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

type PendingServerRequest = {
  type?: string
}

type LogFn = (level: string, scope: string, ...parts: unknown[]) => void

type MainIpcContext = {
  ipcMain: IpcMainLike
  BrowserWindow: BrowserWindowStatic
  app: {
    quit: () => void
  }
  randomUUID: () => string
  writeLog: LogFn
  getMainI18n: () => MainI18n
  showOpenDialog: (window: BrowserWindowLike | null, options: Record<string, unknown>) => Promise<{
    canceled: boolean
    filePaths: string[]
  }>
  findEditorWindowByTrackedFilePath: (filePath: string) => BrowserWindowLike | null
  focusWindow: (window: BrowserWindowLike) => void
  createWindow: () => Promise<BrowserWindowLike>
  readUtf8File: (filePath: string) => Promise<unknown>
  emitDebugChannelEvent: (type: string, payload?: unknown) => void
  upsertAutosaveRecovery: (snapshot: object) => Promise<unknown> | unknown
  clearAutosaveRecovery: (payload: unknown) => Promise<void> | void
  getLatestAutosaveRecovery: () => Promise<unknown> | unknown
  getAutosaveRecoveryForFile: (filePath: unknown) => Promise<unknown> | unknown
  getMdastCapabilities: () => Promise<unknown> | unknown
  extractHeadingOutline: (markdown: string) => Promise<unknown> | unknown
  trackCurrentFileForWindow: (window: BrowserWindowLike, filePath: string | null) => void
  readRelativeAssetAsDataUrl: (baseFilePath: string, source: string) => Promise<unknown>
  hiddenLaunchRevealTimerByWindowId: Map<number, ReturnType<typeof setTimeout>>
  saveHtmlExportToPath: (window: BrowserWindowLike | undefined, payload: unknown) => Promise<unknown>
  openSettingsWindow: (window: BrowserWindowLike | null) => Promise<unknown> | unknown
  openFetchPermissionsWindow: (window: BrowserWindowLike | null) => Promise<unknown> | unknown
  openAboutWindow: (window: BrowserWindowLike | null) => Promise<unknown> | unknown
  launchStateByWindowId: Map<number, LaunchState>
  getSettingsState: () => SettingsState
  getHasPersistedSettings: () => boolean
  getHasReadableSettings: () => boolean
  getUpdaterStateSnapshot: () => Promise<unknown> | unknown
  checkForAppUpdates: (options: { silent: boolean }) => Promise<unknown>
  downloadAvailableUpdate: () => Promise<unknown>
  installDownloadedUpdate: () => boolean
  assertValidSettingsUpdate: (patch: unknown) => void
  adjustTypographySettings: (settingsState: SettingsState, adjustment: unknown) => TypographyAdjustmentResult
  sanitizeSettings: (candidate: Record<string, unknown>) => SettingsState
  mergePlainObjects: <T>(base: T, patch: unknown) => T
  isPlainObject: (value: unknown) => value is PlainObject
  enqueueSettingsMutation: <Value>(
    mutate: (currentState: SettingsState) => SettingsMutationPlan<Value>,
  ) => Promise<SettingsMutationOutcome<Value>>
  broadcastSettingsChanged: () => void
  normalizeSecret: (value: unknown) => string | null
  getSecretsState: () => SecretsState
  setSecretsState: (nextSecretsState: SecretsState) => void
  sanitizeSecrets: (candidate: Record<string, unknown>) => SecretsState
  persistSecrets: () => Promise<void>
  getProviderStatus: () => ProviderStatus
  getAppMetadata: () => Promise<unknown> | unknown
  getEditorWindowForAiAction: (window: BrowserWindowLike | null) => BrowserWindowLike | null
  requestEditorContext: (window: BrowserWindowLike | null) => Promise<unknown>
  ensureEditorRuntimeState: (window: BrowserWindowLike | null) => EditorRuntimeState
  readAiTargetForWindow: (window: BrowserWindowLike | null, payload: unknown, options?: { publicDisplay?: boolean }) => Promise<unknown>
  exactSearchForWindow: (window: BrowserWindowLike | null, payload: unknown) => Promise<unknown>
  statsAiSliceForWindow: (window: BrowserWindowLike | null, payload: unknown) => Promise<unknown>
  semanticSearchForWindow: (window: BrowserWindowLike | null, payload: unknown) => Promise<unknown>
  writeAiTargetForWindow: (window: BrowserWindowLike | null, payload: unknown) => Promise<unknown>
  listAiBuffersForWindow: (window: BrowserWindowLike | null) => Promise<unknown>
  getAiChangeProposalForWindow: (window: BrowserWindowLike, payload: unknown) => unknown
  reviseAiChangeProposalHunkForWindow: (window: BrowserWindowLike, payload: unknown) => unknown
  applyAiChangeProposalForWindow: (window: BrowserWindowLike, payload: unknown) => Promise<unknown>
  cancelAiChangeProposalForWindow: (window: BrowserWindowLike, payload: unknown) => unknown
  requestOpenAiChatResponse: (
    window: BrowserWindowLike | null,
    messages: unknown,
    onEvent: (event: AiChatStreamEvent) => void,
    requestContext: { originRequestId: string; sourceWindowId: number },
  ) => Promise<AiChatResponse>
  emitAiChatStreamEvent: (window: BrowserWindowLike | null, payload: Record<string, unknown>) => void
  openExternalLink: (window: BrowserWindowLike | null, href: string) => Promise<unknown>
  openDocumentLink: (window: BrowserWindowLike | null, href: string) => Promise<unknown>
  ensureDraftWorkspace: (payload: unknown) => Promise<DraftWorkspace>
  importImageAsset: (payload: unknown) => Promise<ImportedImageAsset>
  cleanupImportedAssetFiles: (filePaths: unknown) => Promise<void>
  cleanupDraftWorkspace: (payload: unknown) => Promise<void>
  saveContentToPath: (window: BrowserWindowLike | undefined, payload: unknown) => Promise<SaveResult>
  showUnsavedChangesDialog: (window: BrowserWindowLike | undefined, payload: unknown) => Promise<unknown>
  pendingAiEditorRequests: Map<string, PendingAiEditorRequest>
  isManagedClient: () => boolean
  pendingServerRequests: Map<string, PendingServerRequest>
  managedClientId: string
  postServerJson: (path: string, payload: unknown) => Promise<unknown>
  logFilePath: string
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function registerMainIpcHandlers(context: MainIpcContext) {
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
    createWindow,
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
    getHasPersistedSettings,
    getHasReadableSettings,
    getUpdaterStateSnapshot,
    checkForAppUpdates,
    downloadAvailableUpdate,
    installDownloadedUpdate,
    assertValidSettingsUpdate,
    adjustTypographySettings,
    sanitizeSettings,
    mergePlainObjects,
    isPlainObject,
    enqueueSettingsMutation,
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
    getAiChangeProposalForWindow,
    reviseAiChangeProposalHunkForWindow,
    applyAiChangeProposalForWindow,
    cancelAiChangeProposalForWindow,
    requestOpenAiChatResponse,
    emitAiChatStreamEvent,
    openExternalLink,
    openDocumentLink,
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

    const selectedPath = result.filePaths[0]
    const existingWindow = findEditorWindowByTrackedFilePath(selectedPath)

    if (existingWindow) {
      writeLog('INFO', 'ipc', 'open-file focused existing editor', {
        filePath: selectedPath,
        windowId: existingWindow.id,
      })
      focusWindow(existingWindow)
      return null
    }

    writeLog('INFO', 'ipc', 'open-file selected', selectedPath)
    return readUtf8File(selectedPath)
  })

  ipcMain.handle('mdv:new-document-window', async () => {
    if (isManagedClient()) {
      writeLog('INFO', 'ipc', 'new-document-window unavailable in managed-client mode')
      return { status: 'unavailable', reason: 'managed-client' }
    }

    const nextWindow = await createWindow()
    focusWindow(nextWindow)
    writeLog('INFO', 'ipc', 'new-document-window opened', { windowId: nextWindow.id })
    return { status: 'opened', windowId: nextWindow.id }
  })

  ipcMain.handle('mdv:read-file', async (_event: unknown, filePath: unknown) => {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      writeLog('WARN', 'ipc', 'read-file received invalid path', filePath)
      return null
    }

    writeLog('INFO', 'ipc', 'read-file', filePath)
    return readUtf8File(filePath)
  })

  ipcMain.on('mdv:debug-channel-notify', (event: unknown, payload: unknown) => {
    const ipcEvent = event as IpcEventLike
    const sourceWindow = BrowserWindow.fromWebContents(ipcEvent.sender)
    const payloadRecord = isObjectRecord(payload) ? payload : null
    const eventType = typeof payloadRecord?.type === 'string' && payloadRecord.type.trim().length > 0
      ? payloadRecord.type.trim()
      : 'renderer:message'

    emitDebugChannelEvent(`renderer:${eventType}`, {
      windowId: sourceWindow?.id ?? null,
      webContentsId: ipcEvent.sender.id,
      payload: payloadRecord?.payload ?? null,
    })
  })

  ipcMain.handle('mdv:autosave-recovery-upsert', async (_event: unknown, payload: unknown) => {
    const payloadRecord = isObjectRecord(payload) ? payload : null
    const snapshot = isObjectRecord(payloadRecord?.snapshot) ? payloadRecord.snapshot : null

    if (!snapshot) {
      writeLog('WARN', 'ipc', 'autosave-recovery-upsert received invalid payload')
      return null
    }

    writeLog('INFO', 'ipc', 'autosave-recovery-upsert', {
      currentFilePath: typeof snapshot.currentFilePath === 'string' ? snapshot.currentFilePath : null,
      displayTitle: typeof snapshot.displayTitle === 'string' ? snapshot.displayTitle : null,
    })
    return upsertAutosaveRecovery(snapshot)
  })

  ipcMain.handle('mdv:autosave-recovery-clear', async (_event: unknown, payload: unknown) => {
    clearAutosaveRecovery(payload)
  })

  ipcMain.handle('mdv:autosave-recovery-latest', async () => getLatestAutosaveRecovery())
  ipcMain.handle('mdv:autosave-recovery-for-file', async (_event: unknown, filePath: unknown) => getAutosaveRecoveryForFile(filePath))

  ipcMain.handle('mdv:mdast-get-capabilities', async () => {
    writeLog('INFO', 'ipc', 'mdast-get-capabilities')
    return getMdastCapabilities()
  })

  ipcMain.handle('mdv:mdast-extract-heading-outline', async (_event: unknown, markdown: unknown) => {
    if (typeof markdown !== 'string') {
      writeLog('WARN', 'ipc', 'mdast-extract-heading-outline received invalid markdown payload')
      return []
    }

    writeLog('INFO', 'ipc', 'mdast-extract-heading-outline', { length: markdown.length })
    return extractHeadingOutline(markdown)
  })

  ipcMain.handle('mdv:track-current-file', async (event: unknown, filePath: unknown) => {
    const window = BrowserWindow.fromWebContents((event as IpcEventLike).sender)
    if (!window || window.isDestroyed()) {
      return
    }
    trackCurrentFileForWindow(window, typeof filePath === 'string' ? filePath : null)
  })

  ipcMain.handle('mdv:read-relative-asset-data-url', async (_event: unknown, payload: unknown) => {
    const payloadRecord = isObjectRecord(payload) ? payload : null
    const baseFilePath = typeof payloadRecord?.baseFilePath === 'string' ? payloadRecord.baseFilePath : ''
    const source = typeof payloadRecord?.source === 'string' ? payloadRecord.source : ''

    if (!baseFilePath || !source) {
      writeLog('WARN', 'ipc', 'read-relative-asset-data-url received invalid payload', payload)
      return null
    }

    writeLog('INFO', 'ipc', 'read-relative-asset-data-url', { baseFilePath, source })
    return readRelativeAssetAsDataUrl(baseFilePath, source)
  })

  ipcMain.on('mdv:initial-launch-open-handled', (event: unknown) => {
    const window = BrowserWindow.fromWebContents((event as IpcEventLike).sender)

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

  ipcMain.handle('mdv:export-html', async (event: unknown, payload: unknown) => {
    const window = BrowserWindow.fromWebContents((event as IpcEventLike).sender)
    return saveHtmlExportToPath(window ?? undefined, payload)
  })

  ipcMain.handle('mdv:open-settings-window', async (event: unknown) => openSettingsWindow(BrowserWindow.fromWebContents((event as IpcEventLike).sender)))
  ipcMain.handle('mdv:open-fetch-permissions-window', async (event: unknown) => openFetchPermissionsWindow(BrowserWindow.fromWebContents((event as IpcEventLike).sender)))
  ipcMain.handle('mdv:open-about-window', async (event: unknown) => openAboutWindow(BrowserWindow.fromWebContents((event as IpcEventLike).sender)))

  ipcMain.on('mdv:settings-bootstrap', (event: unknown) => {
    const ipcEvent = event as IpcEventLike
    const sourceWindow = BrowserWindow.fromWebContents(ipcEvent.sender)
    const launchState = sourceWindow ? launchStateByWindowId.get(sourceWindow.id) : null

    ipcEvent.returnValue = {
      settings: getSettingsState(),
      hasPersistedSettings: getHasPersistedSettings(),
      hasReadableSettings: getHasReadableSettings(),
      hasInitialLaunchRequest: Boolean(launchState?.filePath),
      initialPanel: launchState?.initialPanel === 'write' ? 'write' : 'preview',
    }
  })

  ipcMain.handle('mdv:settings-get', async () => getSettingsState())
  ipcMain.handle('mdv:updater-get-state', async () => getUpdaterStateSnapshot())
  ipcMain.handle('mdv:updater-check', async () => checkForAppUpdates({ silent: false }))
  ipcMain.handle('mdv:updater-download', async () => downloadAvailableUpdate())
  ipcMain.handle('mdv:updater-install', async () => ({ started: installDownloadedUpdate() }))

  ipcMain.handle('mdv:settings-migrate-legacy-theme', async (_event: unknown, themeMode: unknown) => {
    const outcome = await enqueueSettingsMutation((settingsState) => {
      if (
        getHasPersistedSettings()
        || settingsState.general.themeMode !== 'system'
        || (themeMode !== 'light' && themeMode !== 'dark')
      ) {
        return { nextState: settingsState, changed: false, value: null }
      }

      return {
        nextState: sanitizeSettings(mergePlainObjects(settingsState, {
          general: { themeMode },
        })),
        changed: true,
        value: null,
      }
    })

    return outcome.settings
  })

  ipcMain.handle('mdv:settings-update', async (_event: unknown, patch: unknown) => {
    assertValidSettingsUpdate(patch)
    const outcome = await enqueueSettingsMutation((settingsState) => ({
      nextState: sanitizeSettings(mergePlainObjects(settingsState, isPlainObject(patch) ? patch : {})),
      changed: true,
      value: null,
    }))

    return outcome.settings
  })

  ipcMain.handle('mdv:settings-adjust-typography', async (_event: unknown, adjustment: unknown) => {
    const outcome = await enqueueSettingsMutation((settingsState) => {
      const result = adjustTypographySettings(settingsState, adjustment)

      return {
        nextState: result.settings,
        changed: result.changed,
        value: {
          changed: result.changed,
          target: result.target,
          valuePx: result.valuePx,
        },
      }
    })

    return {
      ...outcome.value,
      settings: outcome.settings,
    }
  })

  ipcMain.handle('mdv:settings-save-openai-api-key', async (_event: unknown, apiKey: unknown) => {
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

  ipcMain.handle('mdv:settings-save-tavily-api-key', async (_event: unknown, apiKey: unknown) => {
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

  ipcMain.handle('mdv:ai-chat-get-context', async (event: unknown) => {
    const editorWindow = getEditorWindowForAiAction(BrowserWindow.fromWebContents((event as IpcEventLike).sender))
    return requestEditorContext(editorWindow)
  })

  ipcMain.handle('mdv:ai-chat-read-active-document', async (event: unknown) => {
    const editorWindow = getEditorWindowForAiAction(BrowserWindow.fromWebContents((event as IpcEventLike).sender))
    const runtimeState = ensureEditorRuntimeState(editorWindow)
    return formatAiReadPayloadForExternalDisplay(await readAiTargetForWindow(editorWindow, {
      target: { editorId: runtimeState.editorId, span: { kind: 'document' } },
      cursor: null,
    }, { publicDisplay: true }))
  })

  ipcMain.handle('mdv:ai-chat-read-active-selection', async (event: unknown) => {
    const editorWindow = getEditorWindowForAiAction(BrowserWindow.fromWebContents((event as IpcEventLike).sender))
    const runtimeState = ensureEditorRuntimeState(editorWindow)
    return formatAiReadPayloadForExternalDisplay(await readAiTargetForWindow(editorWindow, {
      target: { editorId: runtimeState.editorId, span: { kind: 'selection' } },
      cursor: null,
    }, { publicDisplay: true }))
  })

  ipcMain.handle('mdv:ai-chat-read-target', async (event: unknown, payload: unknown) => formatAiReadPayloadForExternalDisplay(await readAiTargetForWindow(getEditorWindowForAiAction(BrowserWindow.fromWebContents((event as IpcEventLike).sender)), payload, { publicDisplay: true })))
  ipcMain.handle('mdv:ai-chat-grep-slice', async (event: unknown, payload: unknown) => formatAiExactSearchPayloadForExternalDisplay(await exactSearchForWindow(getEditorWindowForAiAction(BrowserWindow.fromWebContents((event as IpcEventLike).sender)), payload)))
  ipcMain.handle('mdv:ai-chat-stats-slice', async (event: unknown, payload: unknown) => statsAiSliceForWindow(getEditorWindowForAiAction(BrowserWindow.fromWebContents((event as IpcEventLike).sender)), payload))
  ipcMain.handle('mdv:ai-chat-semantic-search', async (event: unknown, payload: unknown) => semanticSearchForWindow(getEditorWindowForAiAction(BrowserWindow.fromWebContents((event as IpcEventLike).sender)), payload))

  ipcMain.handle('mdv:ai-chat-write-active-document', async (event: unknown, payload: unknown) => {
    const payloadRecord = isObjectRecord(payload) ? payload : null
    const editorWindow = getEditorWindowForAiAction(BrowserWindow.fromWebContents((event as IpcEventLike).sender))
    const runtimeState = ensureEditorRuntimeState(editorWindow)
    return writeAiTargetForWindow(editorWindow, {
      destination: { editorId: runtimeState.editorId, span: { kind: 'document' } },
      sources: [{ type: 'literal', text: typeof payloadRecord?.content === 'string' ? payloadRecord.content : '' }],
      mode: 'replace',
    })
  })

  ipcMain.handle('mdv:ai-chat-write-active-selection', async (event: unknown, payload: unknown) => {
    const payloadRecord = isObjectRecord(payload) ? payload : null
    const editorWindow = getEditorWindowForAiAction(BrowserWindow.fromWebContents((event as IpcEventLike).sender))
    const runtimeState = ensureEditorRuntimeState(editorWindow)
    return writeAiTargetForWindow(editorWindow, {
      destination: { editorId: runtimeState.editorId, span: { kind: 'selection' } },
      sources: [{ type: 'literal', text: typeof payloadRecord?.content === 'string' ? payloadRecord.content : '' }],
      mode: 'replace',
    })
  })

  ipcMain.handle('mdv:ai-chat-write-target', async (event: unknown, payload: unknown) => writeAiTargetForWindow(getEditorWindowForAiAction(BrowserWindow.fromWebContents((event as IpcEventLike).sender)), payload))
  ipcMain.handle('mdv:ai-chat-list-buffers', async (event: unknown) => listAiBuffersForWindow(getEditorWindowForAiAction(BrowserWindow.fromWebContents((event as IpcEventLike).sender))))
  ipcMain.handle('mdv:ai-change-proposal-get', async (event: unknown, payload: unknown) => {
    const sourceWindow = BrowserWindow.fromWebContents((event as IpcEventLike).sender)
    if (!sourceWindow) {
      throw new Error('Editor window is unavailable')
    }
    return getAiChangeProposalForWindow(sourceWindow, payload)
  })
  ipcMain.handle('mdv:ai-change-proposal-revise-hunk', async (event: unknown, payload: unknown) => {
    const sourceWindow = BrowserWindow.fromWebContents((event as IpcEventLike).sender)
    if (!sourceWindow) {
      throw new Error('Editor window is unavailable')
    }
    return reviseAiChangeProposalHunkForWindow(sourceWindow, payload)
  })
  ipcMain.handle('mdv:ai-change-proposal-apply', async (event: unknown, payload: unknown) => {
    const sourceWindow = BrowserWindow.fromWebContents((event as IpcEventLike).sender)
    if (!sourceWindow) {
      throw new Error('Editor window is unavailable')
    }
    return applyAiChangeProposalForWindow(sourceWindow, payload)
  })
  ipcMain.handle('mdv:ai-change-proposal-cancel', async (event: unknown, payload: unknown) => {
    const sourceWindow = BrowserWindow.fromWebContents((event as IpcEventLike).sender)
    if (!sourceWindow) {
      throw new Error('Editor window is unavailable')
    }
    return cancelAiChangeProposalForWindow(sourceWindow, payload)
  })

  ipcMain.handle('mdv:ai-chat-send-message', async (event: unknown, payload: unknown) => {
    const payloadRecord = isObjectRecord(payload) ? payload : null
    const sourceWindow = BrowserWindow.fromWebContents((event as IpcEventLike).sender)
    const editorWindow = getEditorWindowForAiAction(sourceWindow)
    const settingsState = getSettingsState()
    const requestId = typeof payloadRecord?.requestId === 'string' && payloadRecord.requestId.trim().length > 0
      ? payloadRecord.requestId.trim()
      : randomUUID()

    writeLog('INFO', 'ai-chat', 'OpenAI chat request start', {
      requestId,
      messageCount: Array.isArray(payloadRecord?.messages) ? payloadRecord.messages.length : 0,
      model: settingsState.ai.openai.model,
    })

    void (async () => {
      try {
        const result = await requestOpenAiChatResponse(
          editorWindow,
          payloadRecord?.messages,
          (streamEvent) => {
            emitAiChatStreamEvent(sourceWindow, { requestId, ...streamEvent })
          },
          {
            originRequestId: requestId,
            sourceWindowId: sourceWindow?.id ?? editorWindow?.id ?? -1,
          },
        )

        if (result.status === 'proposal-pending' && result.proposal) {
          writeLog('INFO', 'ai-chat', 'OpenAI chat request paused for change proposal review', {
            requestId,
            responseId: result.responseId,
            proposalId: result.proposal.proposalId,
            model: result.model,
          })
          emitAiChatStreamEvent(sourceWindow, {
            requestId,
            type: 'proposal-pending',
            proposal: result.proposal,
            reply: result.reply,
            model: result.model,
            responseId: result.responseId,
          })
          return
        }

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

  ipcMain.handle('mdv:open-external-link', async (event: unknown, href: unknown) => {
    if (typeof href !== 'string' || href.length === 0) {
      writeLog('WARN', 'ipc', 'open-external-link received invalid URL', href)
      return { status: 'blocked' }
    }
    return openExternalLink(BrowserWindow.fromWebContents((event as IpcEventLike).sender), href)
  })

  ipcMain.handle('mdv:open-document-link', async (event: unknown, href: unknown) => {
    if (typeof href !== 'string' || href.length === 0) {
      writeLog('WARN', 'ipc', 'open-document-link received invalid href', href)
      return { status: 'blocked', target: 'local', reason: 'invalid-target' }
    }
    return openDocumentLink(BrowserWindow.fromWebContents((event as IpcEventLike).sender), href)
  })

  ipcMain.handle('mdv:ensure-draft-workspace', async (_event: unknown, payload: unknown) => {
    const workspace = await ensureDraftWorkspace(payload)
    writeLog('INFO', 'ipc', 'ensure-draft-workspace', { workspaceId: workspace.workspaceId, rootDir: workspace.rootDir })
    return workspace
  })

  ipcMain.handle('mdv:import-image-asset', async (_event: unknown, payload: unknown) => {
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

  ipcMain.handle('mdv:cleanup-imported-assets', async (_event: unknown, payload: unknown) => {
    const payloadRecord = isObjectRecord(payload) ? payload : null
    await cleanupImportedAssetFiles(payloadRecord?.filePaths)
  })
  ipcMain.handle('mdv:cleanup-draft-workspace', async (_event: unknown, payload: unknown) => {
    await cleanupDraftWorkspace(payload)
  })
  ipcMain.handle('mdv:save-file', async (_event: unknown, payload: unknown) => saveContentToPath(BrowserWindow.getFocusedWindow() ?? undefined, payload))
  ipcMain.handle('mdv:confirm-unsaved-changes', async (event: unknown, payload: unknown) => showUnsavedChangesDialog(BrowserWindow.fromWebContents((event as IpcEventLike).sender) ?? undefined, payload))

  ipcMain.on('mdv:log', (_event: unknown, payload: unknown) => {
    const payloadRecord = isObjectRecord(payload) ? payload : null
    const level = typeof payloadRecord?.level === 'string' ? payloadRecord.level : 'INFO'
    const scope = typeof payloadRecord?.scope === 'string' ? payloadRecord.scope : 'renderer'
    writeLog(level.toUpperCase(), scope, payloadRecord?.message ?? '')
  })

  ipcMain.on('mdv:ai-editor-response', (_event: unknown, payload: unknown) => {
    const payloadRecord = isObjectRecord(payload) ? payload : null
    const requestId = typeof payloadRecord?.requestId === 'string' ? payloadRecord.requestId : null
    if (!requestId) {
      return
    }

    const pendingRequest = pendingAiEditorRequests.get(requestId)
    if (!pendingRequest) {
      return
    }

    clearTimeout(pendingRequest.timeout)
    pendingAiEditorRequests.delete(requestId)

    if (payloadRecord?.ok === false) {
      pendingRequest.reject(new Error(typeof payloadRecord.error === 'string' ? payloadRecord.error : 'AI editor request failed'))
      return
    }

    pendingRequest.resolve(payloadRecord?.payload ?? null)
  })

  ipcMain.on('mdv:server-command-result', (_event: unknown, payload: unknown) => {
    const payloadRecord = isObjectRecord(payload) ? payload : null
    const requestId = typeof payloadRecord?.requestId === 'string' ? payloadRecord.requestId : null
    if (!isManagedClient() || !requestId) {
      return
    }

    const pendingRequest = pendingServerRequests.get(requestId)
    if (pendingRequest?.type === 'suspend') {
      pendingServerRequests.delete(requestId)
    }

    const snapshotSource = payloadRecord?.snapshot
    const snapshot = isObjectRecord(snapshotSource) ? snapshotSource : null
    const currentFilePath = typeof snapshot?.currentFilePath === 'string' ? snapshot.currentFilePath : null
    const payloadType = typeof payloadRecord?.type === 'string' ? payloadRecord.type : null
    const payloadStatus = typeof payloadRecord?.status === 'string' ? payloadRecord.status : null

    void postServerJson(`/api/clients/${encodeURIComponent(managedClientId)}/state`, {
      snapshot,
      filePath: currentFilePath,
      status: payloadType === 'suspend' ? 'suspended' : 'running',
    })

    void postServerJson(`/api/clients/${encodeURIComponent(managedClientId)}/command-result`, payloadRecord)

    if (payloadType === 'suspend' && payloadStatus === 'completed') {
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
