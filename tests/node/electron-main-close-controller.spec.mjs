import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createCloseController } = require('../../electron/lib/main/close-controller.cjs')

function createMessages() {
  return {
    untitledTitle: 'Untitled.md',
    buttons: {
      save: 'Save',
      cancel: 'Cancel',
      continue: 'Continue',
      close: 'Close',
    },
    unsaved: {
      file: 'File',
      hasUnsavedChanges: 'Unsaved changes',
      title: 'Unsaved',
      message: (label) => `Proceed with ${label}`,
    },
    closeFallback: {
      title: 'Unresponsive',
      message: 'Renderer did not respond',
      detail: 'Force close?',
    },
  }
}

function createWindow(id = 1) {
  const sent = []
  let destroyed = false
  let closed = false

  return {
    id,
    sent,
    get closed() {
      return closed
    },
    isDestroyed: () => destroyed,
    destroy: () => {
      destroyed = true
    },
    close: () => {
      closed = true
    },
    webContents: {
      send: (channel, payload) => {
        sent.push({ channel, payload })
      },
    },
  }
}

test('showUnsavedChangesDialog maps message box responses', async () => {
  const responses = [0, 2, 1]
  const controller = createCloseController({
    approvedWindowCloseIds: new Set(),
    getMainI18n: createMessages,
    showMessageBox: async () => ({ response: responses.shift() }),
    requestEditorWindowData: async () => ({ isDirty: false }),
    writeLog: () => {},
    closeAuxiliaryWindowsForEditor: () => {},
    cleanupDraftWorkspace: async () => {},
    saveContentToPath: async () => null,
    collectReferencedDraftAssetPaths: () => [],
    cleanupImportedAssetFiles: async () => {},
    clearAutosaveRecovery: () => {},
  })

  const window = createWindow()
  assert.deepEqual(await controller.showUnsavedChangesDialog(window, {}), { action: 'save' })
  assert.deepEqual(await controller.showUnsavedChangesDialog(window, {}), { action: 'discard' })
  assert.deepEqual(await controller.showUnsavedChangesDialog(window, {}), { action: 'cancel' })
})

test('confirmEditorWindowClose closes clean editor windows immediately', async () => {
  const approvedWindowCloseIds = new Set()
  const effects = {
    cleanupDraftWorkspace: [],
    closeAuxiliary: [],
  }

  const controller = createCloseController({
    approvedWindowCloseIds,
    getMainI18n: createMessages,
    showMessageBox: async () => ({ response: 0 }),
    requestEditorWindowData: async () => ({
      isDirty: false,
      snapshot: { draftWorkspace: { workspaceId: 'w1' } },
    }),
    writeLog: () => {},
    closeAuxiliaryWindowsForEditor: (window) => {
      effects.closeAuxiliary.push(window.id)
    },
    cleanupDraftWorkspace: async (payload) => {
      effects.cleanupDraftWorkspace.push(payload)
    },
    saveContentToPath: async () => null,
    collectReferencedDraftAssetPaths: () => [],
    cleanupImportedAssetFiles: async () => {},
    clearAutosaveRecovery: () => {},
  })

  const window = createWindow(7)
  await controller.confirmEditorWindowClose(window)
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(effects.cleanupDraftWorkspace, [{ draftWorkspace: { workspaceId: 'w1' } }])
  assert.deepEqual(effects.closeAuxiliary, [7])
  assert.equal(approvedWindowCloseIds.has(7), true)
  assert.equal(window.closed, true)
  assert.equal(window.sent.some((entry) => entry.channel === 'mdv:window-close-approved'), true)
})
