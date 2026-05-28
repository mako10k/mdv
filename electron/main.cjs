const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron')
const fs = require('node:fs')
const fsPromises = require('node:fs/promises')
const dnsPromises = require('node:dns/promises')
const net = require('node:net')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const OpenAI = require('openai')

const isDev = !app.isPackaged
const windowIcon = path.join(__dirname, '..', 'build', 'icon.png')
const allowedLinkRulesPath = path.join(app.getPath('userData'), 'allowed-link-rules.json')
const settingsPath = path.join(app.getPath('userData'), 'settings.json')
const secretsPath = path.join(app.getPath('userData'), 'secrets.json')
const semanticCachePath = path.join(app.getPath('userData'), 'semantic-cache-v1.json')
const managedServerUrl = process.env.MDV_SERVER_URL || null
const managedClientId = process.env.MDV_CLIENT_ID || null
const managedWindowId = process.env.MDV_WINDOW_ID || managedClientId || null
const appDisplayName = 'MarkDownViewer'
const defaultOpenAiModel = process.env.MDV_OPENAI_MODEL || 'gpt-5.4-mini'

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')
app.setName(appDisplayName)
app.setAppLogsPath()

const logFilePath = path.join(app.getPath('logs'), 'mdv.log')
let allowedLinkRules = loadAllowedLinkRules()
let pendingLaunchRequest = resolveLaunchRequest(process.argv)
let managedMainWindow = null
let commandPollTimer = null
const pendingServerRequests = new Map()
const editorToAiChatWindowId = new Map()
const aiChatToEditorWindowId = new Map()
const pendingAiEditorRequests = new Map()
const launchStateByWindowId = new Map()
const editorRuntimeStateByWindowId = new Map()
const aiSessionBuffersByEditorWindowId = new Map()
const DEFAULT_MODEL_CONTEXT_WINDOW = 16000
const MODEL_CONTEXT_WINDOW_BY_NAME = {
  'gpt-5.4-mini': 128000,
}
const DEFAULT_TOKEN_TO_CHAR_RATIO = 4
const DEFAULT_FETCH_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_FETCH_IDLE_TIMEOUT_MS = 5_000
const DEFAULT_FETCH_AUTO_DISPOSE_AFTER_MS = 15 * 60_000
const DEFAULT_FETCH_MAX_RESPONSE_BYTES = 512 * 1024
const MAX_FETCH_REDIRECTS = 5
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small'
const MAX_SEMANTIC_INDEX_BYTES = 1024 * 1024
const MAX_EMBEDDING_CACHE_BYTES = 256 * 1024 * 1024
const EMBEDDING_CACHE_TOUCH_INTERVAL_MS = 15_000
const EMBEDDING_CACHE_GC_IDLE_DELAY_MS = 120_000
const EMBEDDING_CACHE_GC_PRESSURE_DELAY_MS = 250
const MAX_SEMANTIC_RUNTIME_COUNT = 24
const MAX_SEMANTIC_RUNTIME_AGE_MS = 15 * 60_000
const SEMANTIC_RUNTIME_TOUCH_INTERVAL_MS = 15_000
const SEMANTIC_LAYERS = [
  { name: 'fine', maxChars: 900, overlapChars: 180, weight: 1 },
  { name: 'medium', maxChars: 2800, overlapChars: 560, weight: 0.97 },
  { name: 'coarse', maxChars: 7200, overlapChars: 1200, weight: 0.94 },
]
let settingsWindow = null
let settingsWindowOwnerEditorId = null
let fetchPermissionsWindow = null
let fetchPermissionsWindowOwnerEditorId = null
const approvedWindowCloseIds = new Set()
const pendingWindowCloseIds = new Set()
let settingsState = loadSettings()
let secretsState = loadSecrets()
let hasPersistedSettings = fs.existsSync(settingsPath)
let hasReadableSettings = loadSettings.didLoadPersisted === true

let semanticCacheDidLoad = false
let semanticCacheDirty = false
let semanticCacheSaveTimer = null
const embeddingCacheByKey = new Map()
const semanticRuntimeBySourceKey = new Map()
let embeddingCacheTotalBytes = 0
let embeddingUsageCountsNeedRepair = false
let embeddingCacheGcTimer = null
let embeddingCacheGcScheduledForAt = 0

function isManagedClient() {
  return Boolean(managedServerUrl && managedClientId && managedWindowId)
}

function estimateTokenCount(text) {
  return typeof text === 'string' && text.length > 0 ? Math.ceil(text.length / DEFAULT_TOKEN_TO_CHAR_RATIO) : 0
}

function getModelContextWindow(model) {
  return MODEL_CONTEXT_WINDOW_BY_NAME[model] || DEFAULT_MODEL_CONTEXT_WINDOW
}

function getInlineTokenBudget() {
  return Math.max(512, Math.floor(getModelContextWindow(settingsState.ai.openai.model) * 0.05))
}

function resolveReadTokenBudget(maxTokens) {
  const configuredBudget = getInlineTokenBudget()
  const numericValue = Number(maxTokens)

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return configuredBudget
  }

  return Math.min(configuredBudget, Math.round(numericValue))
}

function hashText(text) {
  return createHash('sha256').update(text || '').digest('hex')
}

function buildEmbeddingCacheKey(model, text) {
  return `${model}:${hashText(text)}`
}

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

function deleteSemanticRuntimeBySourceKey(sourceKey) {
  const runtime = semanticRuntimeBySourceKey.get(sourceKey)

  if (!runtime) {
    return null
  }

  semanticRuntimeBySourceKey.delete(sourceKey)
  return runtime
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
      writeLog('WARN', 'semantic-search', 'Failed to persist semantic cache', error instanceof Error ? error.message : String(error))
    }
  }, 1000)
}

function getSemanticSourceKey(targetText) {
  return [
    targetText.editorId,
    targetText.span.start.line,
    targetText.span.start.column,
    targetText.span.end.line,
    targetText.span.end.column,
    hashText(targetText.text),
  ].join(':')
}

function adjustChunkBoundary(text, offset, direction) {
  const clampedOffset = Math.min(Math.max(0, offset), text.length)

  if (clampedOffset <= 0 || clampedOffset >= text.length) {
    return clampedOffset
  }

  if (direction === 'end') {
    const newlineOffset = text.indexOf('\n', clampedOffset)
    return newlineOffset === -1 ? text.length : newlineOffset + 1
  }

  const newlineOffset = text.lastIndexOf('\n', clampedOffset - 1)
  return newlineOffset === -1 ? 0 : newlineOffset + 1
}

function localOffsetToAbsolutePos(baseStart, text, offset) {
  let line = baseStart.line
  let column = baseStart.column

  for (let index = 0; index < offset; index += 1) {
    if (text[index] === '\n') {
      line += 1
      column = 1
    } else {
      column += 1
    }
  }

  return { line, column }
}

function buildSemanticChunksForTarget(targetText) {
  const chunks = []

  for (const layer of SEMANTIC_LAYERS) {
    let startOffset = 0

    while (startOffset < targetText.text.length) {
      let endOffset = Math.min(targetText.text.length, startOffset + layer.maxChars)
      endOffset = adjustChunkBoundary(targetText.text, endOffset, 'end')

      if (endOffset <= startOffset) {
        endOffset = Math.min(targetText.text.length, startOffset + layer.maxChars)
      }

      const sliceText = targetText.text.slice(startOffset, endOffset)

      if (sliceText.trim().length > 0) {
        chunks.push({
          id: `${layer.name}:${startOffset}:${endOffset}`,
          layer: layer.name,
          weight: layer.weight,
          startOffset,
          endOffset,
          text: sliceText,
          cacheKey: buildEmbeddingCacheKey(DEFAULT_EMBEDDING_MODEL, sliceText),
          span: {
            start: localOffsetToAbsolutePos(targetText.span.start, targetText.text, startOffset),
            end: localOffsetToAbsolutePos(targetText.span.start, targetText.text, endOffset),
            isEmpty: sliceText.length === 0,
          },
        })
      }

      if (endOffset >= targetText.text.length) {
        break
      }

      startOffset = Math.max(startOffset + 1, endOffset - layer.overlapChars)
      startOffset = adjustChunkBoundary(targetText.text, startOffset, 'start')
    }
  }

  return chunks
}

async function ensureEmbeddingCacheEntries(texts, model = DEFAULT_EMBEDDING_MODEL) {
  loadSemanticCacheIfNeeded()

  const uniqueTexts = Array.from(new Set(texts.filter((text) => typeof text === 'string' && text.trim().length > 0)))
  const missingTexts = uniqueTexts.filter((text) => {
    const cacheKey = buildEmbeddingCacheKey(model, text)
    const existingEntry = embeddingCacheByKey.get(cacheKey)

    if (!existingEntry) {
      return true
    }

    touchEmbeddingCacheEntry(cacheKey, text)
    return false
  })

  if (missingTexts.length === 0) {
    if (isEmbeddingCacheOverLimit()) {
      scheduleEmbeddingCacheGc({ pressure: true })
    }
    return
  }

  const client = createOpenAiClient()

  for (let index = 0; index < missingTexts.length; index += 32) {
    const batch = missingTexts.slice(index, index + 32)
    const response = await client.embeddings.create({
      model,
      input: batch,
    })

    response.data.forEach((entry, entryIndex) => {
      const text = batch[entryIndex]
      const key = buildEmbeddingCacheKey(model, text)
      upsertEmbeddingCacheEntry(buildEmbeddingCacheEntry(key, model, text, entry.embedding))
    })
  }

  scheduleEmbeddingCacheGc({ pressure: true })
  scheduleSemanticCachePersist()
}

function cosineSimilarity(left, right) {
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0

  const length = Math.min(left.length, right.length)

  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index]
    const rightValue = right[index]
    dot += leftValue * rightValue
    leftNorm += leftValue * leftValue
    rightNorm += rightValue * rightValue
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

function createEditorRuntimeState() {
  const timestamp = new Date().toISOString()

  return {
    editorId: `editor:${randomUUID()}`,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function ensureEditorRuntimeState(editorWindow) {
  const existingState = editorRuntimeStateByWindowId.get(editorWindow.id)

  if (existingState) {
    return existingState
  }

  const nextState = createEditorRuntimeState()
  editorRuntimeStateByWindowId.set(editorWindow.id, nextState)
  return nextState
}

function touchEditorRuntimeState(editorWindow) {
  const state = ensureEditorRuntimeState(editorWindow)
  state.updatedAt = new Date().toISOString()
  return state
}

function clearEditorRuntimeState(windowId) {
  const runtimeState = editorRuntimeStateByWindowId.get(windowId)

  if (runtimeState?.editorId) {
    clearSemanticRuntimesForEditorId(runtimeState.editorId)
  }

  editorRuntimeStateByWindowId.delete(windowId)
  clearSessionBuffersForWindow(windowId)
}

function getSessionBufferRegistry(editorWindow) {
  const existingRegistry = aiSessionBuffersByEditorWindowId.get(editorWindow.id)

  if (existingRegistry) {
    return existingRegistry
  }

  const nextRegistry = new Map()
  aiSessionBuffersByEditorWindowId.set(editorWindow.id, nextRegistry)
  return nextRegistry
}

function clearSessionBufferTimer(bufferRecord) {
  if (!bufferRecord?.disposeTimer) {
    return
  }

  clearTimeout(bufferRecord.disposeTimer)
  bufferRecord.disposeTimer = null
}

function disposeSessionBuffer(editorWindow, editorId) {
  const registry = getSessionBufferRegistry(editorWindow)
  const bufferRecord = registry.get(editorId)

  if (!bufferRecord) {
    return false
  }

  clearSessionBufferTimer(bufferRecord)
  clearSemanticRuntimesForEditorId(bufferRecord.editorId)
  registry.delete(editorId)
  return true
}

function scheduleSessionBufferAutoDispose(editorWindow, bufferRecord) {
  clearSessionBufferTimer(bufferRecord)

  if (!bufferRecord || !Number.isFinite(bufferRecord.autoDisposeAfterMs) || bufferRecord.autoDisposeAfterMs <= 0) {
    bufferRecord.autoDisposeAt = null
    return
  }

  const autoDisposeAt = new Date(Date.now() + bufferRecord.autoDisposeAfterMs).toISOString()
  bufferRecord.autoDisposeAt = autoDisposeAt
  bufferRecord.disposeTimer = setTimeout(() => {
    disposeSessionBuffer(editorWindow, bufferRecord.editorId)
  }, bufferRecord.autoDisposeAfterMs)
}

function touchSessionBuffer(editorWindow, bufferRecord) {
  if (!bufferRecord) {
    return null
  }

  const timestamp = new Date().toISOString()
  bufferRecord.updatedAt = timestamp
  bufferRecord.lastAccessedAt = timestamp
  scheduleSessionBufferAutoDispose(editorWindow, bufferRecord)
  return bufferRecord
}

function createSessionBuffer(editorWindow, payload) {
  const registry = getSessionBufferRegistry(editorWindow)
  const timestamp = new Date().toISOString()
  const editorId = payload?.editorId || `buffer:${randomUUID()}`
  const bufferRecord = {
    editorId,
    kind: 'temp-buffer',
    title: typeof payload?.title === 'string' && payload.title.length > 0 ? payload.title : editorId,
    currentFilePath: null,
    isDirty: false,
    capabilities: {
      read: true,
      write: true,
      sliceOps: true,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    lastAccessedAt: timestamp,
    text: typeof payload?.text === 'string' ? payload.text : '',
    autoDisposeAfterMs: Number.isFinite(Number(payload?.autoDisposeAfterMs)) ? Number(payload.autoDisposeAfterMs) : 0,
    autoDisposeAt: null,
    disposeTimer: null,
  }

  registry.set(editorId, bufferRecord)
  return touchSessionBuffer(editorWindow, bufferRecord)
}

function getSessionBuffer(editorWindow, editorId) {
  const registry = getSessionBufferRegistry(editorWindow)
  const bufferRecord = registry.get(editorId) || null

  if (!bufferRecord) {
    return null
  }

  if (bufferRecord.autoDisposeAt && Date.parse(bufferRecord.autoDisposeAt) <= Date.now()) {
    disposeSessionBuffer(editorWindow, editorId)
    return null
  }

  return touchSessionBuffer(editorWindow, bufferRecord)
}

function clearSessionBuffersForWindow(windowId) {
  const registry = aiSessionBuffersByEditorWindowId.get(windowId)

  if (!registry) {
    return
  }

  for (const bufferRecord of registry.values()) {
    clearSessionBufferTimer(bufferRecord)
    clearSemanticRuntimesForEditorId(bufferRecord.editorId)
  }

  aiSessionBuffersByEditorWindowId.delete(windowId)
}

function isActiveEditorAlias(editorId) {
  return editorId === 'active' || editorId === 'editor:active'
}

function getMarkdownLineStartOffsets(markdown) {
  const offsets = [0]

  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] === '\n') {
      offsets.push(index + 1)
    }
  }

  return offsets
}

function clampMarkdownPos(markdown, position) {
  const lineStartOffsets = getMarkdownLineStartOffsets(markdown)
  const rawLine = Number(position?.line)
  const rawColumn = Number(position?.column)
  const line = Number.isFinite(rawLine) ? Math.trunc(rawLine) : 1
  const column = Number.isFinite(rawColumn) ? Math.trunc(rawColumn) : 1
  const clampedLine = Math.min(Math.max(1, line), lineStartOffsets.length)
  const lineStartOffset = lineStartOffsets[clampedLine - 1]
  const nextLineStartOffset = clampedLine < lineStartOffsets.length ? lineStartOffsets[clampedLine] : markdown.length
  const lineEndOffset = nextLineStartOffset > lineStartOffset && markdown[nextLineStartOffset - 1] === '\n'
    ? nextLineStartOffset - 1
    : nextLineStartOffset
  const lineLength = lineEndOffset - lineStartOffset

  return {
    line: clampedLine,
    column: Math.min(Math.max(1, column), lineLength + 1),
  }
}

function markdownPosToOffset(markdown, position) {
  const clampedPosition = clampMarkdownPos(markdown, position)
  const lineStartOffsets = getMarkdownLineStartOffsets(markdown)
  return lineStartOffsets[clampedPosition.line - 1] + clampedPosition.column - 1
}

function offsetToMarkdownPos(markdown, offset) {
  const normalizedOffset = Math.min(Math.max(0, Math.trunc(offset)), markdown.length)
  const lineStartOffsets = getMarkdownLineStartOffsets(markdown)
  let line = 1

  while (line < lineStartOffsets.length && lineStartOffsets[line] <= normalizedOffset) {
    line += 1
  }

  return {
    line,
    column: normalizedOffset - lineStartOffsets[line - 1] + 1,
  }
}

function normalizeOffsetsToSpan(markdown, startOffset, endOffset) {
  const normalizedStartOffset = Math.min(Math.max(0, startOffset), markdown.length)
  const normalizedEndOffset = Math.min(Math.max(normalizedStartOffset, endOffset), markdown.length)

  return {
    start: offsetToMarkdownPos(markdown, normalizedStartOffset),
    end: offsetToMarkdownPos(markdown, normalizedEndOffset),
    isEmpty: normalizedStartOffset === normalizedEndOffset,
  }
}

function isMarkdownPos(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && Number.isFinite(Number(value.line))
    && Number.isFinite(Number(value.column)),
  )
}

function normalizeMarkdownPos(value) {
  if (!isMarkdownPos(value)) {
    throw new Error('Invalid markdown position')
  }

  return {
    line: Math.max(1, Math.round(Number(value.line))),
    column: Math.max(1, Math.round(Number(value.column))),
  }
}

