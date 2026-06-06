import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { registerAppLifecycle } = require('../../electron/lib/main/lifecycle.cjs')

function createHarness(overrides = {}) {
  const appHandlers = new Map()
  const processHandlers = new Map()
  const logs = []
  let pendingLaunchRequest = overrides.pendingLaunchRequest ?? null

  const app = {
    on(event, handler) {
      appHandlers.set(event, handler)
    },
    whenReady() {
      return Promise.resolve()
    },
    quit() {
      logs.push(['quit'])
    },
  }

  const processRef = {
    platform: overrides.platform ?? 'linux',
    on(event, handler) {
      processHandlers.set(event, handler)
    },
  }

  const BrowserWindow = {
    getAllWindows: () => overrides.windows ?? [],
  }

  const calls = {
    focusWindow: [],
    queueOrDispatchOpenFile: [],
    createWindow: [],
    startDebugChannelServer: 0,
    initializeAutoUpdater: 0,
    createApplicationMenu: 0,
    clearPendingLaunchRequest: 0,
    stopDebugChannelServer: 0,
    flushAutosaveRecoveryStoreSync: 0,
    clearCommandPollTimer: 0,
    emitDebugChannelEvent: [],
  }

  registerAppLifecycle({
    app,
    BrowserWindow,
    writeLog: (...parts) => logs.push(parts),
    processRef,
    resolveLaunchRequest: overrides.resolveLaunchRequest ?? ((argv) => ({ filePath: argv[0] ?? null, explicitInitialPanel: null })),
    findEditorWindowByTrackedFilePath: overrides.findEditorWindowByTrackedFilePath ?? (() => null),
    focusWindow: (window) => calls.focusWindow.push(window),
    isManagedClient: overrides.isManagedClient ?? (() => false),
    createWindow: async (launchRequest) => {
      calls.createWindow.push(launchRequest ?? null)
      return { id: 99 }
    },
    getDefaultEditorWindow: overrides.getDefaultEditorWindow ?? (() => null),
    queueOrDispatchOpenFile: (launchRequest) => calls.queueOrDispatchOpenFile.push(launchRequest),
    startDebugChannelServer: () => { calls.startDebugChannelServer += 1 },
    emitDebugChannelEvent: (type, payload) => calls.emitDebugChannelEvent.push({ type, payload }),
    initializeAutoUpdater: () => { calls.initializeAutoUpdater += 1 },
    createApplicationMenu: () => { calls.createApplicationMenu += 1 },
    getPendingLaunchRequest: () => pendingLaunchRequest,
    clearPendingLaunchRequest: () => {
      calls.clearPendingLaunchRequest += 1
      pendingLaunchRequest = null
    },
    stopDebugChannelServer: () => { calls.stopDebugChannelServer += 1 },
    flushAutosaveRecoveryStoreSync: () => { calls.flushAutosaveRecoveryStoreSync += 1 },
    clearCommandPollTimer: () => { calls.clearCommandPollTimer += 1 },
    isDev: overrides.isDev ?? false,
    forceStaticRenderer: overrides.forceStaticRenderer ?? false,
  })

  return { appHandlers, processHandlers, calls, logs }
}

test('second-instance focuses existing editor for matching file', () => {
  const existingWindow = { id: 7 }
  const { appHandlers, calls } = createHarness({
    resolveLaunchRequest: () => ({ filePath: '/tmp/doc.md', explicitInitialPanel: null }),
    findEditorWindowByTrackedFilePath: () => existingWindow,
  })

  appHandlers.get('second-instance')({}, ['/tmp/doc.md'])

  assert.deepEqual(calls.focusWindow, [existingWindow])
  assert.deepEqual(calls.createWindow, [])
  assert.deepEqual(calls.queueOrDispatchOpenFile, [])
})

test('second-instance opens additional window for file launch on unmanaged runtime', async () => {
  const { appHandlers, calls } = createHarness({
    resolveLaunchRequest: () => ({ filePath: '/tmp/doc.md', explicitInitialPanel: 'write' }),
  })

  await Promise.resolve()
  await Promise.resolve()
  calls.createWindow.length = 0
  appHandlers.get('second-instance')({}, ['/tmp/doc.md'])
  await Promise.resolve()

  assert.deepEqual(calls.createWindow, [{ filePath: '/tmp/doc.md', explicitInitialPanel: 'write' }])
  assert.deepEqual(calls.focusWindow, [{ id: 99 }])
  assert.deepEqual(calls.queueOrDispatchOpenFile, [])
})

 test('second-instance queues launch request when managed client reuses current window', () => {
  const targetWindow = { id: 11 }
  const { appHandlers, calls } = createHarness({
    resolveLaunchRequest: () => ({ filePath: '/tmp/doc.md', explicitInitialPanel: 'write' }),
    getDefaultEditorWindow: () => targetWindow,
    isManagedClient: () => true,
  })

  appHandlers.get('second-instance')({}, ['/tmp/doc.md'])

  assert.deepEqual(calls.focusWindow, [targetWindow])
  assert.deepEqual(calls.queueOrDispatchOpenFile, [{ filePath: '/tmp/doc.md', explicitInitialPanel: 'write' }])
})

test('whenReady starts services and opens initial window', async () => {
  const { calls, logs } = createHarness({
    pendingLaunchRequest: { filePath: '/tmp/initial.md', explicitInitialPanel: 'preview' },
    platform: 'darwin',
    isDev: true,
  })

  await Promise.resolve()
  await Promise.resolve()

  assert.equal(calls.startDebugChannelServer, 1)
  assert.equal(calls.initializeAutoUpdater, 1)
  assert.equal(calls.createApplicationMenu, 1)
  assert.equal(calls.clearPendingLaunchRequest, 1)
  assert.deepEqual(calls.createWindow, [{ filePath: '/tmp/initial.md', explicitInitialPanel: 'preview' }])
  assert.deepEqual(calls.emitDebugChannelEvent, [{ type: 'app:ready', payload: { isDev: true, forceStaticRenderer: false, platform: 'darwin' } }])
  assert.ok(logs.some((entry) => entry[2] === 'app.whenReady resolved'))
})
