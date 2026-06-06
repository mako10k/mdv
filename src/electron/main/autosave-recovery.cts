// @ts-nocheck
const fs = require('node:fs')
const fsPromises = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

function createAutosaveRecoveryStore(options) {
  const { autosaveRecoveryPath, getUntitledTitle, writeLog } = options
  const autosaveRecoveryByKey = new Map()
  let autosaveRecoveryDirty = false
  let autosaveRecoverySaveTimer = null

  function normalizeRecoveryFilePath(filePath) {
    return typeof filePath === 'string' && filePath.trim().length > 0 ? path.resolve(filePath) : null
  }

  function buildRecoveryStorageKey(snapshot) {
    const normalizedFilePath = normalizeRecoveryFilePath(snapshot?.currentFilePath)

    if (normalizedFilePath) {
      return `file:${normalizedFilePath}`
    }

    if (typeof snapshot?.recoveryKey === 'string' && snapshot.recoveryKey.trim().length > 0) {
      return `draft:${snapshot.recoveryKey.trim()}`
    }

    return `draft:${randomUUID()}`
  }

  function inferUntouchedUntitledBuffer(snapshot) {
    if (snapshot?.isUntouchedUntitledBuffer === true) {
      return true
    }

    return typeof snapshot?.isUntouchedUntitledBuffer !== 'boolean'
      && normalizeRecoveryFilePath(snapshot?.currentFilePath) === null
      && (typeof snapshot?.markdownText === 'string' ? snapshot.markdownText : '') === ''
      && (typeof snapshot?.persistedMarkdown === 'string' ? snapshot.persistedMarkdown : '') === ''
  }

  function serializeAutosaveRecoveryEntries() {
    return {
      version: 1,
      entries: Array.from(autosaveRecoveryByKey.values())
        .sort((left, right) => Date.parse(right.savedAt) - Date.parse(left.savedAt)),
    }
  }

  function markAutosaveRecoveryDirty() {
    autosaveRecoveryDirty = true

    if (autosaveRecoverySaveTimer) {
      clearTimeout(autosaveRecoverySaveTimer)
    }

    autosaveRecoverySaveTimer = setTimeout(() => {
      autosaveRecoverySaveTimer = null
      void saveAutosaveRecoveryStore()
    }, 250)
  }

  async function saveAutosaveRecoveryStore() {
    if (!autosaveRecoveryDirty) {
      return
    }

    autosaveRecoveryDirty = false

    try {
      await fsPromises.writeFile(autosaveRecoveryPath, JSON.stringify(serializeAutosaveRecoveryEntries(), null, 2), 'utf8')
    } catch (error) {
      autosaveRecoveryDirty = true
      writeLog('ERROR', 'main', 'Failed to save autosave recovery store', error instanceof Error ? error.message : String(error))
    }
  }

  function flushSync() {
    if (autosaveRecoverySaveTimer) {
      clearTimeout(autosaveRecoverySaveTimer)
      autosaveRecoverySaveTimer = null
    }

    if (!autosaveRecoveryDirty) {
      return
    }

    autosaveRecoveryDirty = false

    try {
      fs.writeFileSync(autosaveRecoveryPath, JSON.stringify(serializeAutosaveRecoveryEntries(), null, 2), 'utf8')
    } catch (error) {
      autosaveRecoveryDirty = true
      writeLog('ERROR', 'main', 'Failed to flush autosave recovery store', error instanceof Error ? error.message : String(error))
    }
  }

  function load() {
    try {
      if (!fs.existsSync(autosaveRecoveryPath)) {
        return
      }

      const parsed = JSON.parse(fs.readFileSync(autosaveRecoveryPath, 'utf8'))
      const entries = Array.isArray(parsed?.entries) ? parsed.entries : []

      for (const entry of entries) {
        if (typeof entry?.recoveryKey !== 'string' || typeof entry?.savedAt !== 'string' || typeof entry?.snapshot !== 'object' || entry.snapshot === null) {
          continue
        }

        const snapshot = entry.snapshot

        if (
          typeof snapshot.markdownText !== 'string'
          || typeof snapshot.persistedMarkdown !== 'string'
          || typeof snapshot.displayTitle !== 'string'
        ) {
          continue
        }

        const normalizedRecoveryKey = typeof snapshot.recoveryKey === 'string' && snapshot.recoveryKey.trim().length > 0
          ? snapshot.recoveryKey.trim()
          : entry.recoveryKey.replace(/^draft:/, '')

        autosaveRecoveryByKey.set(entry.recoveryKey, {
          recoveryKey: entry.recoveryKey,
          savedAt: entry.savedAt,
          snapshot: {
            markdownText: snapshot.markdownText,
            persistedMarkdown: snapshot.persistedMarkdown,
            currentFilePath: normalizeRecoveryFilePath(snapshot.currentFilePath),
            fileSnapshot: snapshot.fileSnapshot && typeof snapshot.fileSnapshot === 'object' ? snapshot.fileSnapshot : null,
            draftWorkspace: snapshot.draftWorkspace && typeof snapshot.draftWorkspace === 'object' ? snapshot.draftWorkspace : null,
            pendingImportedAssets: Array.isArray(snapshot.pendingImportedAssets)
              ? snapshot.pendingImportedAssets.filter((asset) => typeof asset?.filePath === 'string' && typeof asset?.relativePath === 'string')
              : [],
            displayTitle: snapshot.displayTitle,
            activePanel: snapshot.activePanel === 'write' ? 'write' : 'preview',
            isUntouchedUntitledBuffer: inferUntouchedUntitledBuffer(snapshot),
            recoveryKey: normalizedRecoveryKey,
          },
        })
      }
    } catch (error) {
      writeLog('WARN', 'main', 'Failed to load autosave recovery store', error instanceof Error ? error.message : String(error))
    }
  }

  function upsert(snapshot) {
    const recoveryKey = buildRecoveryStorageKey(snapshot)
    const savedAt = new Date().toISOString()
    const normalizedSnapshot = {
      markdownText: typeof snapshot?.markdownText === 'string' ? snapshot.markdownText : '',
      persistedMarkdown: typeof snapshot?.persistedMarkdown === 'string' ? snapshot.persistedMarkdown : '',
      currentFilePath: normalizeRecoveryFilePath(snapshot?.currentFilePath),
      fileSnapshot: snapshot?.fileSnapshot && typeof snapshot.fileSnapshot === 'object' ? snapshot.fileSnapshot : null,
      draftWorkspace: snapshot?.draftWorkspace && typeof snapshot.draftWorkspace === 'object' ? snapshot.draftWorkspace : null,
      pendingImportedAssets: Array.isArray(snapshot?.pendingImportedAssets)
        ? snapshot.pendingImportedAssets.filter((asset) => typeof asset?.filePath === 'string' && typeof asset?.relativePath === 'string')
        : [],
      displayTitle: typeof snapshot?.displayTitle === 'string' && snapshot.displayTitle.trim().length > 0 ? snapshot.displayTitle.trim() : getUntitledTitle(),
      activePanel: snapshot?.activePanel === 'write' ? 'write' : 'preview',
      isUntouchedUntitledBuffer: inferUntouchedUntitledBuffer(snapshot),
      recoveryKey: typeof snapshot?.recoveryKey === 'string' && snapshot.recoveryKey.trim().length > 0 ? snapshot.recoveryKey.trim() : recoveryKey.replace(/^draft:/, ''),
    }

    autosaveRecoveryByKey.set(recoveryKey, {
      recoveryKey,
      savedAt,
      snapshot: normalizedSnapshot,
    })
    markAutosaveRecoveryDirty()
    return { recoveryKey, savedAt }
  }

  function clear(payload = {}) {
    const recoveryKey = typeof payload?.recoveryKey === 'string' && payload.recoveryKey.trim().length > 0
      ? payload.recoveryKey.trim()
      : null
    const normalizedFilePath = normalizeRecoveryFilePath(payload?.filePath)
    let didDelete = false

    if (recoveryKey && autosaveRecoveryByKey.delete(recoveryKey)) {
      didDelete = true
    }

    if (recoveryKey && !recoveryKey.startsWith('draft:') && autosaveRecoveryByKey.delete(`draft:${recoveryKey}`)) {
      didDelete = true
    }

    if (normalizedFilePath && autosaveRecoveryByKey.delete(`file:${normalizedFilePath}`)) {
      didDelete = true
    }

    if (didDelete) {
      markAutosaveRecoveryDirty()
    }
  }

  function getLatest() {
    const entries = Array.from(autosaveRecoveryByKey.values())
      .filter((entry) => !normalizeRecoveryFilePath(entry?.snapshot?.currentFilePath))
      .filter((entry) => entry?.snapshot?.isUntouchedUntitledBuffer !== true)
    entries.sort((left, right) => Date.parse(right.savedAt) - Date.parse(left.savedAt))
    return entries[0] || null
  }

  function getByRecoveryKey(recoveryKey) {
    const normalizedRecoveryKey = typeof recoveryKey === 'string' && recoveryKey.trim().length > 0
      ? recoveryKey.trim()
      : null

    if (!normalizedRecoveryKey) {
      return null
    }

    return autosaveRecoveryByKey.get(normalizedRecoveryKey)
      || autosaveRecoveryByKey.get(`draft:${normalizedRecoveryKey}`)
      || null
  }

  function getForFile(filePath) {
    const normalizedFilePath = normalizeRecoveryFilePath(filePath)

    if (!normalizedFilePath) {
      return null
    }

    return autosaveRecoveryByKey.get(`file:${normalizedFilePath}`) || null
  }

  return {
    clear,
    flushSync,
    getByRecoveryKey,
    getForFile,
    getLatest,
    load,
    normalizeRecoveryFilePath,
    upsert,
  }
}

export {
  createAutosaveRecoveryStore,
}
