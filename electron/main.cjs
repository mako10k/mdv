const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron')
const fs = require('node:fs')
const fsPromises = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const OpenAI = require('openai')

const isDev = !app.isPackaged
const windowIcon = path.join(__dirname, '..', 'build', 'icon.png')
const allowedLinkRulesPath = path.join(app.getPath('userData'), 'allowed-link-rules.json')
const settingsPath = path.join(app.getPath('userData'), 'settings.json')
const secretsPath = path.join(app.getPath('userData'), 'secrets.json')
const managedServerUrl = process.env.MDV_SERVER_URL || null
const managedClientId = process.env.MDV_CLIENT_ID || null
const managedWindowId = process.env.MDV_WINDOW_ID || managedClientId || null
const appDisplayName = 'MarkDownViewer'
const defaultOpenAiModel = process.env.MDV_OPENAI_MODEL || 'gpt-5.4-mini'

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')
app.setName(appDisplayName)
app.setAppLogsPath()

const logFilePath = path.join(app.getPath('logs'), 'mdv.log')
let allowedLinkRules = loadAllowedLinkRules()
let pendingLaunchFilePath = resolveLaunchFilePath(process.argv)
let managedMainWindow = null
let commandPollTimer = null
const pendingServerRequests = new Map()
const editorToAiChatWindowId = new Map()
const aiChatToEditorWindowId = new Map()
const pendingAiEditorRequests = new Map()
let settingsWindow = null
let settingsWindowOwnerEditorId = null
let settingsState = loadSettings()
let secretsState = loadSecrets()
let hasPersistedSettings = fs.existsSync(settingsPath)
let hasReadableSettings = loadSettings.didLoadPersisted === true

function isManagedClient() {
  return Boolean(managedServerUrl && managedClientId && managedWindowId)
}

function getFileArgumentStartIndex() {
  return process.defaultApp ? 2 : 1
}

function resolveLaunchFilePath(argv) {
  for (const candidate of argv.slice(getFileArgumentStartIndex())) {
    if (typeof candidate !== 'string' || candidate.length === 0 || candidate.startsWith('-')) {
      continue
    }

    const resolvedPath = path.resolve(candidate)

    try {
      if (fs.statSync(resolvedPath).isFile()) {
        return resolvedPath
      }
    } catch {
      continue
    }
  }

  return null
}

function focusWindow(window) {
  if (window.isMinimized()) {
    window.restore()
  }

  window.focus()
}

function createDefaultSettings() {
  return {
    version: 1,
    general: {
      themeMode: 'system',
      defaultStartPanel: 'write',
      openLinksBehavior: 'confirm-if-untrusted',
    },
    editor: {
      initialEditType: 'markdown',
      showModeSwitch: true,
      previewStyle: 'tab',
    },
    ai: {
      defaultWriteMode: 'direct',
      toolPermissions: {
        readActiveDocument: true,
        readActiveSelection: true,
        writeActiveDocument: true,
        writeActiveSelection: true,
        writeNewDocument: true,
        workspaceGrep: true,
        tavilyWebSearch: true,
      },
      openai: {
        enabled: true,
        baseUrl: null,
        model: defaultOpenAiModel,
      },
      tavily: {
        enabled: false,
        defaultSearchDepth: 'basic',
        defaultMaxResults: 5,
      },
    },
    safety: {
      confirmBeforeFullDocumentOverwrite: true,
      confirmBeforeNewDocumentFromAi: true,
      confirmBeforeExternalUrlOpen: true,
    },
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function mergePlainObjects(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return patch
  }

  const merged = { ...base }

  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = mergePlainObjects(merged[key], value)
      continue
    }

    merged[key] = value
  }

  return merged
}

function normalizeThemeMode(value) {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}

function normalizeStartPanel(value) {
  return value === 'preview' ? 'preview' : 'write'
}

function normalizeOpenLinksBehavior(value) {
  return value === 'block-untrusted' ? 'block-untrusted' : 'confirm-if-untrusted'
}

function normalizeInitialEditType(value) {
  return value === 'wysiwyg' ? 'wysiwyg' : 'markdown'
}

function normalizePreviewStyle(value) {
  return value === 'vertical' ? 'vertical' : 'tab'
}

function normalizeWriteMode(value) {
  return value === 'suggest' ? 'suggest' : 'direct'
}

