type BrowserWindowLike = {
  id: number
}

type WebContentsLike = {
  on: (event: 'preload-error', handler: (event: unknown, preloadPath: string, error: unknown) => void) => void
}

type BrowserWindowStatic = {
  getAllWindows: () => BrowserWindowLike[]
}

type LaunchRequest = {
  filePath?: string | null
  explicitInitialPanel?: string | null
}

type AppLike = {
  on: {
    (event: 'web-contents-created', handler: (event: unknown, contents: WebContentsLike) => void): void
    (event: 'second-instance', handler: (event: unknown, argv: string[]) => void): void
    (event: 'activate', handler: () => void): void
    (event: 'window-all-closed', handler: () => void): void
  }
  whenReady: () => Promise<void>
  quit: () => void
}

type ProcessLike = {
  platform: string
  on: {
    (event: 'uncaughtException', handler: (error: unknown) => void): void
    (event: 'unhandledRejection', handler: (reason: unknown) => void): void
  }
}

type LifecycleOptions = {
  app: AppLike
  BrowserWindow: BrowserWindowStatic
  writeLog: (level: string, scope: string, ...parts: unknown[]) => void
  processRef: ProcessLike
  resolveLaunchRequest: (argv: string[]) => LaunchRequest
  findEditorWindowByTrackedFilePath: (filePath: string) => BrowserWindowLike | null
  focusWindow: (window: BrowserWindowLike) => void
  isManagedClient: () => boolean
  createWindow: (launchRequest?: LaunchRequest | null) => Promise<BrowserWindowLike>
  getDefaultEditorWindow: () => BrowserWindowLike | null
  queueOrDispatchOpenFile: (launchRequest: LaunchRequest) => void
  startDebugChannelServer: () => void
  emitDebugChannelEvent: (type: string, payload?: unknown) => void
  initializeAutoUpdater: () => void
  createApplicationMenu: () => void
  getPendingLaunchRequest: () => LaunchRequest | null
  clearPendingLaunchRequest: () => void
  stopDebugChannelServer: () => void
  flushAutosaveRecoveryStoreSync: () => void
  clearCommandPollTimer: () => void
  isDev: boolean
  forceStaticRenderer: boolean
}

function registerAppLifecycle(options: LifecycleOptions) {
  const {
    app,
    BrowserWindow,
    writeLog,
    processRef,
    resolveLaunchRequest,
    findEditorWindowByTrackedFilePath,
    focusWindow,
    isManagedClient,
    createWindow,
    getDefaultEditorWindow,
    queueOrDispatchOpenFile,
    startDebugChannelServer,
    emitDebugChannelEvent,
    initializeAutoUpdater,
    createApplicationMenu,
    getPendingLaunchRequest,
    clearPendingLaunchRequest,
    stopDebugChannelServer,
    flushAutosaveRecoveryStoreSync,
    clearCommandPollTimer,
    isDev,
    forceStaticRenderer,
  } = options

  app.on('web-contents-created', (_event, contents) => {
    contents.on('preload-error', (_preloadEvent, preloadPath, error) => {
      writeLog('ERROR', 'preload', preloadPath, error)
    })
  })

  processRef.on('uncaughtException', (error) => {
    writeLog('ERROR', 'process', 'uncaughtException', error)
  })

  processRef.on('unhandledRejection', (reason) => {
    writeLog('ERROR', 'process', 'unhandledRejection', reason)
  })

  app.on('second-instance', (_event, argv) => {
    const launchRequest = resolveLaunchRequest(argv)
    const existingWindow = launchRequest.filePath ? findEditorWindowByTrackedFilePath(launchRequest.filePath) : null

    if (existingWindow) {
      writeLog('INFO', 'main', 'Focused existing editor for second-instance file open', {
        filePath: launchRequest.filePath,
        windowId: existingWindow.id,
      })
      focusWindow(existingWindow)
      return
    }

    const shouldOpenAdditionalWindow = Boolean(launchRequest.filePath) && !isManagedClient()

    if (shouldOpenAdditionalWindow) {
      void createWindow(launchRequest).then((nextWindow) => {
        focusWindow(nextWindow)
      }).catch((error: unknown) => {
        writeLog('ERROR', 'main', 'Failed to create additional window', error instanceof Error ? error.message : String(error))
      })
      return
    }

    const targetWindow = getDefaultEditorWindow()

    if (targetWindow) {
      focusWindow(targetWindow)
    }

    if (launchRequest.filePath || launchRequest.explicitInitialPanel) {
      queueOrDispatchOpenFile(launchRequest)
    }
  })

  app.whenReady().then(() => {
    writeLog('INFO', 'main', 'app.whenReady resolved')
    startDebugChannelServer()
    emitDebugChannelEvent('app:ready', {
      isDev,
      forceStaticRenderer,
      platform: processRef.platform,
    })
    initializeAutoUpdater()
    createApplicationMenu()
    const initialLaunchRequest = getPendingLaunchRequest()
    clearPendingLaunchRequest()
    void createWindow(initialLaunchRequest).catch((error: unknown) => {
      writeLog('ERROR', 'main', 'Failed to create initial window', error instanceof Error ? error.message : String(error))
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow().catch((error: unknown) => {
          writeLog('ERROR', 'main', 'Failed to recreate window on activate', error instanceof Error ? error.message : String(error))
        })
      }
    })
  })

  app.on('window-all-closed', () => {
    writeLog('INFO', 'main', 'window-all-closed')
    stopDebugChannelServer()
    flushAutosaveRecoveryStoreSync()
    clearCommandPollTimer()
    if (processRef.platform !== 'darwin') {
      app.quit()
    }
  })
}

export {
  registerAppLifecycle,
}
