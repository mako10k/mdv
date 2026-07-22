import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createSettingsMutationQueue } = require('../../electron/lib/main/settings-mutation-queue.cjs')

function createDeferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })

  return { promise, resolve }
}

test('settings mutation queue persists and commits in arrival order', async () => {
  let state = { value: 0 }
  const firstPersist = createDeferred()
  const persisted = []
  const committed = []
  const queue = createSettingsMutationQueue({
    getState: () => state,
    persistState: async (nextState) => {
      persisted.push(nextState.value)
      if (nextState.value === 1) {
        await firstPersist.promise
      }
    },
    commitState: (nextState) => {
      state = nextState
      committed.push(nextState.value)
    },
  })

  const first = queue.enqueue((current) => ({
    nextState: { value: current.value + 1 },
    changed: true,
    value: 'first',
  }))
  const second = queue.enqueue((current) => ({
    nextState: { value: current.value + 10 },
    changed: true,
    value: 'second',
  }))

  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(persisted, [1])
  assert.deepEqual(committed, [])

  firstPersist.resolve()
  const [firstResult, secondResult] = await Promise.all([first, second])

  assert.deepEqual(persisted, [1, 11])
  assert.deepEqual(committed, [1, 11])
  assert.deepEqual(firstResult, { settings: { value: 1 }, changed: true, value: 'first' })
  assert.deepEqual(secondResult, { settings: { value: 11 }, changed: true, value: 'second' })
})

test('settings mutation queue skips persistence for a no-op', async () => {
  const state = { value: 4 }
  let persistCalls = 0
  let commitCalls = 0
  const queue = createSettingsMutationQueue({
    getState: () => state,
    persistState: async () => {
      persistCalls += 1
    },
    commitState: () => {
      commitCalls += 1
    },
  })

  const result = await queue.enqueue((current) => ({
    nextState: current,
    changed: false,
    value: 'bounded',
  }))

  assert.deepEqual(result, { settings: state, changed: false, value: 'bounded' })
  assert.equal(persistCalls, 0)
  assert.equal(commitCalls, 0)
})

test('settings mutation queue continues after a failed persistence', async () => {
  let state = { value: 0 }
  const persisted = []
  const queue = createSettingsMutationQueue({
    getState: () => state,
    persistState: async (nextState) => {
      persisted.push(nextState.value)
      if (nextState.value === 1) {
        throw new Error('disk unavailable')
      }
    },
    commitState: (nextState) => {
      state = nextState
    },
  })

  const failed = queue.enqueue((current) => ({
    nextState: { value: current.value + 1 },
    changed: true,
    value: null,
  }))
  const recovered = queue.enqueue((current) => ({
    nextState: { value: current.value + 2 },
    changed: true,
    value: null,
  }))

  await assert.rejects(failed, /disk unavailable/)
  const recoveredResult = await recovered

  assert.deepEqual(persisted, [1, 2])
  assert.deepEqual(recoveredResult.settings, { value: 2 })
  assert.deepEqual(state, { value: 2 })
})

test('queued fetch ACL mutation reads the latest committed settings state', async () => {
  let state = {
    editorFontSizePx: 13,
    aclText: 'allow https://existing.example/*',
  }
  const firstPersist = createDeferred()
  const queue = createSettingsMutationQueue({
    getState: () => state,
    persistState: async (nextState) => {
      if (nextState.editorFontSizePx === 14 && !nextState.aclText.includes('pending.example')) {
        await firstPersist.promise
      }
    },
    commitState: (nextState) => {
      state = nextState
    },
  })

  const typographyMutation = queue.enqueue((current) => ({
    nextState: { ...current, editorFontSizePx: 14 },
    changed: true,
    value: null,
  }))
  const fetchAclMutation = queue.enqueue((current) => ({
    nextState: {
      ...current,
      aclText: `${current.aclText}\nallow https://pending.example/*`,
    },
    changed: true,
    value: null,
  }))

  firstPersist.resolve()
  await Promise.all([typographyMutation, fetchAclMutation])

  assert.deepEqual(state, {
    editorFontSizePx: 14,
    aclText: 'allow https://existing.example/*\nallow https://pending.example/*',
  })
})