function normalizeOpenAiModel(value) {
  if (typeof value !== 'string') {
    return defaultOpenAiModel
  }

  const trimmedValue = value.trim()

  if (trimmedValue.length === 0) {
    return defaultOpenAiModel
  }

  return trimmedValue
}

function normalizeSearchDepth(value) {
  return value === 'advanced' ? 'advanced' : 'basic'
}

function normalizeSecret(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function clampDefaultMaxResults(value) {
  const numericValue = Number(value)

  if (!Number.isFinite(numericValue)) {
    return 5
  }

  return Math.min(20, Math.max(1, Math.round(numericValue)))
}

function sanitizeSettings(candidate) {
  const defaults = createDefaultSettings()
  const merged = isPlainObject(candidate) ? mergePlainObjects(defaults, candidate) : defaults

  return {
    version: 1,
    general: {
      themeMode: normalizeThemeMode(merged.general?.themeMode),
      defaultStartPanel: normalizeStartPanel(merged.general?.defaultStartPanel),
      openLinksBehavior: normalizeOpenLinksBehavior(merged.general?.openLinksBehavior),
    },
    editor: {
      initialEditType: normalizeInitialEditType(merged.editor?.initialEditType),
      showModeSwitch: merged.editor?.showModeSwitch !== false,
      previewStyle: normalizePreviewStyle(merged.editor?.previewStyle),
    },
    ai: {
      defaultWriteMode: normalizeWriteMode(merged.ai?.defaultWriteMode),
      toolPermissions: {
        readActiveDocument: merged.ai?.toolPermissions?.readActiveDocument !== false,
        readActiveSelection: merged.ai?.toolPermissions?.readActiveSelection !== false,
        writeActiveDocument: merged.ai?.toolPermissions?.writeActiveDocument !== false,
        writeActiveSelection: merged.ai?.toolPermissions?.writeActiveSelection !== false,
        writeNewDocument: merged.ai?.toolPermissions?.writeNewDocument !== false,
        workspaceGrep: merged.ai?.toolPermissions?.workspaceGrep !== false,
        tavilyWebSearch: merged.ai?.toolPermissions?.tavilyWebSearch !== false,
      },
      openai: {
        enabled: merged.ai?.openai?.enabled === true,
        baseUrl: typeof merged.ai?.openai?.baseUrl === 'string' && merged.ai.openai.baseUrl.trim().length > 0
          ? merged.ai.openai.baseUrl.trim()
          : null,
        model: normalizeOpenAiModel(merged.ai?.openai?.model),
      },
      tavily: {
        enabled: merged.ai?.tavily?.enabled === true,
        defaultSearchDepth: normalizeSearchDepth(merged.ai?.tavily?.defaultSearchDepth),
        defaultMaxResults: clampDefaultMaxResults(merged.ai?.tavily?.defaultMaxResults),
      },
    },
    safety: {
      confirmBeforeFullDocumentOverwrite: merged.safety?.confirmBeforeFullDocumentOverwrite !== false,
      confirmBeforeNewDocumentFromAi: merged.safety?.confirmBeforeNewDocumentFromAi !== false,
      confirmBeforeExternalUrlOpen: merged.safety?.confirmBeforeExternalUrlOpen !== false,
    },
  }
}

function sanitizeSecrets(candidate) {
  return {
    openaiApiKey: normalizeSecret(candidate?.openaiApiKey),
    tavilyApiKey: normalizeSecret(candidate?.tavilyApiKey),
  }
}

function loadSettings() {
  try {
    if (!fs.existsSync(settingsPath)) {
      loadSettings.didLoadPersisted = false
      return createDefaultSettings()
    }

    const raw = fs.readFileSync(settingsPath, 'utf8')
    loadSettings.didLoadPersisted = true
    return sanitizeSettings(JSON.parse(raw))
  } catch (error) {
    loadSettings.didLoadPersisted = false
    writeLog('WARN', 'settings', 'Falling back to default settings', error instanceof Error ? error.message : String(error))
    return createDefaultSettings()
  }
}

loadSettings.didLoadPersisted = false

function loadSecrets() {
  try {
    if (!fs.existsSync(secretsPath)) {
      return sanitizeSecrets({})
    }

    const raw = fs.readFileSync(secretsPath, 'utf8')
    return sanitizeSecrets(JSON.parse(raw))
  } catch (error) {
    writeLog('WARN', 'settings', 'Falling back to empty secrets store', error instanceof Error ? error.message : String(error))
    return sanitizeSecrets({})
  }
}

async function persistSettings() {
  await fsPromises.mkdir(path.dirname(settingsPath), { recursive: true })
  await fsPromises.writeFile(settingsPath, `${JSON.stringify(settingsState, null, 2)}\n`, 'utf8')
  hasPersistedSettings = true
  hasReadableSettings = true
}

async function persistSecrets() {
  await fsPromises.mkdir(path.dirname(secretsPath), { recursive: true })
  await fsPromises.writeFile(secretsPath, `${JSON.stringify(secretsState, null, 2)}\n`, 'utf8')
}

function getProviderStatus() {
  return {
    openaiConfigured: getOpenAiApiKey() !== null,
    tavilyConfigured: getTavilyApiKey() !== null,
  }
}

function isOpenAiEnabled() {
  return settingsState.ai.openai.enabled === true
}

const openAiChatInstructions = [
  'You are MDV Assistant inside MarkDownViewer, a Markdown editing application.',
  'Respond in Markdown and keep answers focused on the user request.',
  'Treat transcript entries labeled as tool context as trusted application-provided context.',
  'Do not claim that edits were applied unless the transcript explicitly says a write action already happened.',
].join(' ')

function getOpenAiApiKey() {
  return secretsState.openaiApiKey
    || (typeof process.env.OPENAI_API_KEY === 'string' && process.env.OPENAI_API_KEY.trim().length > 0
      ? process.env.OPENAI_API_KEY.trim()
      : null)
}

function getTavilyApiKey() {
  return secretsState.tavilyApiKey
    || (typeof process.env.TAVILY_API_KEY === 'string' && process.env.TAVILY_API_KEY.trim().length > 0
      ? process.env.TAVILY_API_KEY.trim()
      : null)
}

function getOpenAiBaseUrl() {
  const configuredBaseUrl = settingsState.ai.openai.baseUrl || process.env.MDV_OPENAI_BASE_URL || 'https://api.openai.com/v1'
  return configuredBaseUrl.endsWith('/') ? configuredBaseUrl : `${configuredBaseUrl}/`
}

function createOpenAiClient() {
  if (!isOpenAiEnabled()) {
    throw new Error('OpenAI is disabled in settings')
  }

  const apiKey = getOpenAiApiKey()

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured')
  }

  return new OpenAI({
    apiKey,
    baseURL: getOpenAiBaseUrl(),
  })
}

