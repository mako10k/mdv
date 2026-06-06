const path = require('node:path') as typeof import('node:path')

type LaunchRequest = {
  filePath?: string | null
  explicitInitialPanel?: string | null
}

type MenuMessages = {
  file: string
  newDocument: string
  open: string
  save: string
  saveAs: string
  settings: string
  view: string
  aiChat: string
  editor: string
  renderedPreview: string
  help: string
  about: string
}

type MainI18n = {
  menu: MenuMessages
}

type BrowserWindowLike = {
  id: number
  webContents: {
    send: (channel: string, payload?: unknown) => void
    on: (event: string, handler: (...args: unknown[]) => void) => void
    getURL: () => string
    isLoading: () => boolean
    openDevTools: (options: { mode: 'detach' }) => void
  }
  loadURL: (url: string) => void
  loadFile: (filePath: string) => void
  on: (event: string, handler: (...args: unknown[]) => void) => void
  once: (event: string, handler: (...args: unknown[]) => void) => void
  close: () => void
  show: () => void
  focus: () => void
  restore: () => void
  isDestroyed: () => boolean
  isVisible: () => boolean
  isMinimized: () => boolean
}

type BrowserWindowStatic = {
  new (options: Record<string, unknown>): BrowserWindowLike
  getAllWindows: () => BrowserWindowLike[]
  getFocusedWindow: () => BrowserWindowLike | null
  fromId: (id: number) => BrowserWindowLike | null
}

type MenuStatic = {
  setApplicationMenu: (menu: unknown) => void
  buildFromTemplate: (template: Array<Record<string, unknown>>) => unknown
}

type WindowStateMap = Map<number, LaunchRequest & { initialPanel?: string | null }>
type WindowTimerMap = Map<number, ReturnType<typeof setTimeout>>

type WindowControllerDependencies = {
  BrowserWindow: BrowserWindowStatic
  Menu: MenuStatic
  isDev: boolean
  windowIcon: string | null
  preloadPath: string
  rendererDistPath: string
  writeLog: (level: string, scope: string, ...parts: unknown[]) => void
  getMainI18n: () => MainI18n
  focusWindow: (window: BrowserWindowLike) => void
  approveWindowClose: (window: BrowserWindowLike) => void
  approvedWindowCloseIds: Set<number>
  pendingWindowCloseIds: Set<number>
  resolveInitialPanelForLaunch: (launchRequest: LaunchRequest | null | undefined) => string | null
  findEditorWindowByTrackedFilePath: (filePath: string) => BrowserWindowLike | null
  getPendingLaunchRequest: () => LaunchRequest | null
  setPendingLaunchRequest: (launchRequest: LaunchRequest | null) => void
  launchStateByWindowId: WindowStateMap
  hiddenLaunchRevealTimerByWindowId: WindowTimerMap
  emitDebugChannelEvent: (type: string, payload?: unknown) => void
  confirmEditorWindowClose: (window: BrowserWindowLike) => Promise<void>
  clearEditorRuntimeState: (windowId: number) => void
  isManagedClient: () => boolean
  registerManagedClient: (window: BrowserWindowLike) => Promise<void>
  setManagedMainWindow: (window: BrowserWindowLike) => void
}

type WindowOpenResult = {
  status: 'focused' | 'opened'
}

type WindowController = {
  attachWindowLogging: (mainWindow: BrowserWindowLike, initialLaunchRequest?: LaunchRequest | null) => void
  createApplicationMenu: () => void
  createWindow: (initialLaunchRequest?: LaunchRequest | null) => Promise<BrowserWindowLike>
  closeAuxiliaryWindowsForEditor: (editorWindow: BrowserWindowLike) => void
  dispatchOpenFileToWindow: (targetWindow: BrowserWindowLike | null | undefined, launchRequest: LaunchRequest | null | undefined) => void
  getAboutWindow: () => BrowserWindowLike | null
  getDefaultEditorWindow: () => BrowserWindowLike | null
  getEditorWindowForAiAction: (candidateWindow: BrowserWindowLike | null | undefined) => BrowserWindowLike | null
  getSettingsWindow: () => BrowserWindowLike | null
  handleEditorWindowClosed: (editorWindowId: number) => void
  isEditorWindow: (targetWindow: BrowserWindowLike | null | undefined) => boolean
  loadRendererWindow: (targetWindow: BrowserWindowLike, htmlFileName: string) => void
  openAboutWindow: (targetWindow: BrowserWindowLike | null | undefined) => WindowOpenResult
  openAiChatWindow: (targetWindow: BrowserWindowLike | null | undefined) => WindowOpenResult
  openFetchPermissionsWindow: (targetWindow: BrowserWindowLike | null | undefined) => WindowOpenResult
  openSettingsWindow: (targetWindow: BrowserWindowLike | null | undefined) => WindowOpenResult
  queueOrDispatchOpenFile: (launchRequest: LaunchRequest | null | undefined) => void
}

