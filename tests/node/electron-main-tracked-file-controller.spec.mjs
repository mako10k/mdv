import test from 'node:test'
import assert from 'node:assert/strict'

const require = (await import('node:module')).createRequire(import.meta.url)
const { createTrackedFileController } = require('../../electron/lib/main/tracked-file-controller.cjs')

test('createTrackedFileController provides track and clear', () => {
  const calls = []
  const fs = {
    watch: (p, opts, cb) => {
      calls.push(['watch', p])
      return { close: () => calls.push(['close']), on: () => {} }
    },
    existsSync: (p) => {
      calls.push(['exists', p])
      return true
    },
  }
  const writeLog = (...args) => calls.push(['log', ...args])
  const runtimeStates = new Map()
  const ensureEditorRuntimeState = (win) => {
    if (!runtimeStates.has(win.id)) {
      runtimeStates.set(win.id, { trackedFilePath: null })
    }
    return runtimeStates.get(win.id)
  }
  const controller = createTrackedFileController({
    fs,
    writeLog,
    ensureEditorRuntimeState,
  })
  assert.ok(typeof controller.trackCurrentFileForWindow === 'function')
  assert.ok(typeof controller.clearTrackedFileWatcher === 'function')

  const fakeWindow = { id: 42, isDestroyed: () => false, webContents: { send: (ch, p) => calls.push(['send', ch, p]) } }
  controller.trackCurrentFileForWindow(fakeWindow, '/tmp/test.md')
  assert.equal(runtimeStates.get(42).trackedFilePath, '/tmp/test.md')
  controller.clearTrackedFileWatcher(42)
  // no throw
})

test('tracked file watch failures back off and suppress repeated capped-delay logs', () => {
  const logs = []
  const scheduled = []
  const cleared = []
  let nextTimerId = 1
  const fs = {
    watch: () => {
      throw Object.assign(new Error('EISDIR'), { code: 'EISDIR' })
    },
    existsSync: () => true,
  }
  const runtimeState = { trackedFilePath: null }
  const controller = createTrackedFileController({
    fs,
    writeLog: (...parts) => logs.push(parts),
    ensureEditorRuntimeState: () => runtimeState,
    setTimeoutImpl: (callback, delay) => {
      const timer = { id: nextTimerId++, callback, delay }
      scheduled.push(timer)
      return timer
    },
    clearTimeoutImpl: (timer) => cleared.push(timer.id),
  })
  const fakeWindow = { id: 8, isDestroyed: () => false, webContents: { send: () => {} } }

  controller.trackCurrentFileForWindow(fakeWindow, '\\\\wsl.localhost\\Ubuntu\\repo\\doc.md')
  for (let index = 0; index < 4; index += 1) {
    scheduled[index].callback()
  }

  assert.deepEqual(scheduled.map((timer) => timer.delay), [1000, 5000, 30_000, 300_000, 300_000])
  assert.equal(logs.length, 4)
  assert.equal(logs.every((entry) => entry[2] === 'Unable to watch tracked file; retry scheduled'), true)

  controller.clearTrackedFileWatcher(fakeWindow.id)
  assert.ok(cleared.includes(scheduled.at(-1).id))
})