function normalizeAiSpanRef(span) {
  if (!span || typeof span !== 'object') {
    return { kind: 'document' }
  }

  if (span.kind === 'selection' || span.kind === 'document') {
    return { kind: span.kind }
  }

  if (span.kind === 'point' && isMarkdownPos(span.at)) {
    return {
      kind: 'point',
      at: normalizeMarkdownPos(span.at),
    }
  }

  if (span.kind === 'line' && Number.isFinite(Number(span.line))) {
    return {
      kind: 'line',
      line: Math.max(1, Math.round(Number(span.line))),
    }
  }

  if (span.kind === 'line-range' && Number.isFinite(Number(span.startLine)) && Number.isFinite(Number(span.endLine))) {
    const startLine = Math.max(1, Math.round(Number(span.startLine)))
    const endLine = Math.max(1, Math.round(Number(span.endLine)))
    return {
      kind: 'line-range',
      startLine: Math.min(startLine, endLine),
      endLine: Math.max(startLine, endLine),
    }
  }

  if (span.kind === 'from-start' && isMarkdownPos(span.end)) {
    return {
      kind: 'from-start',
      end: normalizeMarkdownPos(span.end),
    }
  }

  if (span.kind === 'to-end' && isMarkdownPos(span.start)) {
    return {
      kind: 'to-end',
      start: normalizeMarkdownPos(span.start),
    }
  }

  if (span.kind === 'range' && isMarkdownPos(span.start) && isMarkdownPos(span.end)) {
    return {
      kind: 'range',
      start: normalizeMarkdownPos(span.start),
      end: normalizeMarkdownPos(span.end),
    }
  }

  if (isMarkdownPos(span.start) && isMarkdownPos(span.end)) {
    return {
      kind: 'range',
      start: normalizeMarkdownPos(span.start),
      end: normalizeMarkdownPos(span.end),
    }
  }

  throw new Error(`Unsupported AI span payload: ${JSON.stringify(span)}`)
}

function normalizedSpanToSpanRef(span) {
  return {
    kind: 'range',
    start: normalizeMarkdownPos(span.start),
    end: normalizeMarkdownPos(span.end),
  }
}

function buildAiTargetRef(editorId, span) {
  return {
    editorId,
    span: normalizedSpanToSpanRef(span),
  }
}

function normalizeAiSliceRefSource(source) {
  if (!source || typeof source !== 'object' || source.type !== 'slice-ref') {
    return source
  }

  if (source.target && typeof source.target === 'object') {
    const hasExplicitTargetEditorId = typeof source.target.editorId === 'string' && source.target.editorId.length > 0
    const hasExplicitTargetSpan = source.target.span && typeof source.target.span === 'object'

    if (hasExplicitTargetEditorId && hasExplicitTargetSpan) {
      return {
        ...source,
        editorId: source.target.editorId,
        span: normalizeAiSpanRef(source.target.span),
      }
    }
  }

  const hasLegacyEditorId = typeof source.editorId === 'string' && source.editorId.length > 0
  const hasLegacySpan = source.span && typeof source.span === 'object'

  if (hasLegacyEditorId && hasLegacySpan) {
    return {
      ...source,
      editorId: source.editorId,
      span: normalizeAiSpanRef(source.span),
    }
  }

  throw new Error('Invalid AI slice-ref source target')
}

function normalizeSpanForResolvedTargetKind(targetKind, span) {
  if (!span || typeof span !== 'object') {
    throw new Error('AI target span is required')
  }

  if (targetKind === 'temp-buffer' && span.kind === 'selection') {
    return { kind: 'document' }
  }

  return span
}

function getLineBoundaryOffsets(markdown, line) {
  const totalLines = getMarkdownLineStartOffsets(markdown).length
  const clampedLine = Math.min(Math.max(1, Math.trunc(Number(line) || 1)), totalLines)
  const startOffset = markdownPosToOffset(markdown, { line: clampedLine, column: 1 })
  const endOffset = clampedLine < totalLines
    ? markdownPosToOffset(markdown, { line: clampedLine + 1, column: 1 })
    : markdown.length

  return { startOffset, endOffset }
}

function resolveSpanToOffsets(markdown, span) {
  if (!span || typeof span !== 'object') {
    throw new Error('AI target span is required')
  }

  if (span.kind === 'document') {
    return { startOffset: 0, endOffset: markdown.length }
  }

  if (span.kind === 'point') {
    const offset = markdownPosToOffset(markdown, span.at)
    return { startOffset: offset, endOffset: offset }
  }

  if (span.kind === 'line') {
    return getLineBoundaryOffsets(markdown, span.line)
  }

  if (span.kind === 'line-range') {
    const startLine = Math.min(span.startLine, span.endLine)
    const endLine = Math.max(span.startLine, span.endLine)
    const startOffsets = getLineBoundaryOffsets(markdown, startLine)
    const endOffsets = getLineBoundaryOffsets(markdown, endLine)
    return {
      startOffset: startOffsets.startOffset,
      endOffset: Math.max(startOffsets.startOffset, endOffsets.endOffset),
    }
  }

  if (span.kind === 'from-start') {
    return { startOffset: 0, endOffset: markdownPosToOffset(markdown, span.end) }
  }

  if (span.kind === 'to-end') {
    return { startOffset: markdownPosToOffset(markdown, span.start), endOffset: markdown.length }
  }

  if (span.kind === 'range') {
    const startOffset = markdownPosToOffset(markdown, span.start)
    const endOffset = markdownPosToOffset(markdown, span.end)
    return {
      startOffset: Math.min(startOffset, endOffset),
      endOffset: Math.max(startOffset, endOffset),
    }
  }

  throw new Error(`Unsupported non-editor span kind: ${span.kind}`)
}

function applyCursorToOffsets(markdown, offsets, cursor) {
  if (!cursor || typeof cursor !== 'object') {
    return offsets
  }

  const cursorOffset = markdownPosToOffset(markdown, cursor.after)
  return {
    startOffset: Math.min(offsets.endOffset, Math.max(offsets.startOffset, cursorOffset)),
    endOffset: offsets.endOffset,
  }
}

function buildBoundedReadPayload(editorId, markdown, span, cursor, maxTokens) {
  const resolvedOffsets = applyCursorToOffsets(markdown, resolveSpanToOffsets(markdown, span), cursor)
  const maxChars = resolveReadTokenBudget(maxTokens) * DEFAULT_TOKEN_TO_CHAR_RATIO
  const availableText = markdown.slice(resolvedOffsets.startOffset, resolvedOffsets.endOffset)
  const text = availableText.slice(0, maxChars)
  const finalEndOffset = resolvedOffsets.startOffset + text.length
  const truncated = availableText.length > text.length

  const normalizedSpan = normalizeOffsetsToSpan(markdown, resolvedOffsets.startOffset, finalEndOffset)
  const requestedTarget = {
    editorId,
    span: normalizeAiSpanRef(span),
  }

  return {
    editorId,
    span: normalizedSpan,
    target: requestedTarget,
    pageTarget: buildAiTargetRef(editorId, normalizedSpan),
    text,
    estimatedTokens: estimateTokenCount(text),
    truncated,
    nextCursor: truncated ? { after: offsetToMarkdownPos(markdown, finalEndOffset) } : null,
  }
}

async function readFullTargetTextForWindow(editorWindow, payload) {
  let cursor = payload?.cursor ?? null
  let text = ''
  let pageCount = 0
  let firstPage = null
  let lastPage = null
  const seenCursors = new Set()

  do {
    const page = await readAiTargetForWindow(editorWindow, {
      target: payload?.target,
      cursor,
      maxTokens: getInlineTokenBudget(),
    })

    if (!page) {
      break
    }

    if (!firstPage) {
      firstPage = page
    }

    lastPage = page
    text += page.text || ''
    cursor = page.nextCursor || null
    pageCount += 1

    if (!cursor) {
      break
    }

    const cursorKey = JSON.stringify(cursor)

    if (seenCursors.has(cursorKey)) {
      throw new Error('AI read cursor repeated while materializing full target text')
    }

    seenCursors.add(cursorKey)

    if (pageCount > 256) {
      throw new Error('AI read pagination exceeded safety limit')
    }
  } while (cursor)

  if (!firstPage || !lastPage) {
    const resolvedTarget = resolveTargetForSession(editorWindow, payload?.target)
    return {
      editorId: resolvedTarget.editorId,
      span: {
        start: { line: 1, column: 1 },
        end: { line: 1, column: 1 },
        isEmpty: true,
      },
      text: '',
    }
  }

  return {
    editorId: firstPage.editorId,
    span: {
      start: firstPage.span.start,
      end: lastPage.span.end,
      isEmpty: text.length === 0,
    },
    text,
  }
}

async function readFullEditorWindowSpan(editorWindow, target) {
  let cursor = null
  let firstPage = null
  let lastPage = null
  let pageCount = 0
  const seenCursors = new Set()

  do {
    const page = await requestEditorWindowData(editorWindow, {
      type: 'read',
      target,
      cursor,
      maxTokens: getInlineTokenBudget(),
    })

    if (!page) {
      break
    }

    if (!firstPage) {
      firstPage = page
    }

    lastPage = page
    cursor = page.nextCursor || null
    pageCount += 1

    if (!cursor) {
      break
    }

    const cursorKey = JSON.stringify(cursor)

    if (seenCursors.has(cursorKey)) {
      throw new Error('AI read cursor repeated while resolving editor span')
    }

    seenCursors.add(cursorKey)

    if (pageCount > 256) {
      throw new Error('AI read pagination exceeded safety limit while resolving editor span')
    }
  } while (cursor)

  if (!firstPage || !lastPage) {
    return {
      start: { line: 1, column: 1 },
      end: { line: 1, column: 1 },
      isEmpty: true,
    }
  }

  return {
    start: firstPage.span.start,
    end: lastPage.span.end,
    isEmpty: firstPage.span.isEmpty && lastPage.span.isEmpty,
  }
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function createSliceBufferTitle(prefix, query) {
  const trimmedQuery = typeof query === 'string' ? query.trim() : ''
  if (trimmedQuery.length === 0) {
    return prefix
  }

  return `${prefix}: ${trimmedQuery.slice(0, 48)}`
}

function createPreviewText(text, limit = 220) {
  const collapsed = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : ''
  if (collapsed.length <= limit) {
    return collapsed
  }

  return `${collapsed.slice(0, limit)}...`
}

function createMatchSpan(line, column, matchText) {
  return {
    start: { line, column },
    end: { line, column: column + (typeof matchText === 'string' ? matchText.length : 0) },
    isEmpty: !matchText,
  }
}

async function grepAiSliceForWindow(editorWindow, payload) {
  const query = typeof payload?.query === 'string' ? payload.query : ''

  if (query.length === 0) {
    throw new Error('Slice grep query is required')
  }

  const maxResults = Math.min(200, Math.max(1, Math.round(Number(payload?.maxResults) || 20)))
  const isRegexp = payload?.isRegexp === true
  const caseSensitive = payload?.caseSensitive === true
  const targetText = await readFullTargetTextForWindow(editorWindow, { target: payload?.target })
  const flags = caseSensitive ? 'g' : 'gi'
  const regexp = new RegExp(isRegexp ? query : escapeRegExp(query), flags)
  const lines = targetText.text.split(/\r?\n/)
  const matches = []
  const bufferLines = []
  let truncated = false

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const lineText = lines[lineIndex]
    regexp.lastIndex = 0
    const absoluteLine = targetText.span.start.line + lineIndex

    while (true) {
      const match = regexp.exec(lineText)

      if (!match) {
        break
      }

      const columnOffset = lineIndex === 0 ? Math.max(0, targetText.span.start.column - 1) : 0
      const absoluteColumn = columnOffset + (match.index || 0) + 1

      const result = {
        line: absoluteLine,
        column: absoluteColumn,
        preview: lineText,
        span: createMatchSpan(absoluteLine, absoluteColumn, match[0] || ''),
      }
      result.target = buildAiTargetRef(targetText.editorId, result.span)

      if (matches.length >= maxResults) {
        truncated = true
        break
      }

      matches.push(result)
      bufferLines.push(`${result.line}:${result.column}\t${result.preview}`)

      if (match[0] === '') {
        regexp.lastIndex += 1
      }
    }

    if (truncated) {
      break
    }
  }

  const bufferRecord = payload?.persistBuffer === false
    ? null
    : createSessionBuffer(editorWindow, {
        title: createSliceBufferTitle('grep_slice', query),
        text: bufferLines.join('\n'),
      })

  return {
    editorId: targetText.editorId,
    span: targetText.span,
    target: buildAiTargetRef(targetText.editorId, targetText.span),
    query,
    isRegexp,
    caseSensitive,
    matches,
    truncated,
    bufferId: bufferRecord?.editorId || null,
  }
}

async function statsAiSliceForWindow(editorWindow, payload) {
  if (!settingsState.ai.toolPermissions.sliceSearch) {
    throw new Error('Slice stats are disabled in settings')
  }

  const targetText = await readFullTargetTextForWindow(editorWindow, { target: payload?.target })
  const lines = targetText.text.length === 0 ? [] : targetText.text.split(/\r?\n/)
  const emptyLines = lines.filter((lineText) => lineText.length === 0).length
  const maxLineLength = lines.reduce((currentMax, lineText) => Math.max(currentMax, lineText.length), 0)
  const uniqueLines = new Set(lines).size

  return {
    editorId: targetText.editorId,
    span: targetText.span,
    target: buildAiTargetRef(targetText.editorId, targetText.span),
    characters: targetText.text.length,
    lines: lines.length,
    emptyLines,
    nonEmptyLines: Math.max(0, lines.length - emptyLines),
    maxLineLength,
    uniqueLines,
    estimatedTokens: estimateTokenCount(targetText.text),
  }
}

async function exactSearchForWindow(editorWindow, payload) {
  if (!settingsState.ai.toolPermissions.sliceSearch) {
    throw new Error('Exact search is disabled in settings')
  }

  return grepAiSliceForWindow(editorWindow, payload)
}

async function ensureSemanticRuntimeForTarget(editorWindow, payload) {
  if (!settingsState.ai.toolPermissions.sliceSearch) {
    throw new Error('Semantic search is disabled in settings')
  }

  const targetText = await readFullTargetTextForWindow(editorWindow, { target: payload?.target })
  const targetBytes = Buffer.byteLength(targetText.text, 'utf8')

  if (targetBytes > MAX_SEMANTIC_INDEX_BYTES) {
    throw new Error(`Semantic search skips targets larger than ${MAX_SEMANTIC_INDEX_BYTES} bytes`)
  }

  const sourceKey = getSemanticSourceKey(targetText)
  const cachedRuntime = semanticRuntimeBySourceKey.get(sourceKey)

  if (cachedRuntime) {
    return touchSemanticRuntime(cachedRuntime)
  }

  const chunks = buildSemanticChunksForTarget(targetText)
  await ensureEmbeddingCacheEntries(chunks.map((chunk) => chunk.text))
  clearSemanticRuntimesForTarget(targetText.editorId, targetText.span, sourceKey)

  const cacheKeys = Array.from(new Set(chunks.map((chunk) => chunk.cacheKey)))

  const runtime = {
    editorId: targetText.editorId,
    span: targetText.span,
    text: targetText.text,
    sourceKey,
    builtAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    cacheKeys,
    chunks: chunks.map((chunk) => ({
      ...chunk,
      embedding: embeddingCacheByKey.get(chunk.cacheKey)?.embedding || null,
    })).filter((chunk) => Array.isArray(chunk.embedding)),
  }

  semanticRuntimeBySourceKey.set(sourceKey, runtime)
  markEmbeddingUsageCountsDirty()
  pruneSemanticRuntimes()
  scheduleEmbeddingCacheGc({ pressure: isEmbeddingCacheOverLimit() })
  return runtime
}

