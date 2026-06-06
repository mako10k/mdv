import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createUpdaterController } = require('../../electron/lib/main/updater-controller.cjs')

function createAutoUpdaterHarness() {
  const handlers = new Map()
  const calls = {
    setFeedURL: [],
    checkForUpdates: 0,
    downloadUpdate: 0,
    quitAndInstall: [],
  }

  return {
    autoUpdater: {
      autoDownload: true,
      autoInstallOnAppQuit: false,
      on(event, handler) {
        handlers.set(event, handler)
      },
      emit(event, payload) {
        handlers.get(event)?.(payload)
      },
      setFeedURL(payload) {
        calls.setFeedURL.push(payload)
      },
      async checkForUpdates() {
        calls.checkForUpdates += 1
      },
      async downloadUpdate() {
        calls.downloadUpdate += 1
      },
      quitAndInstall(isSilent, isForceRunAfter) {
        calls.quitAndInstall.push({ isSilent, isForceRunAfter })
      },
    },
    calls,
  }
}

function createMessages() {
  return {
    buttons: {
      close: 'Close',
    },
    updater: {
      invalidInstallMessage: (filePath) => `missing ${filePath}`,
      availableTitle: 'Available',
      availableMessage: (version) => `available ${version}`,
      availableDetail: 'detail',
      downloadNow: 'Download now',
      later: 'Later',
      downloadedTitle: 'Downloaded',
      downloadedMessage: (version) => `downloaded ${version}`,
      downloadedDetail: 'restart',
      restartNow: 'Restart now',
      checkFailedTitle: 'Check failed',
    },
  }
}

function createSupportedRuntime() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdv-updater-'))
  const execDir = path.join(rootDir, 'app')
  const resourcesDir = path.join(rootDir, 'resources')
  fs.mkdirSync(execDir, { recursive: true })
  fs.mkdirSync(resourcesDir, { recursive: true })
  fs.writeFileSync(path.join(execDir, 'Uninstall MDV.exe'), '')
  fs.writeFileSync(path.join(resourcesDir, 'app-update.yml'), 'provider: generic\n')
  return {
    env: {},
    execPath: path.join(execDir, 'MDV.exe'),
    resourcesPath: resourcesDir,
    platform: 'win32',
  }
}

function createController(overrides = {}) {
  const { autoUpdater, calls } = createAutoUpdaterHarness()
  const snapshots = []
  const controller = createUpdaterController({
    app: {
      getVersion: () => '1.2.3',
      isPackaged: false,
    },
    autoUpdater,
    processRef: {
      env: {},
      execPath: '/tmp/app.exe',
      resourcesPath: '/tmp/resources',
      platform: 'linux',
    },
    writeLog: () => {},
    showMessageBox: async () => ({ response: 1 }),
    getMainI18n: createMessages,
    getDefaultEditorWindow: () => null,
    getSettingsWindow: () => null,
    getAboutWindow: () => null,
    getSettingsState: () => ({
      updates: {
        enabled: true,
        autoCheckOnLaunch: true,
        feedUrl: 'https://example.test/feed',
      },
    }),
    broadcastUpdaterStateChanged: (snapshot) => snapshots.push(snapshot),
    ...overrides,
    autoUpdater: overrides.autoUpdater ?? autoUpdater,
  })

  return { controller, autoUpdater: overrides.autoUpdater ?? autoUpdater, calls, snapshots }
}

test('initializeAutoUpdater broadcasts unsupported state on non-installed runtime', () => {
  const { controller, snapshots } = createController()

  controller.initializeAutoUpdater()

  assert.ok(snapshots.length >= 1)
  const snapshot = snapshots.at(-1)
  assert.equal(snapshot.status, 'unsupported')
  assert.equal(snapshot.supported, false)
  assert.equal(snapshot.currentVersion, '1.2.3')
})

test('checkForAppUpdates configures feed and starts updater on supported runtime', async () => {
  const { controller, calls } = createController({
    app: {
      getVersion: () => '1.2.3',
      isPackaged: true,
    },
    processRef: createSupportedRuntime(),
  })

  const result = await controller.checkForAppUpdates({ silent: true })

  assert.equal(calls.setFeedURL.length, 1)
  assert.deepEqual(calls.setFeedURL[0], { provider: 'generic', url: 'https://example.test/feed' })
  assert.equal(calls.checkForUpdates, 1)
  assert.equal(result.status, 'checking')
})

test('installDownloadedUpdate only installs after downloaded state', () => {
  const { controller, autoUpdater, calls } = createController({
    app: {
      getVersion: () => '1.2.3',
      isPackaged: true,
    },
    processRef: createSupportedRuntime(),
  })

  controller.initializeAutoUpdater()
  assert.equal(controller.installDownloadedUpdate(), false)

  autoUpdater.emit('update-downloaded', { version: '1.2.4' })

  assert.equal(controller.installDownloadedUpdate(), true)
  assert.deepEqual(calls.quitAndInstall, [{ isSilent: false, isForceRunAfter: true }])
})
