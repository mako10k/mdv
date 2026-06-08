import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { registerMainIpcHandlers } = require('../../electron/lib/main/main-ipc.cjs')

function createIpcHarness() {
  const handles = new Map()
  const listeners = new Map()

  return {
    ipcMain: {
      handle(channel, handler) {
        handles.set(channel, handler)
      },
      on(channel, handler) {
        listeners.set(channel, handler)
      },
    },
    handles,
    listeners,
  }
}

function createBrowserWindowHarness() {
  const focusedWindow = {
    id: 1,
    isDestroyed: () => false,
    isVisible: () => true,
    show: () => {},
  }

  return {
    BrowserWindow: {
      getFocusedWindow: () => focusedWindow,
      fromWebContents: (sender) => sender.__window ?? focusedWindow,
    },
    focusedWindow,
  }
}

function createContext(overrides = {}) {
  const { ipcMain, handles, listeners } = createIpcHarness()
  const { BrowserWindow, focusedWindow } = createBrowserWindowHarness()
  const logs = []
  const context = {
    ipcMain,
    BrowserWindow,
    app: { quit: () => {} },
    randomUUID: () => 'req-1',
    writeLog: (...parts) => logs.push(parts),
    getMainI18n: () => ({
      fileDialog: {
        markdownFilter: 'Markdown',
        allFilesFilter: 'All files',
      },
    }),
    showOpenDialog: async () => ({ canceled: false, filePaths: ['/tmp/doc.md'] }),
    findEditorWindowByTrackedFilePath: () => null,
    focusWindow: () => {},
    readUtf8File: async (filePath) => ({ path: filePath, content: '# Doc\n' }),
    emitDebugChannelEvent: () => {},
    upsertAutosaveRecovery: (snapshot) => snapshot,
    clearAutosaveRecovery: () => {},
    getLatestAutosaveRecovery: () => null,
    getAutosaveRecoveryForFile: () => null,
    getMdastCapabilities: () => ({ supported: true }),
    extractHeadingOutline: () => [],
    trackCurrentFileForWindow: () => {},
    readRelativeAssetAsDataUrl: async () => null,
    hiddenLaunchRevealTimerByWindowId: new Map(),
    saveHtmlExportToPath: async () => null,
    openSettingsWindow: () => ({ status: 'opened' }),
    openFetchPermissionsWindow: () => ({ status: 'opened' }),
    openAboutWindow: () => ({ status: 'opened' }),
    launchStateByWindowId: new Map(),
    getSettingsState: () => ({ general: { themeMode: 'system' } }),
    getHasPersistedSettings: () => false,
    getHasReadableSettings: () => false,
    getUpdaterStateSnapshot: () => ({ state: 'idle' }),
    checkForAppUpdates: async () => ({ started: true }),
    downloadAvailableUpdate: async () => ({ started: true }),
    installDownloadedUpdate: () => true,
    sanitizeSettings: (value) => value,
    mergePlainObjects: (base, patch) => ({ ...base, ...patch }),
    isPlainObject: (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value),
    persistSettings: async () => {},
    broadcastSettingsChanged: () => {},
    normalizeSecret: (value) => value,
    getSecretsState: () => ({ openaiApiKey: null, tavilyApiKey: null }),
    setSecretsState: () => {},
    sanitizeSecrets: (value) => value,
    persistSecrets: async () => {},
    getProviderStatus: () => ({ openaiConfigured: false, tavilyConfigured: false }),
    getAppMetadata: () => ({ version: '0.1.9' }),
    getEditorWindowForAiAction: (window) => window ?? focusedWindow,
    requestEditorContext: async () => ({ editorId: 'editor:1' }),
    ensureEditorRuntimeState: () => ({ editorId: 'editor:1' }),
    readAiTargetForWindow: async () => ({ text: 'ok' }),
    exactSearchForWindow: async () => ({}),
    statsAiSliceForWindow: async () => ({}),
    semanticSearchForWindow: async () => ({}),
    writeAiTargetForWindow: async () => ({}),
    listAiBuffersForWindow: async () => ({ buffers: [] }),
    requestOpenAiChatResponse: async () => ({ reply: 'ok', model: 'gpt', responseId: 'r1' }),
    emitAiChatStreamEvent: () => {},
    openExternalLink: async () => ({ status: 'opened' }),
    ensureDraftWorkspace: async () => ({ workspaceId: 'w1', rootDir: '/tmp/w1' }),
    importImageAsset: async () => null,
    cleanupImportedAssetFiles: async () => {},
    cleanupDraftWorkspace: async () => {},
    saveContentToPath: async () => ({ status: 'saved' }),
    showUnsavedChangesDialog: async () => ({ action: 'cancel' }),
    pendingAiEditorRequests: new Map(),
    isManagedClient: () => false,
    pendingServerRequests: new Map(),
    managedClientId: 'client-1',
    postServerJson: async () => null,
    logFilePath: '/tmp/mdv.log',
    setSettingsState: () => {},
    ...overrides,
  }

  registerMainIpcHandlers(context)
  return { handles, listeners, logs, focusedWindow }
}