async function semanticSearchForWindow(editorWindow, payload) {
  const query = typeof payload?.query === 'string' ? payload.query.trim() : ''

  if (query.length === 0) {
    throw new Error('Semantic search query is required')
  }

  const maxResults = Math.min(20, Math.max(1, Math.round(Number(payload?.maxResults) || 8)))
  const runtime = await ensureSemanticRuntimeForTarget(editorWindow, payload)
  await ensureEmbeddingCacheEntries([query])
  const queryEmbedding = embeddingCacheByKey.get(buildEmbeddingCacheKey(DEFAULT_EMBEDDING_MODEL, query))?.embedding

  if (!queryEmbedding) {
    throw new Error('Semantic query embedding could not be resolved')
  }

  const results = runtime.chunks
    .map((chunk) => ({
      editorId: runtime.editorId,
      span: chunk.span,
      target: buildAiTargetRef(runtime.editorId, chunk.span),
      layer: chunk.layer,
      score: cosineSimilarity(queryEmbedding, chunk.embedding) * chunk.weight,
      preview: createPreviewText(chunk.text),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, maxResults)

  const bufferRecord = payload?.persistBuffer === false
    ? null
    : createSessionBuffer(editorWindow, {
        title: createSliceBufferTitle('semantic_search', query),
        text: results.map((result) => `${result.layer}\t${result.score.toFixed(4)}\t${result.span.start.line}:${result.span.start.column}-${result.span.end.line}:${result.span.end.column}\t${result.preview}`).join('\n'),
      })

  return {
    editorId: runtime.editorId,
    span: runtime.span,
    target: buildAiTargetRef(runtime.editorId, runtime.span),
    query,
    results,
    bufferId: bufferRecord?.editorId || null,
    indexBuiltAt: runtime.builtAt,
  }
}

function resolveTargetForSession(editorWindow, target) {
  if (!target || typeof target !== 'object') {
    throw new Error('AI target is required')
  }

  const runtimeState = ensureEditorRuntimeState(editorWindow)

  if (isActiveEditorAlias(target.editorId) || target.editorId === runtimeState.editorId) {
    return {
      kind: 'editor-window',
      editorId: runtimeState.editorId,
      span: normalizeSpanForResolvedTargetKind('editor-window', target.span),
    }
  }

  const bufferRecord = getSessionBuffer(editorWindow, target.editorId)

  if (bufferRecord) {
    return {
      kind: 'temp-buffer',
      editorId: bufferRecord.editorId,
      span: normalizeSpanForResolvedTargetKind('temp-buffer', target.span),
      bufferRecord,
    }
  }

  throw new Error(`Unknown editor target: ${target.editorId}`)
}

function getFileArgumentStartIndex() {
  return process.defaultApp ? 2 : 1
}

function resolveLaunchRequest(argv) {
  let explicitInitialPanel = null
  let filePath = null

  for (const candidate of argv.slice(getFileArgumentStartIndex())) {
    if (candidate === '--edit') {
      explicitInitialPanel = 'write'
      continue
    }

    if (candidate === '--view') {
      explicitInitialPanel = 'preview'
      continue
    }

    if (typeof candidate !== 'string' || candidate.length === 0 || candidate.startsWith('-')) {
      continue
    }

    const resolvedPath = path.resolve(candidate)

    try {
      if (fs.statSync(resolvedPath).isFile() && !filePath) {
        filePath = resolvedPath
      }
    } catch {
      continue
    }
  }

  return {
    filePath,
    explicitInitialPanel,
  }
}

function resolveInitialPanelForLaunch(launchRequest) {
  if (launchRequest?.explicitInitialPanel === 'write' || launchRequest?.explicitInitialPanel === 'preview') {
    return launchRequest.explicitInitialPanel
  }

  if (launchRequest?.filePath) {
    return 'preview'
  }

  return settingsState.general.defaultStartPanel === 'preview' ? 'preview' : 'write'
}

function focusWindow(window) {
  if (window.isMinimized()) {
    window.restore()
  }

  window.focus()
}

async function confirmAiWriteAction(parentWindow, options) {
  const response = await dialog.showMessageBox(parentWindow ?? undefined, {
    type: 'warning',
    buttons: ['Continue', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: options.title,
    message: options.message,
    detail: options.detail,
    noLink: true,
  })

  return response.response === 0
}

function createDefaultSettings() {
  return {
    version: 1,
    general: {
      themeMode: 'system',
      defaultStartPanel: 'write',
      openLinksBehavior: 'confirm-if-untrusted',
    },
    editor: {
      initialEditType: 'markdown',
      showModeSwitch: true,
      previewStyle: 'tab',
    },
    ai: {
      defaultWriteMode: 'direct',
      toolPermissions: {
        readActiveDocument: true,
        readActiveSelection: true,
        writeActiveDocument: true,
        writeActiveSelection: true,
        writeNewDocument: true,
        sliceSearch: true,
        workspaceGrep: true,
        tavilyWebSearch: true,
        fetchUrl: false,
      },
      openai: {
        enabled: true,
        baseUrl: null,
        model: defaultOpenAiModel,
      },
      tavily: {
        enabled: false,
        defaultSearchDepth: 'basic',
        defaultMaxResults: 5,
      },
      fetch: {
        allowedUrlRules: [],
        allowedMethods: ['GET'],
        allowedHeaders: [],
        requestTimeoutMs: DEFAULT_FETCH_REQUEST_TIMEOUT_MS,
        idleTimeoutMs: DEFAULT_FETCH_IDLE_TIMEOUT_MS,
        autoDisposeAfterMs: DEFAULT_FETCH_AUTO_DISPOSE_AFTER_MS,
        maxResponseBytes: DEFAULT_FETCH_MAX_RESPONSE_BYTES,
      },
    },
    safety: {
      confirmBeforeFullDocumentOverwrite: true,
      confirmBeforeNewDocumentFromAi: true,
      confirmBeforeExternalUrlOpen: true,
    },
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function mergePlainObjects(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return patch
  }

  const merged = { ...base }

  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = mergePlainObjects(merged[key], value)
      continue
    }

    merged[key] = value
  }

  return merged
}

function normalizeThemeMode(value) {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}

function normalizeStartPanel(value) {
  return value === 'preview' ? 'preview' : 'write'
}

function normalizeOpenLinksBehavior(value) {
  return value === 'block-untrusted' ? 'block-untrusted' : 'confirm-if-untrusted'
}

function normalizeInitialEditType(value) {
  return value === 'wysiwyg' ? 'wysiwyg' : 'markdown'
}

function normalizePreviewStyle(value) {
  return value === 'vertical' ? 'vertical' : 'tab'
}

function normalizeWriteMode(value) {
  return value === 'suggest' ? 'suggest' : 'direct'
}

function normalizeOpenAiModel(value) {
  if (typeof value !== 'string') {
    return defaultOpenAiModel
  }

  const trimmedValue = value.trim()

  if (trimmedValue.length === 0) {
    return defaultOpenAiModel
  }

  return trimmedValue
}

function normalizeSearchDepth(value) {
  return value === 'advanced' ? 'advanced' : 'basic'
}

function normalizeSecret(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function clampDefaultMaxResults(value) {
  const numericValue = Number(value)

  if (!Number.isFinite(numericValue)) {
    return 5
  }

  return Math.min(10, Math.max(1, Math.round(numericValue)))
}

function sanitizeStringList(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return Array.from(new Set(value
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)))
}

function normalizeAllowedMethodList(value) {
  const normalized = sanitizeStringList(value)
    .map((entry) => entry.toUpperCase())
    .filter((entry) => /^[A-Z]+$/.test(entry))

  return normalized.length > 0 ? normalized : ['GET']
}

function normalizeAllowedHeaderList(value) {
  return sanitizeStringList(value)
    .map((entry) => entry.toLowerCase())
    .filter((entry) => /^[a-z0-9-]+$/.test(entry))
}

function clampFetchTimeoutMs(value, fallback) {
  const numericValue = Number(value)

  if (!Number.isFinite(numericValue)) {
    return fallback
  }

  return Math.min(120_000, Math.max(1_000, Math.round(numericValue)))
}

function clampFetchAutoDisposeMs(value) {
  const numericValue = Number(value)

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_FETCH_AUTO_DISPOSE_AFTER_MS
  }

  return Math.min(24 * 60 * 60_000, Math.max(10_000, Math.round(numericValue)))
}

function clampFetchResponseBytes(value) {
  const numericValue = Number(value)

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_FETCH_MAX_RESPONSE_BYTES
  }

  return Math.min(4 * 1024 * 1024, Math.max(16 * 1024, Math.round(numericValue)))
}

function sanitizeSettings(candidate) {
  const defaults = createDefaultSettings()
  const merged = isPlainObject(candidate) ? mergePlainObjects(defaults, candidate) : defaults
  const toolPermissions = merged.ai?.toolPermissions
  const hasExplicitSliceSearch = isPlainObject(toolPermissions) && Object.prototype.hasOwnProperty.call(toolPermissions, 'sliceSearch')
  const normalizedSliceSearch = hasExplicitSliceSearch
    ? toolPermissions.sliceSearch !== false
    : true

  return {
    version: 1,
    general: {
      themeMode: normalizeThemeMode(merged.general?.themeMode),
      defaultStartPanel: normalizeStartPanel(merged.general?.defaultStartPanel),
      openLinksBehavior: normalizeOpenLinksBehavior(merged.general?.openLinksBehavior),
    },
    editor: {
      initialEditType: normalizeInitialEditType(merged.editor?.initialEditType),
      showModeSwitch: merged.editor?.showModeSwitch !== false,
      previewStyle: normalizePreviewStyle(merged.editor?.previewStyle),
    },
    ai: {
      defaultWriteMode: normalizeWriteMode(merged.ai?.defaultWriteMode),
      toolPermissions: {
        readActiveDocument: toolPermissions?.readActiveDocument !== false,
        readActiveSelection: toolPermissions?.readActiveSelection !== false,
        writeActiveDocument: toolPermissions?.writeActiveDocument !== false,
        writeActiveSelection: toolPermissions?.writeActiveSelection !== false,
        writeNewDocument: toolPermissions?.writeNewDocument !== false,
        sliceSearch: normalizedSliceSearch,
        workspaceGrep: toolPermissions?.workspaceGrep !== false,
        tavilyWebSearch: toolPermissions?.tavilyWebSearch !== false,
        fetchUrl: toolPermissions?.fetchUrl !== false,
      },
      openai: {
        enabled: merged.ai?.openai?.enabled === true,
        baseUrl: typeof merged.ai?.openai?.baseUrl === 'string' && merged.ai.openai.baseUrl.trim().length > 0
          ? merged.ai.openai.baseUrl.trim()
          : null,
        model: normalizeOpenAiModel(merged.ai?.openai?.model),
      },
      tavily: {
        enabled: merged.ai?.tavily?.enabled === true,
        defaultSearchDepth: normalizeSearchDepth(merged.ai?.tavily?.defaultSearchDepth),
        defaultMaxResults: clampDefaultMaxResults(merged.ai?.tavily?.defaultMaxResults),
      },
      fetch: {
        allowedUrlRules: sanitizeStringList(merged.ai?.fetch?.allowedUrlRules),
        allowedMethods: normalizeAllowedMethodList(merged.ai?.fetch?.allowedMethods),
        allowedHeaders: normalizeAllowedHeaderList(merged.ai?.fetch?.allowedHeaders),
        requestTimeoutMs: clampFetchTimeoutMs(merged.ai?.fetch?.requestTimeoutMs, DEFAULT_FETCH_REQUEST_TIMEOUT_MS),
        idleTimeoutMs: clampFetchTimeoutMs(merged.ai?.fetch?.idleTimeoutMs, DEFAULT_FETCH_IDLE_TIMEOUT_MS),
        autoDisposeAfterMs: clampFetchAutoDisposeMs(merged.ai?.fetch?.autoDisposeAfterMs),
        maxResponseBytes: clampFetchResponseBytes(merged.ai?.fetch?.maxResponseBytes),
      },
    },
    safety: {
      confirmBeforeFullDocumentOverwrite: merged.safety?.confirmBeforeFullDocumentOverwrite !== false,
      confirmBeforeNewDocumentFromAi: merged.safety?.confirmBeforeNewDocumentFromAi !== false,
      confirmBeforeExternalUrlOpen: merged.safety?.confirmBeforeExternalUrlOpen !== false,
    },
  }
}

function sanitizeSecrets(candidate) {
  return {
    openaiApiKey: normalizeSecret(candidate?.openaiApiKey),
    tavilyApiKey: normalizeSecret(candidate?.tavilyApiKey),
  }
}

function loadSettings() {
  try {
    if (!fs.existsSync(settingsPath)) {
      loadSettings.didLoadPersisted = false
      return createDefaultSettings()
    }

    const raw = fs.readFileSync(settingsPath, 'utf8')
    loadSettings.didLoadPersisted = true
    return sanitizeSettings(JSON.parse(raw))
  } catch (error) {
    loadSettings.didLoadPersisted = false
    writeLog('WARN', 'settings', 'Falling back to default settings', error instanceof Error ? error.message : String(error))
    return createDefaultSettings()
  }
}

loadSettings.didLoadPersisted = false

function loadSecrets() {
  try {
    if (!fs.existsSync(secretsPath)) {
      return sanitizeSecrets({})
    }

    const raw = fs.readFileSync(secretsPath, 'utf8')
    return sanitizeSecrets(JSON.parse(raw))
  } catch (error) {
    writeLog('WARN', 'settings', 'Falling back to empty secrets store', error instanceof Error ? error.message : String(error))
    return sanitizeSecrets({})
  }
}

async function persistSettings() {
  await fsPromises.mkdir(path.dirname(settingsPath), { recursive: true })
  await fsPromises.writeFile(settingsPath, `${JSON.stringify(settingsState, null, 2)}\n`, 'utf8')
  hasPersistedSettings = true
  hasReadableSettings = true
}

async function persistSecrets() {
  await fsPromises.mkdir(path.dirname(secretsPath), { recursive: true })
  await fsPromises.writeFile(secretsPath, `${JSON.stringify(secretsState, null, 2)}\n`, 'utf8')
}

function getProviderStatus() {
  return {
    openaiConfigured: getOpenAiApiKey() !== null,
    tavilyConfigured: getTavilyApiKey() !== null,
  }
}

function isOpenAiEnabled() {
  return settingsState.ai.openai.enabled === true
}

const openAiChatInstructions = [
  'You are MDV Assistant inside MarkDownViewer, a Markdown editing application.',
  'Respond in Markdown and keep answers focused on the user request.',
  'Treat transcript entries labeled as tool context as trusted application-provided context.',
  'Large context hints that include EditorID and SPAN are references, not full text; call read_target when you need the actual text.',
  'Prefer exact_search or semantic_search to narrow large documents before reading wide spans.',
  'For follow-up tool calls, prefer the returned target object exactly as-is; resolved span objects with start/end/isEmpty are output metadata, not SPAN input schema.',
  'For read_target pagination, reuse the returned target together with nextCursor; when you need exactly the returned page as a new input, use pageTarget.',
  'Selection is a live-editor-only SPAN. For temp buffers and other non-editor targets, use document, pageTarget, or an explicit range; if selection is supplied for a temp buffer, it is treated as document.',
  'Use write_target with destination.editorId=":new" when the user asked for a new document instead of mutating the current one.',
  'fetch_url may return a temp buffer instead of inline content when the response exceeds the inline chunk budget; use the returned target or bufferId with read_target/write_target, and call dispose_buffer when you are done.',
  'Do not claim that edits were applied unless the transcript explicitly says a write action already happened.',
].join(' ')

const aiSpanDescription = [
  'SPAN must be one of:',
  '{"kind":"document"},',
  '{"kind":"selection"},',
  '{"kind":"point","at":{"line":12,"column":1}},',
  '{"kind":"line","line":12},',
  '{"kind":"line-range","startLine":10,"endLine":18},',
  '{"kind":"from-start","end":{"line":20,"column":1}},',
  '{"kind":"to-end","start":{"line":20,"column":1}},',
  '{"kind":"range","start":{"line":10,"column":1},"end":{"line":18,"column":1}}.',
  'Selection is only meaningful for live editor targets; temp buffers should use document, pageTarget, or range.',
  'Use the returned target field for follow-up calls whenever available.',
].join(' ')

const aiTargetDescription = `Target object as {"editorId":"editor:active","span":SPAN}. ${aiSpanDescription}`
const aiDestinationDescription = `Destination object as {"editorId":"editor:active"|":new","span":SPAN}. ${aiSpanDescription}`
const aiSliceRefSourceDescription = `Slice-ref source as either {"type":"slice-ref","target":{"editorId":"...","span":SPAN}} or {"type":"slice-ref","editorId":"...","span":SPAN}. ${aiSpanDescription}`
const aiToolHelpFlagDescription = 'Set help=true to return usage guidance, parameter rules, and examples for this tool. When help=true, the other fields may be omitted.'

function buildAiToolParameters(properties, required = []) {
  const helpOnlySchema = {
    type: 'object',
    properties: {
      help: { type: 'boolean', enum: [true], description: aiToolHelpFlagDescription },
    },
    required: ['help'],
    additionalProperties: false,
  }

  const callSchema = {
    type: 'object',
    properties: {
      ...properties,
      help: { type: 'boolean', description: aiToolHelpFlagDescription },
    },
    additionalProperties: false,
  }

  if (required.length > 0) {
    callSchema.required = required
  }

  return {
    oneOf: [helpOnlySchema, callSchema],
  }
}

const aiToolDefinitions = [
  {
    type: 'function',
    name: 'get_context',
    description: 'Get lightweight metadata about the active editor or a known buffer. Use help=true for usage guidance.',
    parameters: buildAiToolParameters({
        editorId: { type: 'string', description: 'Optional editor or buffer ID. Defaults to the active editor.' },
      }),
  },
  {
    type: 'function',
    name: 'list_buffers',
    description: 'List the active editor and session temp buffers available to tools. Use help=true for usage guidance.',
    parameters: buildAiToolParameters({}),
  },
  {
    type: 'function',
    name: 'read_target',
    description: 'Read bounded text from an EditorID + SPAN target. Use nextCursor with the returned target for continuation. Use pageTarget when you need exactly the returned page as a new input target. Use help=true for usage guidance.',
    parameters: buildAiToolParameters({
        target: { type: 'object', description: aiTargetDescription },
        cursor: { type: 'object', description: 'Optional cursor returned by a previous read_target call.' },
        maxTokens: { type: 'number', description: 'Optional bounded token target.' },
      }, ['target']),
  },
  {
    type: 'function',
    name: 'write_target',
    description: 'Write text to an EditorID + SPAN destination, including :new for a new editor window. Prefer target refs returned by earlier tools. Use help=true for usage guidance.',
    parameters: buildAiToolParameters({
        destination: { type: 'object', description: aiDestinationDescription },
        sources: { type: 'array', description: `Array of literal sources like {"type":"literal","text":"..."} or slice-ref sources. ${aiSliceRefSourceDescription}` },
        mode: { type: 'string', enum: ['replace', 'insert'] },
        title: { type: 'string' },
      }, ['destination', 'sources']),
  },
  {
    type: 'function',
    name: 'exact_search',
    description: 'Run an exact search inside an EditorID + SPAN target and return matching lines plus reusable target refs. Use help=true for usage guidance.',
    parameters: buildAiToolParameters({
        target: { type: 'object', description: aiTargetDescription },
        query: { type: 'string' },
        isRegexp: { type: 'boolean' },
        caseSensitive: { type: 'boolean' },
        maxResults: { type: 'number' },
      }, ['target', 'query']),
  },
  {
    type: 'function',
    name: 'stats_slice',
    description: 'Return statistics for an EditorID + SPAN target and include a reusable target ref. Use help=true for usage guidance.',
    parameters: buildAiToolParameters({
        target: { type: 'object', description: aiTargetDescription },
      }, ['target']),
  },
  {
    type: 'function',
    name: 'semantic_search',
    description: 'Run multi-layer semantic search over an EditorID + SPAN target using cached embeddings and return reusable target refs. Use help=true for usage guidance.',
    parameters: buildAiToolParameters({
        target: { type: 'object', description: aiTargetDescription },
        query: { type: 'string' },
        maxResults: { type: 'number' },
      }, ['target', 'query']),
  },
  {
    type: 'function',
    name: 'web_search',
    description: 'Run Tavily web search and return ranked results. A temp buffer may also be returned for deeper follow-up reads. Use help=true for usage guidance.',
    parameters: buildAiToolParameters({
        query: { type: 'string' },
        searchDepth: { type: 'string', enum: ['basic', 'advanced'] },
        maxResults: { type: 'number' },
      }, ['query']),
  },
  {
    type: 'function',
    name: 'fetch_url',
    description: 'Fetch an allowlisted HTTP(S) URL with explicit method and header controls. Large responses are returned as temp buffers instead of inline text. Use help=true for usage guidance.',
    parameters: buildAiToolParameters({
        url: { type: 'string' },
        method: { type: 'string' },
        headers: { type: 'object', additionalProperties: { type: 'string' } },
        body: { type: 'string' },
      }, ['url']),
  },
  {
    type: 'function',
    name: 'dispose_buffer',
    description: 'Dispose a temp buffer explicitly when it is no longer needed. Use help=true for usage guidance.',
    parameters: buildAiToolParameters({
        editorId: { type: 'string' },
      }, ['editorId']),
  },
]