function createWindowController({
  BrowserWindow,
  Menu,
  isDev,
  windowIcon,
  preloadPath,
  rendererDistPath,
  writeLog,
  getMainI18n,
  focusWindow,
  approveWindowClose,
  approvedWindowCloseIds,
  pendingWindowCloseIds,
  resolveInitialPanelForLaunch,
  findEditorWindowByTrackedFilePath,
  getPendingLaunchRequest,
  setPendingLaunchRequest,
  launchStateByWindowId,
  hiddenLaunchRevealTimerByWindowId,
  emitDebugChannelEvent,
  confirmEditorWindowClose,
  clearEditorRuntimeState,
  isManagedClient,
  registerManagedClient,
  setManagedMainWindow,
}: WindowControllerDependencies): WindowController {
  let settingsWindow: BrowserWindowLike | null = null
  let settingsWindowOwnerEditorId: number | null = null
  let fetchPermissionsWindow: BrowserWindowLike | null = null
  let fetchPermissionsWindowOwnerEditorId: number | null = null
  let aboutWindow: BrowserWindowLike | null = null
  let aboutWindowOwnerEditorId: number | null = null

  function loadRendererWindow(targetWindow: BrowserWindowLike, htmlFileName: string) {
    if (isDev) {
      targetWindow.loadURL(`http://localhost:5173/${htmlFileName}`)
      return
    }

    targetWindow.loadFile(path.join(rendererDistPath, htmlFileName))
  }

  function isSettingsWindow(targetWindow: BrowserWindowLike | null | undefined) {
    return Boolean(settingsWindow?.id) && Boolean(targetWindow?.id) && settingsWindow?.id === targetWindow?.id
  }

  function isFetchPermissionsWindow(targetWindow: BrowserWindowLike | null | undefined) {
    return Boolean(fetchPermissionsWindow?.id) && Boolean(targetWindow?.id) && fetchPermissionsWindow?.id === targetWindow?.id
  }

  function isAboutWindow(targetWindow: BrowserWindowLike | null | undefined) {
    return Boolean(aboutWindow?.id) && Boolean(targetWindow?.id) && aboutWindow?.id === targetWindow?.id
  }

  function isEditorWindow(targetWindow: BrowserWindowLike | null | undefined) {
    return Boolean(targetWindow) && !isSettingsWindow(targetWindow) && !isFetchPermissionsWindow(targetWindow) && !isAboutWindow(targetWindow)
  }

  function getDefaultEditorWindow() {
    return BrowserWindow.getAllWindows().find((targetWindow) => isEditorWindow(targetWindow)) ?? null
  }

  function getEditorWindowForAiAction(candidateWindow: BrowserWindowLike | null | undefined) {
    if (!candidateWindow) {
      return getDefaultEditorWindow()
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

    if (isFetchPermissionsWindow(candidateWindow)) {
      if (fetchPermissionsWindowOwnerEditorId) {
        const ownerWindow = BrowserWindow.fromId(fetchPermissionsWindowOwnerEditorId)
        if (ownerWindow && !ownerWindow.isDestroyed()) {
          return ownerWindow
        }
      }

      return getDefaultEditorWindow()
    }

    if (isAboutWindow(candidateWindow)) {
      if (aboutWindowOwnerEditorId) {
        const ownerWindow = BrowserWindow.fromId(aboutWindowOwnerEditorId)
        if (ownerWindow && !ownerWindow.isDestroyed()) {
          return ownerWindow
        }
      }

      return getDefaultEditorWindow()
    }

    return candidateWindow
  }

  function sendMenuAction(action: string) {
    const targetWindow = getEditorWindowForAiAction(BrowserWindow.getFocusedWindow())
      ?? BrowserWindow.getAllWindows().find((targetWindow) => isEditorWindow(targetWindow))

    if (!targetWindow) {
      writeLog('WARN', 'menu', 'No window available for action', action)
      return
    }

    writeLog('INFO', 'menu', 'Dispatch action', action)
    targetWindow.webContents.send('mdv:menu-action', action)
  }

  function openAiChatWindow(targetWindow: BrowserWindowLike | null | undefined): WindowOpenResult {
    const editorWindow = getEditorWindowForAiAction(targetWindow)

    if (!editorWindow || editorWindow.isDestroyed()) {
      writeLog('WARN', 'ai-chat', 'No editor window available')
      return { status: 'focused' }
    }

    focusWindow(editorWindow)
    editorWindow.webContents.send('mdv:menu-action', 'open-ai-chat')
    writeLog('INFO', 'ai-chat', 'Assistant dock requested', { editorWindowId: editorWindow.id })

    return { status: 'opened' }
  }

  function createAuxiliaryWindow(options: Record<string, unknown>) {
    return new BrowserWindow({
      ...options,
      backgroundColor: '#fffaf4',
      autoHideMenuBar: true,
      icon: windowIcon,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
  }

  function openSettingsWindow(targetWindow: BrowserWindowLike | null | undefined): WindowOpenResult {
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

    settingsWindow = createAuxiliaryWindow({
      width: 960,
      height: 720,
      minWidth: 760,
      minHeight: 560,
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

  function openFetchPermissionsWindow(targetWindow: BrowserWindowLike | null | undefined): WindowOpenResult {
    const ownerEditorWindow = getEditorWindowForAiAction(targetWindow)

    if (!ownerEditorWindow && (!fetchPermissionsWindow || fetchPermissionsWindow.isDestroyed())) {
      writeLog('WARN', 'fetch-permissions', 'No editor window available for fetch permissions owner')
      return { status: 'focused' }
    }

    if (ownerEditorWindow && !ownerEditorWindow.isDestroyed()) {
      fetchPermissionsWindowOwnerEditorId = ownerEditorWindow.id
    }

    if (fetchPermissionsWindow && !fetchPermissionsWindow.isDestroyed()) {
      focusWindow(fetchPermissionsWindow)
      return { status: 'focused' }
    }

    fetchPermissionsWindow = createAuxiliaryWindow({
      width: 920,
      height: 760,
      minWidth: 760,
      minHeight: 560,
    })

    fetchPermissionsWindow.on('closed', () => {
      fetchPermissionsWindow = null
      fetchPermissionsWindowOwnerEditorId = null
    })

    loadRendererWindow(fetchPermissionsWindow, 'fetch-permissions.html')
    focusWindow(fetchPermissionsWindow)
    writeLog('INFO', 'fetch-permissions', 'Fetch permissions window opened')

    return { status: 'opened' }
  }

  function openAboutWindow(targetWindow: BrowserWindowLike | null | undefined): WindowOpenResult {
    const ownerEditorWindow = getEditorWindowForAiAction(targetWindow)

    if (!ownerEditorWindow && (!aboutWindow || aboutWindow.isDestroyed())) {
      writeLog('WARN', 'about', 'No editor window available for about owner')
      return { status: 'focused' }
    }

    if (ownerEditorWindow && !ownerEditorWindow.isDestroyed()) {
      aboutWindowOwnerEditorId = ownerEditorWindow.id
    }

    if (aboutWindow && !aboutWindow.isDestroyed()) {
      focusWindow(aboutWindow)
      return { status: 'focused' }
    }

    aboutWindow = createAuxiliaryWindow({
      width: 720,
      height: 640,
      minWidth: 620,
      minHeight: 520,
    })

    aboutWindow.on('closed', () => {
      aboutWindow = null
      aboutWindowOwnerEditorId = null
    })

    loadRendererWindow(aboutWindow, 'about.html')
    focusWindow(aboutWindow)
    writeLog('INFO', 'about', 'About window opened')

    return { status: 'opened' }
  }

  function closeAuxiliaryWindowsForEditor(editorWindow: BrowserWindowLike) {
    if (settingsWindowOwnerEditorId === editorWindow.id && settingsWindow && !settingsWindow.isDestroyed()) {
      approveWindowClose(settingsWindow)
      settingsWindow.close()
    }

    if (fetchPermissionsWindowOwnerEditorId === editorWindow.id && fetchPermissionsWindow && !fetchPermissionsWindow.isDestroyed()) {
      approveWindowClose(fetchPermissionsWindow)
      fetchPermissionsWindow.close()
    }
  }

  function handleEditorWindowClosed(editorWindowId: number) {
    if (settingsWindowOwnerEditorId === editorWindowId) {
      settingsWindowOwnerEditorId = null
    }

    if (fetchPermissionsWindowOwnerEditorId === editorWindowId) {
      fetchPermissionsWindowOwnerEditorId = null
    }

    if (aboutWindowOwnerEditorId === editorWindowId) {
      aboutWindowOwnerEditorId = null
    }

    if (getDefaultEditorWindow()) {
      return
    }

    for (const auxiliaryWindow of [settingsWindow, fetchPermissionsWindow, aboutWindow]) {
      if (!auxiliaryWindow || auxiliaryWindow.isDestroyed()) {
        continue
      }

      approveWindowClose(auxiliaryWindow)
      auxiliaryWindow.close()
    }
  }

  function createApplicationMenu() {
    const messages = getMainI18n().menu
    const template: Array<Record<string, unknown>> = [
      ...(process.platform === 'darwin'
        ? [{ role: 'appMenu' }]
        : []),
      {
        label: messages.file,
        submenu: [
          {
            label: messages.newDocument,
            accelerator: 'CmdOrCtrl+N',
            click: () => sendMenuAction('new-document'),
          },
          { type: 'separator' },
          {
            label: messages.open,
            accelerator: 'CmdOrCtrl+O',
            click: () => sendMenuAction('open'),
          },
          {
            label: messages.save,
            accelerator: 'CmdOrCtrl+S',
            click: () => sendMenuAction('save'),
          },
          {
            label: messages.saveAs,
            accelerator: 'CmdOrCtrl+Shift+S',
            click: () => sendMenuAction('save-as'),
          },
          { type: 'separator' },
          {
            label: messages.settings,
            accelerator: 'CmdOrCtrl+,',
            click: () => openSettingsWindow(BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null),
          },
          { type: 'separator' },
          process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
        ],
      },
      {
        label: messages.view,
        submenu: [
          {
            label: messages.aiChat,
            accelerator: 'CmdOrCtrl+I',
            click: () => openAiChatWindow(BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null),
          },
          { type: 'separator' },
          {
            label: messages.editor,
            accelerator: 'CmdOrCtrl+1',
            click: () => sendMenuAction('show-editor'),
          },
          {
            label: messages.renderedPreview,
            accelerator: 'CmdOrCtrl+2',
            click: () => sendMenuAction('show-preview'),
          },
          { type: 'separator' },
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
        ],
      },
      {
        label: messages.help,
        submenu: [
          {
            label: messages.about,
            click: () => openAboutWindow(BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null),
          },
        ],
      },
    ]

    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }

  function dispatchOpenFileToWindow(targetWindow: BrowserWindowLike | null | undefined, launchRequest: LaunchRequest | null | undefined) {
    if (!targetWindow || (!launchRequest?.filePath && !launchRequest?.explicitInitialPanel)) {
      return
    }

    const resolvedLaunchRequest = {
      filePath: launchRequest.filePath || null,
      initialPanel: resolveInitialPanelForLaunch(launchRequest),
      isInitialLaunch: !targetWindow.isVisible() && Boolean(launchRequest.filePath),
    }

    writeLog('INFO', 'main', 'Dispatch launch/open file request', resolvedLaunchRequest)
    targetWindow.webContents.send('mdv:open-file-requested', resolvedLaunchRequest)
  }

  function queueOrDispatchOpenFile(launchRequest: LaunchRequest | null | undefined) {
    if (!launchRequest?.filePath && !launchRequest?.explicitInitialPanel) {
      return
    }

    const existingWindow = launchRequest.filePath ? findEditorWindowByTrackedFilePath(launchRequest.filePath) : null

    if (existingWindow) {
      writeLog('INFO', 'main', 'Focused existing editor for launch/open file request', {
        filePath: launchRequest.filePath,
        windowId: existingWindow.id,
      })
      focusWindow(existingWindow)
      return
    }

    const targetWindow = getDefaultEditorWindow()

    if (!targetWindow || targetWindow.webContents.isLoading()) {
      setPendingLaunchRequest(launchRequest)
      writeLog('INFO', 'main', 'Queued launch file path', launchRequest)
      return
    }

    dispatchOpenFileToWindow(targetWindow, launchRequest)
  }

  function attachWindowLogging(mainWindow: BrowserWindowLike, initialLaunchRequest: LaunchRequest | null = null) {
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

      if (initialLaunchRequest?.filePath || initialLaunchRequest?.explicitInitialPanel) {
        dispatchOpenFileToWindow(mainWindow, initialLaunchRequest)
        return
      }

      const pendingLaunchRequest = getPendingLaunchRequest()
      if (pendingLaunchRequest?.filePath || pendingLaunchRequest?.explicitInitialPanel) {
        setPendingLaunchRequest(null)
        dispatchOpenFileToWindow(mainWindow, pendingLaunchRequest)
      }
    })
  }

  async function createWindow(initialLaunchRequest: LaunchRequest | null = null) {
    const mainWindow = new BrowserWindow({
      width: 1600,
      height: 980,
      minWidth: 1200,
      minHeight: 760,
      show: !Boolean(initialLaunchRequest?.filePath),
      backgroundColor: '#fffaf4',
      autoHideMenuBar: true,
      icon: windowIcon,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    emitDebugChannelEvent('window:created', {
      windowId: mainWindow.id,
      hiddenForLaunch: Boolean(initialLaunchRequest?.filePath),
    })

    launchStateByWindowId.set(mainWindow.id, {
      filePath: initialLaunchRequest?.filePath || null,
      initialPanel: resolveInitialPanelForLaunch(initialLaunchRequest),
    })

    mainWindow.on('close', (...args: unknown[]) => {
      const event = args[0] as { preventDefault: () => void }
      if (approvedWindowCloseIds.delete(mainWindow.id)) {
        return
      }

      event.preventDefault()

      if (pendingWindowCloseIds.has(mainWindow.id)) {
        return
      }

      pendingWindowCloseIds.add(mainWindow.id)
      void confirmEditorWindowClose(mainWindow)
        .catch((error) => {
          writeLog('ERROR', 'main', 'Editor window close confirmation failed', error instanceof Error ? error.message : String(error))
        })
        .finally(() => {
          pendingWindowCloseIds.delete(mainWindow.id)
        })
    })

    attachWindowLogging(mainWindow, initialLaunchRequest)

    if (initialLaunchRequest?.filePath) {
      const revealTimer = setTimeout(() => {
        hiddenLaunchRevealTimerByWindowId.delete(mainWindow.id)

        if (mainWindow.isDestroyed() || mainWindow.isVisible()) {
          return
        }

        writeLog('WARN', 'main', 'Revealing hidden launch window after startup timeout', initialLaunchRequest.filePath)
        mainWindow.show()
        focusWindow(mainWindow)
      }, 1500)

      hiddenLaunchRevealTimerByWindowId.set(mainWindow.id, revealTimer)
    }

    mainWindow.on('closed', () => {
      emitDebugChannelEvent('window:closed', { windowId: mainWindow.id })
      const revealTimer = hiddenLaunchRevealTimerByWindowId.get(mainWindow.id)
      if (revealTimer) {
        clearTimeout(revealTimer)
        hiddenLaunchRevealTimerByWindowId.delete(mainWindow.id)
      }

      approvedWindowCloseIds.delete(mainWindow.id)
      pendingWindowCloseIds.delete(mainWindow.id)
      launchStateByWindowId.delete(mainWindow.id)
      clearEditorRuntimeState(mainWindow.id)
      handleEditorWindowClosed(mainWindow.id)
    })

    setManagedMainWindow(mainWindow)
    writeLog('INFO', 'main', 'BrowserWindow created')

    mainWindow.once('ready-to-show', () => {
      emitDebugChannelEvent('window:ready-to-show', { windowId: mainWindow.id })
    })

    mainWindow.webContents.on('did-finish-load', () => {
      emitDebugChannelEvent('window:did-finish-load', {
        windowId: mainWindow.id,
        url: mainWindow.webContents.getURL(),
      })

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

  return {
    attachWindowLogging,
    createApplicationMenu,
    createWindow,
    closeAuxiliaryWindowsForEditor,
    dispatchOpenFileToWindow,
    getAboutWindow: () => aboutWindow,
    getDefaultEditorWindow,
    getEditorWindowForAiAction,
    getSettingsWindow: () => settingsWindow,
    handleEditorWindowClosed,
    isEditorWindow,
    loadRendererWindow,
    openAboutWindow,
    openAiChatWindow,
    openFetchPermissionsWindow,
    openSettingsWindow,
    queueOrDispatchOpenFile,
  }
}

module.exports = {
  createWindowController,
}
