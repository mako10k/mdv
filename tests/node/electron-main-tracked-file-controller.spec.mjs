import test from 'node:test'
import assert from 'node:assert/strict'

const require = (await import('node:module')).createRequire(import.meta.url)
const { createTrackedFileController } = require('../../electron/lib/main/tracked-file-controller.cjs')

test('createTrackedFileController provides track and clear', () => {
  const calls = []
  const fs = {
    watch: (p, opts, cb) => {
      calls.push(['watch', p])
      return { close: () => calls.push(['close']) }
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