const aiToolHelpDocs = {
  get_context: {
    summary: 'Inspect lightweight metadata for the active editor or one known temp buffer.',
    parameters: [
      { name: 'editorId', required: false, type: 'string', description: 'Optional. Omit it to inspect the active editor, or pass a buffer/editor id returned by a previous tool.' },
    ],
    examples: [
      { description: 'Active editor context', args: {} },
      { description: 'Known temp buffer context', args: { editorId: 'buffer:example' } },
    ],
  },
  list_buffers: {
    summary: 'List the active editor plus temp buffers available in the current AI session.',
    parameters: [],
    examples: [
      { description: 'List current buffers', args: {} },
    ],
  },
  read_target: {
    summary: 'Read bounded text from an EditorID + SPAN target.',
    parameters: [
      { name: 'target', required: true, type: 'object', description: 'Canonical target object like {"editorId":"editor:active","span":{"kind":"document"}}.' },
      { name: 'cursor', required: false, type: 'object', description: 'Continuation cursor returned by a previous read_target result.' },
      { name: 'maxTokens', required: false, type: 'number', description: 'Soft upper bound for inline text. Positive number only.' },
    ],
    examples: [
      { description: 'Read active document', args: { target: { editorId: 'editor:active', span: { kind: 'document' } } } },
      { description: 'Read a line range', args: { target: { editorId: 'editor:active', span: { kind: 'line-range', startLine: 10, endLine: 20 } } } },
    ],
  },
  write_target: {
    summary: 'Write literal text or slice references into an editor target or a new document.',
    parameters: [
      { name: 'destination', required: true, type: 'object', description: 'Destination target. Use editorId=":new" to create a new document.' },
      { name: 'sources', required: true, type: 'array', description: 'One or more sources. Each source must be {"type":"literal","text":"..."} or a slice-ref object.' },
      { name: 'mode', required: false, type: 'string', description: 'Optional. "replace" or "insert". Defaults to replace.' },
      { name: 'title', required: false, type: 'string', description: 'Optional title when destination.editorId is :new.' },
    ],
    examples: [
      { description: 'Replace active selection with literal text', args: { destination: { editorId: 'editor:active', span: { kind: 'selection' } }, sources: [{ type: 'literal', text: 'Updated text' }], mode: 'replace' } },
      { description: 'Create a new document', args: { destination: { editorId: ':new', span: { kind: 'document' } }, sources: [{ type: 'literal', text: '# Draft\n' }], title: 'Draft.md' } },
    ],
  },
  exact_search: {
    summary: 'Search exact text or a regular expression inside a bounded target.',
    parameters: [
      { name: 'target', required: true, type: 'object', description: 'Target to search within.' },
      { name: 'query', required: true, type: 'string', description: 'Literal text or regexp pattern.' },
      { name: 'isRegexp', required: false, type: 'boolean', description: 'Set true only when query is a regexp.' },
      { name: 'caseSensitive', required: false, type: 'boolean', description: 'Optional case-sensitive matching.' },
      { name: 'maxResults', required: false, type: 'number', description: 'Optional positive limit.' },
    ],
    examples: [
      { description: 'Literal search', args: { target: { editorId: 'editor:active', span: { kind: 'document' } }, query: 'TODO' } },
      { description: 'Regexp search', args: { target: { editorId: 'editor:active', span: { kind: 'document' } }, query: '^# ', isRegexp: true } },
    ],
  },
  stats_slice: {
    summary: 'Return counts and size statistics for one bounded target.',
    parameters: [
      { name: 'target', required: true, type: 'object', description: 'Target to measure.' },
    ],
    examples: [
      { description: 'Stats for the active document', args: { target: { editorId: 'editor:active', span: { kind: 'document' } } } },
    ],
  },
  semantic_search: {
    summary: 'Run semantic search over a bounded target and return ranked slice refs.',
    parameters: [
      { name: 'target', required: true, type: 'object', description: 'Target to search within.' },
      { name: 'query', required: true, type: 'string', description: 'Semantic query text.' },
      { name: 'maxResults', required: false, type: 'number', description: 'Optional positive limit.' },
    ],
    examples: [
      { description: 'Semantic search in active document', args: { target: { editorId: 'editor:active', span: { kind: 'document' } }, query: 'release packaging flow' } },
    ],
  },
  web_search: {
    summary: 'Run Tavily web search and optionally get a temp buffer for follow-up reads.',
    parameters: [
      { name: 'query', required: true, type: 'string', description: 'Search query text.' },
      { name: 'searchDepth', required: false, type: 'string', description: 'Optional. basic or advanced.' },
      { name: 'maxResults', required: false, type: 'number', description: 'Optional positive limit.' },
    ],
    examples: [
      { description: 'Basic web search', args: { query: 'Electron app logs Windows location' } },
    ],
  },
  fetch_url: {
    summary: 'Fetch one allowlisted HTTP(S) URL under the app safety policy.',
    parameters: [
      { name: 'url', required: true, type: 'string', description: 'HTTP or HTTPS URL. Must pass allowlist and network safety checks.' },
      { name: 'method', required: false, type: 'string', description: 'Optional method. Defaults to GET. Must be allowlisted.' },
      { name: 'headers', required: false, type: 'object', description: 'Optional string headers. Header names must be allowlisted and newline-safe.' },
      { name: 'body', required: false, type: 'string', description: 'Optional request body for methods that permit a body.' },
    ],
    examples: [
      { description: 'Fetch a GET URL', args: { url: 'https://example.com/docs' } },
    ],
  },
  dispose_buffer: {
    summary: 'Dispose one temp buffer after it is no longer needed.',
    parameters: [
      { name: 'editorId', required: true, type: 'string', description: 'Temp buffer id such as buffer:... Do not pass editor:active.' },
    ],
    examples: [
      { description: 'Dispose one buffer', args: { editorId: 'buffer:example' } },
    ],
  },
}

class AiToolUserError extends Error {
  constructor(toolName, reason, fix, code = 'invalid_arguments') {
    super(reason)
    this.name = 'AiToolUserError'
    this.toolName = toolName
    this.reason = reason
    this.fix = fix
    this.code = code
  }
}

function isAiToolHelpRequest(args) {
  return args?.help === true
}

function getAiToolDefinition(toolName) {
  return aiToolDefinitions.find((tool) => tool.name === toolName) || null
}

function buildAiToolHelpResult(toolName) {
  const definition = getAiToolDefinition(toolName)
  const helpDoc = aiToolHelpDocs[toolName]

  if (!definition || !helpDoc) {
    return {
      ok: false,
      toolName,
      error: {
        code: 'unknown_tool',
        reason: `Unknown AI tool: ${toolName}`,
        fix: 'Call one of the tool names advertised in the current tool list.',
        help: {
          call: null,
          note: 'This tool name is not registered in MDV.',
        },
      },
    }
  }

  return {
    ok: true,
    toolName,
    help: {
      schema: definition.parameters,
      description: definition.description,
      summary: helpDoc.summary,
      parameters: [
        ...helpDoc.parameters,
        { name: 'help', required: false, type: 'boolean', description: aiToolHelpFlagDescription },
      ],
      examples: helpDoc.examples,
      notes: [
        'Follow the parameter object schema exactly and avoid extra keys.',
        'If a previous tool returned target or pageTarget, reuse that object as-is when possible.',
      ],
    },
  }
}

function buildAiToolErrorResult(toolName, error) {
  const message = error instanceof Error ? error.message : String(error)

  if (error instanceof AiToolUserError) {
    return {
      ok: false,
      toolName,
      error: {
        code: error.code,
        reason: error.reason,
        fix: error.fix,
        help: {
          call: { help: true },
          note: `Call ${toolName} with {"help":true} for the exact schema and examples.`,
        },
      },
    }
  }

  return {
    ok: false,
    toolName,
    error: {
      code: 'tool_execution_failed',
      reason: message,
      fix: 'Adjust the arguments, retry a narrower operation, or inspect tool help before the next call.',
      help: {
        call: { help: true },
        note: `Call ${toolName} with {"help":true} for the exact schema and examples.`,
      },
    },
  }
}

function requireObjectArg(toolName, args, fieldName, description) {
  const value = args?.[fieldName]

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiToolUserError(toolName, `${fieldName} must be an object.`, `Provide ${fieldName} as ${description}.`)
  }

  return value
}

function requireStringArg(toolName, args, fieldName, description) {
  const value = typeof args?.[fieldName] === 'string' ? args[fieldName].trim() : ''

  if (value.length === 0) {
    throw new AiToolUserError(toolName, `${fieldName} must be a non-empty string.`, `Provide ${fieldName} as ${description}.`)
  }

  return value
}

function requireArrayArg(toolName, args, fieldName, description) {
  const value = args?.[fieldName]

  if (!Array.isArray(value) || value.length === 0) {
    throw new AiToolUserError(toolName, `${fieldName} must be a non-empty array.`, `Provide ${fieldName} as ${description}.`)
  }

  return value
}

function validateAiToolArgs(toolName, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new AiToolUserError(toolName, 'Tool arguments must be a JSON object.', 'Return one JSON object matching the tool parameter schema.')
  }

  if (isAiToolHelpRequest(args)) {
    return
  }

  if (toolName === 'read_target') {
    requireObjectArg(toolName, args, 'target', '{"editorId":"editor:active","span":{"kind":"document"}}')
    return
  }

  if (toolName === 'write_target') {
    requireObjectArg(toolName, args, 'destination', '{"editorId":"editor:active","span":{"kind":"selection"}}')
    requireArrayArg(toolName, args, 'sources', '[{"type":"literal","text":"..."}]')
    return
  }

  if (toolName === 'exact_search') {
    requireObjectArg(toolName, args, 'target', '{"editorId":"editor:active","span":{"kind":"document"}}')
    requireStringArg(toolName, args, 'query', 'a non-empty search string or regexp pattern')
    return
  }

  if (toolName === 'stats_slice') {
    requireObjectArg(toolName, args, 'target', '{"editorId":"editor:active","span":{"kind":"document"}}')
    return
  }

  if (toolName === 'semantic_search') {
    requireObjectArg(toolName, args, 'target', '{"editorId":"editor:active","span":{"kind":"document"}}')
    requireStringArg(toolName, args, 'query', 'a non-empty semantic query string')
    return
  }

  if (toolName === 'web_search') {
    requireStringArg(toolName, args, 'query', 'a non-empty web search query')
    return
  }

  if (toolName === 'fetch_url') {
    requireStringArg(toolName, args, 'url', 'a non-empty HTTP(S) URL string')
    return
  }

  if (toolName === 'dispose_buffer') {
    requireStringArg(toolName, args, 'editorId', 'a temp buffer id such as buffer:example')
  }
}

function parseAiToolArguments(toolName, rawArguments) {
  if (typeof rawArguments !== 'string' || rawArguments.trim().length === 0) {
    return {}
  }

  try {
    return JSON.parse(rawArguments)
  } catch (error) {
    throw new AiToolUserError(
      toolName,
      'Tool arguments must be valid JSON.',
      'Return one valid JSON object. Use double-quoted keys and strings, and avoid trailing commas.',
      'invalid_json',
    )
  }
}

function getOpenAiApiKey() {
  return secretsState.openaiApiKey
    || (typeof process.env.OPENAI_API_KEY === 'string' && process.env.OPENAI_API_KEY.trim().length > 0
      ? process.env.OPENAI_API_KEY.trim()
      : null)
}

function getTavilyApiKey() {
  return secretsState.tavilyApiKey
    || (typeof process.env.TAVILY_API_KEY === 'string' && process.env.TAVILY_API_KEY.trim().length > 0
      ? process.env.TAVILY_API_KEY.trim()
      : null)
}

function isUrlAllowedByRules(rules, targetUrl) {
  return Array.isArray(rules) && rules.some((rule) => {
    if (typeof rule !== 'string' || rule.length === 0) {
      return false
    }

    if (rule.endsWith('*')) {
      return targetUrl.href.startsWith(rule.slice(0, -1))
    }

    return targetUrl.href === rule
  })
}

function isRestrictedIpAddress(address) {
  const ipVersion = net.isIP(address)

  if (ipVersion === 4) {
    const octets = address.split('.').map((segment) => Number(segment))
    const [first, second] = octets

    return first === 0
      || first === 10
      || first === 127
      || (first === 100 && second >= 64 && second <= 127)
      || (first === 169 && second === 254)
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168)
      || (first === 198 && (second === 18 || second === 19))
      || first >= 224
    }

  if (ipVersion === 6) {
    const normalized = address.toLowerCase()

    return normalized === '::'
      || normalized === '::1'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || normalized.startsWith('fe80:')
      || normalized.startsWith('::ffff:127.')
  }

  return false
}

async function assertSafeFetchDestination(targetUrl) {
  const hostname = targetUrl.hostname.toLowerCase()

  if (!isSupportedExternalUrl(targetUrl)) {
    throw new Error(`Unsupported fetch protocol: ${targetUrl.protocol}`)
  }

  if (targetUrl.username || targetUrl.password) {
    throw new Error('Fetch URLs with embedded credentials are blocked')
  }

  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error(`Fetch target is blocked: ${hostname}`)
  }

  if (net.isIP(hostname)) {
    if (isRestrictedIpAddress(hostname)) {
      throw new Error(`Fetch target IP is blocked: ${hostname}`)
    }

    return
  }

  const resolvedAddresses = await dnsPromises.lookup(hostname, { all: true, verbatim: true })

  if (!Array.isArray(resolvedAddresses) || resolvedAddresses.length === 0) {
    throw new Error(`Fetch target could not be resolved: ${hostname}`)
  }

  if (resolvedAddresses.some((entry) => isRestrictedIpAddress(entry.address))) {
    throw new Error(`Fetch target resolves to a blocked address: ${hostname}`)
  }
}

function resolveFetchRequestHeaders(headers) {
  if (!isPlainObject(headers)) {
    return {}
  }

  const allowedHeaders = new Set(settingsState.ai.fetch.allowedHeaders)
  const forbiddenHeaders = new Set(['connection', 'content-length', 'cookie', 'host', 'proxy-authenticate', 'proxy-authorization', 'set-cookie', 'te', 'trailer', 'transfer-encoding', 'upgrade'])
  const normalizedHeaders = {}

  for (const [headerName, headerValue] of Object.entries(headers)) {
    const normalizedName = typeof headerName === 'string' ? headerName.trim().toLowerCase() : ''

    if (!normalizedName || !allowedHeaders.has(normalizedName)) {
      throw new Error(`Fetch header is not allowlisted: ${headerName}`)
    }

    if (forbiddenHeaders.has(normalizedName)) {
      throw new Error(`Fetch header is blocked: ${headerName}`)
    }

    if (typeof headerValue !== 'string') {
      throw new Error(`Fetch header value must be a string: ${headerName}`)
    }

    if (/[\r\n]/.test(headerValue)) {
      throw new Error(`Fetch header contains an unsafe newline: ${headerName}`)
    }

    normalizedHeaders[normalizedName] = headerValue
  }

  return normalizedHeaders
}

function resolveFetchMethod(method) {
  const normalizedMethod = typeof method === 'string' && method.trim().length > 0 ? method.trim().toUpperCase() : 'GET'

  if (!settingsState.ai.fetch.allowedMethods.includes(normalizedMethod)) {
    throw new Error(`Fetch method is not allowlisted: ${normalizedMethod}`)
  }

  return normalizedMethod
}

function resolveFetchBody(body, method) {
  if (body == null || body === '') {
    return undefined
  }

  if (method === 'GET' || method === 'HEAD') {
    throw new Error(`Fetch method ${method} does not allow a request body`)
  }

  if (typeof body !== 'string') {
    throw new Error('Fetch body must be a string when provided')
  }

  if (Buffer.byteLength(body, 'utf8') > 64 * 1024) {
    throw new Error('Fetch body exceeds the 64 KiB safety limit')
  }

  return body
}

