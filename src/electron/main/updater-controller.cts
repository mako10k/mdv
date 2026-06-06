// @ts-nocheck
const fs = require('node:fs')
const path = require('node:path')

function createUpdaterController(options) {
  const {
    app,
    autoUpdater,
    processRef,
    writeLog,
    showMessageBox,
    getMainI18n,
    getDefaultEditorWindow,
    getSettingsWindow,
    getAboutWindow,
    getSettingsState,
    broadcastUpdaterStateChanged,
  } = options

  let updaterCheckInFlight = null
  let updaterDownloadInFlight = null
  let updaterConfiguredFeedUrl = null
  let updaterAvailabilityPromptOpen = false
  let updaterDownloadedPromptOpen = false
  const updaterState = {
    supported: false,
    enabled: false,
    configured: false,
    feedUrl: null,
    status: 'idle',
    currentVersion: app.getVersion(),
    availableVersion: null,
    downloadedVersion: null,
    checkedAt: null,
    progressPercent: null,
    error: null,
  }

  function isPortableRuntime() {
    return Boolean(processRef.env.PORTABLE_EXECUTABLE_FILE || processRef.env.PORTABLE_EXECUTABLE_DIR)
  }

  function hasNsisInstallMarker() {
    try {
      const executableDir = path.dirname(processRef.execPath)
      const fileNames = fs.readdirSync(executableDir)
      return fileNames.some((fileName) => /^Uninstall .*\.exe$/i.test(fileName))
    } catch {
      return false
    }
  }

  function hasUpdaterConfigFile() {
    try {
      return fs.existsSync(path.join(processRef.resourcesPath, 'app-update.yml'))
    } catch {
      return false
    }
  }

  function isInstalledWindowsReleaseRuntime() {
    return processRef.platform === 'win32'
      && app.isPackaged
      && !isPortableRuntime()
      && hasNsisInstallMarker()
  }

  function getAutoUpdaterSetupError() {
    if (!isInstalledWindowsReleaseRuntime() || hasUpdaterConfigFile()) {
      return null
    }

    return getMainI18n().updater.invalidInstallMessage(path.join(processRef.resourcesPath, 'app-update.yml'))
  }

  function isAutoUpdateSupported() {
    return isInstalledWindowsReleaseRuntime()
  }

  function getUpdaterDialogParentWindow() {
    const aboutWindow = getAboutWindow()
    if (aboutWindow && !aboutWindow.isDestroyed()) {
      return aboutWindow
    }

    const settingsWindow = getSettingsWindow()
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      return settingsWindow
    }

    return getDefaultEditorWindow()
  }

  function getUpdaterStateSnapshot() {
    const settingsState = getSettingsState()

    return {
      ...updaterState,
      supported: isAutoUpdateSupported(),
      enabled: settingsState.updates?.enabled !== false,
      configured: typeof settingsState.updates?.feedUrl === 'string' && settingsState.updates.feedUrl.length > 0,
      feedUrl: settingsState.updates?.feedUrl ?? null,
      currentVersion: app.getVersion(),
    }
  }

  function setUpdaterState(patch) {
    Object.assign(updaterState, patch)
    broadcastUpdaterStateChanged(getUpdaterStateSnapshot())
  }

  function configureAutoUpdaterFeed() {
    const settingsState = getSettingsState()

    if (!isAutoUpdateSupported()) {
      setUpdaterState({
        status: 'unsupported',
        availableVersion: null,
        downloadedVersion: null,
        progressPercent: null,
        error: null,
      })
      return false
    }

    const setupError = getAutoUpdaterSetupError()

    if (setupError) {
      writeLog('ERROR', 'updater', 'Broken installer auto-update setup', setupError)
      setUpdaterState({
        status: 'error',
        availableVersion: null,
        downloadedVersion: null,
        progressPercent: null,
        error: setupError,
      })
      return false
    }

    if (settingsState.updates?.enabled === false) {
      setUpdaterState({
        status: 'disabled',
        availableVersion: null,
        downloadedVersion: null,
        progressPercent: null,
        error: null,
      })
      return false
    }

    const feedUrl = settingsState.updates?.feedUrl ?? null

    if (!feedUrl) {
      setUpdaterState({
        status: 'unconfigured',
        availableVersion: null,
        downloadedVersion: null,
        progressPercent: null,
        error: null,
      })
      return false
    }

    if (updaterConfiguredFeedUrl !== feedUrl) {
      autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl })
      updaterConfiguredFeedUrl = feedUrl
    }

    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    setUpdaterState({ error: null })
    return true
  }

  async function promptToDownloadUpdate(version) {
    if (updaterAvailabilityPromptOpen) {
      return
    }

    updaterAvailabilityPromptOpen = true

    try {
      const messages = getMainI18n()
      const response = await showMessageBox(getUpdaterDialogParentWindow(), {
        type: 'info',
        title: messages.updater.availableTitle,
        message: messages.updater.availableMessage(version),
        detail: messages.updater.availableDetail,
        buttons: [messages.updater.downloadNow, messages.updater.later],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })

      if (response.response === 0) {
        await downloadAvailableUpdate()
      }
    } finally {
      updaterAvailabilityPromptOpen = false
    }
  }

  async function promptToInstallDownloadedUpdate(version) {
    if (updaterDownloadedPromptOpen) {
      return
    }

    updaterDownloadedPromptOpen = true

    try {
      const messages = getMainI18n()
      const response = await showMessageBox(getUpdaterDialogParentWindow(), {
        type: 'info',
        title: messages.updater.downloadedTitle,
        message: messages.updater.downloadedMessage(version),
        detail: messages.updater.downloadedDetail,
        buttons: [messages.updater.restartNow, messages.updater.later],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })

      if (response.response === 0) {
        installDownloadedUpdate()
      }
    } finally {
      updaterDownloadedPromptOpen = false
    }
  }

  async function checkForAppUpdates(optionsArg = {}) {
    if (!configureAutoUpdaterFeed()) {
      const snapshot = getUpdaterStateSnapshot()

      if (optionsArg.silent !== true && snapshot.status === 'error' && snapshot.error) {
        const messages = getMainI18n()
        void showMessageBox(getUpdaterDialogParentWindow(), {
          type: 'error',
          title: messages.updater.checkFailedTitle,
          message: snapshot.error,
          buttons: [messages.buttons.close],
          defaultId: 0,
          noLink: true,
        })
      }

      return snapshot
    }

    if (updaterCheckInFlight) {
      return updaterCheckInFlight
    }

    setUpdaterState({
      status: 'checking',
      checkedAt: new Date().toISOString(),
      progressPercent: null,
      error: null,
    })

    updaterCheckInFlight = autoUpdater.checkForUpdates()
      .then(() => getUpdaterStateSnapshot())
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        setUpdaterState({ status: 'error', error: message, progressPercent: null })

        if (optionsArg.silent !== true) {
          const messages = getMainI18n()
          void showMessageBox(getUpdaterDialogParentWindow(), {
            type: 'error',
            title: messages.updater.checkFailedTitle,
            message,
            buttons: [messages.buttons.close],
            defaultId: 0,
            noLink: true,
          })
        }

        return getUpdaterStateSnapshot()
      })
      .finally(() => {
        updaterCheckInFlight = null
      })

    return updaterCheckInFlight
  }

  async function downloadAvailableUpdate() {
    if (!configureAutoUpdaterFeed()) {
      return getUpdaterStateSnapshot()
    }

    if (updaterDownloadInFlight) {
      return updaterDownloadInFlight
    }

    setUpdaterState({ status: 'downloading', progressPercent: 0, error: null })
    updaterDownloadInFlight = autoUpdater.downloadUpdate()
      .then(() => getUpdaterStateSnapshot())
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        setUpdaterState({ status: 'error', error: message, progressPercent: null })
        return getUpdaterStateSnapshot()
      })
      .finally(() => {
        updaterDownloadInFlight = null
      })

    return updaterDownloadInFlight
  }

  function installDownloadedUpdate() {
    if (updaterState.status !== 'downloaded') {
      return false
    }

    writeLog('INFO', 'updater', 'Installing downloaded update')
    autoUpdater.quitAndInstall(false, true)
    return true
  }

  function initializeAutoUpdater() {
    autoUpdater.on('checking-for-update', () => {
      setUpdaterState({ status: 'checking', checkedAt: new Date().toISOString(), error: null })
    })

    autoUpdater.on('update-available', (info) => {
      const version = typeof info?.version === 'string' && info.version.length > 0 ? info.version : null
      setUpdaterState({ status: 'update-available', availableVersion: version, downloadedVersion: null, progressPercent: null, error: null })
      writeLog('INFO', 'updater', 'Update available', { version, feedUrl: getSettingsState().updates?.feedUrl ?? null })
      void promptToDownloadUpdate(version ?? 'unknown')
    })

    autoUpdater.on('update-not-available', () => {
      setUpdaterState({ status: 'up-to-date', availableVersion: null, downloadedVersion: null, progressPercent: null, error: null, checkedAt: new Date().toISOString() })
    })

    autoUpdater.on('download-progress', (progress) => {
      const percent = Number.isFinite(progress?.percent) ? Math.max(0, Math.min(100, progress.percent)) : null
      setUpdaterState({ status: 'downloading', progressPercent: percent, error: null })
    })

    autoUpdater.on('update-downloaded', (info) => {
      const version = typeof info?.version === 'string' && info.version.length > 0 ? info.version : null
      setUpdaterState({ status: 'downloaded', downloadedVersion: version, progressPercent: 100, error: null })
      writeLog('INFO', 'updater', 'Update downloaded', { version })
      void promptToInstallDownloadedUpdate(version ?? 'unknown')
    })

    autoUpdater.on('error', (error) => {
      const message = error instanceof Error ? error.message : String(error)
      writeLog('WARN', 'updater', 'Auto-update error', message)
      setUpdaterState({ status: 'error', error: message, progressPercent: null })
    })

    if (configureAutoUpdaterFeed() && getSettingsState().updates?.autoCheckOnLaunch !== false) {
      void checkForAppUpdates({ silent: true })
    } else {
      broadcastUpdaterStateChanged(getUpdaterStateSnapshot())
    }
  }

  return {
    checkForAppUpdates,
    downloadAvailableUpdate,
    getUpdaterStateSnapshot,
    initializeAutoUpdater,
    installDownloadedUpdate,
  }
}

export {
  createUpdaterController,
}
