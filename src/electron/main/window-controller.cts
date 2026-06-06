// @ts-nocheck
const path = require('node:path')

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
  resolveInitialPanelForLaunch,
  findEditorWindowByTrackedFilePath,
  getPendingLaunchRequest,
  setPendingLaunchRequest,
}) {
  let settingsWindow = null
  let settingsWindowOwnerEditorId = null
  let fetchPermissionsWindow = null
  let fetchPermissionsWindowOwnerEditorId = null
  let aboutWindow = null
  let aboutWindowOwnerEditorId = null

  function loadRendererWindow(targetWindow, htmlFileName) {
    if (isDev) {
      targetWindow.loadURL(`http://localhost:5173/${htmlFileName}`)
      return
    }

    targetWindow.loadFile(path.join(rendererDistPath, htmlFileName))
  }

  function isSettingsWindow(targetWindow) {
    return Boolean(settingsWindow) && Boolean(targetWindow) && settingsWindow.id === targetWindow.id
  }

  function isFetchPermissionsWindow(targetWindow) {
    return Boolean(fetchPermissionsWindow) && Boolean(targetWindow) && fetchPermissionsWindow.id === targetWindow.id
  }

  function isAboutWindow(targetWindow) {
    return Boolean(aboutWindow) && Boolean(targetWindow) && aboutWindow.id === targetWindow.id
  }

  function isEditorWindow(targetWindow) {
    return Boolean(targetWindow) && !isSettingsWindow(targetWindow) && !isFetchPermissionsWindow(targetWindow) && !isAboutWindow(targetWindow)
  }

  function getDefaultEditorWindow() {
    return BrowserWindow.getAllWindows().find((targetWindow) => isEditorWindow(targetWindow)) ?? null
  }

  function getEditorWindowForAiAction(candidateWindow) {
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

  function sendMenuAction(action) {
    const targetWindow = getEditorWindowForAiAction(BrowserWindow.getFocusedWindow())
      ?? BrowserWindow.getAllWindows().find((targetWindow) => isEditorWindow(targetWindow))

    if (!targetWindow) {
      writeLog('WARN', 'menu', 'No window available for action', action)
      return
    }

    writeLog('INFO', 'menu', 'Dispatch action', action)
    targetWindow.webContents.send('mdv:menu-action', action)
  }

  function openAiChatWindow(targetWindow) {
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

  function createAuxiliaryWindow(options) {
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

  function openFetchPermissionsWindow(targetWindow) {
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

  function openAboutWindow(targetWindow) {
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

  function closeAuxiliaryWindowsForEditor(editorWindow) {
    if (settingsWindowOwnerEditorId === editorWindow.id && settingsWindow && !settingsWindow.isDestroyed()) {
      approveWindowClose(settingsWindow)
      settingsWindow.close()
    }

    if (fetchPermissionsWindowOwnerEditorId === editorWindow.id && fetchPermissionsWindow && !fetchPermissionsWindow.isDestroyed()) {
      approveWindowClose(fetchPermissionsWindow)
      fetchPermissionsWindow.close()
    }
  }

  function handleEditorWindowClosed(editorWindowId) {
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
    const template = [
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
            click: () => openSettingsWindow(BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]),
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
            click: () => openAiChatWindow(BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]),
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
            click: () => openAboutWindow(BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]),
          },
        ],
      },
    ]

    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }

  function dispatchOpenFileToWindow(targetWindow, launchRequest) {
    if (!targetWindow || (!launchRequest?.filePath && !launchRequest?.explicitInitialPanel)) {
      return
    }

    const resolvedLaunchRequest = {
      filePath: launchRequest?.filePath || null,
      initialPanel: resolveInitialPanelForLaunch(launchRequest),
      isInitialLaunch: !targetWindow.isVisible() && Boolean(launchRequest?.filePath),
    }

    writeLog('INFO', 'main', 'Dispatch launch/open file request', resolvedLaunchRequest)
    targetWindow.webContents.send('mdv:open-file-requested', resolvedLaunchRequest)
  }

  function queueOrDispatchOpenFile(launchRequest) {
    if (!launchRequest?.filePath && !launchRequest?.explicitInitialPanel) {
      return
    }

    const existingWindow = launchRequest?.filePath ? findEditorWindowByTrackedFilePath(launchRequest.filePath) : null

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

  function attachWindowLogging(mainWindow, initialLaunchRequest = null) {
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

  return {
    attachWindowLogging,
    createApplicationMenu,
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