async function readResponseTextWithIdleTimeout(response, controller, idleTimeoutMs, maxResponseBytes) {
  if (!response.body) {
    return ''
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytesRead = 0
  let idleTimer = null
  let abortedByIdleTimeout = false
  let text = ''

  const refreshIdleTimer = () => {
    if (idleTimer) {
      clearTimeout(idleTimer)
    }

    idleTimer = setTimeout(() => {
      abortedByIdleTimeout = true
      controller.abort()
    }, idleTimeoutMs)
  }

  refreshIdleTimer()

  try {
    while (true) {
      const chunk = await reader.read()

      if (chunk.done) {
        break
      }

      refreshIdleTimer()
      bytesRead += chunk.value.byteLength

      if (bytesRead > maxResponseBytes) {
        throw new Error(`Fetch response exceeded ${maxResponseBytes} bytes`)
      }

      text += decoder.decode(chunk.value, { stream: true })
    }

    text += decoder.decode()
    return text
  } catch (error) {
    if (abortedByIdleTimeout) {
      throw new Error(`Fetch response timed out after ${idleTimeoutMs} ms of inactivity`)
    }

    throw error
  } finally {
    if (idleTimer) {
      clearTimeout(idleTimer)
    }
    reader.releaseLock()
  }
}

async function performSafeFetch(requestUrl, options) {
  let targetUrl = new URL(requestUrl)
  const redirectTrail = []

  for (let redirectCount = 0; redirectCount <= MAX_FETCH_REDIRECTS; redirectCount += 1) {
    if (!isUrlAllowedByRules(settingsState.ai.fetch.allowedUrlRules, targetUrl)) {
      throw new Error(`Fetch URL is not allowlisted: ${targetUrl.href}`)
    }

    await assertSafeFetchDestination(targetUrl)

    const controller = new AbortController()
    let requestTimedOut = false
    const requestTimer = setTimeout(() => {
      requestTimedOut = true
      controller.abort()
    }, options.requestTimeoutMs)

    try {
      const response = await fetch(targetUrl, {
        method: options.method,
        headers: options.headers,
        body: options.body,
        redirect: 'manual',
        signal: controller.signal,
      })

      const redirectLocation = response.headers.get('location')

      if (redirectLocation && response.status >= 300 && response.status < 400) {
        if (redirectCount === MAX_FETCH_REDIRECTS) {
          throw new Error(`Fetch redirect limit exceeded for ${targetUrl.href}`)
        }

        const nextUrl = new URL(redirectLocation, targetUrl)
        redirectTrail.push({ status: response.status, url: targetUrl.href })
        targetUrl = nextUrl
        continue
      }

      const text = await readResponseTextWithIdleTimeout(response, controller, options.idleTimeoutMs, options.maxResponseBytes)

      return {
        url: targetUrl.href,
        response,
        text,
        redirectTrail,
      }
    } catch (error) {
      if (requestTimedOut) {
        throw new Error(`Fetch request timed out after ${options.requestTimeoutMs} ms`)
      }

      throw error
    } finally {
      clearTimeout(requestTimer)
    }
  }

  throw new Error(`Fetch redirect limit exceeded for ${requestUrl}`)
}

function buildFetchResult(editorWindow, payload) {
  const text = typeof payload?.text === 'string' ? payload.text : ''
  const estimatedTokens = estimateTokenCount(text)
  const baseResult = {
    url: payload.url,
    method: payload.method,
    status: payload.status,
    ok: payload.ok,
    statusText: payload.statusText,
    contentType: payload.contentType,
    estimatedTokens,
    redirectTrail: payload.redirectTrail,
    responseHeaders: payload.responseHeaders,
  }

  if (estimatedTokens <= getInlineTokenBudget()) {
    return {
      ...baseResult,
      delivery: 'inline',
      content: text,
    }
  }

  const bufferRecord = createSessionBuffer(editorWindow, {
    title: createSliceBufferTitle('fetch', payload.url),
    text,
    autoDisposeAfterMs: settingsState.ai.fetch.autoDisposeAfterMs,
  })

  return {
    ...baseResult,
    delivery: 'buffer',
    bufferId: bufferRecord.editorId,
    target: buildAiTargetRef(bufferRecord.editorId, { kind: 'document' }),
    preview: createPreviewText(text, 320),
    autoDisposeAt: bufferRecord.autoDisposeAt,
  }
}

async function fetchUrlForWindow(editorWindow, payload) {
  if (!settingsState.ai.toolPermissions.fetchUrl) {
    throw new Error('Fetch URL tool is disabled in settings')
  }

  const url = typeof payload?.url === 'string' ? payload.url.trim() : ''

  if (url.length === 0) {
    throw new Error('Fetch URL is required')
  }

  let parsedUrl

  try {
    parsedUrl = new URL(url)
  } catch {
    throw new Error(`Invalid fetch URL: ${url}`)
  }

  const method = resolveFetchMethod(payload?.method)
  const headers = resolveFetchRequestHeaders(payload?.headers)
  const body = resolveFetchBody(payload?.body, method)
  const result = await performSafeFetch(parsedUrl.href, {
    method,
    headers,
    body,
    requestTimeoutMs: settingsState.ai.fetch.requestTimeoutMs,
    idleTimeoutMs: settingsState.ai.fetch.idleTimeoutMs,
    maxResponseBytes: settingsState.ai.fetch.maxResponseBytes,
  })

  return buildFetchResult(editorWindow, {
    url: result.url,
    method,
    status: result.response.status,
    ok: result.response.ok,
    statusText: result.response.statusText,
    contentType: result.response.headers.get('content-type') || 'application/octet-stream',
    responseHeaders: Object.fromEntries(Array.from(result.response.headers.entries()).slice(0, 24)),
    redirectTrail: result.redirectTrail,
    text: result.text,
  })
}

async function tavilyWebSearchForWindow(editorWindow, payload) {
  if (!settingsState.ai.toolPermissions.tavilyWebSearch) {
    throw new Error('Tavily web search is disabled in settings')
  }

  if (!settingsState.ai.tavily.enabled) {
    throw new Error('Tavily is disabled in settings')
  }

  const apiKey = getTavilyApiKey()

  if (!apiKey) {
    throw new Error('TAVILY_API_KEY is not configured')
  }

  const query = typeof payload?.query === 'string' ? payload.query.trim() : ''

  if (query.length === 0) {
    throw new Error('Tavily query is required')
  }

  const maxResults = Math.min(10, Math.max(1, Math.round(Number(payload?.maxResults) || settingsState.ai.tavily.defaultMaxResults)))
  const searchDepth = payload?.searchDepth === 'advanced' ? 'advanced' : settingsState.ai.tavily.defaultSearchDepth
  const controller = new AbortController()
  let requestTimedOut = false
  const requestTimer = setTimeout(() => {
    requestTimedOut = true
    controller.abort()
  }, settingsState.ai.fetch.requestTimeoutMs)

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: searchDepth,
        max_results: maxResults,
        include_answer: true,
        include_raw_content: false,
        topic: 'general',
      }),
      signal: controller.signal,
    })
    const responseText = await readResponseTextWithIdleTimeout(response, controller, settingsState.ai.fetch.idleTimeoutMs, settingsState.ai.fetch.maxResponseBytes)

    if (!response.ok) {
      throw new Error(`Tavily request failed: ${response.status} ${response.statusText}`)
    }

    const parsed = JSON.parse(responseText)
    const results = Array.isArray(parsed?.results)
      ? parsed.results.slice(0, maxResults).map((entry) => ({
          title: typeof entry?.title === 'string' ? entry.title : '',
          url: typeof entry?.url === 'string' ? entry.url : '',
          content: typeof entry?.content === 'string' ? entry.content : '',
          score: Number.isFinite(Number(entry?.score)) ? Number(entry.score) : null,
        }))
      : []
    const summaryText = [
      typeof parsed?.answer === 'string' && parsed.answer.trim().length > 0 ? `Answer: ${parsed.answer.trim()}` : null,
      ...results.map((entry, index) => `${index + 1}. ${entry.title}\n${entry.url}\n${entry.content}`),
    ].filter(Boolean).join('\n\n')
    const bufferRecord = summaryText.length > 0
      ? createSessionBuffer(editorWindow, {
          title: createSliceBufferTitle('web_search', query),
          text: summaryText,
          autoDisposeAfterMs: settingsState.ai.fetch.autoDisposeAfterMs,
        })
      : null

    return {
      query,
      answer: typeof parsed?.answer === 'string' ? parsed.answer : null,
      results,
      responseTime: Number.isFinite(Number(parsed?.response_time)) ? Number(parsed.response_time) : null,
      bufferId: bufferRecord?.editorId || null,
      target: bufferRecord ? buildAiTargetRef(bufferRecord.editorId, { kind: 'document' }) : null,
      autoDisposeAt: bufferRecord?.autoDisposeAt || null,
    }
  } catch (error) {
    if (requestTimedOut) {
      throw new Error(`Tavily request timed out after ${settingsState.ai.fetch.requestTimeoutMs} ms`)
    }

    throw error
  } finally {
    clearTimeout(requestTimer)
  }
}

function getOpenAiBaseUrl() {
  const configuredBaseUrl = settingsState.ai.openai.baseUrl || process.env.MDV_OPENAI_BASE_URL || 'https://api.openai.com/v1'
  return configuredBaseUrl.endsWith('/') ? configuredBaseUrl : `${configuredBaseUrl}/`
}

function createOpenAiClient() {
  if (!isOpenAiEnabled()) {
    throw new Error('OpenAI is disabled in settings')
  }

  const apiKey = getOpenAiApiKey()

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured')
  }

  return new OpenAI({
    apiKey,
    baseURL: getOpenAiBaseUrl(),
  })
}

function formatToolEventContent(payload) {
  try {
    const content = JSON.stringify(payload, null, 2)
    return content.length <= 12000 ? content : `${content.slice(0, 12000)}\n...`
  } catch {
    return String(payload)
  }
}

function summarizeSpanForLog(span) {
  if (!span || typeof span !== 'object') {
    return null
  }

  if (span.kind === 'point' && span.at) {
    return {
      kind: 'point',
      at: span.at,
    }
  }

  if (span.kind === 'line' && Number.isFinite(Number(span.line))) {
    return {
      kind: 'line',
      line: Number(span.line),
    }
  }

  if (span.kind === 'line-range' && Number.isFinite(Number(span.startLine)) && Number.isFinite(Number(span.endLine))) {
    return {
      kind: 'line-range',
      startLine: Number(span.startLine),
      endLine: Number(span.endLine),
    }
  }

  if (span.kind === 'from-start' && span.end) {
    return {
      kind: 'from-start',
      end: span.end,
    }
  }

  if (span.kind === 'to-end' && span.start) {
    return {
      kind: 'to-end',
      start: span.start,
    }
  }

  if (span.start && span.end) {
    const summary = {
      start: span.start,
      end: span.end,
      isEmpty: span.isEmpty === true,
    }

    if (typeof span.kind === 'string') {
      return {
        kind: span.kind,
        ...summary,
      }
    }

    return summary
  }

  if (typeof span.kind === 'string') {
    return { kind: span.kind }
  }

  return null
}

function summarizeTargetForLog(target) {
  if (!target || typeof target !== 'object') {
    return null
  }

  return {
    editorId: typeof target.editorId === 'string' ? target.editorId : null,
    span: summarizeSpanForLog(target.span),
  }
}

function summarizeAiWriteSourcesForLog(sources) {
  if (!Array.isArray(sources)) {
    return []
  }

  return sources.map((source) => {
    if (!source || typeof source !== 'object') {
      return { type: 'unknown' }
    }

    if (typeof source.text === 'string') {
      return {
        type: 'text',
        bytes: Buffer.byteLength(source.text, 'utf8'),
      }
    }

    const legacyTarget = typeof source.editorId === 'string' && source.span && typeof source.span === 'object'
      ? {
          editorId: source.editorId,
          span: source.span,
        }
      : null

    return {
      type: 'slice-ref',
      target: summarizeTargetForLog(source.target || legacyTarget),
    }
  })
}

function summarizeAiToolArgsForLog(toolName, args) {
  if (toolName === 'write_target') {
    return {
      destination: summarizeTargetForLog(args?.destination),
      mode: args?.mode === 'insert' ? 'insert' : 'replace',
      sourceCount: Array.isArray(args?.sources) ? args.sources.length : 0,
      sources: summarizeAiWriteSourcesForLog(args?.sources),
    }
  }

  if (toolName === 'read_target' || toolName === 'exact_search' || toolName === 'stats_slice' || toolName === 'semantic_search') {
    return {
      target: summarizeTargetForLog(args?.target ?? args),
      query: typeof args?.query === 'string' ? args.query.slice(0, 160) : undefined,
      cursor: args?.cursor ?? null,
      maxTokens: Number.isFinite(Number(args?.maxTokens)) ? Number(args.maxTokens) : undefined,
      maxResults: Number.isFinite(Number(args?.maxResults)) ? Number(args.maxResults) : undefined,
      isRegexp: args?.isRegexp === true,
      caseSensitive: args?.caseSensitive === true,
    }
  }

  if (toolName === 'get_context') {
    return {
      editorId: typeof args?.editorId === 'string' ? args.editorId : null,
    }
  }

  if (toolName === 'list_buffers') {
    return null
  }

  if (toolName === 'web_search') {
    return {
      query: typeof args?.query === 'string' ? args.query.slice(0, 160) : undefined,
      searchDepth: typeof args?.searchDepth === 'string' ? args.searchDepth : undefined,
      maxResults: Number.isFinite(Number(args?.maxResults)) ? Number(args.maxResults) : undefined,
    }
  }

  if (toolName === 'fetch_url') {
    return {
      url: typeof args?.url === 'string' ? args.url.slice(0, 320) : undefined,
      method: typeof args?.method === 'string' ? args.method : undefined,
      headerNames: isPlainObject(args?.headers) ? Object.keys(args.headers).slice(0, 16) : undefined,
      hasBody: typeof args?.body === 'string' && args.body.length > 0,
    }
  }

  if (toolName === 'dispose_buffer') {
    return {
      editorId: typeof args?.editorId === 'string' ? args.editorId : null,
    }
  }

  return args
}

function summarizeAiToolResultForLog(toolName, result) {
  if (toolName === 'write_target') {
    return {
      editorId: typeof result?.editorId === 'string' ? result.editorId : null,
      target: summarizeTargetForLog(result?.target),
      pageTarget: summarizeTargetForLog(result?.pageTarget),
      bytesWritten: Number.isFinite(Number(result?.bytesWritten)) ? Number(result.bytesWritten) : null,
      created: result?.created === true,
      mode: typeof result?.mode === 'string' ? result.mode : null,
    }
  }

  if (toolName === 'read_target') {
    return {
      editorId: typeof result?.editorId === 'string' ? result.editorId : null,
      target: summarizeTargetForLog(result?.target),
      pageTarget: summarizeTargetForLog(result?.pageTarget),
      estimatedTokens: Number.isFinite(Number(result?.estimatedTokens)) ? Number(result.estimatedTokens) : null,
      truncated: result?.truncated === true,
      nextCursor: result?.nextCursor ?? null,
    }
  }

  if (toolName === 'exact_search' || toolName === 'semantic_search') {
    return {
      target: summarizeTargetForLog(result?.target),
      resultCount: Array.isArray(result?.matches) ? result.matches.length : Array.isArray(result?.results) ? result.results.length : null,
      bufferId: typeof result?.bufferId === 'string' ? result.bufferId : null,
    }
  }

  if (toolName === 'stats_slice') {
    return {
      target: summarizeTargetForLog(result?.target),
      characters: Number.isFinite(Number(result?.characters)) ? Number(result.characters) : null,
      lines: Number.isFinite(Number(result?.lines)) ? Number(result.lines) : null,
      estimatedTokens: Number.isFinite(Number(result?.estimatedTokens)) ? Number(result.estimatedTokens) : null,
    }
  }

  if (toolName === 'get_context') {
    return {
      editorId: typeof result?.editorId === 'string' ? result.editorId : null,
      textLength: Number.isFinite(Number(result?.textLength)) ? Number(result.textLength) : null,
      selectionTextLength: Number.isFinite(Number(result?.selectionTextLength)) ? Number(result.selectionTextLength) : null,
      activePanel: typeof result?.activePanel === 'string' ? result.activePanel : null,
    }
  }

  if (toolName === 'list_buffers') {
    return {
      bufferCount: Array.isArray(result?.buffers) ? result.buffers.length : Array.isArray(result) ? result.length : null,
    }
  }

  if (toolName === 'web_search') {
    return {
      resultCount: Array.isArray(result?.results) ? result.results.length : null,
      bufferId: typeof result?.bufferId === 'string' ? result.bufferId : null,
      target: summarizeTargetForLog(result?.target),
    }
  }

  if (toolName === 'fetch_url') {
    return {
      url: typeof result?.url === 'string' ? result.url : null,
      status: Number.isFinite(Number(result?.status)) ? Number(result.status) : null,
      delivery: typeof result?.delivery === 'string' ? result.delivery : null,
      estimatedTokens: Number.isFinite(Number(result?.estimatedTokens)) ? Number(result.estimatedTokens) : null,
      bufferId: typeof result?.bufferId === 'string' ? result.bufferId : null,
      target: summarizeTargetForLog(result?.target),
    }
  }

  if (toolName === 'dispose_buffer') {
    return {
      editorId: typeof result?.editorId === 'string' ? result.editorId : null,
      disposed: result?.disposed === true,
    }
  }

  return result
}

function normalizeToolTarget(args) {
  const target = args?.target && typeof args.target === 'object' ? args.target : null

  return {
    editorId: typeof target?.editorId === 'string' && target.editorId.length > 0 ? target.editorId : 'editor:active',
    span: normalizeAiSpanRef(target?.span),
  }
}

