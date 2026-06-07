import test from 'node:test'
import assert from 'node:assert/strict'

const require = (await import('node:module')).createRequire(import.meta.url)
const { createSemanticCacheController } = require('../../electron/lib/main/semantic-cache-controller.cjs')

test('createSemanticCacheController provides core cache methods', () => {
  const calls = []
  const fs = {
    existsSync: (p) => { calls.push(['exists', p]); return false },
    readFileSync: () => { calls.push(['read']); return JSON.stringify({version:1, entries:[]}) },
    mkdirSync: () => calls.push(['mkdir']),
    writeFileSync: () => calls.push(['write']),
  }
  const writeLog = (...args) => calls.push(['log', ...args])
  const controller = createSemanticCacheController({
    semanticCachePath: '/tmp/test-semantic-cache.json',
    fs,
    writeLog,
  })
  assert.ok(typeof controller.loadSemanticCacheIfNeeded === 'function')
  assert.ok(typeof controller.scheduleSemanticCachePersist === 'function')
  assert.ok(typeof controller.touchEmbeddingCacheEntry === 'function')
  assert.ok(typeof controller.upsertEmbeddingCacheEntry === 'function')
  // basic call
  controller.loadSemanticCacheIfNeeded()
  // no crash
})