function mapAiChatMessageToOpenAiInput(message) {
  if (!message || typeof message.content !== 'string' || message.content.trim().length === 0) {
    return null
  }

  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: message.content,
    }
  }

  if (message.role === 'tool') {
    return {
      role: 'user',
      content: `Tool context${message.title ? ` (${message.title})` : ''}:\n${message.content}`,
    }
  }

  return {
    role: 'user',
    content: message.content,
  }
}

async function requestOpenAiChatResponse(messages) {
  const input = Array.isArray(messages)
    ? messages
      .map(mapAiChatMessageToOpenAiInput)
      .filter(Boolean)
    : []

  if (input.length === 0) {
    throw new Error('No chat context was provided to OpenAI')
  }

  const client = createOpenAiClient()

  try {
    const response = await client.responses.create({
      model: settingsState.ai.openai.model,
      instructions: openAiChatInstructions,
      input,
      store: false,
    })

    const reply = typeof response.output_text === 'string' ? response.output_text.trim() : ''

    if (!reply) {
      throw new Error('OpenAI SDK returned no output_text')
    }

    return {
      reply,
      model: typeof response.model === 'string' && response.model.length > 0 ? response.model : settingsState.ai.openai.model,
      responseId: typeof response.id === 'string' ? response.id : null,
    }
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      throw new Error(`OpenAI request failed: ${error.message}`)
    }

    throw error
  }
}

function broadcastSettingsChanged() {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue
    }

    window.webContents.send('mdv:settings-changed', settingsState)
  }
}

function loadRendererWindow(window, htmlFileName) {
  if (isDev) {
    window.loadURL(`http://localhost:5173/${htmlFileName}`)
    return
  }

  window.loadFile(path.join(__dirname, '..', 'dist', htmlFileName))
}

function isSettingsWindow(window) {
  return Boolean(settingsWindow) && Boolean(window) && settingsWindow.id === window.id
}

function isAiChatWindow(window) {
  return Boolean(window) && aiChatToEditorWindowId.has(window.id)
}

function isEditorWindow(window) {
  return Boolean(window) && !isAiChatWindow(window) && !isSettingsWindow(window)
}