async function executeAiToolCall(editorWindow, toolName, args) {
  writeLog('INFO', 'ai-tool', 'start', {
    toolName,
    args: summarizeAiToolArgsForLog(toolName, args),
  })

  try {
    validateAiToolArgs(toolName, args)

    if (isAiToolHelpRequest(args)) {
      const helpResult = buildAiToolHelpResult(toolName)
      writeLog('INFO', 'ai-tool', 'completed', {
        toolName,
        result: summarizeAiToolResultForLog(toolName, helpResult),
      })
      return helpResult
    }

    let result

    if (toolName === 'get_context') {
      const requestedEditorId = typeof args?.editorId === 'string' && args.editorId.length > 0 ? args.editorId : null

      if (!requestedEditorId || isActiveEditorAlias(requestedEditorId) || requestedEditorId === ensureEditorRuntimeState(editorWindow).editorId) {
        result = requestEditorContext(editorWindow)
      } else {
        const bufferRecord = getSessionBuffer(editorWindow, requestedEditorId)

        if (!bufferRecord) {
          throw new Error(`Unknown buffer for get_context: ${requestedEditorId}`)
        }

        result = {
          editorId: bufferRecord.editorId,
          currentFilePath: null,
          title: bufferRecord.title,
          activePanel: 'write',
          textLength: bufferRecord.text.length,
          selectionTextLength: 0,
          tokenEstimate: estimateTokenCount(bufferRecord.text),
          isDirty: false,
        }
      }
    } else if (toolName === 'list_buffers') {
      result = listAiBuffersForWindow(editorWindow)
    } else if (toolName === 'read_target') {
      result = readAiTargetForWindow(editorWindow, {
        target: normalizeToolTarget({ target: requireObjectArg(toolName, args, 'target', '{"editorId":"editor:active","span":{"kind":"document"}}') }),
        cursor: args?.cursor ?? null,
        maxTokens: args?.maxTokens,
      })
    } else if (toolName === 'write_target') {
      const destination = requireObjectArg(toolName, args, 'destination', '{"editorId":"editor:active","span":{"kind":"selection"}}')
      const sources = requireArrayArg(toolName, args, 'sources', '[{"type":"literal","text":"..."}]')
      result = writeAiTargetForWindow(editorWindow, {
        destination: destination && typeof destination === 'object'
          ? {
              editorId: typeof destination.editorId === 'string' && destination.editorId.length > 0 ? destination.editorId : 'editor:active',
              span: normalizeAiSpanRef(destination.span),
            }
          : { editorId: 'editor:active', span: { kind: 'document' } },
        sources: sources.map((source) => normalizeAiSliceRefSource(source)),
        mode: args?.mode === 'insert' ? 'insert' : 'replace',
        title: typeof args?.title === 'string' ? args.title : undefined,
      })
    } else if (toolName === 'exact_search') {
      result = exactSearchForWindow(editorWindow, {
        target: normalizeToolTarget({ target: requireObjectArg(toolName, args, 'target', '{"editorId":"editor:active","span":{"kind":"document"}}') }),
        query: requireStringArg(toolName, args, 'query', 'a non-empty search string or regexp pattern'),
        isRegexp: args?.isRegexp === true,
        caseSensitive: args?.caseSensitive === true,
        maxResults: args?.maxResults,
      })
    } else if (toolName === 'stats_slice') {
      result = statsAiSliceForWindow(editorWindow, {
        target: normalizeToolTarget({ target: requireObjectArg(toolName, args, 'target', '{"editorId":"editor:active","span":{"kind":"document"}}') }),
      })
    } else if (toolName === 'semantic_search') {
      result = semanticSearchForWindow(editorWindow, {
        target: normalizeToolTarget({ target: requireObjectArg(toolName, args, 'target', '{"editorId":"editor:active","span":{"kind":"document"}}') }),
        query: requireStringArg(toolName, args, 'query', 'a non-empty semantic query string'),
        maxResults: args?.maxResults,
      })
    } else if (toolName === 'web_search') {
      result = tavilyWebSearchForWindow(editorWindow, {
        query: requireStringArg(toolName, args, 'query', 'a non-empty web search query'),
        searchDepth: args?.searchDepth,
        maxResults: args?.maxResults,
      })
    } else if (toolName === 'fetch_url') {
      result = fetchUrlForWindow(editorWindow, {
        url: requireStringArg(toolName, args, 'url', 'a non-empty HTTP(S) URL string'),
        method: args?.method,
        headers: args?.headers,
        body: args?.body,
      })
    } else if (toolName === 'dispose_buffer') {
      result = disposeBufferForWindow(editorWindow, {
        editorId: requireStringArg(toolName, args, 'editorId', 'a temp buffer id such as buffer:example'),
      })
    } else {
      throw new Error(`Unsupported AI tool: ${toolName}`)
    }

    const awaitedResult = await result
    writeLog('INFO', 'ai-tool', 'completed', {
      toolName,
      result: summarizeAiToolResultForLog(toolName, awaitedResult),
    })
    return awaitedResult
  } catch (error) {
    writeLog('ERROR', 'ai-tool', 'failed', {
      toolName,
      args: summarizeAiToolArgsForLog(toolName, args),
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

function mapAiChatMessageToOpenAiInput(message) {
  if (!message || typeof message.content !== 'string' || message.content.trim().length === 0) {
    return null
  }

  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: message.content,
    }
  }

  if (message.role === 'tool') {
    return {
      role: 'user',
      content: `Tool context${message.title ? ` (${message.title})` : ''}:\n${message.content}`,
    }
  }

  return {
    role: 'user',
    content: message.content,
  }
}

async function requestOpenAiChatResponse(editorWindow, messages) {
  const input = Array.isArray(messages)
    ? messages
      .map(mapAiChatMessageToOpenAiInput)
      .filter(Boolean)
    : []

  if (input.length === 0) {
    throw new Error('No chat context was provided to OpenAI')
  }

  const client = createOpenAiClient()
  const toolEvents = []
  let nextInput = input
  let previousResponseId = null

  try {
    for (let iteration = 0; iteration < 12; iteration += 1) {
      writeLog('INFO', 'ai-chat', 'OpenAI response iteration start', {
        iteration,
        previousResponseId,
        inputCount: nextInput.length,
      })
      const response = await client.responses.create({
        model: settingsState.ai.openai.model,
        instructions: openAiChatInstructions,
        input: nextInput,
        previous_response_id: previousResponseId || undefined,
        tools: aiToolDefinitions,
        store: true,
      })

      previousResponseId = typeof response.id === 'string' ? response.id : null

      const outputItems = Array.isArray(response.output) ? response.output : []
      const functionCalls = outputItems.filter((item) => item?.type === 'function_call')
      writeLog('INFO', 'ai-chat', 'OpenAI response iteration received', {
        iteration,
        responseId: previousResponseId,
        functionCallCount: functionCalls.length,
        outputItemCount: outputItems.length,
      })

      if (functionCalls.length === 0) {
        const reply = typeof response.output_text === 'string' ? response.output_text.trim() : ''

        if (!reply) {
          throw new Error('OpenAI SDK returned no output_text')
        }

        return {
          reply,
          model: typeof response.model === 'string' && response.model.length > 0 ? response.model : settingsState.ai.openai.model,
          responseId: previousResponseId,
          toolEvents,
        }
      }

      nextInput = []

      for (const functionCall of functionCalls) {
        let args
        let result

        try {
          args = parseAiToolArguments(functionCall.name, functionCall.arguments)
        } catch (error) {
          args = {}
          result = buildAiToolErrorResult(functionCall.name, error)
          writeLog('ERROR', 'ai-chat', 'OpenAI function_call argument parse failed', {
            iteration,
            responseId: previousResponseId,
            toolName: functionCall.name,
            callId: functionCall.call_id,
            error: error instanceof Error ? error.message : String(error),
          })
        }

        writeLog('INFO', 'ai-chat', 'OpenAI function_call received', {
          iteration,
          responseId: previousResponseId,
          toolName: functionCall.name,
          callId: functionCall.call_id,
          args: summarizeAiToolArgsForLog(functionCall.name, args),
        })

        toolEvents.push({
          title: `${functionCall.name} call`,
          content: formatToolEventContent(args),
        })

        if (!result) {
          try {
            result = await executeAiToolCall(editorWindow, functionCall.name, args)
          } catch (error) {
            result = buildAiToolErrorResult(functionCall.name, error)
          }
        }

        writeLog('INFO', 'ai-chat', 'OpenAI function_call completed', {
          iteration,
          responseId: previousResponseId,
          toolName: functionCall.name,
          callId: functionCall.call_id,
          result: summarizeAiToolResultForLog(functionCall.name, result),
        })

        toolEvents.push({
          title: `${functionCall.name} result`,
          content: formatToolEventContent(result),
        })

        nextInput.push({
          type: 'function_call_output',
          call_id: functionCall.call_id,
          output: JSON.stringify(result),
        })
      }
    }

    throw new Error('OpenAI tool orchestration exceeded the safety iteration limit')
  } catch (error) {
    writeLog('ERROR', 'ai-chat', 'OpenAI chat orchestration failed', {
      previousResponseId,
      error: error instanceof Error ? error.message : String(error),
    })
    if (error instanceof OpenAI.APIError) {
      throw new Error(`OpenAI request failed: ${error.message}`)
    }

    throw error
  }
}

function broadcastSettingsChanged() {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue
    }

    window.webContents.send('mdv:settings-changed', settingsState)
  }
}

function loadRendererWindow(window, htmlFileName) {
  if (isDev) {
    window.loadURL(`http://localhost:5173/${htmlFileName}`)
    return
  }

  window.loadFile(path.join(__dirname, '..', 'dist', htmlFileName))
}

function isSettingsWindow(window) {
  return Boolean(settingsWindow) && Boolean(window) && settingsWindow.id === window.id
}

function isFetchPermissionsWindow(window) {
  return Boolean(fetchPermissionsWindow) && Boolean(window) && fetchPermissionsWindow.id === window.id
}

function isAiChatWindow(window) {
  return Boolean(window) && aiChatToEditorWindowId.has(window.id)
}

function isEditorWindow(window) {
  return Boolean(window) && !isAiChatWindow(window) && !isSettingsWindow(window) && !isFetchPermissionsWindow(window)
}

function getDefaultEditorWindow() {
  return BrowserWindow.getAllWindows().find((window) => isEditorWindow(window)) ?? null
}

function getEditorWindowForAiAction(candidateWindow) {
  if (!candidateWindow) {
    return getDefaultEditorWindow()
  }

  if (aiChatToEditorWindowId.has(candidateWindow.id)) {
    const ownerWindowId = aiChatToEditorWindowId.get(candidateWindow.id)
    return BrowserWindow.fromId(ownerWindowId) ?? null
  }

  if (isSettingsWindow(candidateWindow)) {
    if (settingsWindowOwnerEditorId) {
      const ownerWindow = BrowserWindow.fromId(settingsWindowOwnerEditorId)
      if (ownerWindow && !ownerWindow.isDestroyed()) {
        return ownerWindow
      }
    }

    return getDefaultEditorWindow()
  }

  if (isFetchPermissionsWindow(candidateWindow)) {
    if (fetchPermissionsWindowOwnerEditorId) {
      const ownerWindow = BrowserWindow.fromId(fetchPermissionsWindowOwnerEditorId)
      if (ownerWindow && !ownerWindow.isDestroyed()) {
        return ownerWindow
      }
    }

    return getDefaultEditorWindow()
  }

  return candidateWindow
}

function getAiChatWindowForEditorWindow(editorWindow) {
  const chatWindowId = editorToAiChatWindowId.get(editorWindow.id)
  return chatWindowId ? BrowserWindow.fromId(chatWindowId) : null
}

function requestEditorWindowData(editorWindow, request) {
  if (!editorWindow || editorWindow.isDestroyed()) {
    return Promise.reject(new Error('Editor window is unavailable'))
  }

  return new Promise((resolve, reject) => {
    const requestId = randomUUID()
    const timeout = setTimeout(() => {
      pendingAiEditorRequests.delete(requestId)
      reject(new Error(`AI editor request timed out: ${request.type}`))
    }, 5000)

    pendingAiEditorRequests.set(requestId, {
      resolve,
      reject,
      timeout,
    })

    editorWindow.webContents.send('mdv:ai-editor-request', {
      requestId,
      ...request,
    })
  })
}

async function requestEditorContext(editorWindow) {
  const runtimeState = touchEditorRuntimeState(editorWindow)
  const context = await requestEditorWindowData(editorWindow, {
    type: 'get-context',
    editorId: runtimeState.editorId,
  })

  return {
    ...context,
    editorId: runtimeState.editorId,
  }
}

async function readAiTargetForWindow(editorWindow, payload) {
  const runtimeState = touchEditorRuntimeState(editorWindow)
  const resolvedTarget = resolveTargetForSession(editorWindow, payload?.target)

  if (resolvedTarget.kind === 'temp-buffer') {
    return buildBoundedReadPayload(
      resolvedTarget.editorId,
      resolvedTarget.bufferRecord.text,
      resolvedTarget.span,
      payload?.cursor,
      payload?.maxTokens,
    )
  }

  if (resolvedTarget.span?.kind === 'selection') {
    if (!settingsState.ai.toolPermissions.readActiveSelection) {
      throw new Error('Active selection read is disabled in settings')
    }
  } else if (!settingsState.ai.toolPermissions.readActiveDocument) {
    throw new Error('Active document read is disabled in settings')
  }

  const readResult = await requestEditorWindowData(editorWindow, {
    type: 'read',
    target: {
      editorId: runtimeState.editorId,
      span: resolvedTarget.span,
    },
    cursor: payload?.cursor ?? null,
    maxTokens: resolveReadTokenBudget(payload?.maxTokens),
  })

  return readResult
}

async function materializeWriteSources(editorWindow, sources) {
  if (!Array.isArray(sources) || sources.length === 0) {
    return ''
  }

  let output = ''

  for (const source of sources) {
    if (!source || typeof source !== 'object') {
      throw new Error('Invalid AI write source')
    }

    if (source.type === 'literal') {
      output += typeof source.text === 'string' ? source.text : ''
      continue
    }

    if (source.type !== 'slice-ref') {
      throw new Error(`Unsupported AI write source type: ${source.type}`)
    }
    const normalizedSource = normalizeAiSliceRefSource(source)

    const readPayload = await readAiTargetForWindow(editorWindow, {
      target: {
        editorId: normalizedSource.editorId,
        span: normalizedSource.span,
      },
      cursor: null,
      maxTokens: getInlineTokenBudget(),
    })

    if (readPayload?.truncated) {
      throw new Error(`Write source ${normalizedSource.editorId} exceeded bounded read budget; narrow the span first`)
    }

    output += readPayload?.text || ''
  }

  return output
}

function waitForWindowDidFinishLoad(targetWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) {
    return Promise.reject(new Error('Target window is unavailable'))
  }

  if (!targetWindow.webContents.isLoading()) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const handleFinish = () => {
      cleanup()
      resolve()
    }

    const handleFail = (_event, errorCode, errorDescription) => {
      cleanup()
      reject(new Error(`Window failed to load: ${errorCode} ${errorDescription}`))
    }

    const cleanup = () => {
      targetWindow.webContents.removeListener('did-finish-load', handleFinish)
      targetWindow.webContents.removeListener('did-fail-load', handleFail)
    }

    targetWindow.webContents.on('did-finish-load', handleFinish)
    targetWindow.webContents.on('did-fail-load', handleFail)
  })
}

async function createNewEditorWindowFromContent(content, title) {
  const nextWindow = createWindow()
  await waitForWindowDidFinishLoad(nextWindow)
  const context = await requestEditorContext(nextWindow)
  const writeResult = await requestEditorWindowData(nextWindow, {
    type: 'write',
    destination: {
      editorId: context.editorId,
      span: { kind: 'document' },
    },
    sources: [
      {
        type: 'literal',
        text: content,
      },
    ],
    mode: 'replace',
    title: typeof title === 'string' ? title : undefined,
  })

  focusWindow(nextWindow)
  return writeResult
}

async function writeAiTargetForWindow(editorWindow, payload) {
  const runtimeState = touchEditorRuntimeState(editorWindow)
  const destination = payload?.destination

  if (!destination || typeof destination !== 'object') {
    throw new Error('AI write destination is required')
  }

  const content = await materializeWriteSources(editorWindow, payload?.sources)

  if (destination.editorId === ':new') {
    if (!settingsState.ai.toolPermissions.writeNewDocument) {
      throw new Error('New document write is disabled in settings')
    }

    if (isManagedClient()) {
      throw new Error('AI new document creation is unavailable in managed-client mode')
    }

    if (settingsState.safety.confirmBeforeNewDocumentFromAi) {
      const confirmed = await confirmAiWriteAction(editorWindow, {
        title: 'Create AI document?',
        message: 'AI is about to create a new document window.',
        detail: `Title: ${typeof payload?.title === 'string' && payload.title.trim().length > 0 ? payload.title.trim() : 'Untitled.md'}\nBytes: ${Buffer.byteLength(content, 'utf8')}`,
      })

      if (!confirmed) {
        throw new Error('AI new document creation was cancelled')
      }
    }

    const writeResult = await createNewEditorWindowFromContent(content, payload?.title)
    return {
      ...writeResult,
      target: writeResult?.span && typeof writeResult.editorId === 'string' ? buildAiTargetRef(writeResult.editorId, writeResult.span) : undefined,
      created: true,
    }
  }

  const resolvedTarget = resolveTargetForSession(editorWindow, destination)

  if (resolvedTarget.kind === 'temp-buffer') {
    const nextMode = payload?.mode === 'insert' ? 'insert' : 'replace'
    const currentText = resolvedTarget.bufferRecord.text
    const resolvedOffsets = resolveSpanToOffsets(currentText, resolvedTarget.span)
    const startOffset = resolvedOffsets.startOffset
    const endOffset = nextMode === 'insert' ? startOffset : resolvedOffsets.endOffset
    const nextText = `${currentText.slice(0, startOffset)}${content}${currentText.slice(endOffset)}`
    const writtenSpan = normalizeOffsetsToSpan(nextText, startOffset, startOffset + content.length)
    resolvedTarget.bufferRecord.text = nextText
    resolvedTarget.bufferRecord.updatedAt = new Date().toISOString()

    return {
      editorId: resolvedTarget.editorId,
      span: writtenSpan,
      target: buildAiTargetRef(resolvedTarget.editorId, writtenSpan),
      text: content,
      mode: nextMode,
      bytesWritten: Buffer.byteLength(content, 'utf8'),
      created: false,
    }
  }

  if (resolvedTarget.span?.kind === 'selection') {
    if (!settingsState.ai.toolPermissions.writeActiveSelection) {
      throw new Error('Active selection write is disabled in settings')
    }
  } else if (!settingsState.ai.toolPermissions.writeActiveDocument) {
    throw new Error('Active document write is disabled in settings')
  }

  if (payload?.mode !== 'insert' && settingsState.safety.confirmBeforeFullDocumentOverwrite) {
    const fullDocumentTarget = await readFullTargetTextForWindow(editorWindow, {
      target: {
        editorId: resolvedTarget.editorId,
        span: { kind: 'document' },
      },
    })
    const overwriteSpan = resolvedTarget.kind === 'editor-window' && resolvedTarget.span?.kind === 'selection'
      ? await readFullEditorWindowSpan(editorWindow, {
          editorId: resolvedTarget.editorId,
          span: resolvedTarget.span,
        })
      : resolvedTarget.span
    const overwriteOffsets = 'start' in overwriteSpan && 'end' in overwriteSpan
      ? {
          startOffset: markdownPosToOffset(fullDocumentTarget.text, overwriteSpan.start),
          endOffset: markdownPosToOffset(fullDocumentTarget.text, overwriteSpan.end),
        }
      : resolveSpanToOffsets(fullDocumentTarget.text, overwriteSpan)
    const isWholeDocumentOverwrite = overwriteOffsets.startOffset === 0 && overwriteOffsets.endOffset === fullDocumentTarget.text.length

    if (isWholeDocumentOverwrite) {
      const confirmed = await confirmAiWriteAction(editorWindow, {
        title: 'Overwrite document with AI output?',
        message: 'AI is about to replace the full document contents.',
        detail: `Bytes: ${Buffer.byteLength(content, 'utf8')}`,
      })

      if (!confirmed) {
        throw new Error('AI full document overwrite was cancelled')
      }
    }
  }

  const writeResult = await requestEditorWindowData(editorWindow, {
    type: 'write',
    destination: {
      editorId: runtimeState.editorId,
      span: resolvedTarget.span,
    },
    sources: [
      {
        type: 'literal',
        text: content,
      },
    ],
    mode: payload?.mode === 'insert' ? 'insert' : 'replace',
    title: resolvedTarget.editorId === ':new' && typeof payload?.title === 'string' ? payload.title : undefined,
  })

  return {
    ...writeResult,
    target: writeResult?.span && typeof writeResult.editorId === 'string' ? buildAiTargetRef(writeResult.editorId, writeResult.span) : undefined,
  }
}

