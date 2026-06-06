import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createE2eDialogController } = require('../../electron/lib/main/dialogs.cjs')

function createDialogHarness() {
  const calls = []
  const dialog = {
    async showMessageBox(window, options) {
      calls.push(['message', window, options])
      return { response: 9, checkboxChecked: true }
    },
    async showSaveDialog(window, options) {
      calls.push(['save', window, options])
      return { canceled: false, filePath: '/tmp/default.md' }
    },
    async showOpenDialog(window, options) {
      calls.push(['open', window, options])
      return { canceled: false, filePaths: ['/tmp/default.md'] }
    },
  }
  return { dialog, calls }
}

test('uses injected message/save/open dialog responses from env', async () => {
  process.env.MDV_E2E_DIALOG_RESPONSES = JSON.stringify({
    messageBox: [{ response: 2, checkboxChecked: true }],
    saveDialog: [{ canceled: false, filePath: '/tmp/injected.md', bookmark: 'b1' }],
    openDialog: [{ canceled: false, filePaths: ['/tmp/a.md', 1], bookmarks: ['x', 2] }],
  })
  const { dialog, calls } = createDialogHarness()
  const logs = []
  const controller = createE2eDialogController({ dialog, writeLog: (...parts) => logs.push(parts) })

  const message = await controller.showMessageBox(null, { message: 'x' })
  const save = await controller.showSaveDialog(null, { title: 'y' })
  const open = await controller.showOpenDialog(null, { title: 'z' })

  assert.deepEqual(message, { response: 2, checkboxChecked: true })
  assert.deepEqual(save, { canceled: false, filePath: '/tmp/injected.md', bookmark: 'b1' })
  assert.deepEqual(open, { canceled: false, filePaths: ['/tmp/a.md'], bookmarks: ['x'] })
  assert.deepEqual(calls, [])
  assert.ok(logs.some((entry) => entry[2] === 'Using injected showOpenDialog response'))
  delete process.env.MDV_E2E_DIALOG_RESPONSES
})

test('falls back to real dialog implementation when env is absent', async () => {
  delete process.env.MDV_E2E_DIALOG_RESPONSES
  const { dialog, calls } = createDialogHarness()
  const controller = createE2eDialogController({ dialog, writeLog: () => {} })

  const result = await controller.showMessageBox({ id: 1 }, { message: 'fallback' })

  assert.deepEqual(result, { response: 9, checkboxChecked: true })
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'message')
})