function getDefaultEditorWindow() {
  return BrowserWindow.getAllWindows().find((window) => isEditorWindow(window)) ?? null
}

function getEditorWindowForAiAction(candidateWindow) {
  if (!candidateWindow) {
    return getDefaultEditorWindow()
  }

  if (aiChatToEditorWindowId.has(candidateWindow.id)) {
    const ownerWindowId = aiChatToEditorWindowId.get(candidateWindow.id)
    return BrowserWindow.fromId(ownerWindowId) ?? null
  }

  if (isSettingsWindow(candidateWindow)) {
    if (settingsWindowOwnerEditorId) {
      const ownerWindow = BrowserWindow.fromId(settingsWindowOwnerEditorId)
      if (ownerWindow && !ownerWindow.isDestroyed()) {
        return ownerWindow
      }
    }

    return getDefaultEditorWindow()
  }

  return candidateWindow
}

function getAiChatWindowForEditorWindow(editorWindow) {
  const chatWindowId = editorToAiChatWindowId.get(editorWindow.id)
  return chatWindowId ? BrowserWindow.fromId(chatWindowId) : null
}

function requestEditorWindowData(editorWindow, request) {
  if (!editorWindow || editorWindow.isDestroyed()) {
    return Promise.reject(new Error('Editor window is unavailable'))
  }

  return new Promise((resolve, reject) => {
    const requestId = randomUUID()
    const timeout = setTimeout(() => {
      pendingAiEditorRequests.delete(requestId)
      reject(new Error(`AI editor request timed out: ${request.type}`))
    }, 5000)

    pendingAiEditorRequests.set(requestId, {
      resolve,
      reject,
      timeout,
    })

    editorWindow.webContents.send('mdv:ai-editor-request', {
      requestId,
      ...request,
    })
  })
}