async function listAiBuffersForWindow(editorWindow) {
  const runtimeState = touchEditorRuntimeState(editorWindow)
  const context = await requestEditorContext(editorWindow)
  const bufferRegistry = getSessionBufferRegistry(editorWindow)
  const buffers = [
    {
      editorId: runtimeState.editorId,
      kind: 'editor-window',
      title: context?.title || 'Untitled',
      currentFilePath: context?.currentFilePath || null,
      isDirty: context?.isDirty === true,
      capabilities: {
        read: true,
        write: true,
        sliceOps: true,
      },
      createdAt: runtimeState.createdAt,
      updatedAt: runtimeState.updatedAt,
    },
    ...Array.from(bufferRegistry.values()).map((bufferRecord) => ({
      editorId: bufferRecord.editorId,
      kind: bufferRecord.kind,
      title: bufferRecord.title,
      currentFilePath: bufferRecord.currentFilePath,
      isDirty: bufferRecord.isDirty,
      capabilities: bufferRecord.capabilities,
      createdAt: bufferRecord.createdAt,
      updatedAt: bufferRecord.updatedAt,
    })),
  ]

  return { buffers }
}

function disposeBufferForWindow(editorWindow, payload) {
  const editorId = typeof payload?.editorId === 'string' ? payload.editorId : ''

  if (!editorId || isActiveEditorAlias(editorId) || editorId.startsWith('editor:')) {
    throw new Error('dispose_buffer requires a temp buffer editorId')
  }

  return {
    editorId,
    disposed: disposeSessionBuffer(editorWindow, editorId),
  }
}

