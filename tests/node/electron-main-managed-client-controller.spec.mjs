import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createManagedClientController } = require('../../electron/lib/main/managed-client-controller.cjs')

function createFetchHarness() {
  const calls = []
  const queuedResponses = []

  async function fetch(url, options = undefined) {
    calls.push({
      url: String(url),
      options,
    })

    const next = queuedResponses.shift() ?? { ok: true, json: async () => ({}) }
    return next
  }

  return {
    fetch,
    calls,
    queueJson(body, overrides = {}) {
      queuedResponses.push({
        ok: true,
        json: async () => body,
        ...overrides,
      })
    },
  }
}

function createWindowHarness() {
  const sent = []

  return {
    window: {
      isDestroyed: () => false,
      webContents: {
        send(channel, payload) {
          sent.push({ channel, payload })
        },
      },
    },
    sent,
  }
}

function createController(overrides = {}) {
  const fetchHarness = createFetchHarness()
  const intervals = []
  const clearedIntervals = []
  const logs = []

  const controller = createManagedClientController({
    fetch: fetchHarness.fetch,
    URL,
    processRef: { pid: 4321 },
    setInterval(handler, timeout) {
      const token = { handler, timeout }
      intervals.push(token)
      return token
    },
    clearInterval(token) {
      clearedIntervals.push(token)
    },
    managedServerUrl: 'http://127.0.0.1:4010',
    managedClientId: 'client-1',
    managedWindowId: 'window-1',
    getPendingLaunchFilePath: () => '/tmp/from-launch.md',
    getAppMetadata: () => ({ version: '9.9.9' }),
    writeLog(level, scope, ...parts) {
      logs.push({ level, scope, parts })
    },
    ...overrides,
  })

  return { controller, fetchHarness, intervals, clearedIntervals, logs }
}

test('isManagedClient is false when server settings are incomplete', () => {
  const { controller } = createController({
    managedServerUrl: null,
  })

  assert.equal(controller.isManagedClient(), false)
})

test('registerManagedClient posts registration with pending launch file path', async () => {
  const { controller, fetchHarness, intervals, logs } = createController()
  const { window } = createWindowHarness()

  fetchHarness.queueJson({})
  fetchHarness.queueJson({ commands: [] })

  await controller.registerManagedClient(window)

  assert.equal(fetchHarness.calls.length, 2)
  assert.equal(fetchHarness.calls[0].url, 'http://127.0.0.1:4010/api/clients/register')
  assert.deepEqual(JSON.parse(fetchHarness.calls[0].options.body), {
    clientId: 'client-1',
    windowId: 'window-1',
    pid: 4321,
    filePath: '/tmp/from-launch.md',
    version: '9.9.9',
  })
  assert.equal(intervals.length, 1)
  assert.equal(intervals[0].timeout, 1000)
  assert.equal(logs[0].scope, 'server-client')
})

test('polled suspend and resume commands are forwarded and tracked', async () => {
  const { controller, fetchHarness } = createController()
  const { window, sent } = createWindowHarness()

  controller.setManagedMainWindow(window)
  fetchHarness.queueJson({})
  fetchHarness.queueJson({
    commands: [
      { requestId: 'req-1', type: 'suspend' },
      { requestId: 'req-2', type: 'resume' },
      { requestId: 'req-3', type: 'ignore' },
    ],
  })

  await controller.registerManagedClient(window)
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(
    sent.map((entry) => entry.payload),
    [
      { requestId: 'req-1', type: 'suspend' },
      { requestId: 'req-2', type: 'resume' },
    ],
  )
  assert.deepEqual(controller.pendingServerRequests.get('req-1'), { type: 'suspend' })
  assert.deepEqual(controller.pendingServerRequests.get('req-2'), { type: 'resume' })
  assert.equal(controller.pendingServerRequests.has('req-3'), false)
})
