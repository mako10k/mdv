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
    createWindow: async () => ({ id: 2, isDestroyed: () => false, isVisible: () => true, show: () => {} }),
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
    assertValidSettingsUpdate: () => {},
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
    getAiChangeProposalForWindow: () => ({}),
    reviseAiChangeProposalHunkForWindow: () => ({}),
    applyAiChangeProposalForWindow: async () => ({}),
    cancelAiChangeProposalForWindow: () => ({}),
    requestOpenAiChatResponse: async () => ({ status: 'completed', reply: 'ok', model: 'gpt', responseId: 'r1' }),
    emitAiChatStreamEvent: () => {},
    openExternalLink: async () => ({ status: 'opened' }),
    openDocumentLink: async () => ({ status: 'opened', target: 'local', displayName: 'doc.md' }),
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

test('settings update validates a model selection before persistence', async () => {
  const calls = []
  const currentSettings = { ai: { openai: { model: 'gpt-5.6-terra' } } }
  const { handles } = createContext({
    getSettingsState: () => currentSettings,
    assertValidSettingsUpdate: (patch) => calls.push(['validate', patch.ai.openai.model]),
    mergePlainObjects: (_base, patch) => patch,
    sanitizeSettings: (value) => {
      calls.push(['sanitize', value.ai.openai.model])
      return value
    },
    setSettingsState: (value) => calls.push(['set', value.ai.openai.model]),
    persistSettings: async () => calls.push(['persist']),
    broadcastSettingsChanged: () => calls.push(['broadcast']),
  })

  const result = await handles.get('mdv:settings-update')({}, {
    ai: { openai: { model: 'gpt-5.6-sol' } },
  })

  assert.deepEqual(result, { ai: { openai: { model: 'gpt-5.6-sol' } } })
  assert.deepEqual(calls, [
    ['validate', 'gpt-5.6-sol'],
    ['sanitize', 'gpt-5.6-sol'],
    ['set', 'gpt-5.6-sol'],
    ['persist'],
    ['broadcast'],
  ])
})

test('open-file delegates to readUtf8File when no existing editor exists', async () => {
  const { handles } = createContext()

  const result = await handles.get('mdv:open-file')()

  assert.deepEqual(result, {
    path: '/tmp/doc.md',
    content: '# Doc\n',
  })
})

test('new-document-window creates and focuses a fresh editor window outside managed-client mode', async () => {
  const focusedWindowIds = []
  const { handles } = createContext({
    createWindow: async () => ({ id: 42, isDestroyed: () => false, isVisible: () => true, show: () => {} }),
    focusWindow: (window) => {
      focusedWindowIds.push(window.id)
    },
  })

  const result = await handles.get('mdv:new-document-window')()

  assert.deepEqual(result, { status: 'opened', windowId: 42 })
  assert.deepEqual(focusedWindowIds, [42])
})

test('new-document-window reports unavailable instead of creating windows in managed-client mode', async () => {
  let createWindowCalls = 0
  const { handles } = createContext({
    isManagedClient: () => true,
    createWindow: async () => {
      createWindowCalls += 1
      return { id: 42, isDestroyed: () => false, isVisible: () => true, show: () => {} }
    },
  })

  const result = await handles.get('mdv:new-document-window')()

  assert.deepEqual(result, { status: 'unavailable', reason: 'managed-client' })
  assert.equal(createWindowCalls, 0)
})

test('open-external-link blocks invalid href payloads', async () => {
  const { handles } = createContext()
  const event = { sender: { __window: null } }

  const result = await handles.get('mdv:open-external-link')(event, '')

  assert.deepEqual(result, { status: 'blocked' })
})