function openAiChatWindow(targetWindow) {
  const editorWindow = getEditorWindowForAiAction(targetWindow)

  if (!editorWindow || editorWindow.isDestroyed()) {
    writeLog('WARN', 'ai-chat', 'No editor window available')
    return { status: 'focused' }
  }

  const existingChatWindow = getAiChatWindowForEditorWindow(editorWindow)

  if (existingChatWindow && !existingChatWindow.isDestroyed()) {
    focusWindow(existingChatWindow)
    return { status: 'focused' }
  }

  const chatWindow = new BrowserWindow({
    width: 520,
    height: 760,
    minWidth: 420,
    minHeight: 540,
    backgroundColor: '#fffaf4',
    autoHideMenuBar: true,
    icon: windowIcon,
    parent: editorWindow,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  editorToAiChatWindowId.set(editorWindow.id, chatWindow.id)
  aiChatToEditorWindowId.set(chatWindow.id, editorWindow.id)

  chatWindow.on('closed', () => {
    aiChatToEditorWindowId.delete(chatWindow.id)
    editorToAiChatWindowId.delete(editorWindow.id)
    clearSessionBuffersForWindow(editorWindow.id)
  })

  loadRendererWindow(chatWindow, 'chat.html')
  focusWindow(chatWindow)
  writeLog('INFO', 'ai-chat', 'BrowserWindow created', { editorWindowId: editorWindow.id, chatWindowId: chatWindow.id })

  return { status: 'opened' }
}

function openSettingsWindow(targetWindow) {
  const ownerEditorWindow = getEditorWindowForAiAction(targetWindow)

  if (!ownerEditorWindow && (!settingsWindow || settingsWindow.isDestroyed())) {
    writeLog('WARN', 'settings', 'No editor window available for settings owner')
    return { status: 'focused' }
  }

  if (ownerEditorWindow && !ownerEditorWindow.isDestroyed()) {
    settingsWindowOwnerEditorId = ownerEditorWindow.id
  }

  if (settingsWindow && !settingsWindow.isDestroyed()) {
    focusWindow(settingsWindow)
    return { status: 'focused' }
  }

  settingsWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: '#fffaf4',
    autoHideMenuBar: true,
    icon: windowIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  settingsWindow.on('closed', () => {
    settingsWindow = null
    settingsWindowOwnerEditorId = null
  })

  loadRendererWindow(settingsWindow, 'settings.html')
  focusWindow(settingsWindow)
  writeLog('INFO', 'settings', 'Settings window opened')

  return { status: 'opened' }
}

function openFetchPermissionsWindow(targetWindow) {
  const ownerEditorWindow = getEditorWindowForAiAction(targetWindow)

  if (!ownerEditorWindow && (!fetchPermissionsWindow || fetchPermissionsWindow.isDestroyed())) {
    writeLog('WARN', 'fetch-permissions', 'No editor window available for fetch permissions owner')
    return { status: 'focused' }
  }

  if (ownerEditorWindow && !ownerEditorWindow.isDestroyed()) {
    fetchPermissionsWindowOwnerEditorId = ownerEditorWindow.id
  }

  if (fetchPermissionsWindow && !fetchPermissionsWindow.isDestroyed()) {
    focusWindow(fetchPermissionsWindow)
    return { status: 'focused' }
  }

  fetchPermissionsWindow = new BrowserWindow({
    width: 920,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: '#fffaf4',
    autoHideMenuBar: true,
    icon: windowIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  fetchPermissionsWindow.on('closed', () => {
    fetchPermissionsWindow = null
    fetchPermissionsWindowOwnerEditorId = null
  })

  loadRendererWindow(fetchPermissionsWindow, 'fetch-permissions.html')
  focusWindow(fetchPermissionsWindow)
  writeLog('INFO', 'fetch-permissions', 'Fetch permissions window opened')

  return { status: 'opened' }
}

function dispatchOpenFileToWindow(targetWindow, launchRequest) {
  if (!targetWindow || (!launchRequest?.filePath && !launchRequest?.explicitInitialPanel)) {
    return
  }

  const resolvedLaunchRequest = {
    filePath: launchRequest?.filePath || null,
    initialPanel: resolveInitialPanelForLaunch(launchRequest),
  }

  writeLog('INFO', 'main', 'Dispatch launch/open file request', resolvedLaunchRequest)
  targetWindow.webContents.send('mdv:open-file-requested', resolvedLaunchRequest)
}

function dispatchServerCommand(command) {
  if (!managedMainWindow || managedMainWindow.isDestroyed()) {
    return
  }

  managedMainWindow.webContents.send('mdv:server-command', command)
}

function queueOrDispatchOpenFile(launchRequest) {
  if (!launchRequest?.filePath && !launchRequest?.explicitInitialPanel) {
    return
  }

  const targetWindow = getDefaultEditorWindow()

  if (!targetWindow || targetWindow.webContents.isLoading()) {
    pendingLaunchRequest = launchRequest
    writeLog('INFO', 'main', 'Queued launch file path', launchRequest)
    return
  }

  dispatchOpenFileToWindow(targetWindow, launchRequest)
}

function loadAllowedLinkRules() {
  try {
    const raw = fs.readFileSync(allowedLinkRulesPath, 'utf8')
    const parsed = JSON.parse(raw)

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter((rule) => typeof rule === 'string' && rule.length > 0)
  } catch {
    return []
  }
}

function saveAllowedLinkRules() {
  fs.mkdirSync(path.dirname(allowedLinkRulesPath), { recursive: true })
  fs.writeFileSync(allowedLinkRulesPath, JSON.stringify(allowedLinkRules, null, 2), 'utf8')
}

function isSupportedExternalUrl(targetUrl) {
  return targetUrl.protocol === 'http:' || targetUrl.protocol === 'https:'
}

function createAllowedLinkRule(targetUrl) {
  return `${targetUrl.origin}/*`
}

function isUrlAllowed(targetUrl) {
  return allowedLinkRules.some((rule) => {
    if (rule.endsWith('*')) {
      return targetUrl.href.startsWith(rule.slice(0, -1))
    }

    return targetUrl.href === rule
  })
}

function registerAllowedLinkRule(rule) {
  if (allowedLinkRules.includes(rule)) {
    return
  }

  allowedLinkRules = [...allowedLinkRules, rule]
  saveAllowedLinkRules()
}

async function confirmExternalNavigation(parentWindow, targetUrl) {
  const suggestedRule = createAllowedLinkRule(targetUrl)
  const response = await dialog.showMessageBox(parentWindow ?? undefined, {
    type: 'warning',
    buttons: ['許可リストに登録して表示', '今回のみ表示', '表示しない'],
    defaultId: 1,
    cancelId: 2,
    title: '未許可の外部サイトです',
    message: '未許可の外部サイトを開こうとしています。',
    detail: `URL: ${targetUrl.href}\n登録候補: ${suggestedRule}`,
    noLink: true,
  })

  if (response.response === 0) {
    registerAllowedLinkRule(suggestedRule)
    return true
  }

  return response.response === 1
}

async function openExternalLink(parentWindow, href) {
  let targetUrl

  try {
    targetUrl = new URL(href)
  } catch {
    writeLog('WARN', 'link', 'Invalid URL', href)
    return { status: 'blocked' }
  }

  if (!isSupportedExternalUrl(targetUrl)) {
    writeLog('WARN', 'link', 'Unsupported protocol', targetUrl.href)
    return { status: 'blocked' }
  }

  if (settingsState.general.openLinksBehavior === 'block-untrusted' && !isUrlAllowed(targetUrl)) {
    writeLog('INFO', 'link', 'Blocked by settings policy', targetUrl.href)
    return { status: 'blocked' }
  }

  if (!isUrlAllowed(targetUrl)) {
    const confirmed = await confirmExternalNavigation(parentWindow, targetUrl)

    if (!confirmed) {
      writeLog('INFO', 'link', 'Blocked by confirmation dialog', targetUrl.href)
      return { status: 'cancelled' }
    }
  }

  if (!settingsState.safety.confirmBeforeExternalUrlOpen) {
    await shell.openExternal(targetUrl.href)
    writeLog('INFO', 'link', 'Opened in default browser without trusted-link confirmation', targetUrl.href)
    return { status: 'opened' }
  }

  await shell.openExternal(targetUrl.href)
  writeLog('INFO', 'link', 'Opened in default browser', targetUrl.href)

  return { status: 'opened' }
}

async function saveContentToPath(parentWindow, payload) {
  const content = typeof payload?.content === 'string' ? payload.content : ''
  const currentPath = typeof payload?.path === 'string' ? payload.path : ''
  const forceDialog = payload?.forceDialog === true
  const defaultFileName = typeof payload?.defaultFileName === 'string' && payload.defaultFileName.trim().length > 0
    ? payload.defaultFileName.trim()
    : 'document.md'

  let targetPath = currentPath

  if (!targetPath || forceDialog) {
    const result = await dialog.showSaveDialog(parentWindow ?? undefined, {
      defaultPath: currentPath || defaultFileName,
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })

    if (result.canceled || !result.filePath) {
      writeLog('INFO', 'ipc', 'save-file cancelled')
      return null
    }

    targetPath = result.filePath
  }

  await fsPromises.writeFile(targetPath, content, 'utf8')
  writeLog('INFO', 'ipc', 'save-file wrote', targetPath)

  return {
    path: targetPath,
  }
}

async function showUnsavedChangesDialog(window, payload) {
  const currentFilePath = typeof payload?.currentFilePath === 'string' ? payload.currentFilePath : ''
  const displayTitle = typeof payload?.displayTitle === 'string' && payload.displayTitle.trim().length > 0
    ? payload.displayTitle.trim()
    : 'Untitled.md'
  const proceedLabel = typeof payload?.proceedLabel === 'string' && payload.proceedLabel.trim().length > 0
    ? payload.proceedLabel.trim()
    : '続行'
  const detailLines = [
    `ファイル: ${currentFilePath || displayTitle}`,
    '未保存の変更があります。',
  ]
  const response = await dialog.showMessageBox(window ?? undefined, {
    type: 'warning',
    buttons: ['保存', 'キャンセル', proceedLabel],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: '保存されていない変更があります',
    message: `このまま${proceedLabel}しますか？`,
    detail: detailLines.join('\n'),
  })

  if (response.response === 0) {
    return { action: 'save' }
  }

  if (response.response === 2) {
    return { action: 'discard' }
  }

  return { action: 'cancel' }
}

async function showUnresponsiveCloseDialog(window) {
  const response = await dialog.showMessageBox(window ?? undefined, {
    type: 'warning',
    buttons: ['キャンセル', '閉じる'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: 'ウィンドウを閉じる前に確認できませんでした',
    message: 'エディタの状態を取得できませんでした。',
    detail: '保存されていない変更がある場合は失われる可能性があります。閉じる場合はそのまま終了します。',
  })

  return response.response === 1
}

async function requestEditorCloseState(editorWindow) {
  return requestEditorWindowData(editorWindow, {
    type: 'get-close-state',
  })
}

function closeAuxiliaryWindowsForEditor(editorWindow) {
  const chatWindow = getAiChatWindowForEditorWindow(editorWindow)

  if (chatWindow && !chatWindow.isDestroyed()) {
    approvedWindowCloseIds.add(chatWindow.id)
    chatWindow.close()
  }

  if (settingsWindowOwnerEditorId === editorWindow.id && settingsWindow && !settingsWindow.isDestroyed()) {
    approvedWindowCloseIds.add(settingsWindow.id)
    settingsWindow.close()
  }

  if (fetchPermissionsWindowOwnerEditorId === editorWindow.id && fetchPermissionsWindow && !fetchPermissionsWindow.isDestroyed()) {
    approvedWindowCloseIds.add(fetchPermissionsWindow.id)
    fetchPermissionsWindow.close()
  }
}

function approveAndCloseWindow(window) {
  approvedWindowCloseIds.add(window.id)
  window.webContents.send('mdv:window-close-approved')
  setImmediate(() => {
    if (!window.isDestroyed()) {
      window.close()
    }
  })
}

async function confirmEditorWindowClose(window) {
  if (!window || window.isDestroyed()) {
    return
  }

  let closeState = null

  try {
    closeState = await requestEditorCloseState(window)
  } catch (error) {
    writeLog('ERROR', 'main', 'Failed to request editor close state', error instanceof Error ? error.message : String(error))
    const shouldForceClose = await showUnresponsiveCloseDialog(window)

    if (!shouldForceClose) {
      return
    }

    closeAuxiliaryWindowsForEditor(window)
    approveAndCloseWindow(window)
    return
  }

  if (!closeState?.isDirty) {
    closeAuxiliaryWindowsForEditor(window)
    approveAndCloseWindow(window)
    return
  }

  const snapshot = closeState.snapshot || {
    markdownText: '',
    persistedMarkdown: '',
    currentFilePath: null,
    displayTitle: 'Untitled.md',
    activePanel: 'write',
  }
  const response = await showUnsavedChangesDialog(window, {
    currentFilePath: snapshot.currentFilePath,
    displayTitle: snapshot.displayTitle,
    proceedLabel: '閉じる',
  })

  if (response.action === 'cancel') {
    return
  }

  if (response.action === 'save') {
    const saveResult = await saveContentToPath(window, {
      path: snapshot.currentFilePath,
      content: snapshot.markdownText,
      defaultFileName: snapshot.displayTitle || 'Untitled.md',
    })

    if (!saveResult) {
      return
    }
  }

  closeAuxiliaryWindowsForEditor(window)
  approveAndCloseWindow(window)
}

async function postServerJson(routePath, payload) {
  if (!managedServerUrl) {
    return null
  }

  const response = await fetch(new URL(routePath, managedServerUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  })

  if (!response.ok) {
    throw new Error(`Server request failed: ${response.status} ${routePath}`)
  }

  return response.json()
}

async function getServerJson(routePath) {
  if (!managedServerUrl) {
    return null
  }

  const response = await fetch(new URL(routePath, managedServerUrl))

  if (!response.ok) {
    throw new Error(`Server request failed: ${response.status} ${routePath}`)
  }

  return response.json()
}

async function registerManagedClient(window) {
  if (!isManagedClient()) {
    return
  }

  const registration = {
    clientId: managedClientId,
    windowId: managedWindowId,
    pid: process.pid,
    filePath: pendingLaunchFilePath,
    version: app.getVersion(),
  }

  await postServerJson('/api/clients/register', registration)
  writeLog('INFO', 'server-client', 'registered', registration)

  if (commandPollTimer) {
    clearInterval(commandPollTimer)
  }

  commandPollTimer = setInterval(() => {
    void pollManagedServerCommands(window)
  }, 1000)

  void pollManagedServerCommands(window)
}

async function pollManagedServerCommands(window) {
  if (!isManagedClient() || !window || window.isDestroyed()) {
    return
  }

  const payload = await getServerJson(`/api/clients/${encodeURIComponent(managedClientId)}/commands`)
  const commands = Array.isArray(payload?.commands) ? payload.commands : []

  for (const command of commands) {
    await handleManagedServerCommand(window, command)
  }
}

async function handleManagedServerCommand(window, command) {
  if (!command || typeof command.type !== 'string') {
    return
  }

  writeLog('INFO', 'server-client', 'command', command)

  if (command.type === 'suspend') {
    pendingServerRequests.set(command.requestId, { type: 'suspend' })
    dispatchServerCommand(command)
    return
  }

  if (command.type === 'resume') {
    pendingServerRequests.set(command.requestId, { type: 'resume' })
    dispatchServerCommand(command)
  }
}

function serializeLogValue(value) {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}\n${value.stack ?? ''}`.trim()
  }

  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function writeLog(level, scope, ...parts) {
  const line = `[${new Date().toISOString()}] [${level}] [${scope}] ${parts
    .map(serializeLogValue)
    .join(' ')}\n`

  fs.mkdirSync(path.dirname(logFilePath), { recursive: true })
  fs.appendFileSync(logFilePath, line, 'utf8')
}

writeLog('INFO', 'main', 'Application bootstrap', { isDev, logFilePath })

async function readUtf8File(filePath) {
  const content = await fsPromises.readFile(filePath, 'utf8')

  return {
    path: filePath,
    content,
  }
}

function attachWindowLogging(mainWindow, initialLaunchRequest = null) {
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    writeLog('ERROR', 'webContents', 'did-fail-load', {
      errorCode,
      errorDescription,
      validatedURL,
    })
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    writeLog('ERROR', 'webContents', 'render-process-gone', details)
  })

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    writeLog('INFO', 'renderer-console', { level, message, line, sourceId })
  })

  mainWindow.webContents.on('dom-ready', () => {
    writeLog('INFO', 'webContents', 'dom-ready', mainWindow.webContents.getURL())
  })

  mainWindow.webContents.on('did-finish-load', () => {
    writeLog('INFO', 'webContents', 'did-finish-load', mainWindow.webContents.getURL())

    if (initialLaunchRequest?.filePath || initialLaunchRequest?.explicitInitialPanel) {
      dispatchOpenFileToWindow(mainWindow, initialLaunchRequest)
      return
    }

    if (pendingLaunchRequest?.filePath || pendingLaunchRequest?.explicitInitialPanel) {
      const launchRequest = pendingLaunchRequest
      pendingLaunchRequest = null
      dispatchOpenFileToWindow(mainWindow, launchRequest)
    }
  })
}

function sendMenuAction(action) {
  const targetWindow = getEditorWindowForAiAction(BrowserWindow.getFocusedWindow())
    ?? BrowserWindow.getAllWindows().find((window) => isEditorWindow(window))

  if (!targetWindow) {
    writeLog('WARN', 'menu', 'No window available for action', action)
    return
  }

  writeLog('INFO', 'menu', 'Dispatch action', action)
  targetWindow.webContents.send('mdv:menu-action', action)
}

function createApplicationMenu() {
  const template = [
    ...(process.platform === 'darwin'
      ? [{ role: 'appMenu' }]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendMenuAction('open'),
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendMenuAction('save'),
        },
        {
          label: 'Save As',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => sendMenuAction('save-as'),
        },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => openSettingsWindow(BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]),
        },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'AI Chat',
          accelerator: 'CmdOrCtrl+I',
          click: () => openAiChatWindow(BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]),
        },
        { type: 'separator' },
        {
          label: 'Editor',
          accelerator: 'CmdOrCtrl+1',
          click: () => sendMenuAction('show-editor'),
        },
        {
          label: 'Rendered Preview',
          accelerator: 'CmdOrCtrl+2',
          click: () => sendMenuAction('show-preview'),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(initialLaunchRequest = null) {
  const mainWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: '#fffaf4',
    autoHideMenuBar: true,
    icon: windowIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  launchStateByWindowId.set(mainWindow.id, {
    initialPanel: resolveInitialPanelForLaunch(initialLaunchRequest),
  })

  mainWindow.on('close', (event) => {
    if (approvedWindowCloseIds.delete(mainWindow.id)) {
      return
    }

    event.preventDefault()

    if (pendingWindowCloseIds.has(mainWindow.id)) {
      return
    }

    pendingWindowCloseIds.add(mainWindow.id)
    void confirmEditorWindowClose(mainWindow)
      .catch((error) => {
        writeLog('ERROR', 'main', 'Editor window close confirmation failed', error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        pendingWindowCloseIds.delete(mainWindow.id)
      })
  })

  attachWindowLogging(mainWindow, initialLaunchRequest)
  mainWindow.on('closed', () => {
    approvedWindowCloseIds.delete(mainWindow.id)
    pendingWindowCloseIds.delete(mainWindow.id)
    launchStateByWindowId.delete(mainWindow.id)
    if (settingsWindowOwnerEditorId === mainWindow.id) {
      settingsWindowOwnerEditorId = null
    }
    if (fetchPermissionsWindowOwnerEditorId === mainWindow.id) {
      fetchPermissionsWindowOwnerEditorId = null
    }

    clearEditorRuntimeState(mainWindow.id)

    if (!getDefaultEditorWindow() && settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.close()
    }
    if (!getDefaultEditorWindow() && fetchPermissionsWindow && !fetchPermissionsWindow.isDestroyed()) {
      fetchPermissionsWindow.close()
    }
  })
  managedMainWindow = mainWindow
  writeLog('INFO', 'main', 'BrowserWindow created')

  mainWindow.webContents.on('did-finish-load', () => {
    if (isManagedClient()) {
      void registerManagedClient(mainWindow)
    }
  })

  if (isDev) {
    loadRendererWindow(mainWindow, 'index.html')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
    return mainWindow
  }

  loadRendererWindow(mainWindow, 'index.html')
  return mainWindow
}

const hasSingleInstanceLock = isManagedClient() ? true : app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
}

ipcMain.handle('mdv:open-file', async () => {
  const window = BrowserWindow.getFocusedWindow()
  const result = await dialog.showOpenDialog(window ?? undefined, {
    properties: ['openFile'],
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })

  if (result.canceled || result.filePaths.length === 0) {
    writeLog('INFO', 'ipc', 'open-file cancelled')
    return null
  }

  writeLog('INFO', 'ipc', 'open-file selected', result.filePaths[0])
  return readUtf8File(result.filePaths[0])
})

ipcMain.handle('mdv:read-file', async (_event, filePath) => {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    writeLog('WARN', 'ipc', 'read-file received invalid path', filePath)
    return null
  }

  writeLog('INFO', 'ipc', 'read-file', filePath)
  return readUtf8File(filePath)
})

ipcMain.handle('mdv:open-ai-chat', async (event) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender)
  return openAiChatWindow(sourceWindow)
})

ipcMain.handle('mdv:open-settings-window', async (event) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender)
  return openSettingsWindow(sourceWindow)
})

ipcMain.handle('mdv:open-fetch-permissions-window', async (event) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender)
  return openFetchPermissionsWindow(sourceWindow)
})

ipcMain.on('mdv:settings-bootstrap', (event) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender)
  const launchState = sourceWindow ? launchStateByWindowId.get(sourceWindow.id) : null

  event.returnValue = {
    settings: settingsState,
    hasPersistedSettings,
    hasReadableSettings,
    initialPanel: launchState?.initialPanel === 'write' ? 'write' : 'preview',
  }
})

ipcMain.handle('mdv:settings-get', async () => settingsState)

ipcMain.handle('mdv:settings-migrate-legacy-theme', async (_event, themeMode) => {
  if (hasPersistedSettings || settingsState.general.themeMode !== 'system') {
    return settingsState
  }

  if (themeMode !== 'light' && themeMode !== 'dark') {
    return settingsState
  }

  settingsState = sanitizeSettings(mergePlainObjects(settingsState, {
    general: {
      themeMode,
    },
  }))
  await persistSettings()
  broadcastSettingsChanged()
  return settingsState
})

ipcMain.handle('mdv:settings-update', async (_event, patch) => {
  settingsState = sanitizeSettings(mergePlainObjects(settingsState, isPlainObject(patch) ? patch : {}))
  await persistSettings()
  broadcastSettingsChanged()
  return settingsState
})

ipcMain.handle('mdv:settings-save-openai-api-key', async (_event, apiKey) => {
  const normalizedApiKey = normalizeSecret(apiKey)

  if (!normalizedApiKey) {
    throw new Error('OpenAI API key cannot be empty')
  }

  secretsState = sanitizeSecrets({
    ...secretsState,
    openaiApiKey: normalizedApiKey,
  })
  await persistSecrets()
  broadcastSettingsChanged()
  return getProviderStatus()
})

ipcMain.handle('mdv:settings-clear-openai-api-key', async () => {
  secretsState = sanitizeSecrets({
    ...secretsState,
    openaiApiKey: null,
  })
  await persistSecrets()
  broadcastSettingsChanged()
  return getProviderStatus()
})

ipcMain.handle('mdv:settings-save-tavily-api-key', async (_event, apiKey) => {
  const normalizedApiKey = normalizeSecret(apiKey)

  if (!normalizedApiKey) {
    throw new Error('Tavily API key cannot be empty')
  }

  secretsState = sanitizeSecrets({
    ...secretsState,
    tavilyApiKey: normalizedApiKey,
  })
  await persistSecrets()
  broadcastSettingsChanged()
  return getProviderStatus()
})

ipcMain.handle('mdv:settings-clear-tavily-api-key', async () => {
  secretsState = sanitizeSecrets({
    ...secretsState,
    tavilyApiKey: null,
  })
  await persistSecrets()
  broadcastSettingsChanged()
  return getProviderStatus()
})

ipcMain.handle('mdv:settings-provider-status', async () => getProviderStatus())

ipcMain.handle('mdv:ai-chat-get-context', async (event) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender)
  const editorWindow = getEditorWindowForAiAction(sourceWindow)
  return requestEditorContext(editorWindow)
})

ipcMain.handle('mdv:ai-chat-read-active-document', async (event) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender)
  const editorWindow = getEditorWindowForAiAction(sourceWindow)
  const runtimeState = ensureEditorRuntimeState(editorWindow)
  return readAiTargetForWindow(editorWindow, {
    target: {
      editorId: runtimeState.editorId,
      span: { kind: 'document' },
    },
    cursor: null,
  })
})

ipcMain.handle('mdv:ai-chat-read-active-selection', async (event) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender)
  const editorWindow = getEditorWindowForAiAction(sourceWindow)
  const runtimeState = ensureEditorRuntimeState(editorWindow)
  return readAiTargetForWindow(editorWindow, {
    target: {
      editorId: runtimeState.editorId,
      span: { kind: 'selection' },
    },
    cursor: null,
  })
})

ipcMain.handle('mdv:ai-chat-read-target', async (event, payload) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender)
  const editorWindow = getEditorWindowForAiAction(sourceWindow)
  return readAiTargetForWindow(editorWindow, payload)
})

ipcMain.handle('mdv:ai-chat-grep-slice', async (event, payload) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender)
  const editorWindow = getEditorWindowForAiAction(sourceWindow)
  return exactSearchForWindow(editorWindow, payload)
})

ipcMain.handle('mdv:ai-chat-stats-slice', async (event, payload) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender)
  const editorWindow = getEditorWindowForAiAction(sourceWindow)
  return statsAiSliceForWindow(editorWindow, payload)
})

ipcMain.handle('mdv:ai-chat-semantic-search', async (event, payload) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender)
  const editorWindow = getEditorWindowForAiAction(sourceWindow)
  return semanticSearchForWindow(editorWindow, payload)
})

ipcMain.handle('mdv:ai-chat-write-active-document', async (event, payload) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender)
  const editorWindow = getEditorWindowForAiAction(sourceWindow)
  const runtimeState = ensureEditorRuntimeState(editorWindow)
  return writeAiTargetForWindow(editorWindow, {
    destination: {
      editorId: runtimeState.editorId,
      span: { kind: 'document' },
    },
    sources: [
      {
        type: 'literal',
        text: typeof payload?.content === 'string' ? payload.content : '',
      },
    ],
    mode: 'replace',
  })
})

ipcMain.handle('mdv:ai-chat-write-active-selection', async (event, payload) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender)
  const editorWindow = getEditorWindowForAiAction(sourceWindow)
  const runtimeState = ensureEditorRuntimeState(editorWindow)
  return writeAiTargetForWindow(editorWindow, {
    destination: {
      editorId: runtimeState.editorId,
      span: { kind: 'selection' },
    },
    sources: [
      {
        type: 'literal',
        text: typeof payload?.content === 'string' ? payload.content : '',
      },
    ],
    mode: 'replace',
  })
})

ipcMain.handle('mdv:ai-chat-write-target', async (event, payload) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender)
  const editorWindow = getEditorWindowForAiAction(sourceWindow)
  return writeAiTargetForWindow(editorWindow, payload)
})

ipcMain.handle('mdv:ai-chat-list-buffers', async (event) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender)
  const editorWindow = getEditorWindowForAiAction(sourceWindow)
  return listAiBuffersForWindow(editorWindow)
})

ipcMain.handle('mdv:ai-chat-send-message', async (_event, payload) => {
  const sourceWindow = BrowserWindow.fromWebContents(_event.sender)
  const editorWindow = getEditorWindowForAiAction(sourceWindow)
  writeLog('INFO', 'ai-chat', 'OpenAI chat request start', {
    messageCount: Array.isArray(payload?.messages) ? payload.messages.length : 0,
    model: settingsState.ai.openai.model,
  })

  try {
    const result = await requestOpenAiChatResponse(editorWindow, payload?.messages)
    writeLog('INFO', 'ai-chat', 'OpenAI chat request completed', {
      responseId: result.responseId,
      model: result.model,
    })
    return result
  } catch (error) {
    writeLog('ERROR', 'ai-chat', 'OpenAI chat request failed', {
      model: settingsState.ai.openai.model,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
})

ipcMain.handle('mdv:open-external-link', async (event, href) => {
  if (typeof href !== 'string' || href.length === 0) {
    writeLog('WARN', 'ipc', 'open-external-link received invalid URL', href)
    return { status: 'blocked' }
  }

  const parentWindow = BrowserWindow.fromWebContents(event.sender)
  return openExternalLink(parentWindow, href)
})

ipcMain.handle('mdv:save-file', async (_event, payload) => {
  const window = BrowserWindow.getFocusedWindow()
  return saveContentToPath(window ?? undefined, payload)
})

ipcMain.handle('mdv:confirm-unsaved-changes', async (event, payload) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  return showUnsavedChangesDialog(window ?? undefined, payload)
})

ipcMain.on('mdv:log', (_event, payload) => {
  const level = typeof payload?.level === 'string' ? payload.level : 'INFO'
  const scope = typeof payload?.scope === 'string' ? payload.scope : 'renderer'
  const message = payload?.message ?? ''
  writeLog(level.toUpperCase(), scope, message)
})

ipcMain.on('mdv:ai-editor-response', (_event, payload) => {
  const pendingRequest = pendingAiEditorRequests.get(payload?.requestId)

  if (!pendingRequest) {
    return
  }

  clearTimeout(pendingRequest.timeout)
  pendingAiEditorRequests.delete(payload.requestId)

  if (payload?.ok === false) {
    pendingRequest.reject(new Error(payload?.error || 'AI editor request failed'))
    return
  }

  pendingRequest.resolve(payload?.payload ?? null)
})

ipcMain.on('mdv:server-command-result', (_event, payload) => {
  if (!isManagedClient() || !payload?.requestId) {
    return
  }

  const pendingRequest = pendingServerRequests.get(payload.requestId)

  if (pendingRequest?.type === 'suspend') {
    pendingServerRequests.delete(payload.requestId)
  }

  void postServerJson(`/api/clients/${encodeURIComponent(managedClientId)}/state`, {
    snapshot: payload.snapshot || null,
    filePath: payload.snapshot?.currentFilePath || null,
    status: payload.type === 'suspend' ? 'suspended' : 'running',
  })

  void postServerJson(`/api/clients/${encodeURIComponent(managedClientId)}/command-result`, payload)

  if (payload.type === 'suspend' && payload.status === 'completed') {
    setTimeout(() => {
      app.quit()
    }, 100)
  }
})

ipcMain.handle('mdv:get-log-path', () => logFilePath)

app.on('web-contents-created', (_event, contents) => {
  contents.on('preload-error', (_preloadEvent, preloadPath, error) => {
    writeLog('ERROR', 'preload', preloadPath, error)
  })
})

process.on('uncaughtException', (error) => {
  writeLog('ERROR', 'process', 'uncaughtException', error)
})

process.on('unhandledRejection', (reason) => {
  writeLog('ERROR', 'process', 'unhandledRejection', reason)
})

app.on('second-instance', (_event, argv) => {
  const launchRequest = resolveLaunchRequest(argv)
  const shouldOpenAdditionalWindow = Boolean(launchRequest.filePath) && !isManagedClient()

  if (shouldOpenAdditionalWindow) {
    const nextWindow = createWindow(launchRequest)
    focusWindow(nextWindow)
    return
  }

  const targetWindow = getDefaultEditorWindow()

  if (targetWindow) {
    focusWindow(targetWindow)
  }

  if (launchRequest.filePath || launchRequest.explicitInitialPanel) {
    queueOrDispatchOpenFile(launchRequest)
  }
})

app.whenReady().then(() => {
  writeLog('INFO', 'main', 'app.whenReady resolved')
  createApplicationMenu()
  const initialLaunchRequest = pendingLaunchRequest
  pendingLaunchRequest = null
  createWindow(initialLaunchRequest)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  writeLog('INFO', 'main', 'window-all-closed')
  if (commandPollTimer) {
    clearInterval(commandPollTimer)
    commandPollTimer = null
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})