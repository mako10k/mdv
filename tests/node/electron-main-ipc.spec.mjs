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
    openMermaidViewer: () => ({ status: 'opened' }),
    isEditorWindow: () => true,
    launchStateByWindowId: new Map(),
    getSettingsState: () => ({
      general: { themeMode: 'system' },
      editor: { fontSizePx: 13 },
      ai: { chatFontSizePx: 12, openai: { model: 'gpt-5.6-terra' } },
    }),
    getHasPersistedSettings: () => false,
    getHasReadableSettings: () => false,
    getUpdaterStateSnapshot: () => ({ state: 'idle' }),
    checkForAppUpdates: async () => ({ started: true }),
    downloadAvailableUpdate: async () => ({ started: true }),
    installDownloadedUpdate: () => true,
    assertValidSettingsUpdate: () => {},
    adjustTypographySettings: (settings, adjustment) => {
      const currentValue = adjustment.target === 'chat' ? settings.ai.chatFontSizePx : settings.editor.fontSizePx
      const valuePx = adjustment.kind === 'reset'
        ? adjustment.target === 'chat' ? 12 : 13
        : currentValue + adjustment.steps
      const nextSettings = adjustment.target === 'chat'
        ? { ...settings, ai: { ...settings.ai, chatFontSizePx: valuePx } }
        : { ...settings, editor: { ...settings.editor, fontSizePx: valuePx } }

      return {
        changed: valuePx !== currentValue,
        target: adjustment.target,
        valuePx,
        settings: nextSettings,
      }
    },
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
    getPluginDiagnostics: () => ({ contractVersion: 1, hostVersion: '0.1.9', packages: [] }),
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

  if (typeof context.enqueueSettingsMutation !== 'function') {
    context.enqueueSettingsMutation = async (mutate) => {
      const plan = mutate(context.getSettingsState())
      if (plan.changed) {
        await context.persistSettings(plan.nextState)
        context.setSettingsState(plan.nextState)
        context.broadcastSettingsChanged()
      }

      return {
        settings: plan.changed ? plan.nextState : context.getSettingsState(),
        changed: plan.changed,
        value: plan.value,
      }
    }
  }

  registerMainIpcHandlers(context)
  return { handles, listeners, logs, focusedWindow }
}

test('Mermaid viewer IPC accepts only bounded source and an explicit theme', async () => {
  const calls = []
  const { handles, focusedWindow } = createContext({
    openMermaidViewer: (window, payload) => {
      calls.push({ windowId: window.id, payload })
      return { status: 'opened' }
    },
  })
  const event = { sender: { __window: focusedWindow } }
  const handler = handles.get('mdv:open-mermaid-viewer')

  assert.deepEqual(await handler(event, { code: 'flowchart TD\nA-->B', theme: 'dark' }), { status: 'opened' })
  assert.deepEqual(await handler(event, { code: '', theme: 'dark' }), { status: 'invalid' })
  assert.deepEqual(await handler(event, { code: 'A'.repeat(100_001), theme: 'light' }), { status: 'invalid' })
  assert.deepEqual(await handler(event, { code: 'flowchart TD', theme: 'system' }), { status: 'invalid' })
  const rejectedSender = { id: 8, isDestroyed: () => false, isVisible: () => true }
  const rejected = createContext({ isEditorWindow: (window) => window.id !== rejectedSender.id })
  assert.deepEqual(await rejected.handles.get('mdv:open-mermaid-viewer')({ sender: { __window: rejectedSender } }, { code: 'flowchart TD', theme: 'light' }), { status: 'invalid' })
  assert.deepEqual(calls, [{ windowId: focusedWindow.id, payload: { code: 'flowchart TD\nA-->B', theme: 'dark' } }])
})

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

test('Plugin diagnostics IPC returns only the main-owned read-only snapshot', async () => {
  const snapshot = {
    contractVersion: 1,
    hostVersion: '0.2.3',
    packages: [{
      catalogId: 'sample',
      packageId: 'dev.mdv.diagnostics-sample',
      displayName: 'Diagnostics Sample',
      version: '1.0.0',
      origin: 'bundled',
      status: 'ready',
      packageDigestSha256: 'a'.repeat(64),
      capabilities: [{
        id: 'sample-codeblock',
        family: 'codeblock',
        version: 1,
        availability: 'declared',
        executable: false,
        loaded: false,
      }],
      skills: [{
        id: 'sample-guide',
        family: 'skill',
        version: '1.0.0',
        availability: 'declared',
        executable: false,
        loaded: false,
      }],
      diagnostics: [],
    }],
  }
  const { handles } = createContext({ getPluginDiagnostics: () => snapshot })

  const result = await handles.get('mdv:plugins-get-diagnostics')({})
  assert.deepEqual(result, snapshot)
  assert.equal('packageRoot' in result.packages[0], false)
  assert.equal('manifest' in result.packages[0], false)
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
    ['persist'],
    ['set', 'gpt-5.6-sol'],
    ['broadcast'],
  ])
})

test('typography adjustment returns authoritative typed result', async () => {
  let currentSettings = {
    general: { themeMode: 'system' },
    editor: { fontSizePx: 13 },
    ai: { chatFontSizePx: 12, openai: { model: 'gpt-5.6-terra' } },
  }
  const calls = []
  const { handles } = createContext({
    getSettingsState: () => currentSettings,
    setSettingsState: (nextSettings) => {
      currentSettings = nextSettings
      calls.push(['set', nextSettings.editor.fontSizePx])
    },
    persistSettings: async (nextSettings) => calls.push(['persist', nextSettings.editor.fontSizePx]),
    broadcastSettingsChanged: () => calls.push(['broadcast']),
  })

  const result = await handles.get('mdv:settings-adjust-typography')({}, {
    target: 'editor',
    kind: 'delta',
    steps: 1,
  })

  assert.deepEqual(result, {
    changed: true,
    target: 'editor',
    valuePx: 14,
    settings: {
      general: { themeMode: 'system' },
      editor: { fontSizePx: 14 },
      ai: { chatFontSizePx: 12, openai: { model: 'gpt-5.6-terra' } },
    },
  })
  assert.deepEqual(calls, [
    ['persist', 14],
    ['set', 14],
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