test('settings bootstrap returns persisted/readable flags and launch panel', () => {
  const sender = { id: 10, __window: { id: 3, isDestroyed: () => false, isVisible: () => true } }
  const { listeners } = createContext({
    getSettingsState: () => ({ general: { themeMode: 'dark' } }),
    getHasPersistedSettings: () => true,
    getHasReadableSettings: () => true,
    launchStateByWindowId: new Map([[3, { filePath: '/tmp/doc.md', initialPanel: 'write' }]]),
  })
  const event = { sender, returnValue: null }

  listeners.get('mdv:settings-bootstrap')(event)

  assert.deepEqual(event.returnValue, {
    settings: { general: { themeMode: 'dark' } },
    hasPersistedSettings: true,
    hasReadableSettings: true,
    hasInitialLaunchRequest: true,
    initialPanel: 'write',
  })
})

test('open-file delegates to readUtf8File when no existing editor exists', async () => {
  const { handles } = createContext()

  const result = await handles.get('mdv:open-file')()

  assert.deepEqual(result, {
    path: '/tmp/doc.md',
    content: '# Doc\n',
  })
})

test('open-external-link blocks invalid href payloads', async () => {
  const { handles } = createContext()
  const event = { sender: { __window: null } }

  const result = await handles.get('mdv:open-external-link')(event, '')

  assert.deepEqual(result, { status: 'blocked' })
})

test('ai chat read handlers abbreviate inline data image payload text', async () => {
  const { handles, focusedWindow } = createContext({
    ensureEditorRuntimeState: () => ({ editorId: 'editor:1' }),
    readAiTargetForWindow: async () => ({
      editorId: 'editor:1',
      span: {
        start: { line: 1, column: 1 },
        end: { line: 1, column: 40 },
        isEmpty: false,
      },
      text: '![logo](data:image/png;base64,QUJDRA==)',
      estimatedTokens: 1,
      truncated: false,
    }),
  })
  const event = { sender: { __window: focusedWindow } }

  const activeDocument = await handles.get('mdv:ai-chat-read-active-document')(event)
  const directTarget = await handles.get('mdv:ai-chat-read-target')(event, {
    target: { editorId: 'editor:1', span: { kind: 'document' } },
  })

  assert.equal(activeDocument.text, '![logo](data:image/png;base64,<4 B omitted>)')
  assert.equal(directTarget.text, '![logo](data:image/png;base64,<4 B omitted>)')
})

test('ai chat grep handler abbreviates previews for public display', async () => {
  const { handles, focusedWindow } = createContext({
    exactSearchForWindow: async () => ({
      matches: [
        {
          line: 1,
          column: 1,
          preview: '![logo](data:image/png;base64,QUJDRA==)',
        },
      ],
      truncated: false,
    }),
  })
  const event = { sender: { __window: focusedWindow } }

  const result = await handles.get('mdv:ai-chat-grep-slice')(event, {
    target: { editorId: 'editor:1', span: { kind: 'document' } },
    query: 'logo',
  })

  assert.equal(result.matches[0].preview, '![logo](data:image/png;base64,<4 B omitted>)')
})
