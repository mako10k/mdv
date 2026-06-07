// @ts-nocheck
const path = require('node:path') as typeof import('node:path')

function createSemanticCacheController({
  semanticCachePath,
  fs,
  writeLog,
}) {
  let semanticCacheDidLoad = false
  let semanticCacheDirty = false
  let semanticCacheSaveTimer = null
  const embeddingCacheByKey = new Map()
  const semanticRuntimeBySourceKey = new Map()
  let embeddingCacheTotalBytes = 0
  let embeddingUsageCountsNeedRepair = false
  let embeddingCacheGcTimer = null
  let embeddingCacheGcScheduledForAt = 0

  const MAX_SEMANTIC_INDEX_BYTES = 1024 * 1024
  const MAX_EMBEDDING_CACHE_BYTES = 256 * 1024 * 1024
  const EMBEDDING_CACHE_TOUCH_INTERVAL_MS = 15_000
  const EMBEDDING_CACHE_GC_IDLE_DELAY_MS = 120_000
  const EMBEDDING_CACHE_GC_PRESSURE_DELAY_MS = 250
  const MAX_SEMANTIC_RUNTIME_COUNT = 24
  const MAX_SEMANTIC_RUNTIME_AGE_MS = 15 * 60_000
  const SEMANTIC_RUNTIME_TOUCH_INTERVAL_MS = 15_000
  const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small'

  function estimateEmbeddingCacheEntryBytes(key, model, text, embedding) {
    const keyBytes = Buffer.byteLength(typeof key === 'string' ? key : '', 'utf8')
    const modelBytes = Buffer.byteLength(typeof model === 'string' ? model : '', 'utf8')
    const textBytes = Buffer.byteLength(typeof text === 'string' ? text : '', 'utf8')
    const embeddingBytes = Array.isArray(embedding) ? embedding.length * 4 : 0
    return keyBytes + modelBytes + textBytes + embeddingBytes + 128
  }

  function buildEmbeddingCacheEntry(key, model, text, embedding, createdAt = new Date().toISOString(), lastUsedAt = createdAt) {
    return {
      key,
      model,
      text,
      embedding,
      textLength: typeof text === 'string' ? text.length : 0,
      createdAt,
      lastUsedAt,
      usingCount: 0,
      byteSize: estimateEmbeddingCacheEntryBytes(key, model, text, embedding),
    }
  }

  function upsertEmbeddingCacheEntry(entry) {
    const existingEntry = embeddingCacheByKey.get(entry.key)

    if (existingEntry) {
      embeddingCacheTotalBytes -= existingEntry.byteSize || 0
      if (!Number.isFinite(entry.usingCount)) {
        entry.usingCount = existingEntry.usingCount || 0
      }
    }

    embeddingCacheByKey.set(entry.key, entry)
    embeddingCacheTotalBytes += entry.byteSize || 0
  }

  function removeEmbeddingCacheEntry(key) {
    const existingEntry = embeddingCacheByKey.get(key)

    if (!existingEntry) {
      return false
    }

    embeddingCacheTotalBytes -= existingEntry.byteSize || 0
    embeddingCacheByKey.delete(key)
    return true
  }

  function isEmbeddingCacheOverLimit() {
    return embeddingCacheTotalBytes > MAX_EMBEDDING_CACHE_BYTES
  }

  function touchEmbeddingCacheEntry(key, textOverride = undefined) {
    const existingEntry = embeddingCacheByKey.get(key)

    if (!existingEntry) {
      return null
    }

    const nextText = typeof textOverride === 'string' ? textOverride : existingEntry.text
    const nextLastUsedAt = new Date().toISOString()
    const shouldRefreshUsageTime = Date.parse(nextLastUsedAt) - Date.parse(existingEntry.lastUsedAt) >= EMBEDDING_CACHE_TOUCH_INTERVAL_MS
    const didTextChange = nextText !== existingEntry.text

    if (!shouldRefreshUsageTime && !didTextChange) {
      return existingEntry
    }

    const nextEntry = {
      ...existingEntry,
      text: nextText,
      textLength: typeof nextText === 'string' ? nextText.length : 0,
      lastUsedAt: shouldRefreshUsageTime ? nextLastUsedAt : existingEntry.lastUsedAt,
      byteSize: estimateEmbeddingCacheEntryBytes(key, existingEntry.model, nextText, existingEntry.embedding),
    }

    upsertEmbeddingCacheEntry(nextEntry)

    if (didTextChange) {
      scheduleSemanticCachePersist()
    }

    return nextEntry
  }

  function markEmbeddingUsageCountsDirty() {
    embeddingUsageCountsNeedRepair = true
  }

  function repairEmbeddingUsageCounts() {
    if (!embeddingUsageCountsNeedRepair) {
      return false
    }

    const desiredUsingCountByKey = new Map()

    for (const runtime of semanticRuntimeBySourceKey.values()) {
      if (!Array.isArray(runtime.cacheKeys)) {
        continue
      }

      for (const cacheKey of runtime.cacheKeys) {
        desiredUsingCountByKey.set(cacheKey, (desiredUsingCountByKey.get(cacheKey) || 0) + 1)
      }
    }

    let didRepair = false

    for (const entry of embeddingCacheByKey.values()) {
      const desiredUsingCount = desiredUsingCountByKey.get(entry.key) || 0

      if ((entry.usingCount || 0) === desiredUsingCount) {
        continue
      }

      upsertEmbeddingCacheEntry({
        ...entry,
        usingCount: desiredUsingCount,
      })
      didRepair = true
    }

    embeddingUsageCountsNeedRepair = false
    return didRepair
  }

  function getSemanticRuntimeLastUsedTime(runtime) {
    if (!runtime) {
      return 0
    }

    const timestamp = runtime.lastUsedAt || runtime.builtAt
    return Date.parse(timestamp)
  }

  function pruneSemanticRuntimes(now = Date.now()) {
    const removableSourceKeys = []

    for (const [sourceKey, runtime] of semanticRuntimeBySourceKey.entries()) {
      const lastUsedAt = getSemanticRuntimeLastUsedTime(runtime)

      if (Number.isFinite(lastUsedAt) && now - lastUsedAt > MAX_SEMANTIC_RUNTIME_AGE_MS) {
        removableSourceKeys.push(sourceKey)
      }
    }

    if (semanticRuntimeBySourceKey.size - removableSourceKeys.length > MAX_SEMANTIC_RUNTIME_COUNT) {
      const overflow = semanticRuntimeBySourceKey.size - removableSourceKeys.length - MAX_SEMANTIC_RUNTIME_COUNT
      const protectedSourceKeys = new Set(removableSourceKeys)
      const oldestRuntimes = Array.from(semanticRuntimeBySourceKey.entries())
        .filter(([sourceKey]) => !protectedSourceKeys.has(sourceKey))
        .sort((left, right) => getSemanticRuntimeLastUsedTime(left[1]) - getSemanticRuntimeLastUsedTime(right[1]))
        .slice(0, overflow)

      for (const [sourceKey] of oldestRuntimes) {
        removableSourceKeys.push(sourceKey)
      }
    }

    if (removableSourceKeys.length === 0) {
      return false
    }

    let didRemove = false

    for (const sourceKey of removableSourceKeys) {
      const removedRuntime = deleteSemanticRuntimeBySourceKey(sourceKey)
      if (removedRuntime) {
        didRemove = true
      }
    }

    if (didRemove) {
      markEmbeddingUsageCountsDirty()
    }

    return didRemove
  }

  function scheduleEmbeddingCacheGc(options = {}) {
    const pressure = options.pressure === true || isEmbeddingCacheOverLimit()
    const delayMs = pressure ? EMBEDDING_CACHE_GC_PRESSURE_DELAY_MS : EMBEDDING_CACHE_GC_IDLE_DELAY_MS
    const nextRunAt = Date.now() + delayMs

    if (embeddingCacheGcTimer && embeddingCacheGcScheduledForAt <= nextRunAt) {
      return
    }

    if (embeddingCacheGcTimer) {
      clearTimeout(embeddingCacheGcTimer)
    }

    embeddingCacheGcScheduledForAt = nextRunAt
    embeddingCacheGcTimer = setTimeout(() => {
      embeddingCacheGcTimer = null
      embeddingCacheGcScheduledForAt = 0
      runEmbeddingCacheGc()
    }, delayMs)
  }

  function runEmbeddingCacheGc() {
    pruneSemanticRuntimes()
    repairEmbeddingUsageCounts()
    evictEmbeddingCacheEntriesIfNeeded()
  }

  function evictEmbeddingCacheEntriesIfNeeded() {
    if (embeddingCacheTotalBytes <= MAX_EMBEDDING_CACHE_BYTES) {
      return
    }

    const evictionCandidates = Array.from(embeddingCacheByKey.values())
      .filter((entry) => (entry.usingCount || 0) === 0)
      .sort((left, right) => Date.parse(left.lastUsedAt) - Date.parse(right.lastUsedAt))

    let evictedCount = 0

    for (const entry of evictionCandidates) {
      if (embeddingCacheTotalBytes <= MAX_EMBEDDING_CACHE_BYTES) {
        break
      }

      if (removeEmbeddingCacheEntry(entry.key)) {
        evictedCount += 1
      }
    }

    if (evictedCount > 0) {
      scheduleSemanticCachePersist()
    }

    if (embeddingCacheTotalBytes > MAX_EMBEDDING_CACHE_BYTES) {
      writeLog('INFO', 'semantic-search', 'Embedding cache remains above limit because all remaining entries are in use', {
        embeddingCacheTotalBytes,
        maxBytes: MAX_EMBEDDING_CACHE_BYTES,
      })
    }
  }

  function releaseSemanticRuntime(runtime) {
    if (!runtime) {
      return
    }

    markEmbeddingUsageCountsDirty()
    scheduleEmbeddingCacheGc()
  }

  function deleteSemanticRuntimeBySourceKey(sourceKey) {
    const runtime = semanticRuntimeBySourceKey.get(sourceKey)

    if (!runtime) {
      return null
    }

    semanticRuntimeBySourceKey.delete(sourceKey)
    return runtime
  }

  function clearSemanticRuntimeBySourceKey(sourceKey) {
    const runtime = deleteSemanticRuntimeBySourceKey(sourceKey)

    if (!runtime) {
      return false
    }

    releaseSemanticRuntime(runtime)
    return true
  }

  function clearSemanticRuntimesForEditorId(editorId) {
    for (const [sourceKey, runtime] of semanticRuntimeBySourceKey.entries()) {
      if (runtime.editorId === editorId) {
        clearSemanticRuntimeBySourceKey(sourceKey)
      }
    }
  }

  function clearSemanticRuntimesForTarget(editorId, span, exceptSourceKey = null) {
    for (const [sourceKey, runtime] of semanticRuntimeBySourceKey.entries()) {
      if (sourceKey === exceptSourceKey) {
        continue
      }

      if (runtime.editorId !== editorId) {
        continue
      }

      if (runtime.span.start.line !== span.start.line || runtime.span.start.column !== span.start.column) {
        continue
      }

      if (runtime.span.end.line !== span.end.line || runtime.span.end.column !== span.end.column) {
        continue
      }

      clearSemanticRuntimeBySourceKey(sourceKey)
    }
  }

  function touchSemanticRuntime(runtime) {
    if (!runtime || !Array.isArray(runtime.cacheKeys)) {
      return runtime
    }

    const nowIsoString = new Date().toISOString()
    const shouldRefreshRuntimeTime = Date.parse(nowIsoString) - getSemanticRuntimeLastUsedTime(runtime) >= SEMANTIC_RUNTIME_TOUCH_INTERVAL_MS

    for (const cacheKey of runtime.cacheKeys) {
      touchEmbeddingCacheEntry(cacheKey)
    }

    if (shouldRefreshRuntimeTime) {
      runtime.lastUsedAt = nowIsoString
    }

    return runtime
  }

  function loadSemanticCacheIfNeeded() {
    if (semanticCacheDidLoad) {
      return
    }

    semanticCacheDidLoad = true

    try {
      if (!fs.existsSync(semanticCachePath)) {
        return
      }

      const raw = fs.readFileSync(semanticCachePath, 'utf8')
      const parsed = JSON.parse(raw)
      const entries = Array.isArray(parsed?.entries) ? parsed.entries : []

      for (const entry of entries) {
        if (typeof entry?.key !== 'string' || !Array.isArray(entry?.embedding) || typeof entry?.text !== 'string') {
          continue
        }

        upsertEmbeddingCacheEntry(buildEmbeddingCacheEntry(
          entry.key,
          typeof entry.model === 'string' ? entry.model : DEFAULT_EMBEDDING_MODEL,
          entry.text,
          entry.embedding,
          typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString(),
          typeof entry.lastUsedAt === 'string' ? entry.lastUsedAt : (typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString()),
        ))
      }

      runEmbeddingCacheGc()
    } catch (error) {
      writeLog('WARN', 'semantic-search', 'Failed to load semantic cache', error instanceof Error ? error.message : String(error))
    }
  }

  function scheduleSemanticCachePersist() {
    semanticCacheDirty = true

    if (semanticCacheSaveTimer) {
      return
    }

    semanticCacheSaveTimer = setTimeout(() => {
      semanticCacheSaveTimer = null
      if (!semanticCacheDirty) {
        return
      }

      semanticCacheDirty = false

      try {
        fs.mkdirSync(path.dirname(semanticCachePath), { recursive: true })
        const entries = Array.from(embeddingCacheByKey.values())
          .sort((left, right) => Date.parse(right.lastUsedAt) - Date.parse(left.lastUsedAt))
          .map((value) => ({
          key: value.key,
          model: value.model,
          text: value.text,
          embedding: value.embedding,
          textLength: value.textLength,
          createdAt: value.createdAt,
          lastUsedAt: value.lastUsedAt,
        }))
        fs.writeFileSync(semanticCachePath, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`, 'utf8')
      } catch (error) {
      }
    }, 1000)
  }

  function getEmbeddingCacheEntry(key) {
    return embeddingCacheByKey.get(key) || null
  }

  function getSemanticRuntime(sourceKey) {
    return semanticRuntimeBySourceKey.get(sourceKey) || null
  }

  function setSemanticRuntime(sourceKey, runtime) {
    semanticRuntimeBySourceKey.set(sourceKey, runtime)
  }

  function getAllEmbeddingCacheEntries() {
    return Array.from(embeddingCacheByKey.values())
  }

  function getEmbeddingCacheTotalBytes() {
    return embeddingCacheTotalBytes
  }

  function getSemanticRuntimeBySourceKeyMap() {
    return semanticRuntimeBySourceKey
  }

  // expose internal for prune etc if needed, but prefer methods

  return {
    loadSemanticCacheIfNeeded,
    scheduleSemanticCachePersist,
    touchEmbeddingCacheEntry,
    upsertEmbeddingCacheEntry,
    removeEmbeddingCacheEntry,
    isEmbeddingCacheOverLimit,
    markEmbeddingUsageCountsDirty,
    repairEmbeddingUsageCounts,
    getSemanticRuntimeLastUsedTime,
    pruneSemanticRuntimes,
    scheduleEmbeddingCacheGc,
    runEmbeddingCacheGc,
    evictEmbeddingCacheEntriesIfNeeded,
    releaseSemanticRuntime,
    clearSemanticRuntimeBySourceKey,
    clearSemanticRuntimesForEditorId,
    clearSemanticRuntimesForTarget,
    touchSemanticRuntime,
    getEmbeddingCacheEntry,
    getSemanticRuntime,
    setSemanticRuntime,
    buildEmbeddingCacheEntry,
  }
}

module.exports = {
  createSemanticCacheController,
  buildEmbeddingCacheEntry,
}
