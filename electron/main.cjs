const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron')
const fs = require('node:fs')
const fsPromises = require('node:fs/promises')
const path = require('node:path')

const isDev = !app.isPackaged
const windowIcon = path.join(__dirname, '..', 'build', 'icon.png')
const allowedLinkRulesPath = path.join(app.getPath('userData'), 'allowed-link-rules.json')
const managedServerUrl = process.env.MDV_SERVER_URL || null
const managedClientId = process.env.MDV_CLIENT_ID || null
const managedWindowId = process.env.MDV_WINDOW_ID || managedClientId || null
const appDisplayName = 'MarkDownViewer'

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
const aiChatWindows = new Map()

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

function loadRendererWindow(window, htmlFileName) {
  if (isDev) {
    window.loadURL(`http://localhost:5173/${htmlFileName}`)
    return
  }

  window.loadFile(path.join(__dirname, '..', 'dist', htmlFileName))
}

function getEditorWindowForAiAction(candidateWindow) {
  if (!candidateWindow) {
    const firstEditorWindow = BrowserWindow.getAllWindows().find((window) => !aiChatWindows.has(window.id))
    return firstEditorWindow ?? null
  }

  if (aiChatWindows.has(candidateWindow.id)) {
    const ownerWindowId = aiChatWindows.get(candidateWindow.id)
    return BrowserWindow.fromId(ownerWindowId) ?? null
  }

  return candidateWindow
}

function openAiChatWindow(targetWindow) {
  const editorWindow = getEditorWindowForAiAction(targetWindow)

  if (!editorWindow || editorWindow.isDestroyed()) {
    writeLog('WARN', 'ai-chat', 'No editor window available')
    return { status: 'focused' }
  }

  const existingChatWindowId = aiChatWindows.get(editorWindow.id)
  const existingChatWindow = existingChatWindowId ? BrowserWindow.fromId(existingChatWindowId) : null

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

  aiChatWindows.set(editorWindow.id, chatWindow.id)
  aiChatWindows.set(chatWindow.id, editorWindow.id)

  chatWindow.on('closed', () => {
    aiChatWindows.delete(chatWindow.id)
    aiChatWindows.delete(editorWindow.id)
  })

  loadRendererWindow(chatWindow, 'chat.html')
  focusWindow(chatWindow)
  writeLog('INFO', 'ai-chat', 'BrowserWindow created', { editorWindowId: editorWindow.id, chatWindowId: chatWindow.id })

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

  const targetWindow = BrowserWindow.getAllWindows()[0]

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

  if (!isUrlAllowed(targetUrl)) {
    const confirmed = await confirmExternalNavigation(parentWindow, targetUrl)

    if (!confirmed) {
      writeLog('INFO', 'link', 'Blocked by confirmation dialog', targetUrl.href)
      return { status: 'cancelled' }
    }
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
  const targetWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]

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

  const targetWindow = BrowserWindow.getAllWindows()[0]

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