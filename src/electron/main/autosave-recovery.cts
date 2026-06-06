const fs = require('node:fs') as typeof import('node:fs')
const fsPromises = require('node:fs/promises') as typeof import('node:fs/promises')
const path = require('node:path') as typeof import('node:path')
const { randomUUID } = require('node:crypto') as typeof import('node:crypto')

type ActivePanel = 'preview' | 'write'

type PendingImportedAsset = {
  filePath: string
  relativePath: string
}

type RecoverySnapshot = {
  markdownText: string
  persistedMarkdown: string
  currentFilePath: string | null
  fileSnapshot: Record<string, unknown> | null
  draftWorkspace: Record<string, unknown> | null
  pendingImportedAssets: PendingImportedAsset[]
  displayTitle: string
  activePanel: ActivePanel
  isUntouchedUntitledBuffer: boolean
  recoveryKey: string
}

type RecoveryEntry = {
  recoveryKey: string
  savedAt: string
  snapshot: RecoverySnapshot
}

type AutosaveRecoveryStoreOptions = {
  autosaveRecoveryPath: string
  getUntitledTitle: () => string
  writeLog: (level: string, scope: string, ...parts: unknown[]) => void
}

type UpsertRecoveryPayload = {
  markdownText?: unknown
  persistedMarkdown?: unknown
  currentFilePath?: unknown
  fileSnapshot?: unknown
  draftWorkspace?: unknown
  pendingImportedAssets?: unknown
  displayTitle?: unknown
  activePanel?: unknown
  isUntouchedUntitledBuffer?: unknown
  recoveryKey?: unknown
}

type ClearRecoveryPayload = {
  recoveryKey?: unknown
  filePath?: unknown
}

type StoredEntryRecord = {
  recoveryKey?: unknown
  savedAt?: unknown
  snapshot?: unknown
}

type AutosaveRecoveryStore = {
  clear: (payload?: ClearRecoveryPayload) => void
  flushSync: () => void
  getByRecoveryKey: (recoveryKey: unknown) => RecoveryEntry | null
  getForFile: (filePath: unknown) => RecoveryEntry | null
  getLatest: () => RecoveryEntry | null
  load: () => void
  normalizeRecoveryFilePath: (filePath: unknown) => string | null
  upsert: (snapshot: UpsertRecoveryPayload) => { recoveryKey: string, savedAt: string }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function isPendingImportedAsset(value: unknown): value is PendingImportedAsset {
  return isObjectRecord(value) && typeof value.filePath === 'string' && typeof value.relativePath === 'string'
}

function createAutosaveRecoveryStore(options: AutosaveRecoveryStoreOptions): AutosaveRecoveryStore {
  const { autosaveRecoveryPath, getUntitledTitle, writeLog } = options
  const autosaveRecoveryByKey = new Map<string, RecoveryEntry>()
  let autosaveRecoveryDirty = false
  let autosaveRecoverySaveTimer: ReturnType<typeof setTimeout> | null = null

  function normalizeRecoveryFilePath(filePath: unknown) {
    return typeof filePath === 'string' && filePath.trim().length > 0 ? path.resolve(filePath) : null
  }

  function buildRecoveryStorageKey(snapshot: UpsertRecoveryPayload) {
    const normalizedFilePath = normalizeRecoveryFilePath(snapshot?.currentFilePath)

    if (normalizedFilePath) {
      return `file:${normalizedFilePath}`
    }

    if (typeof snapshot?.recoveryKey === 'string' && snapshot.recoveryKey.trim().length > 0) {
      return `draft:${snapshot.recoveryKey.trim()}`
    }

    return `draft:${randomUUID()}`
  }

  function inferUntouchedUntitledBuffer(snapshot: UpsertRecoveryPayload) {
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

      const parsed: unknown = JSON.parse(fs.readFileSync(autosaveRecoveryPath, 'utf8'))
      const parsedRecord = isObjectRecord(parsed) ? parsed : null
      const entries = Array.isArray(parsedRecord?.entries) ? parsedRecord.entries : []

      for (const entry of entries) {
        const entryRecord = isObjectRecord(entry) ? entry as StoredEntryRecord : null
        if (!entryRecord || typeof entryRecord.recoveryKey !== 'string' || typeof entryRecord.savedAt !== 'string' || !isObjectRecord(entryRecord.snapshot)) {
          continue
        }

        const snapshot = entryRecord.snapshot

        if (
          typeof snapshot.markdownText !== 'string'
          || typeof snapshot.persistedMarkdown !== 'string'
          || typeof snapshot.displayTitle !== 'string'
        ) {
          continue
        }

        const normalizedRecoveryKey = typeof snapshot.recoveryKey === 'string' && snapshot.recoveryKey.trim().length > 0
          ? snapshot.recoveryKey.trim()
          : entryRecord.recoveryKey.replace(/^draft:/, '')

        autosaveRecoveryByKey.set(entryRecord.recoveryKey, {
          recoveryKey: entryRecord.recoveryKey,
          savedAt: entryRecord.savedAt,
          snapshot: {
            markdownText: snapshot.markdownText,
            persistedMarkdown: snapshot.persistedMarkdown,
            currentFilePath: normalizeRecoveryFilePath(snapshot.currentFilePath),
            fileSnapshot: isObjectRecord(snapshot.fileSnapshot) ? snapshot.fileSnapshot : null,
            draftWorkspace: isObjectRecord(snapshot.draftWorkspace) ? snapshot.draftWorkspace : null,
            pendingImportedAssets: Array.isArray(snapshot.pendingImportedAssets)
              ? snapshot.pendingImportedAssets.filter(isPendingImportedAsset)
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

  function upsert(snapshot: UpsertRecoveryPayload) {
    const recoveryKey = buildRecoveryStorageKey(snapshot)
    const savedAt = new Date().toISOString()
    const normalizedSnapshot: RecoverySnapshot = {
      markdownText: typeof snapshot?.markdownText === 'string' ? snapshot.markdownText : '',
      persistedMarkdown: typeof snapshot?.persistedMarkdown === 'string' ? snapshot.persistedMarkdown : '',
      currentFilePath: normalizeRecoveryFilePath(snapshot?.currentFilePath),
      fileSnapshot: isObjectRecord(snapshot?.fileSnapshot) ? snapshot.fileSnapshot : null,
      draftWorkspace: isObjectRecord(snapshot?.draftWorkspace) ? snapshot.draftWorkspace : null,
      pendingImportedAssets: Array.isArray(snapshot?.pendingImportedAssets)
        ? snapshot.pendingImportedAssets.filter(isPendingImportedAsset)
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

  function clear(payload: ClearRecoveryPayload = {}) {
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
      .filter((entry) => !normalizeRecoveryFilePath(entry.snapshot.currentFilePath))
      .filter((entry) => entry.snapshot.isUntouchedUntitledBuffer !== true)
    entries.sort((left, right) => Date.parse(right.savedAt) - Date.parse(left.savedAt))
    return entries[0] || null
  }

  function getByRecoveryKey(recoveryKey: unknown) {
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

  function getForFile(filePath: unknown) {
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
