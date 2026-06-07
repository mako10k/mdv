import test from 'node:test'
import assert from 'node:assert/strict'

const require = (await import('node:module')).createRequire(import.meta.url)
const { createProtectedContextController } = require('../../electron/lib/main/protected-context-controller.cjs')

test('createProtectedContextController provides core context methods', () => {
  const calls = []
  const states = new Map()
  function ensureEditorRuntimeState(win) {
    const id = win && win.id != null ? win.id : 'win'
    if (!states.has(id)) {
      states.set(id, { protectedContextItems: new Map() })
    }
    return states.get(id)
  }
  const estimateTokenCount = (text) => (typeof text === 'string' && text.length > 0 ? Math.ceil(text.length / 4) : 0)
  const getProtectedContextBudgetTokens = () => 256
  class LocalAiToolUserError extends Error {
    constructor(toolName, reason, fix, code = 'invalid_arguments') {
      super(reason)
      this.name = 'AiToolUserError'
      this.toolName = toolName
      this.reason = reason
      this.fix = fix
      this.code = code
    }
  }
  const touchEditorRuntimeState = (win) => {
    const st = ensureEditorRuntimeState(win)
    st.updatedAt = new Date().toISOString()
    return st
  }
  const controller = createProtectedContextController({
    ensureEditorRuntimeState,
    estimateTokenCount,
    getProtectedContextBudgetTokens,
    AiToolUserError: LocalAiToolUserError,
    touchEditorRuntimeState,
  })
  assert.ok(typeof controller.buildProtectedContextInput === 'function')
  assert.ok(typeof controller.getProtectedContextUsage === 'function')
  assert.ok(typeof controller.saveProtectedContextItemForWindow === 'function')
  assert.ok(typeof controller.updateProtectedContextItemForWindow === 'function')
  assert.ok(typeof controller.mergeProtectedContextItemsForWindow === 'function')
  assert.ok(typeof controller.listProtectedContextItemsForWindow === 'function')
  assert.ok(typeof controller.deleteProtectedContextItemForWindow === 'function')
  // basic safe call (no throw)
  const fakeWin = { id: 'test-win' }
  const listed = controller.listProtectedContextItemsForWindow(fakeWin)
  assert.ok(listed && Array.isArray(listed.items))
  // build input on empty
  const input = controller.buildProtectedContextInput(fakeWin, 1000)
  assert.strictEqual(input, null)
})
