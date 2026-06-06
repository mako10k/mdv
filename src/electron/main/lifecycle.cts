// @ts-nocheck
function registerAppLifecycle(options) {
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
      }).catch((error) => {
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
    void createWindow(initialLaunchRequest).catch((error) => {
      writeLog('ERROR', 'main', 'Failed to create initial window', error instanceof Error ? error.message : String(error))
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow().catch((error) => {
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
