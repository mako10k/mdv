import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createAutosaveRecoveryStore } = require('../../electron/lib/main/autosave-recovery.cjs')

function createStore() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdv-autosave-'))
  const autosaveRecoveryPath = path.join(tempDir, 'autosave.json')
  const logs = []
  const store = createAutosaveRecoveryStore({
    autosaveRecoveryPath,
    getUntitledTitle: () => 'Untitled',
    writeLog: (...parts) => logs.push(parts),
  })
  return { store, autosaveRecoveryPath, logs }
}

test('upsert normalizes snapshot and latest ignores untouched untitled buffer', () => {
  const { store } = createStore()

  store.upsert({
    markdownText: '',
    persistedMarkdown: '',
    currentFilePath: '',
    displayTitle: '',
  })
  store.upsert({
    markdownText: '# Doc',
    persistedMarkdown: '',
    currentFilePath: '',
    displayTitle: ' Draft ',
    recoveryKey: 'draft-1',
    activePanel: 'write',
  })

  const latest = store.getLatest()
  assert.equal(latest.snapshot.displayTitle, 'Draft')
  assert.equal(latest.snapshot.activePanel, 'write')
  assert.equal(latest.snapshot.recoveryKey, 'draft-1')
})

test('clear removes entries by file path and recovery key', () => {
  const { store } = createStore()

  const fileEntry = store.upsert({
    markdownText: '# File',
    persistedMarkdown: '',
    currentFilePath: '/tmp/doc.md',
    displayTitle: 'Doc',
  })
  const draftEntry = store.upsert({
    markdownText: '# Draft',
    persistedMarkdown: '',
    currentFilePath: '',
    displayTitle: 'Draft',
    recoveryKey: 'draft-2',
  })

  assert.ok(store.getForFile('/tmp/doc.md'))
  assert.ok(store.getByRecoveryKey('draft-2'))

  store.clear({ filePath: '/tmp/doc.md' })
  store.clear({ recoveryKey: draftEntry.recoveryKey })

  assert.equal(store.getForFile('/tmp/doc.md'), null)
  assert.equal(store.getByRecoveryKey('draft-2'), null)
  assert.ok(fileEntry.recoveryKey.startsWith('file:'))
})

test('flushSync persists and load restores normalized entries', () => {
  const { store, autosaveRecoveryPath } = createStore()

  store.upsert({
    markdownText: '# Saved',
    persistedMarkdown: '# Old',
    currentFilePath: './notes.md',
    displayTitle: 'Saved',
    pendingImportedAssets: [{ filePath: '/tmp/a.png', relativePath: 'a.png' }, { filePath: 1 }],
  })
  store.flushSync()

  const restored = createAutosaveRecoveryStore({
    autosaveRecoveryPath,
    getUntitledTitle: () => 'Untitled',
    writeLog: () => {},
  })
  restored.load()

  const entry = restored.getForFile(path.resolve('./notes.md'))
  assert.ok(entry)
  assert.equal(entry.snapshot.pendingImportedAssets.length, 1)
  assert.equal(entry.snapshot.pendingImportedAssets[0].relativePath, 'a.png')
})