test('asynchronous watcher errors preserve the consecutive retry backoff', () => {
  const watchers = []
  const scheduled = []
  const logs = []
  const runtimeState = { trackedFilePath: null }
  const fs = {
    watch: () => {
      const handlers = new Map()
      const watcher = {
        close: () => {},
        on: (event, handler) => handlers.set(event, handler),
        emit: (event, error) => handlers.get(event)?.(error),
      }
      watchers.push(watcher)
      return watcher
    },
    existsSync: () => true,
  }
  const controller = createTrackedFileController({
    fs,
    writeLog: (...parts) => logs.push(parts),
    ensureEditorRuntimeState: () => runtimeState,
    setTimeoutImpl: (callback, delay) => {
      const timer = { callback, delay }
      scheduled.push(timer)
      return timer
    },
    clearTimeoutImpl: () => {},
  })
  const fakeWindow = { id: 9, isDestroyed: () => false, webContents: { send: () => {} } }

  controller.trackCurrentFileForWindow(fakeWindow, '\\\\server\\share\\doc.md')
  for (let index = 0; index < 5; index += 1) {
    watchers[index].emit('error', new Error('watch failed'))
    if (index < 4) {
      scheduled[index].callback()
    }
  }
  scheduled[4].callback()
  watchers[5].emit('error', Object.assign(new Error('permission denied'), { code: 'EACCES' }))

  assert.deepEqual(scheduled.map((timer) => timer.delay), [1000, 5000, 30_000, 300_000, 300_000, 300_000])
  assert.equal(logs.length, 5)
  assert.equal(logs.at(-1)[3].error, 'permission denied')
})

test('alternating watcher errors keep the global backoff and bounded warning count', () => {
  const watchers = []
  const scheduled = []
  const logs = []
  const runtimeState = { trackedFilePath: null }
  const fs = {
    watch: () => {
      const handlers = new Map()
      const watcher = {
        close: () => {},
        on: (event, handler) => handlers.set(event, handler),
        emit: (event, error) => handlers.get(event)?.(error),
      }
      watchers.push(watcher)
      return watcher
    },
    existsSync: () => true,
  }
  const controller = createTrackedFileController({
    fs,
    writeLog: (...parts) => logs.push(parts),
    ensureEditorRuntimeState: () => runtimeState,
    setTimeoutImpl: (callback, delay) => {
      const timer = { callback, delay }
      scheduled.push(timer)
      return timer
    },
    clearTimeoutImpl: () => {},
  })
  const fakeWindow = { id: 11, isDestroyed: () => false, webContents: { send: () => {} } }

  controller.trackCurrentFileForWindow(fakeWindow, '\\\\server\\share\\alternating.md')
  for (let index = 0; index < 8; index += 1) {
    const code = index % 2 === 0 ? 'EISDIR' : 'EACCES'
    watchers[index].emit('error', Object.assign(new Error(code), { code }))
    if (index < 7) {
      scheduled[index].callback()
    }
  }

  assert.deepEqual(scheduled.map((timer) => timer.delay), [
    1000,
    5000,
    30_000,
    300_000,
    300_000,
    300_000,
    300_000,
    300_000,
  ])
  assert.equal(logs.length, 4)
})

test('stale watcher events cannot restore a prior path after path change or close', () => {
  const watchers = []
  const scheduled = []
  const runtimeState = { trackedFilePath: null }
  const fs = {
    watch: () => {
      const handlers = new Map()
      const watcher = {
        close: () => {},
        on: (event, handler) => handlers.set(event, handler),
        emit: (event, error) => handlers.get(event)?.(error),
      }
      watchers.push(watcher)
      return watcher
    },
    existsSync: () => true,
  }
  const controller = createTrackedFileController({
    fs,
    writeLog: () => {},
    ensureEditorRuntimeState: () => runtimeState,
    setTimeoutImpl: (callback, delay) => {
      const timer = { callback, delay }
      scheduled.push(timer)
      return timer
    },
    clearTimeoutImpl: () => {},
  })
  let destroyed = false
  const fakeWindow = { id: 10, isDestroyed: () => destroyed, webContents: { send: () => {} } }

  controller.trackCurrentFileForWindow(fakeWindow, '/workspace/a.md')
  controller.trackCurrentFileForWindow(fakeWindow, '/workspace/b.md')
  watchers[0].emit('error', new Error('stale A error'))

  assert.equal(runtimeState.trackedFilePath, '/workspace/b.md')
  assert.equal(scheduled.length, 0)

  controller.clearTrackedFileWatcher(fakeWindow.id)
  destroyed = true
  watchers[1].emit('error', new Error('closed B error'))

  assert.equal(scheduled.length, 0)
})