test('open-document-link delegates raw href with the sender window', async () => {
  const calls = []
  const { handles, focusedWindow } = createContext({
    openDocumentLink: async (window, href) => {
      calls.push({ window, href })
      return { status: 'opened', target: 'local', displayName: 'target.md' }
    },
  })
  const senderWindow = { id: 9, isDestroyed: () => false }
  const event = { sender: { __window: senderWindow } }

  const result = await handles.get('mdv:open-document-link')(event, '../target.md')

  assert.deepEqual(result, { status: 'opened', target: 'local', displayName: 'target.md' })
  assert.deepEqual(calls, [{ window: senderWindow, href: '../target.md' }])
  assert.notEqual(calls[0].window, focusedWindow)
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

test('change proposal IPC delegates review, hunk revision, apply, and cancel to the source editor window', async () => {
  const calls = []
  const { handles, focusedWindow } = createContext({
    getAiChangeProposalForWindow: (window, payload) => {
      calls.push(['get', window.id, payload])
      return { proposalId: payload.proposalId }
    },
    reviseAiChangeProposalHunkForWindow: (window, payload) => {
      calls.push(['revise', window.id, payload])
      return { proposalId: payload.proposalId, revision: payload.expectedRevision + 1 }
    },
    applyAiChangeProposalForWindow: async (window, payload) => {
      calls.push(['apply', window.id, payload])
      return { proposalId: payload.proposalId, status: 'applied' }
    },
    cancelAiChangeProposalForWindow: (window, payload) => {
      calls.push(['cancel', window.id, payload])
      return { proposalId: payload.proposalId, status: 'cancelled' }
    },
  })
  const event = { sender: { __window: focusedWindow } }

  await handles.get('mdv:ai-change-proposal-get')(event, { proposalId: 'proposal:1' })
  const revisePayload = {
    proposalId: 'proposal:1',
    hunkId: 'hunk:1',
    expectedRevision: 1,
    expectedProposalFingerprint: 'candidate-1',
    edit: { kind: 'replace-hunk-body', markdown: 'manual\n' },
  }
  await handles.get('mdv:ai-change-proposal-revise-hunk')(event, revisePayload)
  await handles.get('mdv:ai-change-proposal-apply')(event, {
    proposalId: 'proposal:1',
    expectedRevision: 2,
    expectedProposalFingerprint: 'candidate-2',
    selectedHunkIds: ['hunk:1'],
  })
  await handles.get('mdv:ai-change-proposal-cancel')(event, { proposalId: 'proposal:2' })

  assert.deepEqual(calls, [
    ['get', 1, { proposalId: 'proposal:1' }],
    ['revise', 1, revisePayload],
    ['apply', 1, {
      proposalId: 'proposal:1',
      expectedRevision: 2,
      expectedProposalFingerprint: 'candidate-2',
      selectedHunkIds: ['hunk:1'],
    }],
    ['cancel', 1, { proposalId: 'proposal:2' }],
  ])
})

test('proposal-pending terminates the chat request without emitting completed', async () => {
  let requestContext = null
  const emitted = []
  let resolvePendingEvent
  const pendingEvent = new Promise((resolve) => {
    resolvePendingEvent = resolve
  })
  const { handles, focusedWindow } = createContext({
    getSettingsState: () => ({
      general: { themeMode: 'system' },
      ai: { openai: { model: 'gpt-test' } },
    }),
    requestOpenAiChatResponse: async (_window, _messages, _onEvent, context) => {
      requestContext = context
      return {
        status: 'proposal-pending',
        proposal: { proposalId: 'proposal:1', title: 'Example' },
        reply: '',
        model: 'gpt-test',
        responseId: 'response:1',
      }
    },
    emitAiChatStreamEvent: (_window, event) => {
      emitted.push(event)
      if (event.type === 'proposal-pending') {
        resolvePendingEvent()
      }
    },
  })
  const event = { sender: { __window: focusedWindow } }

  const dispatch = await handles.get('mdv:ai-chat-send-message')(event, {
    requestId: 'request:proposal',
    messages: [{ role: 'user', content: 'propose a change' }],
  })
  await pendingEvent

  assert.deepEqual(dispatch, { status: 'started', requestId: 'request:proposal' })
  assert.deepEqual(requestContext, { originRequestId: 'request:proposal', sourceWindowId: 1 })
  assert.equal(emitted.some((item) => item.type === 'completed'), false)
  assert.equal(emitted.at(-1).type, 'proposal-pending')
  assert.equal(emitted.at(-1).proposal.proposalId, 'proposal:1')
})