function openAiChatWindow(targetWindow) {
  const editorWindow = getEditorWindowForAiAction(targetWindow)

  if (!editorWindow || editorWindow.isDestroyed()) {
    writeLog('WARN', 'ai-chat', 'No editor window available')
    return { status: 'focused' }
  }

  const existingChatWindow = getAiChatWindowForEditorWindow(editorWindow)

  if (existingChatWindow && !existingChatWindow.isDestroyed()) {
    focusWindow(existingChatWindow)
    return { status: 'focused' }
  }

  const chatWindow = new BrowserWindow({
    width: 520,
    height: 760,
    minWidth: 420,
    minHeight: 540,
    backgroundColor: '#fffaf4',
    autoHideMenuBar: true,
    icon: windowIcon,
    parent: editorWindow,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  editorToAiChatWindowId.set(editorWindow.id, chatWindow.id)
  aiChatToEditorWindowId.set(chatWindow.id, editorWindow.id)

  chatWindow.on('closed', () => {
    aiChatToEditorWindowId.delete(chatWindow.id)
    editorToAiChatWindowId.delete(editorWindow.id)
  })

  loadRendererWindow(chatWindow, 'chat.html')
  focusWindow(chatWindow)
  writeLog('INFO', 'ai-chat', 'BrowserWindow created', { editorWindowId: editorWindow.id, chatWindowId: chatWindow.id })

  return { status: 'opened' }
}

function openSettingsWindow(targetWindow) {
  const ownerEditorWindow = getEditorWindowForAiAction(targetWindow)

  if (!ownerEditorWindow && (!settingsWindow || settingsWindow.isDestroyed())) {
    writeLog('WARN', 'settings', 'No editor window available for settings owner')
    return { status: 'focused' }
  }

  if (ownerEditorWindow && !ownerEditorWindow.isDestroyed()) {
    settingsWindowOwnerEditorId = ownerEditorWindow.id
  }

  if (settingsWindow && !settingsWindow.isDestroyed()) {
    focusWindow(settingsWindow)
    return { status: 'focused' }
  }

  settingsWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: '#fffaf4',
    autoHideMenuBar: true,
    icon: windowIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  settingsWindow.on('closed', () => {
    settingsWindow = null
    settingsWindowOwnerEditorId = null
  })

  loadRendererWindow(settingsWindow, 'settings.html')
  focusWindow(settingsWindow)
  writeLog('INFO', 'settings', 'Settings window opened')

  return { status: 'opened' }
}

function dispatchOpenFileToWindow(targetWindow, filePath) {
  if (!targetWindow || !filePath) {
    return
  }

  writeLog('INFO', 'main', 'Dispatch launch/open file request', filePath)
  targetWindow.webContents.send('mdv:open-file-requested', filePath)
}

function dispatchServerCommand(command) {
  if (!managedMainWindow || managedMainWindow.isDestroyed()) {
    return
  }

  managedMainWindow.webContents.send('mdv:server-command', command)
}

function queueOrDispatchOpenFile(filePath) {
  if (!filePath) {
    return
  }

  const targetWindow = getDefaultEditorWindow()

  if (!targetWindow || targetWindow.webContents.isLoading()) {
    pendingLaunchFilePath = filePath
    writeLog('INFO', 'main', 'Queued launch file path', filePath)
    return
  }

  dispatchOpenFileToWindow(targetWindow, filePath)
}

function loadAllowedLinkRules() {
  try {
    const raw = fs.readFileSync(allowedLinkRulesPath, 'utf8')
    const parsed = JSON.parse(raw)

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter((rule) => typeof rule === 'string' && rule.length > 0)
  } catch {
    return []
  }
}

function saveAllowedLinkRules() {
  fs.mkdirSync(path.dirname(allowedLinkRulesPath), { recursive: true })
  fs.writeFileSync(allowedLinkRulesPath, JSON.stringify(allowedLinkRules, null, 2), 'utf8')
}

function isSupportedExternalUrl(targetUrl) {
  return targetUrl.protocol === 'http:' || targetUrl.protocol === 'https:'
}

function createAllowedLinkRule(targetUrl) {
  return `${targetUrl.origin}/*`
}

function isUrlAllowed(targetUrl) {
  return allowedLinkRules.some((rule) => {
    if (rule.endsWith('*')) {
      return targetUrl.href.startsWith(rule.slice(0, -1))
    }

    return targetUrl.href === rule
  })
}

function registerAllowedLinkRule(rule) {
  if (allowedLinkRules.includes(rule)) {
    return
  }

  allowedLinkRules = [...allowedLinkRules, rule]
  saveAllowedLinkRules()
}

async function confirmExternalNavigation(parentWindow, targetUrl) {
  const suggestedRule = createAllowedLinkRule(targetUrl)
  const response = await dialog.showMessageBox(parentWindow ?? undefined, {
    type: 'warning',
    buttons: ['許可リストに登録して表示', '今回のみ表示', '表示しない'],
    defaultId: 1,
    cancelId: 2,
    title: '未許可の外部サイトです',
    message: '未許可の外部サイトを開こうとしています。',
    detail: `URL: ${targetUrl.href}\n登録候補: ${suggestedRule}`,
    noLink: true,
  })

  if (response.response === 0) {
    registerAllowedLinkRule(suggestedRule)
    return true
  }

  return response.response === 1
}

async function openExternalLink(parentWindow, href) {
  let targetUrl

  try {
    targetUrl = new URL(href)
  } catch {
    writeLog('WARN', 'link', 'Invalid URL', href)
    return { status: 'blocked' }
  }

  if (!isSupportedExternalUrl(targetUrl)) {
    writeLog('WARN', 'link', 'Unsupported protocol', targetUrl.href)
    return { status: 'blocked' }
  }

  if (settingsState.general.openLinksBehavior === 'block-untrusted' && !isUrlAllowed(targetUrl)) {
    writeLog('INFO', 'link', 'Blocked by settings policy', targetUrl.href)
    return { status: 'blocked' }
  }

  if (!isUrlAllowed(targetUrl)) {
    const confirmed = await confirmExternalNavigation(parentWindow, targetUrl)

    if (!confirmed) {
      writeLog('INFO', 'link', 'Blocked by confirmation dialog', targetUrl.href)
      return { status: 'cancelled' }
    }
  }

  if (!settingsState.safety.confirmBeforeExternalUrlOpen) {
    await shell.openExternal(targetUrl.href)
    writeLog('INFO', 'link', 'Opened in default browser without trusted-link confirmation', targetUrl.href)
    return { status: 'opened' }
  }

  await shell.openExternal(targetUrl.href)
  writeLog('INFO', 'link', 'Opened in default browser', targetUrl.href)

  return { status: 'opened' }
}

async function postServerJson(routePath, payload) {
  if (!managedServerUrl) {
    return null
  }

  const response = await fetch(new URL(routePath, managedServerUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  })

  if (!response.ok) {
    throw new Error(`Server request failed: ${response.status} ${routePath}`)
  }

  return response.json()
}

async function getServerJson(routePath) {
  if (!managedServerUrl) {
    return null
  }

  const response = await fetch(new URL(routePath, managedServerUrl))

  if (!response.ok) {
    throw new Error(`Server request failed: ${response.status} ${routePath}`)
  }

  return response.json()
}

async function registerManagedClient(window) {
  if (!isManagedClient()) {
    return
  }

  const registration = {
    clientId: managedClientId,
    windowId: managedWindowId,
    pid: process.pid,
    filePath: pendingLaunchFilePath,
    version: app.getVersion(),
  }

  await postServerJson('/api/clients/register', registration)
  writeLog('INFO', 'server-client', 'registered', registration)

  if (commandPollTimer) {
    clearInterval(commandPollTimer)
  }

  commandPollTimer = setInterval(() => {
    void pollManagedServerCommands(window)
  }, 1000)

  void pollManagedServerCommands(window)
}

async function pollManagedServerCommands(window) {
  if (!isManagedClient() || !window || window.isDestroyed()) {
    return
  }

  const payload = await getServerJson(`/api/clients/${encodeURIComponent(managedClientId)}/commands`)
  const commands = Array.isArray(payload?.commands) ? payload.commands : []

  for (const command of commands) {
    await handleManagedServerCommand(window, command)
  }
}

async function handleManagedServerCommand(window, command) {
  if (!command || typeof command.type !== 'string') {
    return
  }

  writeLog('INFO', 'server-client', 'command', command)

  if (command.type === 'suspend') {
    pendingServerRequests.set(command.requestId, { type: 'suspend' })
    dispatchServerCommand(command)
    return
  }

  if (command.type === 'resume') {
    pendingServerRequests.set(command.requestId, { type: 'resume' })
    dispatchServerCommand(command)
  }
}

function serializeLogValue(value) {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}\n${value.stack ?? ''}`.trim()
  }

  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function writeLog(level, scope, ...parts) {
  const line = `[${new Date().toISOString()}] [${level}] [${scope}] ${parts
    .map(serializeLogValue)
    .join(' ')}\n`

  fs.mkdirSync(path.dirname(logFilePath), { recursive: true })
  fs.appendFileSync(logFilePath, line, 'utf8')
}

writeLog('INFO', 'main', 'Application bootstrap', { isDev, logFilePath })

async function readUtf8File(filePath) {
  const content = await fsPromises.readFile(filePath, 'utf8')

  return {
    path: filePath,
    content,
  }
}

function attachWindowLogging(mainWindow, initialLaunchFilePath = null) {
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    writeLog('ERROR', 'webContents', 'did-fail-load', {
      errorCode,
      errorDescription,
      validatedURL,
    })
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    writeLog('ERROR', 'webContents', 'render-process-gone', details)
  })

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    writeLog('INFO', 'renderer-console', { level, message, line, sourceId })
  })

  mainWindow.webContents.on('dom-ready', () => {
    writeLog('INFO', 'webContents', 'dom-ready', mainWindow.webContents.getURL())
  })

  mainWindow.webContents.on('did-finish-load', () => {
    writeLog('INFO', 'webContents', 'did-finish-load', mainWindow.webContents.getURL())

    if (initialLaunchFilePath) {
      dispatchOpenFileToWindow(mainWindow, initialLaunchFilePath)
      return
    }

    if (pendingLaunchFilePath) {
      const filePath = pendingLaunchFilePath
      pendingLaunchFilePath = null
      dispatchOpenFileToWindow(mainWindow, filePath)
    }
  })
}

function sendMenuAction(action) {
  const targetWindow = getEditorWindowForAiAction(BrowserWindow.getFocusedWindow())
    ?? BrowserWindow.getAllWindows().find((window) => isEditorWindow(window))

  if (!targetWindow) {
    writeLog('WARN', 'menu', 'No window available for action', action)
    return
  }

  writeLog('INFO', 'menu', 'Dispatch action', action)
  targetWindow.webContents.send('mdv:menu-action', action)
}

function createApplicationMenu() {
  const template = [
    ...(process.platform === 'darwin'
      ? [{ role: 'appMenu' }]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendMenuAction('open'),
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendMenuAction('save'),
        },
        {
          label: 'Save As',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => sendMenuAction('save-as'),
        },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => openSettingsWindow(BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]),
        },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'AI Chat',
          accelerator: 'CmdOrCtrl+I',
          click: () => openAiChatWindow(BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]),
        },
        { type: 'separator' },
        {
          label: 'Editor',
          accelerator: 'CmdOrCtrl+1',
          click: () => sendMenuAction('show-editor'),
        },
        {
          label: 'Rendered Preview',
          accelerator: 'CmdOrCtrl+2',
          click: () => sendMenuAction('show-preview'),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(initialLaunchFilePath = null) {
  const mainWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: '#fffaf4',
    autoHideMenuBar: true,
    icon: windowIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  attachWindowLogging(mainWindow, initialLaunchFilePath)
  mainWindow.on('closed', () => {
    if (settingsWindowOwnerEditorId === mainWindow.id) {
      settingsWindowOwnerEditorId = null
    }

    if (!getDefaultEditorWindow() && settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.close()
    }
  })
  managedMainWindow = mainWindow
  writeLog('INFO', 'main', 'BrowserWindow created')

  mainWindow.webContents.on('did-finish-load', () => {
    if (isManagedClient()) {
      void registerManagedClient(mainWindow)
    }
  })

  if (isDev) {
    loadRendererWindow(mainWindow, 'index.html')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
    return mainWindow
  }

  loadRendererWindow(mainWindow, 'index.html')
  return mainWindow
}

const hasSingleInstanceLock = isManagedClient() ? true : app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
}

ipcMain.handle('mdv:open-file', async () => {
  const window = BrowserWindow.getFocusedWindow()
  const result = await dialog.showOpenDialog(window ?? undefined, {
    properties: ['openFile'],
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })

  if (result.canceled || result.filePaths.length === 0) {
    writeLog('INFO', 'ipc', 'open-file cancelled')
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

ipcMain.handle('mdv:open-ai-chat', async (event) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender)
  return openAiChatWindow(sourceWindow)
})

ipcMain.handle('mdv:open-settings-window', async (event) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender)
  return openSettingsWindow(sourceWindow)
})

ipcMain.on('mdv:settings-bootstrap', (event) => {
  event.returnValue = {
    settings: settingsState,
    hasPersistedSettings,
    hasReadableSettings,
  }
})

ipcMain.handle('mdv:settings-get', async () => settingsState)

ipcMain.handle('mdv:settings-migrate-legacy-theme', async (_event, themeMode) => {
  if (hasPersistedSettings || settingsState.general.themeMode !== 'system') {
    return settingsState
  }

  if (themeMode !== 'light' && themeMode !== 'dark') {
    return settingsState
  }

  settingsState = sanitizeSettings(mergePlainObjects(settingsState, {
    general: {
      themeMode,
    },
  }))
  await persistSettings()
  broadcastSettingsChanged()
  return settingsState
})

ipcMain.handle('mdv:settings-update', async (_event, patch) => {
  settingsState = sanitizeSettings(mergePlainObjects(settingsState, isPlainObject(patch) ? patch : {}))
  await persistSettings()
  broadcastSettingsChanged()
  return settingsState
})

ipcMain.handle('mdv:settings-save-openai-api-key', async (_event, apiKey) => {
  const normalizedApiKey = normalizeSecret(apiKey)

  if (!normalizedApiKey) {
    throw new Error('OpenAI API key cannot be empty')
  }

  secretsState = sanitizeSecrets({
    ...secretsState,
    openaiApiKey: normalizedApiKey,
  })
  await persistSecrets()
  return getProviderStatus()
})

ipcMain.handle('mdv:settings-clear-openai-api-key', async () => {
  secretsState = sanitizeSecrets({
    ...secretsState,
    openaiApiKey: null,
  })
  await persistSecrets()
  return getProviderStatus()
})

ipcMain.handle('mdv:settings-provider-status', async () => getProviderStatus())

ipcMain.handle('mdv:ai-chat-get-context', async (event) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender)
  const editorWindow = getEditorWindowForAiAction(sourceWindow)
  return requestEditorWindowData(editorWindow, { type: 'get-context' })
})

ipcMain.handle('mdv:ai-chat-read-active-document', async (event) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender)
  const editorWindow = getEditorWindowForAiAction(sourceWindow)
  return requestEditorWindowData(editorWindow, {
    type: 'read',
    source: 'active:document',
  })
})

ipcMain.handle('mdv:ai-chat-read-active-selection', async (event) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender)
  const editorWindow = getEditorWindowForAiAction(sourceWindow)
  return requestEditorWindowData(editorWindow, {
    type: 'read',
    source: 'active:selection',
  })
})

ipcMain.handle('mdv:ai-chat-write-active-document', async (event, payload) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender)
  const editorWindow = getEditorWindowForAiAction(sourceWindow)
  return requestEditorWindowData(editorWindow, {
    type: 'write',
    destination: 'active:document',
    content: typeof payload?.content === 'string' ? payload.content : '',
  })
})

ipcMain.handle('mdv:ai-chat-write-active-selection', async (event, payload) => {
  if (!settingsState.ai.toolPermissions.writeActiveSelection) {
    throw new Error('Active selection write is disabled in settings')
  }

  const sourceWindow = BrowserWindow.fromWebContents(event.sender)
  const editorWindow = getEditorWindowForAiAction(sourceWindow)
  return requestEditorWindowData(editorWindow, {
    type: 'write',
    destination: 'active:selection',
    content: typeof payload?.content === 'string' ? payload.content : '',
  })
})

ipcMain.handle('mdv:ai-chat-send-message', async (_event, payload) => {
  writeLog('INFO', 'ai-chat', 'OpenAI chat request start', {
    messageCount: Array.isArray(payload?.messages) ? payload.messages.length : 0,
    model: settingsState.ai.openai.model,
  })

  const result = await requestOpenAiChatResponse(payload?.messages)
  writeLog('INFO', 'ai-chat', 'OpenAI chat request completed', {
    responseId: result.responseId,
    model: result.model,
  })
  return result
})

ipcMain.handle('mdv:open-external-link', async (event, href) => {
  if (typeof href !== 'string' || href.length === 0) {
    writeLog('WARN', 'ipc', 'open-external-link received invalid URL', href)
    return { status: 'blocked' }
  }

  const parentWindow = BrowserWindow.fromWebContents(event.sender)
  return openExternalLink(parentWindow, href)
})

ipcMain.handle('mdv:save-file', async (_event, payload) => {
  const content = typeof payload?.content === 'string' ? payload.content : ''
  const currentPath = typeof payload?.path === 'string' ? payload.path : ''
  const forceDialog = payload?.forceDialog === true

  let targetPath = currentPath

  if (!targetPath || forceDialog) {
    const window = BrowserWindow.getFocusedWindow()
    const result = await dialog.showSaveDialog(window ?? undefined, {
      defaultPath: currentPath || 'document.md',
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })

    if (result.canceled || !result.filePath) {
      writeLog('INFO', 'ipc', 'save-file cancelled')
      return null
    }

    targetPath = result.filePath
  }

  await fsPromises.writeFile(targetPath, content, 'utf8')
  writeLog('INFO', 'ipc', 'save-file wrote', targetPath)

  return {
    path: targetPath,
  }
})

ipcMain.on('mdv:log', (_event, payload) => {
  const level = typeof payload?.level === 'string' ? payload.level : 'INFO'
  const scope = typeof payload?.scope === 'string' ? payload.scope : 'renderer'
  const message = payload?.message ?? ''
  writeLog(level.toUpperCase(), scope, message)
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

app.on('web-contents-created', (_event, contents) => {
  contents.on('preload-error', (_preloadEvent, preloadPath, error) => {
    writeLog('ERROR', 'preload', preloadPath, error)
  })
})

process.on('uncaughtException', (error) => {
  writeLog('ERROR', 'process', 'uncaughtException', error)
})

process.on('unhandledRejection', (reason) => {
  writeLog('ERROR', 'process', 'unhandledRejection', reason)
})

app.on('second-instance', (_event, argv) => {
  const filePath = resolveLaunchFilePath(argv)
  const shouldOpenAdditionalWindow = Boolean(filePath) && !isManagedClient()

  if (shouldOpenAdditionalWindow) {
    const nextWindow = createWindow(filePath)
    focusWindow(nextWindow)
    return
  }

  const targetWindow = getDefaultEditorWindow()

  if (targetWindow) {
    focusWindow(targetWindow)
  }

  if (filePath) {
    queueOrDispatchOpenFile(filePath)
  }
})

app.whenReady().then(() => {
  writeLog('INFO', 'main', 'app.whenReady resolved')
  createApplicationMenu()
  const initialFilePath = pendingLaunchFilePath
  pendingLaunchFilePath = null
  createWindow(initialFilePath)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  writeLog('INFO', 'main', 'window-all-closed')
  if (commandPollTimer) {
    clearInterval(commandPollTimer)
    commandPollTimer = null
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})