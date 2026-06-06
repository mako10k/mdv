// @ts-nocheck
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron')
const { autoUpdater } = require('electron-updater')
const fs = require('node:fs')
const fsPromises = require('node:fs/promises')
const dnsPromises = require('node:dns/promises')
const net = require('node:net')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { createPatch, applyPatch } = require('diff')
const OpenAI = require('openai')
const { createOpenAiResponseStream } = require('../openai-response-stream.cjs')
const {
  extractHeadingOutline,
  getMarkdownStructure,
  getMdastCapabilities,
  mapMarkdownStructure,
  mutateMarkdownStructure,
  validateMarkdownQuery,
} = require('./mdast-adapter.cjs')
const {
  addFetchAclDecisionRule,
  createDefaultFetchAclText,
  evaluateFetchAcl,
  migrateLegacyFetchConfig,
  parseFetchAclText,
} = require('../fetch-acl.cjs')
const { createMainProcessRuntime } = require('./main/runtime.cjs')
const { createDebugChannelController } = require('./main/debug-channel.cjs')
const { createE2eDialogController } = require('./main/dialogs.cjs')
const { buildMergePreviewText, getMainI18n: getMainI18nForSettings } = require('./main/i18n.cjs')
const { createAutosaveRecoveryStore } = require('./main/autosave-recovery.cjs')
const { registerAppLifecycle } = require('./main/lifecycle.cjs')
const { registerMainIpcHandlers } = require('./main/main-ipc.cjs')
const { createSettingsController } = require('./main/settings-controller.cjs')
const { createUpdaterController } = require('./main/updater-controller.cjs')

const runtime = createMainProcessRuntime(app)
const {
  forceStaticRenderer,
  managedServerUrl,
  managedClientId,
  managedWindowId,
  defaultOpenAiModel,
  defaultUpdateFeedUrl,
  isDev,
  windowIcon,
  logFilePath,
  allowedLinkRulesPath,
  settingsPath,
  secretsPath,
  semanticCachePath,
  autosaveRecoveryPath,
  draftWorkspaceRootPath,
} = runtime
let allowedLinkRules = loadAllowedLinkRules()
let pendingLaunchRequest = resolveLaunchRequest(process.argv)
let managedMainWindow = null
let commandPollTimer = null
const pendingServerRequests = new Map()
const pendingAiEditorRequests = new Map()
const launchStateByWindowId = new Map()
const hiddenLaunchRevealTimerByWindowId = new Map()
const editorRuntimeStateByWindowId = new Map()
const aiSessionBuffersByEditorWindowId = new Map()
const trackedFileWatchersByWindowId = new Map()
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
const DEFAULT_CHAT_INPUT_BUDGET_RATIO = 0.45
const DEFAULT_CHAT_INPUT_MIN_TOKENS = 4096
const DEFAULT_CHAT_SUMMARY_BUDGET_RATIO = 0.18
const DEFAULT_CHAT_RECENT_BUDGET_RATIO = 0.62
const DEFAULT_PROTECTED_CONTEXT_BUDGET_RATIO = 0.06
const DEFAULT_PROTECTED_CONTEXT_MAX_ITEMS = 8
const DEFAULT_PROTECTED_CONTEXT_MAX_ITEM_TOKENS = 128
const MAX_SEMANTIC_INDEX_BYTES = 1024 * 1024
const MAX_EMBEDDING_CACHE_BYTES = 256 * 1024 * 1024
const EMBEDDING_CACHE_TOUCH_INTERVAL_MS = 15_000
const EMBEDDING_CACHE_GC_IDLE_DELAY_MS = 120_000
const EMBEDDING_CACHE_GC_PRESSURE_DELAY_MS = 250
const MAX_SEMANTIC_RUNTIME_COUNT = 24
const MAX_SEMANTIC_RUNTIME_AGE_MS = 15 * 60_000
const SEMANTIC_RUNTIME_TOUCH_INTERVAL_MS = 15_000
const SEMANTIC_LAYERS = [
  { name: 'fine', maxChars: 420, overlapChars: 96, weight: 1, boundarySlackChars: 72 },
  { name: 'coarse', maxChars: 1800, overlapChars: 240, weight: 0.96, boundarySlackChars: 180 },
]

let settingsWindow = null
let settingsWindowOwnerEditorId = null
let fetchPermissionsWindow = null
let fetchPermissionsWindowOwnerEditorId = null
let aboutWindow = null
let aboutWindowOwnerEditorId = null
const approvedWindowCloseIds = new Set()
const pendingWindowCloseIds = new Set()

let semanticCacheDidLoad = false
let semanticCacheDirty = false
let semanticCacheSaveTimer = null
const embeddingCacheByKey = new Map()
const semanticRuntimeBySourceKey = new Map()
let embeddingCacheTotalBytes = 0
let embeddingUsageCountsNeedRepair = false
let embeddingCacheGcTimer = null
let embeddingCacheGcScheduledForAt = 0

const debugChannel = createDebugChannelController({
  port: runtime.debugChannelPort,
  writeLog: (...parts) => writeLog(...parts),
})
const e2eDialogs = createE2eDialogController({
  dialog,
  writeLog: (...parts) => writeLog(...parts),
})
const autosaveRecoveryStore = createAutosaveRecoveryStore({
  autosaveRecoveryPath,
  getUntitledTitle: () => getMainI18n().untitledTitle,
  writeLog: (...parts) => writeLog(...parts),
})
const settingsController = createSettingsController({
  settingsPath,
  secretsPath,
  defaultOpenAiModel,
  defaultUpdateFeedUrl,
  appLocale: app.getLocale(),
  createDefaultFetchAclText,
  migrateLegacyFetchConfig,
  assertSafeFetchAclText,
  DEFAULT_FETCH_REQUEST_TIMEOUT_MS,
  DEFAULT_FETCH_IDLE_TIMEOUT_MS,
  DEFAULT_FETCH_AUTO_DISPOSE_AFTER_MS,
  DEFAULT_FETCH_MAX_RESPONSE_BYTES,
  writeLog: (...parts) => writeLog(...parts),
})
let settingsState = settingsController.getSettingsState()
let secretsState = settingsController.getSecretsState()
const updaterController = createUpdaterController({
  app,
  autoUpdater,
  processRef: process,
  writeLog: (...parts) => writeLog(...parts),
  showMessageBox,
  getMainI18n,
  getDefaultEditorWindow,
  getSettingsWindow: () => settingsWindow,
  getAboutWindow: () => aboutWindow,
  getSettingsState: () => settingsState,
  broadcastUpdaterStateChanged: (snapshot) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) {
        continue
      }

      window.webContents.send('mdv:updater-state-changed', snapshot)
    }
  },
})

autosaveRecoveryStore.load()

function isManagedClient() {
  return Boolean(managedServerUrl && managedClientId && managedWindowId)
}

function estimateTokenCount(text) {
  return typeof text === 'string' && text.length > 0 ? Math.ceil(text.length / DEFAULT_TOKEN_TO_CHAR_RATIO) : 0
}

function normalizeRecoveryFilePath(filePath) {
  return autosaveRecoveryStore.normalizeRecoveryFilePath(filePath)
}

function flushAutosaveRecoveryStoreSync() {
  autosaveRecoveryStore.flushSync()
}

function upsertAutosaveRecovery(snapshot) {
  return autosaveRecoveryStore.upsert(snapshot)
}

function clearAutosaveRecovery(payload = {}) {
  autosaveRecoveryStore.clear(payload)
}

function getLatestAutosaveRecovery() {
  return autosaveRecoveryStore.getLatest()
}

function getAutosaveRecoveryByRecoveryKey(recoveryKey) {
  return autosaveRecoveryStore.getByRecoveryKey(recoveryKey)
}

function getAutosaveRecoveryForFile(filePath) {
  return autosaveRecoveryStore.getForFile(filePath)
}

function getMainI18n() {
  return getMainI18nForSettings(settingsState)
}

function emitDebugChannelEvent(type, payload = null) {
  debugChannel.emitEvent(type, payload)
}

function startDebugChannelServer() {
  debugChannel.startServer()
}

function stopDebugChannelServer() {
  debugChannel.stopServer()
}

async function showMessageBox(window, options) {
  return e2eDialogs.showMessageBox(window, options)
}

async function showSaveDialog(window, options) {
  return e2eDialogs.showSaveDialog(window, options)
}

async function showOpenDialog(window, options) {
  return e2eDialogs.showOpenDialog(window, options)
}

function getModelContextWindow(model) {
  return MODEL_CONTEXT_WINDOW_BY_NAME[model] || DEFAULT_MODEL_CONTEXT_WINDOW
}

function normalizeWorkspaceId(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function buildDraftWorkspaceRecord(workspaceId) {
  const rootDir = path.join(draftWorkspaceRootPath, workspaceId)

  return {
    workspaceId,
    rootDir,
    markdownFilePath: path.join(rootDir, 'document.md'),
    assetDir: path.join(rootDir, 'assets'),
    manifestPath: path.join(rootDir, 'manifest.json'),
  }
}

async function ensureDraftWorkspace(payload = {}) {
  const workspaceId = normalizeWorkspaceId(payload.workspaceId) || `wrk_${randomUUID()}`
  const workspace = buildDraftWorkspaceRecord(workspaceId)

  await fsPromises.mkdir(workspace.assetDir, { recursive: true })

  const existingManifest = await readDraftWorkspaceManifest(workspace)

  if (existingManifest) {
    return workspace
  }

  const manifest = {
    workspaceId,
    kind: 'draft',
    markdownFile: path.relative(workspace.rootDir, workspace.markdownFilePath),
    assetDir: path.relative(workspace.rootDir, workspace.assetDir),
    assets: [],
  }

  await fsPromises.writeFile(workspace.manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

  return workspace
}

function normalizeDraftWorkspacePayload(value) {
  const workspaceId = normalizeWorkspaceId(value?.workspaceId)

  if (!workspaceId) {
    return null
  }

  return buildDraftWorkspaceRecord(workspaceId)
}

function ensurePosixRelativePath(value) {
  return value.split(path.sep).join('/')
}

function isImageMimeType(mimeType) {
  return typeof mimeType === 'string' && mimeType.startsWith('image/')
}

function getExtensionForMimeType(mimeType) {
  switch ((mimeType || '').toLowerCase()) {
    case 'image/png':
      return '.png'
    case 'image/jpeg':
      return '.jpg'
    case 'image/gif':
      return '.gif'
    case 'image/webp':
      return '.webp'
    case 'image/svg+xml':
      return '.svg'
    case 'image/bmp':
      return '.bmp'
    case 'image/x-icon':
      return '.ico'
    case 'image/avif':
      return '.avif'
    default:
      return ''
  }
}

function sanitizeAssetFileName(fileName, mimeType) {
  const trimmedName = typeof fileName === 'string' ? fileName.trim() : ''
  const normalizedName = trimmedName.length > 0 ? trimmedName : `image${getExtensionForMimeType(mimeType) || '.png'}`
  const parsedName = path.parse(normalizedName)
  const safeBaseName = (parsedName.name || 'image').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'image'
  const extension = parsedName.ext || getExtensionForMimeType(mimeType) || '.png'
  return `${safeBaseName}${extension.toLowerCase()}`
}

async function getUniqueFilePath(directoryPath, fileName) {
  const parsedName = path.parse(fileName)
  let candidateIndex = 1
  let candidatePath = path.join(directoryPath, fileName)

  while (true) {
    try {
      await fsPromises.access(candidatePath, fs.constants.F_OK)
      candidateIndex += 1
      candidatePath = path.join(directoryPath, `${parsedName.name}-${candidateIndex}${parsedName.ext}`)
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') {
        return candidatePath
      }

      throw error
    }
  }
}

async function readDraftWorkspaceManifest(draftWorkspace) {
  try {
    const parsed = JSON.parse(await fsPromises.readFile(draftWorkspace.manifestPath, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return null
    }

    throw error
  }
}

async function writeDraftWorkspaceManifest(draftWorkspace, manifest) {
  await fsPromises.mkdir(draftWorkspace.rootDir, { recursive: true })
  await fsPromises.writeFile(draftWorkspace.manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
}

async function appendDraftWorkspaceAssetRecord(draftWorkspace, assetRecord) {
  const manifest = await readDraftWorkspaceManifest(draftWorkspace) || {
    workspaceId: draftWorkspace.workspaceId,
    kind: 'draft',
    markdownFile: path.relative(draftWorkspace.rootDir, draftWorkspace.markdownFilePath),
    assetDir: path.relative(draftWorkspace.rootDir, draftWorkspace.assetDir),
    assets: [],
  }

  const assets = Array.isArray(manifest.assets) ? manifest.assets : []
  assets.push(assetRecord)
  manifest.assets = assets
  await writeDraftWorkspaceManifest(draftWorkspace, manifest)
}

function buildWorkspaceAssetContext(payload = {}) {
  const currentFilePath = normalizeRecoveryFilePath(payload.currentFilePath)

  if (currentFilePath) {
    return {
      markdownFilePath: currentFilePath,
      assetDir: path.join(path.dirname(currentFilePath), 'assets'),
      draftWorkspace: null,
    }
  }

  const draftWorkspace = normalizeDraftWorkspacePayload(payload.draftWorkspace)

  if (!draftWorkspace) {
    return null
  }

  return {
    markdownFilePath: draftWorkspace.markdownFilePath,
    assetDir: draftWorkspace.assetDir,
    draftWorkspace,
  }
}

async function importImageAsset(payload = {}) {
  const workspaceContext = buildWorkspaceAssetContext(payload)

  if (!workspaceContext) {
    return null
  }

  const sourcePath = normalizeRecoveryFilePath(payload.sourcePath)
  const mimeType = typeof payload.mimeType === 'string' ? payload.mimeType.trim().toLowerCase() : ''
  const suggestedName = typeof payload.suggestedName === 'string' ? payload.suggestedName.trim() : ''
  let content = null

  if (sourcePath) {
    if (!isInlineExportImagePath(sourcePath)) {
      return null
    }

    content = await fsPromises.readFile(sourcePath)
  } else if (typeof payload.bytesBase64 === 'string' && payload.bytesBase64.length > 0) {
    if (!isImageMimeType(mimeType)) {
      return null
    }

    content = Buffer.from(payload.bytesBase64, 'base64')
  }

  if (!content) {
    return null
  }

  await fsPromises.mkdir(workspaceContext.assetDir, { recursive: true })
  const fileName = sanitizeAssetFileName(suggestedName || (sourcePath ? path.basename(sourcePath) : ''), mimeType || (sourcePath ? getMimeTypeForFile(sourcePath) : ''))
  const targetPath = await getUniqueFilePath(workspaceContext.assetDir, fileName)
  await fsPromises.writeFile(targetPath, content)

  const relativePath = ensurePosixRelativePath(path.relative(path.dirname(workspaceContext.markdownFilePath), targetPath))

  if (workspaceContext.draftWorkspace) {
    const stat = await fsPromises.stat(targetPath)
    await appendDraftWorkspaceAssetRecord(workspaceContext.draftWorkspace, {
      assetId: `ast_${randomUUID()}`,
      relativePath,
      mimeType: mimeType || getMimeTypeForFile(targetPath),
      byteSize: Number(stat.size) || content.length,
      createdBy: payload.createdBy === 'drop' ? 'drop' : 'paste',
    })
  }

  return {
    filePath: targetPath,
    relativePath,
    markdownFilePath: workspaceContext.markdownFilePath,
    draftWorkspace: workspaceContext.draftWorkspace,
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function rewriteMarkdownAssetPath(markdown, currentRelativePath, nextRelativePath) {
  if (currentRelativePath === nextRelativePath) {
    return markdown
  }

  const expression = new RegExp(`(\\!?(?:\\[[^\\]]*\\])\\()${escapeRegExp(currentRelativePath)}(?=[)#?])`, 'g')
  return markdown.replace(expression, `$1${nextRelativePath}`)
}

function collectReferencedDraftAssetPaths(markdown) {
  const assetPaths = new Set()
  const expression = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  let match = expression.exec(markdown)

  while (match) {
    const candidate = typeof match[1] === 'string' ? match[1].trim() : ''

    if (candidate.startsWith('assets/')) {
      assetPaths.add(candidate)
    }

    match = expression.exec(markdown)
  }

  return [...assetPaths]
}

function collectReferencedRelativeAssetPaths(markdown) {
  return new Set(collectReferencedDraftAssetPaths(markdown))
}

function collectDraftWorkspaceMaterializationPaths(manifest, markdown) {
  const assetRelativePaths = new Set()

  for (const relativePath of collectReferencedDraftAssetPaths(markdown)) {
    assetRelativePaths.add(relativePath)
  }

  return assetRelativePaths
}

async function cleanupImportedAssetFiles(filePaths) {
  for (const filePath of Array.isArray(filePaths) ? filePaths : []) {
    if (typeof filePath !== 'string' || filePath.trim().length === 0) {
      continue
    }

    try {
      await fsPromises.unlink(filePath)
    } catch (error) {
      if (!error || typeof error !== 'object' || error.code !== 'ENOENT') {
        throw error
      }
    }
  }
}

async function cleanupDraftWorkspace(payload = {}) {
  const draftWorkspace = normalizeDraftWorkspacePayload(payload?.draftWorkspace)

  if (!draftWorkspace) {
    return
  }

  await fsPromises.rm(draftWorkspace.rootDir, { recursive: true, force: true })
}

async function resolveDraftWorkspaceForMaterialization(draftWorkspace, recoveryKey, markdown) {
  const normalizedDraftWorkspace = normalizeDraftWorkspacePayload(draftWorkspace)
  const recoveredEntry = getAutosaveRecoveryByRecoveryKey(recoveryKey)

  if (recoveredEntry?.snapshot?.draftWorkspace) {
    const recoveredDraftWorkspace = normalizeDraftWorkspacePayload(recoveredEntry.snapshot.draftWorkspace)

    if (recoveredDraftWorkspace) {
      const recoveredManifest = await readDraftWorkspaceManifest(recoveredDraftWorkspace)

      if (collectDraftWorkspaceMaterializationPaths(recoveredManifest, markdown).size > 0) {
        return recoveredDraftWorkspace
      }
    }
  }

  if (normalizedDraftWorkspace) {
    const manifest = await readDraftWorkspaceManifest(normalizedDraftWorkspace)

    if (collectDraftWorkspaceMaterializationPaths(manifest, markdown).size > 0) {
      return normalizedDraftWorkspace
    }
  }

  const latestRecovery = getLatestAutosaveRecovery()

  if (!latestRecovery?.snapshot || latestRecovery.snapshot.markdownText !== markdown) {
    return normalizedDraftWorkspace
  }

  const recoveredDraftWorkspace = normalizeDraftWorkspacePayload(latestRecovery.snapshot.draftWorkspace)

  if (!recoveredDraftWorkspace) {
    return normalizedDraftWorkspace
  }

  const recoveredManifest = await readDraftWorkspaceManifest(recoveredDraftWorkspace)

  if (collectDraftWorkspaceMaterializationPaths(recoveredManifest, markdown).size === 0) {
    return normalizedDraftWorkspace
  }

  return recoveredDraftWorkspace
}

async function materializeDraftWorkspaceAssets(draftWorkspace, targetMarkdownPath, markdown, recoveryKey = null) {
  const normalizedDraftWorkspace = await resolveDraftWorkspaceForMaterialization(
    draftWorkspace,
    recoveryKey,
    markdown,
  )

  if (!normalizedDraftWorkspace) {
    return markdown
  }

  const manifest = await readDraftWorkspaceManifest(normalizedDraftWorkspace)
  const assetRelativePaths = collectDraftWorkspaceMaterializationPaths(manifest, markdown)

  if (assetRelativePaths.size === 0) {
    return markdown
  }

  const targetAssetDir = path.join(path.dirname(targetMarkdownPath), 'assets')
  await fsPromises.mkdir(targetAssetDir, { recursive: true })
  let nextMarkdown = markdown

  for (const relativePath of assetRelativePaths) {
    const sourceAssetPath = path.resolve(normalizedDraftWorkspace.rootDir, relativePath)

    try {
      await fsPromises.access(sourceAssetPath, fs.constants.F_OK)
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') {
        continue
      }

      throw error
    }

    const targetAssetPath = await getUniqueFilePath(targetAssetDir, path.basename(relativePath))
    await fsPromises.copyFile(sourceAssetPath, targetAssetPath)
    const nextRelativePath = ensurePosixRelativePath(path.relative(path.dirname(targetMarkdownPath), targetAssetPath))
    nextMarkdown = rewriteMarkdownAssetPath(nextMarkdown, relativePath, nextRelativePath)
  }

  return nextMarkdown
}

async function materializePendingImportedAssets(pendingImportedAssets, currentMarkdownPath, targetMarkdownPath, markdown) {
  const assets = Array.isArray(pendingImportedAssets)
    ? pendingImportedAssets.filter((asset) => typeof asset?.filePath === 'string' && typeof asset?.relativePath === 'string')
    : []

  if (assets.length === 0 || !currentMarkdownPath || currentMarkdownPath === targetMarkdownPath) {
    return markdown
  }

  const referencedAssetPaths = collectReferencedRelativeAssetPaths(markdown)

  if (referencedAssetPaths.size === 0) {
    return markdown
  }

  const targetAssetDir = path.join(path.dirname(targetMarkdownPath), 'assets')
  await fsPromises.mkdir(targetAssetDir, { recursive: true })
  let nextMarkdown = markdown

  for (const asset of assets) {
    if (!referencedAssetPaths.has(asset.relativePath)) {
      continue
    }

    const targetAssetPath = await getUniqueFilePath(targetAssetDir, path.basename(asset.relativePath))
    await fsPromises.copyFile(asset.filePath, targetAssetPath)
    const nextRelativePath = ensurePosixRelativePath(path.relative(path.dirname(targetMarkdownPath), targetAssetPath))
    nextMarkdown = rewriteMarkdownAssetPath(nextMarkdown, asset.relativePath, nextRelativePath)
  }

  return nextMarkdown
}

function getInlineTokenBudget() {
  return Math.max(512, Math.floor(getModelContextWindow(settingsState.ai.openai.model) * 0.05))
}

function getAiChatInputBudget(model = settingsState.ai.openai.model) {
  return Math.max(DEFAULT_CHAT_INPUT_MIN_TOKENS, Math.floor(getModelContextWindow(model) * DEFAULT_CHAT_INPUT_BUDGET_RATIO))
}

function getAiChatSummaryBudget(model = settingsState.ai.openai.model) {
  return Math.max(256, Math.floor(getAiChatInputBudget(model) * DEFAULT_CHAT_SUMMARY_BUDGET_RATIO))
}

function getAiChatRecentBudget(model = settingsState.ai.openai.model) {
  return Math.max(1024, Math.floor(getAiChatInputBudget(model) * DEFAULT_CHAT_RECENT_BUDGET_RATIO))
}

function getProtectedContextBudgetTokens(model = settingsState.ai.openai.model) {
  return Math.max(96, Math.floor(getModelContextWindow(model) * DEFAULT_PROTECTED_CONTEXT_BUDGET_RATIO))
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

function adjustChunkBoundary(text, offset, direction, maxAdjustmentChars = Number.POSITIVE_INFINITY) {
  const clampedOffset = Math.min(Math.max(0, offset), text.length)

  if (clampedOffset <= 0 || clampedOffset >= text.length) {
    return clampedOffset
  }

  if (direction === 'end') {
    const newlineOffset = text.indexOf('\n', clampedOffset)

    if (newlineOffset === -1) {
      return clampedOffset
    }

    if (newlineOffset - clampedOffset > maxAdjustmentChars) {
      return clampedOffset
    }

    return newlineOffset + 1
  }

  const newlineOffset = text.lastIndexOf('\n', clampedOffset - 1)

  if (newlineOffset === -1) {
    return clampedOffset
  }

  const adjustedOffset = newlineOffset + 1

  if (clampedOffset - adjustedOffset > maxAdjustmentChars) {
    return clampedOffset
  }

  return adjustedOffset
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
      endOffset = adjustChunkBoundary(targetText.text, endOffset, 'end', layer.boundarySlackChars)

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
      startOffset = adjustChunkBoundary(targetText.text, startOffset, 'start', layer.boundarySlackChars)
    }
  }

  return chunks
}

function compareSemanticCandidates(left, right) {
  const scoreDelta = right.score - left.score

  if (scoreDelta !== 0) {
    return scoreDelta
  }

  const leftWidth = left.endOffset - left.startOffset
  const rightWidth = right.endOffset - right.startOffset

  if (leftWidth !== rightWidth) {
    return leftWidth - rightWidth
  }

  return left.startOffset - right.startOffset
}

function isContainedSemanticCandidate(outer, inner) {
  return outer.startOffset <= inner.startOffset && outer.endOffset >= inner.endOffset
}

function normalizeSemanticCandidates(candidates, maxResults) {
  const bestBySpanKey = new Map()

  for (const candidate of candidates) {
    const spanKey = `${candidate.startOffset}:${candidate.endOffset}`
    const existingCandidate = bestBySpanKey.get(spanKey)

    if (!existingCandidate || compareSemanticCandidates(candidate, existingCandidate) < 0) {
      bestBySpanKey.set(spanKey, candidate)
    }
  }

  const sortedCandidates = Array.from(bestBySpanKey.values()).sort(compareSemanticCandidates)
  const candidatePool = sortedCandidates.slice(0, Math.max(maxResults * 6, maxResults))
  const normalized = []

  for (const candidate of candidatePool) {
    const candidateWidth = candidate.endOffset - candidate.startOffset
    const shadowedByNarrowerMatch = candidatePool.some((otherCandidate) => {
      if (otherCandidate === candidate) {
        return false
      }

      const otherWidth = otherCandidate.endOffset - otherCandidate.startOffset

      if (otherWidth >= candidateWidth) {
        return false
      }

      if (!isContainedSemanticCandidate(candidate, otherCandidate)) {
        return false
      }

      return otherCandidate.score >= candidate.score * 0.94
    })

    if (!shadowedByNarrowerMatch) {
      normalized.push(candidate)
    }
  }

  return normalized.sort(compareSemanticCandidates).slice(0, maxResults)
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
    trackedFilePath: null,
    structureHandles: new Map(),
    protectedContextItems: new Map(),
    compressionState: {
      summaryText: '',
      summarizedMessageCount: 0,
      updatedAt: null,
    },
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

  clearTrackedFileWatcher(windowId)
  editorRuntimeStateByWindowId.delete(windowId)
  clearSessionBuffersForWindow(windowId)
}

function getStructureHandleRegistry(editorWindow) {
  const runtimeState = ensureEditorRuntimeState(editorWindow)

  if (!(runtimeState.structureHandles instanceof Map)) {
    runtimeState.structureHandles = new Map()
  }

  return runtimeState.structureHandles
}

function fingerprintMarkdown(text) {
  return createHash('sha1').update(typeof text === 'string' ? text : '', 'utf8').digest('hex').slice(0, 16)
}

function normalizeStructurePath(path) {
  if (!Array.isArray(path) || path.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error('Invalid structure path')
  }

  return [...path]
}

function structurePathsEqual(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index])
}

function pruneStructureHandlesForEditor(registry, editorId, fingerprint) {
  for (const [handle, record] of registry.entries()) {
    if (record?.editorId === editorId && record?.fingerprint !== fingerprint) {
      registry.delete(handle)
    }
  }
}

function buildStructureSelectorFromHandleRecord(record) {
  return {
    path: normalizeStructurePath(record.path),
  }
}

function registerStructureHandle(editorWindow, payload) {
  const registry = getStructureHandleRegistry(editorWindow)
  const normalizedPath = normalizeStructurePath(payload.path)
  const timestamp = new Date().toISOString()

  pruneStructureHandlesForEditor(registry, payload.editorId, payload.fingerprint)

  for (const record of registry.values()) {
    if (
      record?.editorId === payload.editorId
      && record?.fingerprint === payload.fingerprint
      && structurePathsEqual(record.path, normalizedPath)
    ) {
      record.query = typeof payload.query === 'string' && payload.query.trim().length > 0 ? payload.query.trim() : record.query
      record.type = typeof payload.type === 'string' ? payload.type : record.type
      record.updatedAt = timestamp
      return record
    }
  }

  const handle = `mdast:${randomUUID()}`
  const record = {
    handle,
    editorId: payload.editorId,
    fingerprint: payload.fingerprint,
    path: normalizedPath,
    query: typeof payload.query === 'string' && payload.query.trim().length > 0 ? payload.query.trim() : null,
    type: typeof payload.type === 'string' ? payload.type : 'unknown',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  registry.set(handle, record)
  return record
}

function getStructureHandleRecord(editorWindow, handle) {
  const registry = getStructureHandleRegistry(editorWindow)
  return registry.get(handle) || null
}

function normalizeProtectedContextPriority(value) {
  if (value === 'high' || value === 'low') {
    return value
  }

  return 'normal'
}

function pickHigherProtectedContextPriority(left, right) {
  const priorityOrder = { high: 0, normal: 1, low: 2 }
  const normalizedLeft = normalizeProtectedContextPriority(left)
  const normalizedRight = normalizeProtectedContextPriority(right)
  return (priorityOrder[normalizedLeft] ?? 1) <= (priorityOrder[normalizedRight] ?? 1)
    ? normalizedLeft
    : normalizedRight
}

function getProtectedContextRegistry(editorWindow) {
  const runtimeState = ensureEditorRuntimeState(editorWindow)

  if (!(runtimeState.protectedContextItems instanceof Map)) {
    runtimeState.protectedContextItems = new Map()
  }

  return runtimeState.protectedContextItems
}

function listProtectedContextItemRecords(editorWindow) {
  const registry = getProtectedContextRegistry(editorWindow)

  return Array.from(registry.values())
    .sort((left, right) => {
      const priorityOrder = { high: 0, normal: 1, low: 2 }
      const priorityDelta = (priorityOrder[left.priority] ?? 1) - (priorityOrder[right.priority] ?? 1)

      if (priorityDelta !== 0) {
        return priorityDelta
      }

      return Date.parse(right.updatedAt || 0) - Date.parse(left.updatedAt || 0)
    })
}

function formatProtectedContextItemLine(item) {
  return `- [${item.priority}] ${item.title}: ${item.content}`
}

function buildProtectedContextBlockText(items, maxTokens = Number.POSITIVE_INFINITY) {
  const normalizedItems = Array.isArray(items) ? items.filter(Boolean) : []

  if (normalizedItems.length === 0) {
    return ''
  }

  const header = 'Protected context items. Keep these stable unless the user explicitly changes them:\n'
  const lines = []
  let remainingTokens = Number.isFinite(maxTokens)
    ? Math.max(0, maxTokens - estimateTokenCount(header))
    : Number.POSITIVE_INFINITY

  for (const item of normalizedItems) {
    const line = formatProtectedContextItemLine(item)
    const lineTokens = estimateTokenCount(line)

    if (lineTokens > remainingTokens) {
      break
    }

    lines.push(line)
    remainingTokens -= lineTokens
  }

  if (lines.length === 0) {
    return ''
  }

  return `${header}${lines.join('\n')}`
}

function getProtectedContextUsage(editorWindow, model = settingsState.ai.openai.model) {
  const items = listProtectedContextItemRecords(editorWindow)
  const totalTokens = estimateTokenCount(buildProtectedContextBlockText(items))

  return {
    budgetTokens: getProtectedContextBudgetTokens(model),
    totalTokens,
    itemCount: items.length,
    maxItems: DEFAULT_PROTECTED_CONTEXT_MAX_ITEMS,
    maxItemTokens: DEFAULT_PROTECTED_CONTEXT_MAX_ITEM_TOKENS,
  }
}

function summarizeProtectedContextItem(item) {
  return {
    itemId: item.itemId,
    title: item.title,
    content: item.content,
    priority: item.priority,
    estimatedTokens: item.estimatedTokens,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

function buildProtectedContextDeleteCandidateHint(editorWindow) {
  const items = listProtectedContextItemRecords(editorWindow)
  const candidates = items
    .slice()
    .reverse()
    .slice(0, 3)
    .map((item) => `${item.itemId} (${item.title})`)

  if (candidates.length === 0) {
    return 'Delete or shorten existing protected items before saving another one.'
  }

  return `Delete or shorten existing protected items before saving another one. Candidates: ${candidates.join(', ')}`
}

function saveProtectedContextItemForWindow(editorWindow, payload) {
  const title = typeof payload?.title === 'string' ? payload.title.trim() : ''
  const content = typeof payload?.content === 'string' ? payload.content.trim() : ''

  if (title.length === 0) {
    throw new AiToolUserError('save_context_item', 'title must be a non-empty string.', 'Provide title as a short label such as "Current release constraint".')
  }

  if (content.length === 0) {
    throw new AiToolUserError('save_context_item', 'content must be a non-empty string.', 'Provide content as a short fact, constraint, or TODO to preserve.')
  }

  const priority = normalizeProtectedContextPriority(payload?.priority)
  const estimatedTokens = estimateTokenCount(formatProtectedContextItemLine({ title, content, priority }))

  if (estimatedTokens > DEFAULT_PROTECTED_CONTEXT_MAX_ITEM_TOKENS) {
    throw new AiToolUserError(
      'save_context_item',
      `content is too large for protected context (${estimatedTokens} tokens).`,
      `Shorten the content to about ${DEFAULT_PROTECTED_CONTEXT_MAX_ITEM_TOKENS} tokens or less.`,
    )
  }

  const usage = getProtectedContextUsage(editorWindow)

  if (usage.itemCount >= usage.maxItems) {
    throw new AiToolUserError(
      'save_context_item',
      'protected context is full by item count.',
      buildProtectedContextDeleteCandidateHint(editorWindow),
    )
  }

  const nextTotalTokens = estimateTokenCount(buildProtectedContextBlockText([
    ...listProtectedContextItemRecords(editorWindow),
    { title, content, priority },
  ]))

  if (nextTotalTokens > usage.budgetTokens) {
    throw new AiToolUserError(
      'save_context_item',
      'protected context budget would overflow.',
      `${buildProtectedContextDeleteCandidateHint(editorWindow)} Or save a shorter fact.`,
    )
  }

  const timestamp = new Date().toISOString()
  const item = {
    itemId: `context:${randomUUID()}`,
    title,
    content,
    priority,
    estimatedTokens,
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  const registry = getProtectedContextRegistry(editorWindow)
  registry.set(item.itemId, item)
  touchEditorRuntimeState(editorWindow)

  return {
    item: summarizeProtectedContextItem(item),
    usage: getProtectedContextUsage(editorWindow),
  }
}

function updateProtectedContextItemForWindow(editorWindow, payload) {
  const itemId = typeof payload?.itemId === 'string' ? payload.itemId.trim() : ''

  if (itemId.length === 0) {
    throw new AiToolUserError('update_context_item', 'itemId must be a non-empty string.', 'Call list_context_items first and reuse one returned itemId.')
  }

  const registry = getProtectedContextRegistry(editorWindow)
  const existingItem = registry.get(itemId)

  if (!existingItem) {
    throw new AiToolUserError('update_context_item', `Unknown protected context item: ${itemId}`, 'Call list_context_items first and reuse one returned itemId.')
  }

  const hasTitle = Object.prototype.hasOwnProperty.call(payload || {}, 'title')
  const hasContent = Object.prototype.hasOwnProperty.call(payload || {}, 'content')
  const hasPriority = Object.prototype.hasOwnProperty.call(payload || {}, 'priority')

  if (!hasTitle && !hasContent && !hasPriority) {
    throw new AiToolUserError('update_context_item', 'At least one field must be provided to update.', 'Provide one or more of title, content, or priority.')
  }

  const nextTitle = hasTitle ? String(payload.title || '').trim() : existingItem.title
  const nextContent = hasContent ? String(payload.content || '').trim() : existingItem.content

  if (nextTitle.length === 0) {
    throw new AiToolUserError('update_context_item', 'title must be a non-empty string.', 'Provide title as a short label or omit it to keep the current value.')
  }

  if (nextContent.length === 0) {
    throw new AiToolUserError('update_context_item', 'content must be a non-empty string.', 'Provide content as a short fact, constraint, or TODO, or omit it to keep the current value.')
  }

  const nextPriority = hasPriority ? normalizeProtectedContextPriority(payload.priority) : existingItem.priority
  const estimatedTokens = estimateTokenCount(formatProtectedContextItemLine({ title: nextTitle, content: nextContent, priority: nextPriority }))

  if (estimatedTokens > DEFAULT_PROTECTED_CONTEXT_MAX_ITEM_TOKENS) {
    throw new AiToolUserError(
      'update_context_item',
      `content is too large for protected context (${estimatedTokens} tokens).`,
      `Shorten the content to about ${DEFAULT_PROTECTED_CONTEXT_MAX_ITEM_TOKENS} tokens or less.`,
    )
  }

  const usage = getProtectedContextUsage(editorWindow)
  const nextItems = listProtectedContextItemRecords(editorWindow).map((item) => (
    item.itemId === itemId
      ? {
          ...item,
          title: nextTitle,
          content: nextContent,
          priority: nextPriority,
        }
      : item
  ))
  const nextTotalTokens = estimateTokenCount(buildProtectedContextBlockText(nextItems))

  if (nextTotalTokens > usage.budgetTokens) {
    throw new AiToolUserError(
      'update_context_item',
      'protected context budget would overflow after this update.',
      `${buildProtectedContextDeleteCandidateHint(editorWindow)} Or shorten the updated item.`,
    )
  }

  const updatedItem = {
    ...existingItem,
    title: nextTitle,
    content: nextContent,
    priority: nextPriority,
    estimatedTokens,
    updatedAt: new Date().toISOString(),
  }

  registry.set(itemId, updatedItem)
  touchEditorRuntimeState(editorWindow)

  return {
    item: summarizeProtectedContextItem(updatedItem),
    usage: getProtectedContextUsage(editorWindow),
  }
}

function mergeProtectedContextItemsForWindow(editorWindow, payload) {
  const itemIds = Array.from(new Set((Array.isArray(payload?.itemIds) ? payload.itemIds : [])
    .filter((itemId) => typeof itemId === 'string')
    .map((itemId) => itemId.trim())
    .filter((itemId) => itemId.length > 0)))

  if (itemIds.length < 2) {
    throw new AiToolUserError('merge_context_items', 'itemIds must contain at least two protected context item ids.', 'Call list_context_items first and provide two or more returned itemIds.')
  }

  const title = typeof payload?.title === 'string' ? payload.title.trim() : ''
  const content = typeof payload?.content === 'string' ? payload.content.trim() : ''

  if (title.length === 0) {
    throw new AiToolUserError('merge_context_items', 'title must be a non-empty string.', 'Provide a short label for the merged protected context item.')
  }

  if (content.length === 0) {
    throw new AiToolUserError('merge_context_items', 'content must be a non-empty string.', 'Provide merged content as one short fact, constraint, or TODO.')
  }

  const registry = getProtectedContextRegistry(editorWindow)
  const sourceItems = itemIds.map((itemId) => registry.get(itemId) || null)

  if (sourceItems.some((item) => !item)) {
    const missingItemId = itemIds.find((itemId) => !registry.get(itemId))
    throw new AiToolUserError('merge_context_items', `Unknown protected context item: ${missingItemId}`, 'Call list_context_items first and reuse only returned itemIds.')
  }

  const priority = Object.prototype.hasOwnProperty.call(payload || {}, 'priority')
    ? normalizeProtectedContextPriority(payload.priority)
    : sourceItems.reduce((currentPriority, item) => pickHigherProtectedContextPriority(currentPriority, item?.priority), 'low')
  const estimatedTokens = estimateTokenCount(formatProtectedContextItemLine({ title, content, priority }))

  if (estimatedTokens > DEFAULT_PROTECTED_CONTEXT_MAX_ITEM_TOKENS) {
    throw new AiToolUserError(
      'merge_context_items',
      `merged content is too large for protected context (${estimatedTokens} tokens).`,
      `Shorten the merged content to about ${DEFAULT_PROTECTED_CONTEXT_MAX_ITEM_TOKENS} tokens or less.`,
    )
  }

  const usage = getProtectedContextUsage(editorWindow)
  const nextItems = [
    ...listProtectedContextItemRecords(editorWindow).filter((item) => !itemIds.includes(item.itemId)),
    { title, content, priority },
  ]
  const nextTotalTokens = estimateTokenCount(buildProtectedContextBlockText(nextItems))

  if (nextTotalTokens > usage.budgetTokens) {
    throw new AiToolUserError(
      'merge_context_items',
      'protected context budget would overflow after this merge.',
      'Shorten the merged item before retrying.',
    )
  }

  const timestamp = new Date().toISOString()
  const mergedItem = {
    itemId: `context:${randomUUID()}`,
    title,
    content,
    priority,
    estimatedTokens,
    createdAt: timestamp,
    updatedAt: timestamp,
    mergedFromItemIds: itemIds,
  }

  itemIds.forEach((itemId) => {
    registry.delete(itemId)
  })
  registry.set(mergedItem.itemId, mergedItem)
  touchEditorRuntimeState(editorWindow)

  return {
    item: summarizeProtectedContextItem(mergedItem),
    mergedFromItemIds: itemIds,
    usage: getProtectedContextUsage(editorWindow),
  }
}

function listProtectedContextItemsForWindow(editorWindow) {
  return {
    items: listProtectedContextItemRecords(editorWindow).map(summarizeProtectedContextItem),
    usage: getProtectedContextUsage(editorWindow),
  }
}

function deleteProtectedContextItemForWindow(editorWindow, payload) {
  const itemId = typeof payload?.itemId === 'string' ? payload.itemId.trim() : ''

  if (itemId.length === 0) {
    throw new AiToolUserError('delete_context_item', 'itemId must be a non-empty string.', 'Call list_context_items first and reuse one returned itemId.')
  }

  const registry = getProtectedContextRegistry(editorWindow)
  const deleted = registry.delete(itemId)
  touchEditorRuntimeState(editorWindow)

  return {
    itemId,
    deleted,
    usage: getProtectedContextUsage(editorWindow),
  }
}

function normalizeChatMessageForCompression(message) {
  if (!message || typeof message.content !== 'string') {
    return null
  }

  const content = message.content.trim()

  if (content.length === 0) {
    return null
  }

  const normalizedMessage = {
    role: message.role === 'assistant' ? 'assistant' : message.role === 'tool' ? 'tool' : 'user',
    kind: message.role === 'tool' ? 'tool' : message.role === 'assistant' ? 'assistant' : 'user',
    title: typeof message.title === 'string' ? message.title.trim() : '',
    content,
  }

  normalizedMessage.estimatedTokens = estimateTokenCount(mapAiChatMessageToOpenAiInput(normalizedMessage)?.content || normalizedMessage.content)
  return normalizedMessage
}

function summarizeMessageForCompression(message) {
  const label = message.kind === 'assistant'
    ? 'Assistant'
    : message.kind === 'tool'
      ? `Tool${message.title ? ` (${message.title})` : ''}`
      : 'User'
  const preview = createPreviewText(message.content, 220)
  return `- ${label}: ${preview}`
}

function truncateTextToTokenBudget(text, maxTokens) {
  if (typeof text !== 'string' || text.length === 0) {
    return ''
  }

  const maxChars = Math.max(0, Math.floor(maxTokens) * DEFAULT_TOKEN_TO_CHAR_RATIO)

  if (text.length <= maxChars) {
    return text
  }

  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`
}

function buildCompressedConversationSummary(editorWindow, messages, maxTokens) {
  const usableMessages = Array.isArray(messages) ? messages.filter(Boolean) : []

  if (usableMessages.length === 0 || maxTokens <= 0) {
    return ''
  }

  const header = 'Compressed earlier conversation context:\n'
  const lines = []
  let lineBudget = Math.max(0, maxTokens - estimateTokenCount(header))

  for (const message of usableMessages) {
    const line = summarizeMessageForCompression(message)
    const lineTokens = estimateTokenCount(line)

    if (lineTokens > lineBudget) {
      break
    }

    lines.push(line)
    lineBudget -= lineTokens
  }

  if (lines.length === 0) {
    return ''
  }

  const summaryText = `${header}${lines.join('\n')}`.trim()
  const runtimeState = touchEditorRuntimeState(editorWindow)
  runtimeState.compressionState.summaryText = summaryText
  runtimeState.compressionState.summarizedMessageCount = usableMessages.length
  runtimeState.compressionState.updatedAt = new Date().toISOString()
  return truncateTextToTokenBudget(summaryText, maxTokens)
}

function buildProtectedContextInput(editorWindow, maxTokens) {
  const content = buildProtectedContextBlockText(listProtectedContextItemRecords(editorWindow), maxTokens)

  if (content.length === 0) {
    return null
  }

  return {
    role: 'user',
    content,
  }
}

function buildOpenAiChatInput(editorWindow, messages) {
  const normalizedMessages = Array.isArray(messages)
    ? messages.map(normalizeChatMessageForCompression).filter(Boolean)
    : []

  if (normalizedMessages.length === 0) {
    return []
  }

  const model = settingsState.ai.openai.model
  const totalBudget = getAiChatInputBudget(model)
  const latestMessage = normalizedMessages[normalizedMessages.length - 1]
  const latestInput = mapAiChatMessageToOpenAiInput(latestMessage)

  if (!latestInput) {
    return []
  }

  const latestTokens = estimateTokenCount(latestInput.content)

  if (latestTokens >= totalBudget) {
    return [{
      ...latestInput,
      content: truncateTextToTokenBudget(latestInput.content, totalBudget),
    }]
  }

  const protectedBudget = Math.min(getProtectedContextBudgetTokens(model), Math.max(0, totalBudget - latestTokens))
  const summaryBudget = getAiChatSummaryBudget(model)
  const protectedInput = buildProtectedContextInput(editorWindow, protectedBudget)
  const protectedTokens = protectedInput ? estimateTokenCount(protectedInput.content) : 0
  const recentBudget = Math.max(latestTokens, Math.min(getAiChatRecentBudget(model), totalBudget - protectedTokens))
  const recentInputs = [latestInput]
  let recentTokens = latestTokens
  let cutoffIndex = Math.max(0, normalizedMessages.length - 1)

  for (let index = normalizedMessages.length - 2; index >= 0; index -= 1) {
    const message = normalizedMessages[index]

    if (recentTokens + message.estimatedTokens > recentBudget) {
      cutoffIndex = index + 1
      break
    }

    recentInputs.unshift(mapAiChatMessageToOpenAiInput(message))
    recentTokens += message.estimatedTokens
    cutoffIndex = index
  }

  const olderMessages = normalizedMessages.slice(0, cutoffIndex)
  const remainingBudget = Math.max(0, totalBudget - protectedTokens - recentTokens)
  const summaryText = olderMessages.length > 0
    ? buildCompressedConversationSummary(editorWindow, olderMessages, Math.min(summaryBudget, remainingBudget))
    : ''
  const summaryInput = summaryText.length > 0
    ? {
        role: 'user',
        content: summaryText,
      }
    : null

  return [protectedInput, summaryInput, ...recentInputs].filter(Boolean)
}

function clearTrackedFileWatcher(windowId) {
  const watcherRecord = trackedFileWatchersByWindowId.get(windowId)

  if (!watcherRecord) {
    return
  }

  if (watcherRecord.timer) {
    clearTimeout(watcherRecord.timer)
  }

  if (watcherRecord.retryTimer) {
    clearTimeout(watcherRecord.retryTimer)
  }

  try {
    watcherRecord.watcher?.close()
  } catch {
    // Ignore watcher close failures during teardown.
  }

  trackedFileWatchersByWindowId.delete(windowId)
}

function notifyTrackedFileChanged(editorWindow, filePath) {
  if (!editorWindow || editorWindow.isDestroyed() || !filePath) {
    return
  }

  editorWindow.webContents.send('mdv:current-file-changed', {
    path: filePath,
    exists: fs.existsSync(filePath),
  })
}

function trackCurrentFileForWindow(editorWindow, filePath, options = {}) {
  if (!editorWindow || editorWindow.isDestroyed()) {
    return
  }

  const runtimeState = ensureEditorRuntimeState(editorWindow)
  const normalizedPath = typeof filePath === 'string' && filePath.trim().length > 0 ? filePath.trim() : null
  const forceRetrack = options.force === true

  if (!forceRetrack && runtimeState.trackedFilePath === normalizedPath) {
    return
  }

  runtimeState.trackedFilePath = normalizedPath
  clearTrackedFileWatcher(editorWindow.id)

  if (!normalizedPath) {
    return
  }

  try {
    const watcherRecord = {
      filePath: normalizedPath,
      watcher: null,
      timer: null,
      retryTimer: null,
    }

    watcherRecord.watcher = fs.watch(normalizedPath, { persistent: false }, () => {
      if (watcherRecord.timer) {
        clearTimeout(watcherRecord.timer)
      }

      watcherRecord.timer = setTimeout(() => {
        watcherRecord.timer = null
        trackCurrentFileForWindow(editorWindow, normalizedPath, { force: true })
        notifyTrackedFileChanged(editorWindow, normalizedPath)
      }, 120)
    })
    watcherRecord.watcher.on('error', (error) => {
      writeLog('WARN', 'watch', 'Tracked file watcher error', normalizedPath, error instanceof Error ? error.message : String(error))
      trackCurrentFileForWindow(editorWindow, normalizedPath, { force: true })
      notifyTrackedFileChanged(editorWindow, normalizedPath)
    })
    trackedFileWatchersByWindowId.set(editorWindow.id, watcherRecord)
  } catch (error) {
    writeLog('WARN', 'watch', 'Unable to watch tracked file', normalizedPath, error instanceof Error ? error.message : String(error))
    const retryRecord = {
      filePath: normalizedPath,
      watcher: null,
      timer: null,
      retryTimer: setTimeout(() => {
        trackCurrentFileForWindow(editorWindow, normalizedPath, { force: true })
      }, 1000),
    }
    trackedFileWatchersByWindowId.set(editorWindow.id, retryRecord)
  }
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
  const nextSpan = span && typeof span === 'object' && typeof span.kind === 'string'
    ? normalizeAiSpanRef(span)
    : normalizedSpanToSpanRef(span)

  return {
    editorId,
    span: nextSpan,
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

  const semanticCandidates = runtime.chunks
    .map((chunk) => ({
      editorId: runtime.editorId,
      span: chunk.span,
      target: buildAiTargetRef(runtime.editorId, chunk.span),
      layer: chunk.layer,
      startOffset: chunk.startOffset,
      endOffset: chunk.endOffset,
      score: cosineSimilarity(queryEmbedding, chunk.embedding) * chunk.weight,
      preview: createPreviewText(chunk.text),
    }))

  const results = normalizeSemanticCandidates(semanticCandidates, maxResults)
    .map(({ startOffset: _startOffset, endOffset: _endOffset, ...result }) => result)

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

function buildStructureTargetFromPosition(editorId, position) {
  const start = position?.start
  const end = position?.end

  if (!Number.isFinite(Number(start?.line)) || !Number.isFinite(Number(start?.column)) || !Number.isFinite(Number(end?.line)) || !Number.isFinite(Number(end?.column))) {
    return null
  }

  return buildAiTargetRef(editorId, {
    kind: 'range',
    start: {
      line: Number(start.line),
      column: Number(start.column),
    },
    end: {
      line: Number(end.line),
      column: Number(end.column),
    },
  })
}

function createStructureNodePayload(editorWindow, editorId, fingerprint, match, query, includeMarkdown = false) {
  const handleRecord = registerStructureHandle(editorWindow, {
    editorId,
    fingerprint,
    path: match.path,
    query,
    type: match.type,
  })

  const payload = {
    handle: handleRecord.handle,
    type: match.type,
    path: Array.isArray(match.path) ? [...match.path] : [],
    parentPath: Array.isArray(match.parentPath) ? [...match.parentPath] : null,
    treeDepth: Number.isFinite(Number(match.treeDepth)) ? Number(match.treeDepth) : 0,
    childCount: Number.isFinite(Number(match.childCount)) ? Number(match.childCount) : 0,
    depth: Number.isFinite(Number(match.depth)) ? Number(match.depth) : undefined,
    ordered: typeof match.ordered === 'boolean' ? match.ordered : undefined,
    checked: typeof match.checked === 'boolean' ? match.checked : undefined,
    lang: typeof match.lang === 'string' ? match.lang : undefined,
    url: typeof match.url === 'string' ? match.url : undefined,
    title: typeof match.title === 'string' ? match.title : undefined,
    textPreview: createPreviewText(typeof match.text === 'string' ? match.text : ''),
    position: match.position || null,
    target: buildStructureTargetFromPosition(editorId, match.position),
  }

  if (includeMarkdown) {
    payload.markdown = typeof match.markdown === 'string' ? match.markdown : ''
  }

  return payload
}

async function readStructureDocumentForEditor(editorWindow, editorId) {
  const resolvedEditorId = typeof editorId === 'string' && editorId.length > 0 ? editorId : 'editor:active'
  const textPayload = await readFullTargetTextForWindow(editorWindow, {
    target: {
      editorId: resolvedEditorId,
      span: { kind: 'document' },
    },
  })

  return {
    editorId: textPayload.editorId,
    text: textPayload.text,
    fingerprint: fingerprintMarkdown(textPayload.text),
  }
}

function resolveStructureSelectorInput(editorWindow, toolName, payload, options = {}) {
  const query = typeof payload?.query === 'string' ? payload.query.trim() : ''
  const handle = typeof payload?.handle === 'string' ? payload.handle.trim() : ''
  const allowNone = options.allowNone === true

  if (query && handle) {
    throw new AiToolUserError(toolName, 'Provide either query or handle, not both.', 'Choose one structure selector mode and retry.')
  }

  if (!query && !handle && !allowNone) {
    throw new AiToolUserError(toolName, 'A structure selector is required.', 'Provide query for a mdast selector string or handle from a previous structure result.')
  }

  if (query) {
    return {
      editorId: typeof payload?.editorId === 'string' && payload.editorId.trim().length > 0 ? payload.editorId.trim() : 'editor:active',
      selector: { query },
      query,
      handle: null,
    }
  }

  if (!handle) {
    return {
      editorId: typeof payload?.editorId === 'string' && payload.editorId.trim().length > 0 ? payload.editorId.trim() : 'editor:active',
      selector: null,
      query: '',
      handle: null,
    }
  }

  const handleRecord = getStructureHandleRecord(editorWindow, handle)

  if (!handleRecord) {
    throw new AiToolUserError(toolName, `Unknown structure handle: ${handle}`, 'Call query_structure or list_structure_map again and reuse one returned handle.', 'invalid_handle')
  }

  if (typeof payload?.editorId === 'string' && payload.editorId.trim().length > 0 && payload.editorId.trim() !== handleRecord.editorId) {
    throw new AiToolUserError(toolName, 'handle and editorId do not refer to the same document.', 'Omit editorId when using a handle, or use a handle returned from that editorId.', 'invalid_handle')
  }

  return {
    editorId: handleRecord.editorId,
    selector: buildStructureSelectorFromHandleRecord(handleRecord),
    query: handleRecord.query || '',
    handle: handleRecord,
  }
}

async function validateStructureSelectorQuery(toolName, selectorInput) {
  if (!selectorInput?.query) {
    return
  }

  const diagnostics = await validateMarkdownQuery(selectorInput.query)
  if (Array.isArray(diagnostics) && diagnostics.length > 0) {
    throw new AiToolUserError(toolName, diagnostics[0], 'Call get_structure_help with {"topic":"query-language"} and retry with a valid selector.', 'invalid_query')
  }
}

function ensureFreshStructureHandle(toolName, handleRecord, fingerprint) {
  if (!handleRecord) {
    return
  }

  if (handleRecord.fingerprint !== fingerprint) {
    throw new AiToolUserError(toolName, `Structure handle ${handleRecord.handle} is stale because the document changed.`, 'Call query_structure or list_structure_map again to get fresh handles for the current document.', 'stale_handle')
  }
}

function normalizeStructureMutationError(toolName, error) {
  if (error instanceof AiToolUserError) {
    return error
  }

  const message = error instanceof Error ? error.message : String(error)

  if (toolName === 'wrap_structure') {
    if (message === 'Wrap requires exactly one top-level wrapper node') {
      return new AiToolUserError(toolName, message, 'Provide markdown that parses to exactly one top-level container node and retry.', 'invalid_target_kind')
    }

    if (message.startsWith('Cannot wrap with non-container node type')) {
      return new AiToolUserError(toolName, message, 'Use wrapper markdown that parses to a container node such as blockquote, list, or listItem.', 'invalid_target_kind')
    }
  }

  if (toolName === 'move_structure') {
    if (message.startsWith('Move requires exactly one target match')) {
      return new AiToolUserError(toolName, 'The move target selector must resolve to exactly one node.', 'Use targetHandle from query_structure or narrow targetQuery before retrying move_structure.', 'invalid_target_kind')
    }

    if (message === 'Move target cannot be the same as, or nested inside, the moved source selection') {
      return new AiToolUserError(toolName, 'The move target cannot be the source node or one of its descendants.', 'Choose a target outside the moved source selection and retry.', 'invalid_target_kind')
    }
  }

  if (toolName === 'replace_structure') {
    if (message.startsWith('Replace exceeds maxReplacements=')) {
      return new AiToolUserError(toolName, 'The replace selector exceeded maxReplacements.', 'Narrow the query, use an exact handle, raise maxReplacements, or set onMaxExceeded="break" to stop after the configured limit.', 'too_many_matches')
    }
  }

  return error
}

async function listStructureMapForWindow(editorWindow, payload) {
  const includeRoot = payload?.includeRoot === true
  const maxNodes = Math.min(400, Math.max(1, Math.round(Number(payload?.maxNodes) || 120)))
  const maxDepth = Math.min(12, Math.max(0, Math.round(Number(payload?.maxDepth) || 4)))
  const document = await readStructureDocumentForEditor(editorWindow, typeof payload?.editorId === 'string' ? payload.editorId.trim() : 'editor:active')
  const structureMap = await mapMarkdownStructure(document.text, {
    includeRoot,
    maxNodes,
    maxDepth,
  })

  return {
    editorId: document.editorId,
    fingerprint: document.fingerprint,
    truncated: structureMap.truncated,
    nodes: structureMap.nodes.map((match) => createStructureNodePayload(editorWindow, document.editorId, document.fingerprint, match, '', false)),
  }
}

async function queryStructureForWindow(editorWindow, payload) {
  const selectorInput = resolveStructureSelectorInput(editorWindow, 'query_structure', payload)
  const maxResults = Math.min(100, Math.max(1, Math.round(Number(payload?.maxResults) || 20)))
  const includeMarkdown = payload?.includeMarkdown === true
  await validateStructureSelectorQuery('query_structure', selectorInput)
  const document = await readStructureDocumentForEditor(editorWindow, selectorInput.editorId)
  ensureFreshStructureHandle('query_structure', selectorInput.handle, document.fingerprint)
  const structureResult = await getMarkdownStructure(document.text, selectorInput.selector, { maxMatches: maxResults })

  return {
    editorId: document.editorId,
    fingerprint: document.fingerprint,
    query: selectorInput.query,
    totalMatches: structureResult.totalMatches,
    truncated: structureResult.truncated,
    matches: structureResult.matches.map((match) => createStructureNodePayload(editorWindow, document.editorId, document.fingerprint, match, selectorInput.query, includeMarkdown)),
  }
}

async function getStructureContentForWindow(editorWindow, payload) {
  const selectorInput = resolveStructureSelectorInput(editorWindow, 'get_structure_content', payload)
  await validateStructureSelectorQuery('get_structure_content', selectorInput)
  const document = await readStructureDocumentForEditor(editorWindow, selectorInput.editorId)
  ensureFreshStructureHandle('get_structure_content', selectorInput.handle, document.fingerprint)
  const structureResult = await getMarkdownStructure(document.text, selectorInput.selector, { maxMatches: 1 })

  if (structureResult.totalMatches === 0 || structureResult.matches.length === 0) {
    throw new AiToolUserError('get_structure_content', 'The structure selector matched no nodes.', 'Run query_structure first to inspect the current structure map and then retry with a narrower selector.', 'no_match')
  }

  return {
    editorId: document.editorId,
    fingerprint: document.fingerprint,
    query: selectorInput.query,
    totalMatches: structureResult.totalMatches,
    node: createStructureNodePayload(editorWindow, document.editorId, document.fingerprint, structureResult.matches[0], selectorInput.query, true),
  }
}

function requireStructureMarkdownArg(toolName, payload, fieldName) {
  const markdown = typeof payload?.[fieldName] === 'string' ? payload[fieldName] : ''

  if (markdown.trim().length === 0) {
    throw new AiToolUserError(toolName, `${fieldName} must be a non-empty markdown string.`, `Provide ${fieldName} as markdown content to insert, replace, or wrap with.`)
  }

  return markdown
}

function requireStructureInsertPositionArg(toolName, payload, fieldName = 'position') {
  const position = requireStringArg(toolName, payload, fieldName, 'one of before, after, prepend, or append')

  if (position !== 'before' && position !== 'after' && position !== 'prepend' && position !== 'append') {
    throw new AiToolUserError(toolName, `Unsupported insert position "${position}".`, 'Use one of before, after, prepend, or append.', 'unsupported_position')
  }

  return position
}

function requireStructureMaxReplacementsArg(toolName, payload) {
  if (payload?.maxReplacements === undefined || payload?.maxReplacements === null) {
    return 1
  }

  const maxReplacements = Number(payload.maxReplacements)

  if (!Number.isInteger(maxReplacements) || maxReplacements < 1) {
    throw new AiToolUserError(toolName, 'maxReplacements must be a positive integer.', 'Omit maxReplacements for the safe default of 1, or pass 1 or greater.', 'invalid_argument')
  }

  return maxReplacements
}

function requireStructureReplaceOverflowBehaviorArg(toolName, payload) {
  if (payload?.onMaxExceeded === undefined || payload?.onMaxExceeded === null || payload.onMaxExceeded === '') {
    return 'error'
  }

  const behavior = requireStringArg(toolName, payload, 'onMaxExceeded', 'one of break or error')

  if (behavior !== 'break' && behavior !== 'error') {
    throw new AiToolUserError(toolName, `Unsupported onMaxExceeded value "${behavior}".`, 'Use break to stop after maxReplacements or error to reject the operation when the limit would be exceeded.', 'invalid_argument')
  }

  return behavior
}

async function applyStructureMutationForWindow(editorWindow, toolName, operation, payload) {
  const selectorInput = resolveStructureSelectorInput(editorWindow, toolName, payload)
  await validateStructureSelectorQuery(toolName, selectorInput)
  const document = await readStructureDocumentForEditor(editorWindow, selectorInput.editorId)
  ensureFreshStructureHandle(toolName, selectorInput.handle, document.fingerprint)

  const mutationPayload = {
    selector: selectorInput.selector,
  }

  if (operation === 'insert' || operation === 'replace' || operation === 'wrap') {
    mutationPayload.markdown = requireStructureMarkdownArg(toolName, payload, 'markdown')
  }

  if (operation === 'replace') {
    mutationPayload.maxReplacements = requireStructureMaxReplacementsArg(toolName, payload)
    mutationPayload.onMaxExceeded = requireStructureReplaceOverflowBehaviorArg(toolName, payload)
  }

  if (operation === 'insert') {
    mutationPayload.position = requireStructureInsertPositionArg(toolName, payload)
  }

  if (operation === 'move') {
    const targetInput = resolveStructureSelectorInput(editorWindow, toolName, {
      editorId: payload?.editorId,
      query: payload?.targetQuery,
      handle: payload?.targetHandle,
    })
    await validateStructureSelectorQuery(toolName, targetInput)
    if (targetInput.editorId !== document.editorId) {
      throw new AiToolUserError(toolName, 'source and target must refer to the same editor or buffer.', 'Use source and target handles or queries from the same editorId.', 'invalid_target_kind')
    }
    ensureFreshStructureHandle(toolName, targetInput.handle, document.fingerprint)
    mutationPayload.targetSelector = targetInput.selector
    mutationPayload.position = requireStructureInsertPositionArg(toolName, payload)
  }

  let mutationResult

  try {
    mutationResult = await mutateMarkdownStructure(document.text, operation, mutationPayload)
  } catch (error) {
    throw normalizeStructureMutationError(toolName, error)
  }

  if (Number(mutationResult?.matched) === 0) {
    throw new AiToolUserError(toolName, 'The structure selector matched no nodes.', 'Run query_structure first to inspect the current structure map and then retry with a narrower selector.', 'no_match')
  }

  const writeResult = await writeAiTargetForWindow(editorWindow, {
    destination: {
      editorId: document.editorId,
      span: { kind: 'document' },
    },
    sources: [
      {
        type: 'literal',
        text: mutationResult.markdown,
      },
    ],
    mode: 'replace',
  })

  return {
    editorId: document.editorId,
    fingerprintBefore: document.fingerprint,
    fingerprintAfter: fingerprintMarkdown(mutationResult.markdown),
    matched: Number.isFinite(Number(mutationResult.matched)) ? Number(mutationResult.matched) : undefined,
    effectiveMatched: Number.isFinite(Number(mutationResult.effectiveMatched)) ? Number(mutationResult.effectiveMatched) : undefined,
    maxExceeded: mutationResult?.maxExceeded === true,
    targetMatched: Number.isFinite(Number(mutationResult.targetMatched)) ? Number(mutationResult.targetMatched) : undefined,
    changed: Number.isFinite(Number(mutationResult.changed)) ? Number(mutationResult.changed) : undefined,
    inserted: Number.isFinite(Number(mutationResult.inserted)) ? Number(mutationResult.inserted) : undefined,
    bytesWritten: writeResult?.bytesWritten || Buffer.byteLength(mutationResult.markdown, 'utf8'),
    documentTarget: buildAiTargetRef(document.editorId, { kind: 'document' }),
    target: writeResult?.target,
  }
}

async function copyStructureForWindow(editorWindow, payload) {
  const sourceInput = resolveStructureSelectorInput(editorWindow, 'copy_structure', {
    editorId: payload?.editorId,
    query: payload?.sourceQuery,
    handle: payload?.sourceHandle,
  })
  const targetInput = resolveStructureSelectorInput(editorWindow, 'copy_structure', {
    editorId: payload?.editorId,
    query: payload?.targetQuery,
    handle: payload?.targetHandle,
  })
  await validateStructureSelectorQuery('copy_structure', sourceInput)
  await validateStructureSelectorQuery('copy_structure', targetInput)
  const document = await readStructureDocumentForEditor(editorWindow, sourceInput.editorId)

  if (targetInput.editorId !== document.editorId) {
    throw new AiToolUserError('copy_structure', 'source and target must refer to the same editor or buffer.', 'Use source and target handles or queries from the same editorId.', 'invalid_target_kind')
  }

  ensureFreshStructureHandle('copy_structure', sourceInput.handle, document.fingerprint)
  ensureFreshStructureHandle('copy_structure', targetInput.handle, document.fingerprint)

  const sourceResult = await getMarkdownStructure(document.text, sourceInput.selector, { maxMatches: 2 })
  if (sourceResult.totalMatches === 0 || sourceResult.matches.length === 0) {
    throw new AiToolUserError('copy_structure', 'The source selector matched no nodes.', 'Run query_structure first to inspect the current structure map and then retry with a narrower source selector.', 'no_match')
  }

  if (sourceResult.totalMatches !== 1 || sourceResult.matches.length !== 1) {
    throw new AiToolUserError('copy_structure', 'The source selector must resolve to exactly one node.', 'Use sourceHandle from query_structure or narrow sourceQuery before retrying copy_structure.', 'too_many_matches')
  }

  const snippet = typeof sourceResult.matches[0]?.markdown === 'string' ? sourceResult.matches[0].markdown : ''

  if (snippet.length === 0) {
    throw new AiToolUserError('copy_structure', 'The source selector did not resolve reusable markdown content.', 'Retry with a block-level node such as heading, paragraph, listItem, blockquote, code, or table.', 'invalid_target_kind')
  }

  return applyStructureMutationForWindow(editorWindow, 'copy_structure', 'insert', {
    editorId: document.editorId,
    query: payload?.targetQuery,
    handle: payload?.targetHandle,
    position: requireStructureInsertPositionArg('copy_structure', payload),
    markdown: snippet,
  })
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

function findEditorWindowByTrackedFilePath(filePath) {
  const normalizedPath = normalizeRecoveryFilePath(filePath)

  if (!normalizedPath) {
    return null
  }

  return BrowserWindow.getAllWindows().find((window) => {
    if (!isEditorWindow(window) || window.isDestroyed()) {
      return false
    }

    return ensureEditorRuntimeState(window).trackedFilePath === normalizedPath
  }) ?? null
}

async function confirmAiWriteAction(parentWindow, options) {
  const messages = getMainI18n()
  const response = await showMessageBox(parentWindow, {
    type: 'warning',
    buttons: [messages.buttons.continue, messages.buttons.cancel],
    defaultId: 1,
    cancelId: 1,
    title: options.title,
    message: options.message,
    detail: options.detail,
    noLink: true,
  })

  return response.response === 0
}

const {
  createDefaultSettings,
  getHasPersistedSettings,
  getHasReadableSettings,
  getProviderStatus,
  isPlainObject,
  mergePlainObjects,
  normalizeAllowedHeaderList,
  normalizeAllowedMethodList,
  normalizeSecret,
  persistSecrets,
  persistSettings,
  sanitizeSecrets,
  sanitizeSettings,
} = settingsController

const {
  getUpdaterStateSnapshot,
  checkForAppUpdates,
  downloadAvailableUpdate,
  installDownloadedUpdate,
  initializeAutoUpdater,
} = updaterController

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
  'For mdast structure work, prefer list_structure_map or query_structure before mutating. Structure handles are session-scoped exact node references and become stale after the document changes.',
  'When structure tools return handles, reuse those handles for exact follow-up operations instead of guessing new selectors.',
  'Use write_target with destination.editorId=":new" when the user asked for a new document instead of mutating the current one.',
  'write_target mode "insert" inserts at the destination span start unless you provide a point span for an exact position; mode "append" inserts at the destination span end.',
  'Use save_context_item only for short high-value facts, constraints, or TODOs that should survive compression in this session; protected context is tightly budgeted.',
  'Use update_context_item when an existing protected item should be corrected, shortened, or reprioritized instead of adding a duplicate.',
  'Use merge_context_items when two or more protected items overlap and should be compacted into one denser item.',
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
const aiStructureSelectorDescription = 'Provide query as a selector string such as heading[depth=2], or provide handle separately as an exact mdast:... value from a previous structure tool result. Query and handle are mutually exclusive.'
const aiStructureInsertPositionDescription = 'One of before, after, prepend, or append.'

function buildRequiredAiToolParameter(definition) {
  if (!definition || typeof definition !== 'object') {
    return definition
  }

  const baseDescription = typeof definition.description === 'string' && definition.description.length > 0
    ? `${definition.description} `
    : ''

  return {
    ...definition,
    __mdvRequired: true,
    description: `${baseDescription}Required.`,
  }
}

function buildAiToolParameters(properties) {
  const required = []
  const normalizedProperties = {}

  Object.entries(properties || {}).forEach(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const { __mdvRequired, ...propertyDefinition } = value
      normalizedProperties[key] = propertyDefinition

      if (__mdvRequired) {
        required.push(key)
      }

      return
    }

    normalizedProperties[key] = value
  })

  const schema = {
    type: 'object',
    properties: normalizedProperties,
    additionalProperties: false,
  }

  if (required.length > 0) {
    schema.required = required
  }

  return schema
}

const OPENAI_TOOL_SCHEMA_TOP_LEVEL_FORBIDDEN_KEYS = ['oneOf', 'anyOf', 'allOf', 'enum', 'not']

function assertValidOpenAiToolDefinition(tool) {
  if (!tool || typeof tool !== 'object' || typeof tool.name !== 'string') {
    throw new Error('Invalid OpenAI tool definition: missing tool metadata')
  }

  const parameters = tool.parameters

  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    throw new Error(`Invalid OpenAI schema for function '${tool.name}': parameters must be a JSON object schema.`)
  }

  if (parameters.type !== 'object') {
    throw new Error(`Invalid OpenAI schema for function '${tool.name}': top-level schema must have type 'object'.`)
  }

  const invalidKey = OPENAI_TOOL_SCHEMA_TOP_LEVEL_FORBIDDEN_KEYS.find((key) => Object.prototype.hasOwnProperty.call(parameters, key))
  if (invalidKey) {
    throw new Error(`Invalid OpenAI schema for function '${tool.name}': top-level schema must not include '${invalidKey}'. Enforce that rule in runtime validation instead.`)
  }
}

function getValidatedOpenAiToolDefinitions() {
  aiToolDefinitions.forEach(assertValidOpenAiToolDefinition)
  return aiToolDefinitions
}

function getAppMetadata() {
  const version = app.getVersion()

  return {
    productName: 'MarkDownViewer',
    version,
    releaseTag: `v${version}`,
    platform: process.platform,
  }
}

const aiToolDefinitions = [
  {
    type: 'function',
    name: 'get_tool_help',
    description: 'Return usage guidance, parameter rules, and examples for one AI tool.',
    parameters: buildAiToolParameters({
        toolName: buildRequiredAiToolParameter({ type: 'string', description: 'Exact tool name to describe.' }),
      }),
  },
  {
    type: 'function',
    name: 'get_structure_help',
    description: 'Return mdast query language help, handle semantics, DOM-like structure operations, and error recovery guidance.',
    parameters: buildAiToolParameters({
        topic: { type: 'string', enum: ['overview', 'query-language', 'handles', 'errors', 'examples'] },
      }),
  },
  {
    type: 'function',
    name: 'list_structure_map',
    description: 'Return a flattened structural map of the current Markdown document with reusable structure handles.',
    parameters: buildAiToolParameters({
        editorId: { type: 'string', description: 'Optional editor or buffer ID. Defaults to the active editor.' },
        maxNodes: { type: 'number' },
        maxDepth: { type: 'number' },
        includeRoot: { type: 'boolean' },
      }),
  },
  {
    type: 'function',
    name: 'query_structure',
    description: 'Query mdast structure nodes by selector or exact handle and return reusable structure handles plus target refs.',
    parameters: buildAiToolParameters({
        editorId: { type: 'string', description: 'Optional editor or buffer ID. Defaults to the active editor or the handle document.' },
        query: { type: 'string', description: aiStructureSelectorDescription },
        handle: { type: 'string', description: 'Exact structure handle from a previous structure result.' },
        maxResults: { type: 'number' },
        includeMarkdown: { type: 'boolean' },
      }),
  },
  {
    type: 'function',
    name: 'get_structure_content',
    description: 'Get one structure node content, markdown, and target ref by query or exact handle.',
    parameters: buildAiToolParameters({
        editorId: { type: 'string', description: 'Optional editor or buffer ID. Defaults to the active editor or the handle document.' },
        query: { type: 'string', description: aiStructureSelectorDescription },
        handle: { type: 'string', description: 'Exact structure handle from a previous structure result.' },
      }),
  },
  {
    type: 'function',
    name: 'insert_structure',
    description: 'Insert markdown before, after, prepend into, or append into one or more structure nodes selected by query or handle.',
    parameters: buildAiToolParameters({
        editorId: { type: 'string', description: 'Optional editor or buffer ID. Defaults to the active editor or the handle document.' },
        query: { type: 'string', description: aiStructureSelectorDescription },
        handle: { type: 'string', description: 'Exact structure handle from a previous structure result.' },
        position: buildRequiredAiToolParameter({ type: 'string', description: aiStructureInsertPositionDescription }),
        markdown: buildRequiredAiToolParameter({ type: 'string', description: 'Markdown snippet to insert.' }),
      }),
  },
  {
    type: 'function',
    name: 'replace_structure',
    description: 'Replace matched structure nodes selected by query or handle with markdown parsed through mdast, capped by maxReplacements.',
    parameters: buildAiToolParameters({
        editorId: { type: 'string', description: 'Optional editor or buffer ID. Defaults to the active editor or the handle document.' },
        query: { type: 'string', description: aiStructureSelectorDescription },
        handle: { type: 'string', description: 'Exact structure handle from a previous structure result.' },
        markdown: buildRequiredAiToolParameter({ type: 'string', description: 'Replacement markdown snippet.' }),
      maxReplacements: { type: 'integer', description: 'Optional positive integer cap. Defaults to 1.' },
      onMaxExceeded: { type: 'string', enum: ['break', 'error'], description: 'Optional overflow behavior when effective matches exceed maxReplacements. Defaults to error.' },
      }),
  },
  {
    type: 'function',
    name: 'delete_structure',
    description: 'Delete one or more structure nodes selected by query or handle.',
    parameters: buildAiToolParameters({
        editorId: { type: 'string', description: 'Optional editor or buffer ID. Defaults to the active editor or the handle document.' },
        query: { type: 'string', description: aiStructureSelectorDescription },
        handle: { type: 'string', description: 'Exact structure handle from a previous structure result.' },
      }),
  },
  {
    type: 'function',
    name: 'wrap_structure',
    description: 'Wrap matched structure nodes with exactly one top-level container parsed from markdown.',
    parameters: buildAiToolParameters({
        editorId: { type: 'string', description: 'Optional editor or buffer ID. Defaults to the active editor or the handle document.' },
        query: { type: 'string', description: aiStructureSelectorDescription },
        handle: { type: 'string', description: 'Exact structure handle from a previous structure result.' },
        markdown: buildRequiredAiToolParameter({ type: 'string', description: 'Wrapper markdown such as \"> Quote\" or \"- item\". It must parse to exactly one top-level wrapper node.' }),
      }),
  },
  {
    type: 'function',
    name: 'unwrap_structure',
    description: 'Remove one container layer from matched structure nodes selected by query or handle.',
    parameters: buildAiToolParameters({
        editorId: { type: 'string', description: 'Optional editor or buffer ID. Defaults to the active editor or the handle document.' },
        query: { type: 'string', description: aiStructureSelectorDescription },
        handle: { type: 'string', description: 'Exact structure handle from a previous structure result.' },
      }),
  },
  {
    type: 'function',
    name: 'move_structure',
    description: 'Move matched structure nodes to exactly one target node using before, after, prepend, or append positioning.',
    parameters: buildAiToolParameters({
        editorId: { type: 'string', description: 'Optional editor or buffer ID. Defaults to the active editor or the handle document.' },
        query: { type: 'string', description: 'Source structure selector query.' },
        handle: { type: 'string', description: 'Exact source structure handle from a previous structure result.' },
        targetQuery: { type: 'string', description: 'Target selector query. The target must resolve to exactly one node.' },
        targetHandle: { type: 'string', description: 'Exact target structure handle from a previous structure result.' },
        position: buildRequiredAiToolParameter({ type: 'string', description: aiStructureInsertPositionDescription }),
      }),
  },
  {
    type: 'function',
    name: 'copy_structure',
    description: 'Copy one exact source structure node markdown and insert it at another structure target without removing the source.',
    parameters: buildAiToolParameters({
        editorId: { type: 'string', description: 'Optional editor or buffer ID. Defaults to the active editor or the handle document.' },
        sourceQuery: { type: 'string', description: 'Source structure selector query. It must resolve to exactly one node.' },
        sourceHandle: { type: 'string', description: 'Exact source structure handle from a previous structure result.' },
        targetQuery: { type: 'string', description: 'Target selector query. The target may match one or more nodes.' },
        targetHandle: { type: 'string', description: 'Exact target structure handle from a previous structure result.' },
        position: buildRequiredAiToolParameter({ type: 'string', description: aiStructureInsertPositionDescription }),
      }),
  },
  {
    type: 'function',
    name: 'get_context',
    description: 'Get lightweight metadata about the active editor or a known buffer.',
    parameters: buildAiToolParameters({
        editorId: { type: 'string', description: 'Optional editor or buffer ID. Defaults to the active editor.' },
      }),
  },
  {
    type: 'function',
    name: 'get_app_metadata',
    description: 'Get canonical application metadata such as product name, version, release tag, and platform.',
    parameters: buildAiToolParameters({}),
  },
  {
    type: 'function',
    name: 'list_buffers',
    description: 'List the active editor and session temp buffers available to tools.',
    parameters: buildAiToolParameters({}),
  },
  {
    type: 'function',
    name: 'read_target',
    description: 'Read bounded text from an EditorID + SPAN target. Use nextCursor with the returned target for continuation. Use pageTarget when you need exactly the returned page as a new input target.',
    parameters: buildAiToolParameters({
        target: buildRequiredAiToolParameter({ type: 'object', description: aiTargetDescription }),
        cursor: { type: 'object', description: 'Optional cursor returned by a previous read_target call.' },
        maxTokens: { type: 'number', description: 'Optional bounded token target.' },
      }),
  },
  {
    type: 'function',
    name: 'write_target',
    description: 'Write text to an EditorID + SPAN destination, including :new for a new editor window. Prefer target refs returned by earlier tools.',
    parameters: buildAiToolParameters({
        destination: buildRequiredAiToolParameter({ type: 'object', description: aiDestinationDescription }),
        sources: buildRequiredAiToolParameter({ type: 'array', description: `Array of literal sources like {"type":"literal","text":"..."} or slice-ref sources. ${aiSliceRefSourceDescription}` }),
        mode: { type: 'string', enum: ['replace', 'insert', 'append'] },
        title: { type: 'string' },
      }),
  },
  {
    type: 'function',
    name: 'exact_search',
    description: 'Run an exact search inside an EditorID + SPAN target and return matching lines plus reusable target refs.',
    parameters: buildAiToolParameters({
        target: buildRequiredAiToolParameter({ type: 'object', description: aiTargetDescription }),
        query: buildRequiredAiToolParameter({ type: 'string' }),
        isRegexp: { type: 'boolean' },
        caseSensitive: { type: 'boolean' },
        maxResults: { type: 'number' },
      }),
  },
  {
    type: 'function',
    name: 'stats_slice',
    description: 'Return statistics for an EditorID + SPAN target and include a reusable target ref.',
    parameters: buildAiToolParameters({
        target: buildRequiredAiToolParameter({ type: 'object', description: aiTargetDescription }),
      }),
  },
  {
    type: 'function',
    name: 'semantic_search',
    description: 'Run multi-layer semantic search over an EditorID + SPAN target using cached embeddings and return reusable target refs.',
    parameters: buildAiToolParameters({
        target: buildRequiredAiToolParameter({ type: 'object', description: aiTargetDescription }),
        query: buildRequiredAiToolParameter({ type: 'string' }),
        maxResults: { type: 'number' },
      }),
  },
  {
    type: 'function',
    name: 'web_search',
    description: 'Run Tavily web search and return ranked results. A temp buffer may also be returned for deeper follow-up reads.',
    parameters: buildAiToolParameters({
        query: buildRequiredAiToolParameter({ type: 'string' }),
        searchDepth: { type: 'string', enum: ['basic', 'advanced'] },
        maxResults: { type: 'number' },
      }),
  },
  {
    type: 'function',
    name: 'fetch_url',
    description: 'Fetch an ACL-governed HTTP(S) URL with explicit method and header controls. Pending ACL matches are confirmed in the main process. Large responses are returned as temp buffers instead of inline text.',
    parameters: buildAiToolParameters({
        url: buildRequiredAiToolParameter({ type: 'string' }),
        method: { type: 'string' },
        headers: { type: 'object', additionalProperties: { type: 'string' } },
        body: { type: 'string' },
      }),
  },
  {
    type: 'function',
    name: 'dispose_buffer',
    description: 'Dispose a temp buffer explicitly when it is no longer needed.',
    parameters: buildAiToolParameters({
        editorId: buildRequiredAiToolParameter({ type: 'string' }),
      }),
  },
  {
    type: 'function',
    name: 'save_context_item',
    description: 'Save one short high-value fact, constraint, or TODO into the protected context area so it survives compression within this session.',
    parameters: buildAiToolParameters({
        title: buildRequiredAiToolParameter({ type: 'string', description: 'Short label for the preserved context item.' }),
        content: buildRequiredAiToolParameter({ type: 'string', description: 'Short preserved text. Keep it compact.' }),
        priority: { type: 'string', enum: ['high', 'normal', 'low'] },
      }),
  },
  {
    type: 'function',
    name: 'list_context_items',
    description: 'List the protected context items currently preserved from compression in this session.',
    parameters: buildAiToolParameters({}),
  },
  {
    type: 'function',
    name: 'update_context_item',
    description: 'Update one protected context item in place when the preserved fact should be corrected, shortened, or reprioritized.',
    parameters: buildAiToolParameters({
        itemId: buildRequiredAiToolParameter({ type: 'string', description: 'Protected context item id returned by list_context_items.' }),
        title: { type: 'string', description: 'Optional replacement title. Provide at least one of title, content, or priority.' },
        content: { type: 'string', description: 'Optional replacement content. Keep it compact. Provide at least one of title, content, or priority.' },
        priority: { type: 'string', enum: ['high', 'normal', 'low'], description: 'Optional replacement priority. Provide at least one of title, content, or priority.' },
      }),
  },
  {
    type: 'function',
    name: 'merge_context_items',
    description: 'Merge two or more protected context items into one new compact item and remove the source items.',
    parameters: buildAiToolParameters({
        itemIds: buildRequiredAiToolParameter({ type: 'array', description: 'Two or more protected context item ids returned by list_context_items.', items: { type: 'string' }, minItems: 2 }),
        title: buildRequiredAiToolParameter({ type: 'string', description: 'Title for the merged protected context item.' }),
        content: buildRequiredAiToolParameter({ type: 'string', description: 'Merged compact content.' }),
        priority: { type: 'string', enum: ['high', 'normal', 'low'], description: 'Optional merged priority. If omitted, the highest source priority is kept.' },
      }),
  },
  {
    type: 'function',
    name: 'delete_context_item',
    description: 'Delete one protected context item when it is no longer needed.',
    parameters: buildAiToolParameters({
        itemId: buildRequiredAiToolParameter({ type: 'string', description: 'Protected context item id returned by list_context_items.' }),
      }),
  },
]

const aiToolHelpDocs = {
  get_tool_help: {
    summary: 'Return usage guidance, parameter rules, and examples for one registered AI tool.',
    parameters: [
      { name: 'toolName', required: true, type: 'string', description: 'Exact tool name to describe, such as read_target or web_search.' },
    ],
    examples: [
      { description: 'Describe read_target', args: { toolName: 'read_target' } },
    ],
  },
  get_structure_help: {
    summary: 'Return mdast query language help, structure handle semantics, mutation examples, and error recovery guidance.',
    parameters: [
      { name: 'topic', required: false, type: 'string', description: 'Optional. overview, query-language, handles, errors, or examples.' },
    ],
    examples: [
      { description: 'Query language overview', args: { topic: 'query-language' } },
      { description: 'Handle lifecycle help', args: { topic: 'handles' } },
    ],
  },
  list_structure_map: {
    summary: 'Inspect the Markdown structure as a flattened pre-order map with reusable handles.',
    parameters: [
      { name: 'editorId', required: false, type: 'string', description: 'Optional editor or buffer ID. Omit it for the active editor.' },
      { name: 'maxNodes', required: false, type: 'number', description: 'Optional positive cap. Defaults to 120.' },
      { name: 'maxDepth', required: false, type: 'number', description: 'Optional depth cap. Defaults to 4.' },
      { name: 'includeRoot', required: false, type: 'boolean', description: 'Optional. Include the mdast root node when true.' },
    ],
    examples: [
      { description: 'Map the active document structure', args: {} },
      { description: 'Deeper map with the root node', args: { maxDepth: 6, includeRoot: true } },
    ],
  },
  query_structure: {
    summary: 'Select structure nodes by mdast query or by one exact handle returned earlier.',
    parameters: [
      { name: 'editorId', required: false, type: 'string', description: 'Optional editor or buffer ID. When handle is used, omit editorId unless it matches that handle document.' },
      { name: 'query', required: false, type: 'string', description: 'mdast selector such as heading[depth=2] or listItem text[value*=TODO].' },
      { name: 'handle', required: false, type: 'string', description: 'Exact handle from list_structure_map, query_structure, or get_structure_content.' },
      { name: 'maxResults', required: false, type: 'number', description: 'Optional positive cap. Defaults to 20.' },
      { name: 'includeMarkdown', required: false, type: 'boolean', description: 'Optional. Include the exact matched markdown slices.' },
    ],
    examples: [
      { description: 'Find level-2 headings', args: { query: 'heading[depth=2]' } },
      { description: 'Find one exact previously returned node', args: { handle: 'mdast:example' } },
    ],
  },
  get_structure_content: {
    summary: 'Fetch one exact node markdown and metadata by query or handle.',
    parameters: [
      { name: 'editorId', required: false, type: 'string', description: 'Optional editor or buffer ID.' },
      { name: 'query', required: false, type: 'string', description: 'mdast selector. Use a narrow selector or handle when you need exactly one node.' },
      { name: 'handle', required: false, type: 'string', description: 'Exact handle from a previous structure result.' },
    ],
    examples: [
      { description: 'Read one exact handle', args: { handle: 'mdast:example' } },
      { description: 'Read one matched paragraph', args: { query: 'paragraph[text*=Overview]' } },
    ],
  },
  insert_structure: {
    summary: 'Insert a markdown snippet relative to matched nodes using before, after, prepend, or append.',
    parameters: [
      { name: 'editorId', required: false, type: 'string', description: 'Optional editor or buffer ID.' },
      { name: 'query', required: false, type: 'string', description: 'mdast selector query.' },
      { name: 'handle', required: false, type: 'string', description: 'Exact structure handle.' },
      { name: 'position', required: true, type: 'string', description: 'before, after, prepend, or append.' },
      { name: 'markdown', required: true, type: 'string', description: 'Markdown snippet to insert.' },
    ],
    examples: [
      { description: 'Insert a paragraph after one heading', args: { query: 'heading[depth=1,text=Title]', position: 'after', markdown: 'Intro paragraph' } },
    ],
  },
  replace_structure: {
    summary: 'By default, replace_structure replaces one effective match and returns an error as soon as a second effective match would be touched. effectiveMatched means the overlap-normalized match count used for cap decisions. Use maxReplacements to raise the cap. On a successful call, maxExceeded=false means full success and maxExceeded=true means a cap-limited partial success.',
    parameters: [
      { name: 'editorId', required: false, type: 'string', description: 'Optional editor or buffer ID.' },
      { name: 'query', required: false, type: 'string', description: 'mdast selector query.' },
      { name: 'handle', required: false, type: 'string', description: 'Exact structure handle.' },
      { name: 'markdown', required: true, type: 'string', description: 'Replacement markdown snippet.' },
      { name: 'maxReplacements', required: false, type: 'integer', description: 'Optional positive integer cap. Defaults to 1.' },
      { name: 'onMaxExceeded', required: false, type: 'string', description: 'Optional. break stops after maxReplacements and succeeds. error rejects the operation if the effective match count exceeds the cap. Defaults to error.' },
    ],
    examples: [
      { description: 'Replace one exact paragraph', args: { query: 'paragraph[text*=Draft]', markdown: 'Final paragraph' } },
      { description: 'Replace two matches and still fail if a third would be touched', args: { query: 'paragraph[text*=TODO]', markdown: 'Resolved paragraph', maxReplacements: 2 } },
      { description: 'Replace up to three matches and stop successfully. If maxExceeded is true in the result, the replace stopped at the cap and did not touch every effective match.', args: { query: 'paragraph[text*=TODO]', markdown: 'Resolved paragraph', maxReplacements: 3, onMaxExceeded: 'break' } },
    ],
  },
  delete_structure: {
    summary: 'Delete matched nodes by query or one exact handle.',
    parameters: [
      { name: 'editorId', required: false, type: 'string', description: 'Optional editor or buffer ID.' },
      { name: 'query', required: false, type: 'string', description: 'mdast selector query.' },
      { name: 'handle', required: false, type: 'string', description: 'Exact structure handle.' },
    ],
    examples: [
      { description: 'Delete one exact node', args: { handle: 'mdast:example' } },
    ],
  },
  wrap_structure: {
    summary: 'Wrap matched nodes inside exactly one parsed wrapper node while preserving any existing wrapper children.',
    parameters: [
      { name: 'editorId', required: false, type: 'string', description: 'Optional editor or buffer ID.' },
      { name: 'query', required: false, type: 'string', description: 'mdast selector query.' },
      { name: 'handle', required: false, type: 'string', description: 'Exact structure handle.' },
      { name: 'markdown', required: true, type: 'string', description: 'Wrapper markdown that parses to exactly one top-level container node. Existing wrapper children are preserved before the wrapped nodes.' },
    ],
    examples: [
      { description: 'Wrap one paragraph in a quote with a lead-in line', args: { query: 'paragraph[text*=Risk]', markdown: '> Lead-in' } },
    ],
  },
  unwrap_structure: {
    summary: 'Remove one container layer from matched nodes.',
    parameters: [
      { name: 'editorId', required: false, type: 'string', description: 'Optional editor or buffer ID.' },
      { name: 'query', required: false, type: 'string', description: 'mdast selector query.' },
      { name: 'handle', required: false, type: 'string', description: 'Exact structure handle.' },
    ],
    examples: [
      { description: 'Unwrap one blockquote', args: { query: 'blockquote' } },
    ],
  },
  move_structure: {
    summary: 'Move matched source nodes to one exact target node.',
    parameters: [
      { name: 'editorId', required: false, type: 'string', description: 'Optional editor or buffer ID.' },
      { name: 'query', required: false, type: 'string', description: 'Source selector query.' },
      { name: 'handle', required: false, type: 'string', description: 'Exact source handle.' },
      { name: 'targetQuery', required: false, type: 'string', description: 'Target selector query. It must resolve to exactly one node.' },
      { name: 'targetHandle', required: false, type: 'string', description: 'Exact target handle.' },
      { name: 'position', required: true, type: 'string', description: 'before, after, prepend, or append.' },
    ],
    examples: [
      { description: 'Move one heading after another', args: { query: 'heading[text=One]', targetQuery: 'heading[text=Two]', position: 'after' } },
    ],
  },
  copy_structure: {
    summary: 'Copy one exact source node markdown and insert it at a target location without deleting the source.',
    parameters: [
      { name: 'editorId', required: false, type: 'string', description: 'Optional editor or buffer ID.' },
      { name: 'sourceQuery', required: false, type: 'string', description: 'Source selector query. It must resolve to exactly one node.' },
      { name: 'sourceHandle', required: false, type: 'string', description: 'Exact source handle.' },
      { name: 'targetQuery', required: false, type: 'string', description: 'Target selector query.' },
      { name: 'targetHandle', required: false, type: 'string', description: 'Exact target handle.' },
      { name: 'position', required: true, type: 'string', description: 'before, after, prepend, or append.' },
    ],
    examples: [
      { description: 'Copy one heading after another heading', args: { sourceQuery: 'heading[text=Template]', targetQuery: 'heading[text=Appendix]', position: 'after' } },
    ],
  },
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
  get_app_metadata: {
    summary: 'Return canonical application metadata sourced from the authoritative app version.',
    parameters: [],
    examples: [
      { description: 'Application metadata', args: {} },
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
      { name: 'mode', required: false, type: 'string', description: 'Optional. "replace", "insert", or "append". Defaults to replace. Use destination.span.kind="point" for arbitrary insert positions.' },
      { name: 'title', required: false, type: 'string', description: 'Optional title when destination.editorId is :new.' },
    ],
    examples: [
      { description: 'Replace active selection with literal text', args: { destination: { editorId: 'editor:active', span: { kind: 'selection' } }, sources: [{ type: 'literal', text: 'Updated text' }], mode: 'replace' } },
      { description: 'Append to the end of the active document', args: { destination: { editorId: 'editor:active', span: { kind: 'document' } }, sources: [{ type: 'literal', text: '\n## Notes\n' }], mode: 'append' } },
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
    summary: 'Fetch one ACL-governed HTTP(S) URL under the app safety policy.',
    parameters: [
      { name: 'url', required: true, type: 'string', description: 'HTTP or HTTPS URL. Must pass ACL and network safety checks.' },
      { name: 'method', required: false, type: 'string', description: 'Optional method. Defaults to GET. The ACL must allow or pending-confirm it.' },
      { name: 'headers', required: false, type: 'object', description: 'Optional string headers. Header names must be ACL-allowed or pending-confirmed and newline-safe.' },
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
  save_context_item: {
    summary: 'Save one short protected context item so it survives conversation compression for this session.',
    parameters: [
      { name: 'title', required: true, type: 'string', description: 'Short label for the item.' },
      { name: 'content', required: true, type: 'string', description: 'Short fact, constraint, or TODO to preserve.' },
      { name: 'priority', required: false, type: 'string', description: 'Optional. high, normal, or low.' },
    ],
    examples: [
      { description: 'Save a release constraint', args: { title: 'Packaging constraint', content: 'Keep protected context items short and high-value.', priority: 'high' } },
    ],
  },
  list_context_items: {
    summary: 'List the current protected context items and their budget usage.',
    parameters: [],
    examples: [
      { description: 'List protected items', args: {} },
    ],
  },
  update_context_item: {
    summary: 'Update one protected context item in place.',
    parameters: [
      { name: 'itemId', required: true, type: 'string', description: 'Protected context item id returned by list_context_items.' },
      { name: 'title', required: false, type: 'string', description: 'Optional replacement title. Provide at least one of title, content, or priority.' },
      { name: 'content', required: false, type: 'string', description: 'Optional replacement content. Provide at least one of title, content, or priority.' },
      { name: 'priority', required: false, type: 'string', description: 'Optional. high, normal, or low. Provide at least one of title, content, or priority.' },
    ],
    examples: [
      { description: 'Shorten one protected item', args: { itemId: 'context:example', content: 'Use host-side build flow for Windows packaging.' } },
    ],
  },
  merge_context_items: {
    summary: 'Merge two or more protected context items into one new item and remove the originals.',
    parameters: [
      { name: 'itemIds', required: true, type: 'array', description: 'Two or more protected context item ids returned by list_context_items.' },
      { name: 'title', required: true, type: 'string', description: 'Title for the merged item.' },
      { name: 'content', required: true, type: 'string', description: 'Merged compact content.' },
      { name: 'priority', required: false, type: 'string', description: 'Optional. high, normal, or low. If omitted, the highest source priority is kept.' },
    ],
    examples: [
      { description: 'Merge related packaging constraints', args: { itemIds: ['context:first', 'context:second'], title: 'Windows packaging constraints', content: 'Use host-side build flow and keep protected notes compact.', priority: 'high' } },
    ],
  },
  delete_context_item: {
    summary: 'Delete one protected context item by id.',
    parameters: [
      { name: 'itemId', required: true, type: 'string', description: 'Protected context item id returned by list_context_items.' },
    ],
    examples: [
      { description: 'Delete one protected item', args: { itemId: 'context:example' } },
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
      parameters: helpDoc.parameters,
      examples: helpDoc.examples,
      notes: [
        'Follow the parameter object schema exactly and avoid extra keys.',
        'If a previous tool returned target or pageTarget, reuse that object as-is when possible.',
      ],
    },
  }
}

function buildStructureHelpResult(topic) {
  const resolvedTopic = typeof topic === 'string' && topic.length > 0 ? topic : 'overview'
  const topics = ['overview', 'query-language', 'handles', 'errors', 'examples']

  const helpByTopic = {
    overview: {
      summary: 'Use structure tools for mdast node targeting instead of SPAN when the task is about headings, lists, tables, blockquotes, code blocks, or other Markdown structure.',
      notes: [
        'Start with list_structure_map for a broad map or query_structure for selector-based discovery.',
        'Use handles for exact follow-up operations. Handles are session-scoped and become stale after the document changes.',
        'Use insert_structure, replace_structure, delete_structure, wrap_structure, unwrap_structure, move_structure, or copy_structure for DOM-like mutations.',
      ],
    },
    'query-language': {
      summary: 'The structure query language follows mdast-control selectors.',
      notes: [
        'Examples: heading, root, heading[depth=2], heading[text*=Release], paragraph > text, listItem text[value*=TODO], tableCell[columnIndex=1,cellText=Open].',
        'Operators: = exact, *= contains, ^= startsWith, $= endsWith, != not equal.',
        'Special fields: text, rowIndex, columnIndex, headerText, cellText.',
        'Use spaces for descendant and > for direct child.',
      ],
    },
    handles: {
      summary: 'A structure handle is an exact node reference returned by list_structure_map, query_structure, or get_structure_content.',
      notes: [
        'Handles are opaque ids like mdast:... and should be reused as-is.',
        'Handles are valid only inside the current AI session and only while the document fingerprint stays unchanged.',
        'If a handle becomes stale, rerun list_structure_map or query_structure to obtain fresh handles.',
      ],
    },
    errors: {
      summary: 'Structure tool errors include a reason, a fix, and a get_tool_help or get_structure_help follow-up path.',
      notes: [
        'invalid_query: the selector syntax is wrong. Call get_structure_help with {"topic":"query-language"}.',
        'no_match: the selector matched nothing. Inspect the current document with list_structure_map or query_structure.',
        'invalid_handle or stale_handle: rerun a structure read tool and reuse one returned handle.',
        'too_many_matches on replace_structure: the effective match count exceeded maxReplacements. Narrow the query, use a handle, raise maxReplacements, or set onMaxExceeded to break.',
        'When onMaxExceeded is break, inspect maxExceeded and effectiveMatched in the result. maxExceeded=true means the replace stopped at the configured cap instead of touching every effective match.',
        'matched is the raw selector match count before overlap normalization. effectiveMatched is the normalized count used for maxReplacements and overflow decisions. changed is the number of replacements actually applied.',
        'Move target queries must resolve to exactly one node. Use a handle when you need exact targeting.',
      ],
    },
    examples: {
      summary: 'Typical structure tool flow examples.',
      notes: [
        'Map headings: list_structure_map {} then query_structure {"query":"heading[depth=2]"}.',
        'Insert after one heading: query_structure {"query":"heading[text=Overview]"} then insert_structure {"handle":"mdast:...","position":"after","markdown":"New paragraph"}.',
        'Copy one heading node: copy_structure {"sourceQuery":"heading[text=Template]","targetQuery":"heading[text=Appendix]","position":"after"}.',
      ],
    },
  }

  const help = helpByTopic[resolvedTopic] || helpByTopic.overview

  return {
    ok: true,
    topic: resolvedTopic,
    topics,
    help,
  }
}

function buildAiToolErrorResult(toolName, error) {
  const message = error instanceof Error ? error.message : String(error)
  const helpCall = {
    tool: 'get_tool_help',
    args: { toolName },
  }
  const structureHelpCall = {
    tool: 'get_structure_help',
    args: {
      topic: error instanceof AiToolUserError && error.code === 'invalid_query'
        ? 'query-language'
        : error instanceof AiToolUserError && (error.code === 'invalid_handle' || error.code === 'stale_handle')
          ? 'handles'
          : 'errors',
    },
  }
  const isStructureTool = toolName === 'get_structure_help' || toolName === 'list_structure_map' || toolName === 'query_structure' || toolName === 'get_structure_content' || toolName === 'insert_structure' || toolName === 'replace_structure' || toolName === 'delete_structure' || toolName === 'wrap_structure' || toolName === 'unwrap_structure' || toolName === 'move_structure' || toolName === 'copy_structure'

  if (error instanceof AiToolUserError) {
    return {
      ok: false,
      toolName,
      error: {
        code: error.code,
        reason: error.reason,
        fix: error.fix,
        help: {
          call: isStructureTool ? structureHelpCall : helpCall,
          note: isStructureTool
            ? `Call get_structure_help for query, handle, and recovery guidance, or get_tool_help with {"toolName":"${toolName}"} for the exact schema.`
            : `Call get_tool_help with {"toolName":"${toolName}"} for the exact schema and examples.`,
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
        call: isStructureTool ? structureHelpCall : helpCall,
        note: isStructureTool
          ? `Call get_structure_help for recovery guidance, or get_tool_help with {"toolName":"${toolName}"} for the exact schema.`
          : `Call get_tool_help with {"toolName":"${toolName}"} for the exact schema and examples.`,
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
    throw new AiToolUserError(toolName, 'help=true is no longer valid on action tools.', `Call get_tool_help with {"toolName":"${toolName}"} instead.`)
  }

  if (toolName === 'get_tool_help') {
    requireStringArg(toolName, args, 'toolName', 'an exact registered tool name such as read_target')
    return
  }

  if (toolName === 'get_structure_help') {
    return
  }

  if (toolName === 'list_structure_map') {
    return
  }

  if (toolName === 'query_structure' || toolName === 'get_structure_content' || toolName === 'delete_structure' || toolName === 'unwrap_structure') {
    return
  }

  if (toolName === 'insert_structure' || toolName === 'replace_structure' || toolName === 'wrap_structure') {
    if (toolName === 'insert_structure') {
      requireStringArg(toolName, args, 'position', 'one of before, after, prepend, or append')
    }
    requireStringArg(toolName, args, 'markdown', 'a non-empty markdown string')
    return
  }

  if (toolName === 'move_structure') {
    requireStringArg(toolName, args, 'position', 'one of before, after, prepend, or append')
    return
  }

  if (toolName === 'copy_structure') {
    requireStringArg(toolName, args, 'position', 'one of before, after, prepend, or append')
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
    return
  }

  if (toolName === 'save_context_item') {
    requireStringArg(toolName, args, 'title', 'a short label such as "Current release constraint"')
    requireStringArg(toolName, args, 'content', 'a short fact, constraint, or TODO to preserve')
    return
  }

  if (toolName === 'update_context_item') {
    requireStringArg(toolName, args, 'itemId', 'an item id returned by list_context_items')
    return
  }

  if (toolName === 'merge_context_items') {
    requireArrayArg(toolName, args, 'itemIds', 'an array of two or more item ids returned by list_context_items')
    requireStringArg(toolName, args, 'title', 'a short label for the merged item')
    requireStringArg(toolName, args, 'content', 'merged compact content')
    return
  }

  if (toolName === 'delete_context_item') {
    requireStringArg(toolName, args, 'itemId', 'an item id returned by list_context_items')
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

  const normalizedHeaders = {}

  for (const [headerName, headerValue] of Object.entries(headers)) {
    const { normalizedName, normalizedValue } = assertSafeFetchHeaderEntry(headerName, headerValue)
    normalizedHeaders[normalizedName] = normalizedValue
  }

  return normalizedHeaders
}

function assertSafeFetchHeaderEntry(headerName, headerValue) {
  const forbiddenHeaders = new Set(['connection', 'content-length', 'cookie', 'host', 'proxy-authenticate', 'proxy-authorization', 'set-cookie', 'te', 'trailer', 'transfer-encoding', 'upgrade'])
  const normalizedName = typeof headerName === 'string' ? headerName.trim().toLowerCase() : ''

  if (!normalizedName || !/^[a-z0-9-]+$/.test(normalizedName)) {
    throw new Error(`Fetch header name is invalid: ${headerName}`)
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

  return {
    normalizedName,
    normalizedValue: headerValue,
  }
}

function assertSafeFetchAclNode(node) {
  if (Array.isArray(node?.rules)) {
    for (const rule of node.rules) {
      if (rule?.kind === 'force-header') {
        assertSafeFetchHeaderEntry(rule.name, rule.value)
      }
    }
  }

  if (Array.isArray(node?.children)) {
    for (const child of node.children) {
      assertSafeFetchAclNode(child.node)
    }
  }
}

function assertSafeFetchAclText(aclText) {
  const parsedAcl = parseFetchAclText(aclText)

  for (const node of Object.values(parsedAcl.policies)) {
    assertSafeFetchAclNode(node)
  }

  return parsedAcl.text
}

function resolveFetchMethod(method) {
  const normalizedMethod = typeof method === 'string' && method.trim().length > 0 ? method.trim().toUpperCase() : 'GET'

  if (!/^[A-Z]+$/.test(normalizedMethod)) {
    throw new Error(`Fetch method is invalid: ${normalizedMethod}`)
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
    const effectiveHeaders = await options.authorizeTarget(targetUrl)

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
        headers: effectiveHeaders,
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

function buildFetchAclDeniedError(decision) {
  if (decision.reason === 'method' && decision.detail) {
    return new Error(`Fetch ACL denied method ${decision.method} for ${decision.targetUrl.href} (${decision.detail.scope})`)
  }

  if (decision.reason === 'header' && Array.isArray(decision.detail) && decision.detail.length > 0) {
    return new Error(`Fetch ACL denied headers for ${decision.targetUrl.href}: ${decision.detail.map((entry) => entry.name).join(', ')}`)
  }

  if (decision.reason === 'header-default' && Array.isArray(decision.detail) && decision.detail.length > 0) {
    return new Error(`Fetch ACL denied unruled headers for ${decision.targetUrl.href}: ${decision.detail.join(', ')}`)
  }

  return new Error(`Fetch ACL denied ${decision.method} ${decision.targetUrl.href}`)
}

function mergeFetchHeaders(headers, forcedHeaders) {
  const mergedHeaders = { ...headers }

  for (const [headerName, headerValue] of Object.entries(forcedHeaders)) {
    const { normalizedName, normalizedValue } = assertSafeFetchHeaderEntry(headerName, headerValue)
    mergedHeaders[normalizedName] = normalizedValue
  }

  return mergedHeaders
}

function buildPendingFetchAclDetailLines(messages, decision) {
  const lines = [
    `${messages.urlLabel}: ${decision.targetUrl.href}`,
    `${messages.methodLabel}: ${decision.method}`,
    `${messages.headersLabel}: ${decision.requestedHeaders.join(', ') || messages.none}`,
    '',
    messages.detailsLabel,
  ]

  if (decision.methodDecision) {
    lines.push(`- ${messages.pendingMethod(decision.method, decision.methodDecision.scope)}`)
  }

  for (const pendingHeader of decision.pendingHeaders) {
    lines.push(`- ${messages.pendingHeader(pendingHeader.name, pendingHeader.scope)}`)
  }

  return lines.join('\n')
}

async function promptPendingFetchAclDecision(parentWindow, requestHeaders, decision) {
  const messages = getMainI18n().fetchAclPrompt
  const response = await showMessageBox(parentWindow, {
    type: 'question',
    buttons: [messages.allow, messages.deny, messages.runOnce, messages.skipOnce],
    defaultId: 2,
    cancelId: 3,
    checkboxLabel: messages.applyToOrigin,
    title: messages.title,
    message: messages.message,
    detail: buildPendingFetchAclDetailLines(messages, decision),
    noLink: true,
  })

  return {
    action: response.response === 0
      ? 'allow'
      : response.response === 1
        ? 'deny'
        : response.response === 2
          ? 'run-once'
          : 'skip-once',
    applyToOrigin: response.checkboxChecked === true,
  }
}

async function resolveFetchAclDecision(editorWindow, targetUrl, method, headers) {
  let decision = evaluateFetchAcl(settingsState.ai.fetch.aclText, {
    url: targetUrl,
    method,
    headerNames: Object.keys(headers),
  })

  if (decision.status === 'deny') {
    throw buildFetchAclDeniedError(decision)
  }

  if (decision.status === 'pending') {
    const promptResult = await promptPendingFetchAclDecision(editorWindow, headers, decision)

    if (promptResult.action === 'skip-once') {
      throw new Error(`Fetch ACL pending request was not executed: ${targetUrl.href}`)
    }

    if (promptResult.action === 'run-once') {
      return mergeFetchHeaders(headers, decision.forcedHeaders)
    }

    settingsState = sanitizeSettings(mergePlainObjects(settingsState, {
      ai: {
        fetch: {
          aclText: addFetchAclDecisionRule(settingsState.ai.fetch.aclText, {
            decision: promptResult.action,
            origin: targetUrl.origin,
            path: targetUrl.pathname,
            applyToOrigin: promptResult.applyToOrigin,
            pathMatch: promptResult.applyToOrigin ? 'prefix' : 'exact',
            method: decision.methodDecision ? method : undefined,
            headers: decision.pendingHeaders.map((entry) => entry.name),
          }),
        },
      },
    }))
    await persistSettings()
    broadcastSettingsChanged()

    decision = evaluateFetchAcl(settingsState.ai.fetch.aclText, {
      url: targetUrl,
      method,
      headerNames: Object.keys(headers),
    })

    if (decision.status === 'deny') {
      throw buildFetchAclDeniedError(decision)
    }

    if (decision.status === 'pending') {
      throw new Error(`Fetch ACL still pending after saving a decision for ${targetUrl.href}`)
    }
  }

  return mergeFetchHeaders(headers, decision.forcedHeaders)
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
    body,
    requestTimeoutMs: settingsState.ai.fetch.requestTimeoutMs,
    idleTimeoutMs: settingsState.ai.fetch.idleTimeoutMs,
    maxResponseBytes: settingsState.ai.fetch.maxResponseBytes,
    authorizeTarget: (targetUrl) => resolveFetchAclDecision(editorWindow, targetUrl, method, headers),
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
  if (toolName === 'get_tool_help') {
    return {
      toolName: typeof args?.toolName === 'string' ? args.toolName : null,
    }
  }

  if (toolName === 'get_structure_help') {
    return {
      topic: typeof args?.topic === 'string' ? args.topic : null,
    }
  }

  if (toolName === 'list_structure_map') {
    return {
      editorId: typeof args?.editorId === 'string' ? args.editorId : null,
      maxNodes: Number.isFinite(Number(args?.maxNodes)) ? Number(args.maxNodes) : undefined,
      maxDepth: Number.isFinite(Number(args?.maxDepth)) ? Number(args.maxDepth) : undefined,
      includeRoot: args?.includeRoot === true,
    }
  }

  if (toolName === 'query_structure' || toolName === 'get_structure_content' || toolName === 'delete_structure' || toolName === 'unwrap_structure' || toolName === 'replace_structure' || toolName === 'wrap_structure' || toolName === 'insert_structure') {
    return {
      editorId: typeof args?.editorId === 'string' ? args.editorId : null,
      query: typeof args?.query === 'string' ? args.query.slice(0, 160) : null,
      handle: typeof args?.handle === 'string' ? args.handle : null,
      position: typeof args?.position === 'string' ? args.position : undefined,
      markdownBytes: typeof args?.markdown === 'string' ? Buffer.byteLength(args.markdown, 'utf8') : undefined,
      maxResults: Number.isFinite(Number(args?.maxResults)) ? Number(args.maxResults) : undefined,
      includeMarkdown: args?.includeMarkdown === true,
    }
  }

  if (toolName === 'move_structure') {
    return {
      editorId: typeof args?.editorId === 'string' ? args.editorId : null,
      query: typeof args?.query === 'string' ? args.query.slice(0, 160) : null,
      handle: typeof args?.handle === 'string' ? args.handle : null,
      targetQuery: typeof args?.targetQuery === 'string' ? args.targetQuery.slice(0, 160) : null,
      targetHandle: typeof args?.targetHandle === 'string' ? args.targetHandle : null,
      position: typeof args?.position === 'string' ? args.position : undefined,
    }
  }

  if (toolName === 'copy_structure') {
    return {
      editorId: typeof args?.editorId === 'string' ? args.editorId : null,
      sourceQuery: typeof args?.sourceQuery === 'string' ? args.sourceQuery.slice(0, 160) : null,
      sourceHandle: typeof args?.sourceHandle === 'string' ? args.sourceHandle : null,
      targetQuery: typeof args?.targetQuery === 'string' ? args.targetQuery.slice(0, 160) : null,
      targetHandle: typeof args?.targetHandle === 'string' ? args.targetHandle : null,
      position: typeof args?.position === 'string' ? args.position : undefined,
    }
  }

  if (toolName === 'write_target') {
    return {
      destination: summarizeTargetForLog(args?.destination),
      mode: args?.mode === 'insert' || args?.mode === 'append' ? args.mode : 'replace',
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

  if (toolName === 'get_app_metadata') {
    return null
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

  if (toolName === 'save_context_item') {
    return {
      title: typeof args?.title === 'string' ? args.title.slice(0, 160) : null,
      contentPreview: typeof args?.content === 'string' ? createPreviewText(args.content, 160) : null,
      priority: typeof args?.priority === 'string' ? args.priority : null,
    }
  }

  if (toolName === 'list_context_items') {
    return null
  }

  if (toolName === 'update_context_item') {
    return {
      itemId: typeof args?.itemId === 'string' ? args.itemId : null,
      title: typeof args?.title === 'string' ? args.title.slice(0, 160) : null,
      contentPreview: typeof args?.content === 'string' ? createPreviewText(args.content, 160) : null,
      priority: typeof args?.priority === 'string' ? args.priority : null,
    }
  }

  if (toolName === 'merge_context_items') {
    return {
      itemIds: Array.isArray(args?.itemIds) ? args.itemIds.slice(0, 8) : null,
      title: typeof args?.title === 'string' ? args.title.slice(0, 160) : null,
      contentPreview: typeof args?.content === 'string' ? createPreviewText(args.content, 160) : null,
      priority: typeof args?.priority === 'string' ? args.priority : null,
    }
  }

  if (toolName === 'delete_context_item') {
    return {
      itemId: typeof args?.itemId === 'string' ? args.itemId : null,
    }
  }

  return args
}

function summarizeAiToolResultForLog(toolName, result) {
  if (toolName === 'get_structure_help') {
    return {
      topic: typeof result?.topic === 'string' ? result.topic : null,
    }
  }

  if (toolName === 'list_structure_map') {
    return {
      editorId: typeof result?.editorId === 'string' ? result.editorId : null,
      nodeCount: Array.isArray(result?.nodes) ? result.nodes.length : null,
      truncated: result?.truncated === true,
    }
  }

  if (toolName === 'query_structure') {
    return {
      editorId: typeof result?.editorId === 'string' ? result.editorId : null,
      totalMatches: Number.isFinite(Number(result?.totalMatches)) ? Number(result.totalMatches) : null,
      returnedMatches: Array.isArray(result?.matches) ? result.matches.length : null,
      truncated: result?.truncated === true,
    }
  }

  if (toolName === 'get_structure_content') {
    return {
      editorId: typeof result?.editorId === 'string' ? result.editorId : null,
      totalMatches: Number.isFinite(Number(result?.totalMatches)) ? Number(result.totalMatches) : null,
      handle: typeof result?.node?.handle === 'string' ? result.node.handle : null,
      target: summarizeTargetForLog(result?.node?.target),
    }
  }

  if (toolName === 'insert_structure' || toolName === 'replace_structure' || toolName === 'delete_structure' || toolName === 'wrap_structure' || toolName === 'unwrap_structure' || toolName === 'move_structure' || toolName === 'copy_structure') {
    return {
      editorId: typeof result?.editorId === 'string' ? result.editorId : null,
      matched: Number.isFinite(Number(result?.matched)) ? Number(result.matched) : null,
      effectiveMatched: Number.isFinite(Number(result?.effectiveMatched)) ? Number(result.effectiveMatched) : null,
      maxExceeded: result?.maxExceeded === true,
      targetMatched: Number.isFinite(Number(result?.targetMatched)) ? Number(result.targetMatched) : null,
      changed: Number.isFinite(Number(result?.changed)) ? Number(result.changed) : null,
      inserted: Number.isFinite(Number(result?.inserted)) ? Number(result.inserted) : null,
      bytesWritten: Number.isFinite(Number(result?.bytesWritten)) ? Number(result.bytesWritten) : null,
      target: summarizeTargetForLog(result?.target),
    }
  }

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

  if (toolName === 'save_context_item') {
    return {
      itemId: typeof result?.item?.itemId === 'string' ? result.item.itemId : null,
      title: typeof result?.item?.title === 'string' ? result.item.title : null,
      totalTokens: Number.isFinite(Number(result?.usage?.totalTokens)) ? Number(result.usage.totalTokens) : null,
      itemCount: Number.isFinite(Number(result?.usage?.itemCount)) ? Number(result.usage.itemCount) : null,
    }
  }

  if (toolName === 'list_context_items') {
    return {
      itemCount: Array.isArray(result?.items) ? result.items.length : null,
      totalTokens: Number.isFinite(Number(result?.usage?.totalTokens)) ? Number(result.usage.totalTokens) : null,
    }
  }

  if (toolName === 'update_context_item') {
    return {
      itemId: typeof result?.item?.itemId === 'string' ? result.item.itemId : null,
      title: typeof result?.item?.title === 'string' ? result.item.title : null,
      totalTokens: Number.isFinite(Number(result?.usage?.totalTokens)) ? Number(result.usage.totalTokens) : null,
      itemCount: Number.isFinite(Number(result?.usage?.itemCount)) ? Number(result.usage.itemCount) : null,
    }
  }

  if (toolName === 'merge_context_items') {
    return {
      itemId: typeof result?.item?.itemId === 'string' ? result.item.itemId : null,
      mergedFromCount: Array.isArray(result?.mergedFromItemIds) ? result.mergedFromItemIds.length : null,
      totalTokens: Number.isFinite(Number(result?.usage?.totalTokens)) ? Number(result.usage.totalTokens) : null,
      itemCount: Number.isFinite(Number(result?.usage?.itemCount)) ? Number(result.usage.itemCount) : null,
    }
  }

  if (toolName === 'delete_context_item') {
    return {
      itemId: typeof result?.itemId === 'string' ? result.itemId : null,
      deleted: result?.deleted === true,
      itemCount: Number.isFinite(Number(result?.usage?.itemCount)) ? Number(result.usage.itemCount) : null,
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

    let result

    if (toolName === 'get_tool_help') {
      result = buildAiToolHelpResult(args.toolName)
    } else if (toolName === 'get_structure_help') {
      result = buildStructureHelpResult(typeof args?.topic === 'string' ? args.topic : 'overview')
    } else if (toolName === 'list_structure_map') {
      result = listStructureMapForWindow(editorWindow, args)
    } else if (toolName === 'query_structure') {
      result = queryStructureForWindow(editorWindow, args)
    } else if (toolName === 'get_structure_content') {
      result = getStructureContentForWindow(editorWindow, args)
    } else if (toolName === 'insert_structure') {
      result = applyStructureMutationForWindow(editorWindow, toolName, 'insert', args)
    } else if (toolName === 'replace_structure') {
      result = applyStructureMutationForWindow(editorWindow, toolName, 'replace', args)
    } else if (toolName === 'delete_structure') {
      result = applyStructureMutationForWindow(editorWindow, toolName, 'delete', args)
    } else if (toolName === 'wrap_structure') {
      result = applyStructureMutationForWindow(editorWindow, toolName, 'wrap', args)
    } else if (toolName === 'unwrap_structure') {
      result = applyStructureMutationForWindow(editorWindow, toolName, 'unwrap', args)
    } else if (toolName === 'move_structure') {
      result = applyStructureMutationForWindow(editorWindow, toolName, 'move', args)
    } else if (toolName === 'copy_structure') {
      result = copyStructureForWindow(editorWindow, args)
    } else if (toolName === 'get_context') {
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
    } else if (toolName === 'get_app_metadata') {
      result = getAppMetadata()
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
        mode: args?.mode === 'insert' || args?.mode === 'append' ? args.mode : 'replace',
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
    } else if (toolName === 'save_context_item') {
      result = saveProtectedContextItemForWindow(editorWindow, {
        title: requireStringArg(toolName, args, 'title', 'a short label such as "Current release constraint"'),
        content: requireStringArg(toolName, args, 'content', 'a short fact, constraint, or TODO to preserve'),
        priority: args?.priority,
      })
    } else if (toolName === 'list_context_items') {
      result = listProtectedContextItemsForWindow(editorWindow)
    } else if (toolName === 'update_context_item') {
      result = updateProtectedContextItemForWindow(editorWindow, {
        itemId: requireStringArg(toolName, args, 'itemId', 'an item id returned by list_context_items'),
        ...(Object.prototype.hasOwnProperty.call(args || {}, 'title') ? { title: args.title } : {}),
        ...(Object.prototype.hasOwnProperty.call(args || {}, 'content') ? { content: args.content } : {}),
        ...(Object.prototype.hasOwnProperty.call(args || {}, 'priority') ? { priority: args.priority } : {}),
      })
    } else if (toolName === 'merge_context_items') {
      result = mergeProtectedContextItemsForWindow(editorWindow, {
        itemIds: requireArrayArg(toolName, args, 'itemIds', 'an array of two or more item ids returned by list_context_items'),
        title: requireStringArg(toolName, args, 'title', 'a short label for the merged item'),
        content: requireStringArg(toolName, args, 'content', 'merged compact content'),
        priority: args?.priority,
      })
    } else if (toolName === 'delete_context_item') {
      result = deleteProtectedContextItemForWindow(editorWindow, {
        itemId: requireStringArg(toolName, args, 'itemId', 'an item id returned by list_context_items'),
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

async function requestOpenAiChatResponse(editorWindow, messages, onStreamEvent) {
  const input = buildOpenAiChatInput(editorWindow, messages)

  if (input.length === 0) {
    throw new Error('No chat context was provided to OpenAI')
  }

  const client = createOpenAiClient()
  const openAiTools = getValidatedOpenAiToolDefinitions()
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
      let streamedTextSnapshot = ''
      let streamedTextDone = ''

      const responseStream = createOpenAiResponseStream(client, {
        model: settingsState.ai.openai.model,
        instructions: openAiChatInstructions,
        input: nextInput,
        previous_response_id: previousResponseId || undefined,
        tools: openAiTools,
        store: true,
      })

      responseStream.on('response.output_text.delta', (event) => {
        if (typeof event.delta !== 'string' || event.delta.length === 0) {
          return
        }

        streamedTextSnapshot = typeof event.snapshot === 'string' && event.snapshot.length > 0
          ? event.snapshot
          : `${streamedTextSnapshot}${event.delta}`

        onStreamEvent?.({
          type: 'text-delta',
          delta: event.delta,
        })
      })

      responseStream.on('response.output_text.done', (event) => {
        if (typeof event.text !== 'string' || event.text.length === 0) {
          return
        }

        streamedTextDone = event.text
      })

      const response = await responseStream.finalResponse()

      previousResponseId = typeof response.id === 'string' ? response.id : null

      const outputItems = Array.isArray(response.output) ? response.output : []
      const functionCalls = outputItems.filter((item) => item?.type === 'function_call')
      const outputItemTypes = outputItems.map((item) => item?.type || 'unknown')
      const finalOutputText = typeof response.output_text === 'string' ? response.output_text.trim() : ''
      const doneReply = streamedTextDone.trim()
      const streamedReply = streamedTextSnapshot.trim()

      writeLog('INFO', 'ai-chat', 'OpenAI response iteration received', {
        iteration,
        responseId: previousResponseId,
        functionCallCount: functionCalls.length,
        outputItemCount: outputItems.length,
        outputItemTypes,
        streamedTextLength: streamedTextSnapshot.length,
        streamedDoneTextLength: streamedTextDone.length,
        finalOutputTextLength: finalOutputText.length,
      })

      if (functionCalls.length === 0) {
        if (!finalOutputText && doneReply) {
          writeLog('WARN', 'ai-chat', 'OpenAI final response dropped output_text; using output_text.done', {
            iteration,
            responseId: previousResponseId,
            outputItemTypes,
            streamedDoneTextLength: streamedTextDone.length,
            streamedTextLength: streamedTextSnapshot.length,
          })
        }

        if (!finalOutputText && !doneReply && streamedReply) {
          writeLog('WARN', 'ai-chat', 'OpenAI stream missed output_text.done; using delta snapshot', {
            iteration,
            responseId: previousResponseId,
            outputItemTypes,
            streamedTextLength: streamedTextSnapshot.length,
          })
        }

        const reply = finalOutputText || doneReply || streamedReply

        if (!reply) {
          throw new Error(`OpenAI SDK returned no final text (output item types: ${outputItemTypes.join(', ') || 'none'})`)
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
          phase: 'call',
          title: `${functionCall.name} call`,
          content: formatToolEventContent(args),
        })
        onStreamEvent?.({
          type: 'tool-event',
          phase: 'call',
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
          phase: 'result',
          title: `${functionCall.name} result`,
          content: formatToolEventContent(result),
        })
        onStreamEvent?.({
          type: 'tool-event',
          phase: 'result',
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

function emitAiChatStreamEvent(targetWindow, payload) {
  if (!targetWindow || targetWindow.isDestroyed()) {
    return
  }

  const targetContents = targetWindow.webContents

  if (!targetContents || targetContents.isDestroyed()) {
    return
  }

  targetContents.send('mdv:ai-chat-stream-event', payload)
}

function broadcastSettingsChanged() {
  createApplicationMenu()

  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue
    }

    window.webContents.send('mdv:settings-changed', settingsState)
  }

  const updaterSnapshot = getUpdaterStateSnapshot()

  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue
    }

    window.webContents.send('mdv:updater-state-changed', updaterSnapshot)
  }
}

function loadRendererWindow(window, htmlFileName) {
  if (isDev) {
    window.loadURL(`http://localhost:5173/${htmlFileName}`)
    return
  }

  window.loadFile(path.join(__dirname, '..', '..', 'dist', htmlFileName))
}

function isSettingsWindow(window) {
  return Boolean(settingsWindow) && Boolean(window) && settingsWindow.id === window.id
}

function isFetchPermissionsWindow(window) {
  return Boolean(fetchPermissionsWindow) && Boolean(window) && fetchPermissionsWindow.id === window.id
}

function isAboutWindow(window) {
  return Boolean(aboutWindow) && Boolean(window) && aboutWindow.id === window.id
}

function isEditorWindow(window) {
  return Boolean(window) && !isSettingsWindow(window) && !isFetchPermissionsWindow(window) && !isAboutWindow(window)
}

function getDefaultEditorWindow() {
  return BrowserWindow.getAllWindows().find((window) => isEditorWindow(window)) ?? null
}

function getEditorWindowForAiAction(candidateWindow) {
  if (!candidateWindow) {
    return getDefaultEditorWindow()
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

  if (isAboutWindow(candidateWindow)) {
    if (aboutWindowOwnerEditorId) {
      const ownerWindow = BrowserWindow.fromId(aboutWindowOwnerEditorId)
      if (ownerWindow && !ownerWindow.isDestroyed()) {
        return ownerWindow
      }
    }

    return getDefaultEditorWindow()
  }

  return candidateWindow
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
  const nextWindow = await createWindow()
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
    const nextMode = payload?.mode === 'insert' || payload?.mode === 'append' ? payload.mode : 'replace'
    const currentText = resolvedTarget.bufferRecord.text
    const resolvedOffsets = resolveSpanToOffsets(currentText, resolvedTarget.span)
    const startOffset = nextMode === 'append' ? resolvedOffsets.endOffset : resolvedOffsets.startOffset
    const endOffset = nextMode === 'replace'
      ? resolvedOffsets.endOffset
      : nextMode === 'append'
        ? resolvedOffsets.endOffset
        : resolvedOffsets.startOffset
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

  if (payload?.mode !== 'insert' && payload?.mode !== 'append' && settingsState.safety.confirmBeforeFullDocumentOverwrite) {
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
    mode: payload?.mode === 'insert' || payload?.mode === 'append' ? payload.mode : 'replace',
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

  focusWindow(editorWindow)
  editorWindow.webContents.send('mdv:menu-action', 'open-ai-chat')
  writeLog('INFO', 'ai-chat', 'Assistant dock requested', { editorWindowId: editorWindow.id })

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
      preload: path.join(__dirname, '..', 'preload.cjs'),
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
      preload: path.join(__dirname, '..', 'preload.cjs'),
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

function openAboutWindow(targetWindow) {
  const ownerEditorWindow = getEditorWindowForAiAction(targetWindow)

  if (!ownerEditorWindow && (!aboutWindow || aboutWindow.isDestroyed())) {
    writeLog('WARN', 'about', 'No editor window available for about owner')
    return { status: 'focused' }
  }

  if (ownerEditorWindow && !ownerEditorWindow.isDestroyed()) {
    aboutWindowOwnerEditorId = ownerEditorWindow.id
  }

  if (aboutWindow && !aboutWindow.isDestroyed()) {
    focusWindow(aboutWindow)
    return { status: 'focused' }
  }

  aboutWindow = new BrowserWindow({
    width: 720,
    height: 640,
    minWidth: 620,
    minHeight: 520,
    backgroundColor: '#fffaf4',
    autoHideMenuBar: true,
    icon: windowIcon,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  aboutWindow.on('closed', () => {
    aboutWindow = null
    aboutWindowOwnerEditorId = null
  })

  loadRendererWindow(aboutWindow, 'about.html')
  focusWindow(aboutWindow)
  writeLog('INFO', 'about', 'About window opened')

  return { status: 'opened' }
}

function dispatchOpenFileToWindow(targetWindow, launchRequest) {
  if (!targetWindow || (!launchRequest?.filePath && !launchRequest?.explicitInitialPanel)) {
    return
  }

  const resolvedLaunchRequest = {
    filePath: launchRequest?.filePath || null,
    initialPanel: resolveInitialPanelForLaunch(launchRequest),
    isInitialLaunch: !targetWindow.isVisible() && Boolean(launchRequest?.filePath),
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

  const existingWindow = launchRequest?.filePath ? findEditorWindowByTrackedFilePath(launchRequest.filePath) : null

  if (existingWindow) {
    writeLog('INFO', 'main', 'Focused existing editor for launch/open file request', {
      filePath: launchRequest.filePath,
      windowId: existingWindow.id,
    })
    focusWindow(existingWindow)
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
  const messages = getMainI18n()
  const suggestedRule = createAllowedLinkRule(targetUrl)
  const response = await showMessageBox(parentWindow, {
    type: 'warning',
    buttons: [messages.externalLink.allowAndRemember, messages.externalLink.openOnce, messages.buttons.cancel],
    defaultId: 1,
    cancelId: 2,
    title: messages.externalLink.title,
    message: messages.externalLink.message,
    detail: `URL: ${targetUrl.href}\n${messages.externalLink.suggestedRuleLabel}: ${suggestedRule}`,
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
  const expectedSnapshot = payload?.expectedSnapshot && typeof payload.expectedSnapshot === 'object'
    ? payload.expectedSnapshot
    : null
  const baseContent = typeof payload?.baseContent === 'string' ? payload.baseContent : content

  let targetPath = currentPath

  if (!targetPath || forceDialog) {
    const messages = getMainI18n()
    const result = await showSaveDialog(parentWindow, {
      defaultPath: currentPath || defaultFileName,
      filters: [
        { name: messages.fileDialog.markdownFilter, extensions: ['md', 'markdown', 'txt'] },
        { name: messages.fileDialog.allFilesFilter, extensions: ['*'] },
      ],
    })

    if (result.canceled || !result.filePath) {
      writeLog('INFO', 'ipc', 'save-file cancelled')
      return { status: 'cancelled' }
    }

    targetPath = result.filePath
  }

  let nextContent = content
  const currentDiskFile = await readOptionalUtf8File(targetPath)
  const shouldPromptConflict = targetPath === currentPath
    && Boolean(expectedSnapshot)
    && (!currentDiskFile || !areFileSnapshotsEqual(currentDiskFile.snapshot, expectedSnapshot))

  if (shouldPromptConflict) {
    const messages = getMainI18n()
    const response = await showMessageBox(parentWindow, {
      type: 'warning',
      buttons: [messages.buttons.overwriteSave, messages.buttons.saveAs, messages.buttons.mergeSave, messages.buttons.cancel],
      defaultId: 3,
      cancelId: 3,
      noLink: true,
      title: messages.saveConflict.title,
      message: messages.saveConflict.message,
      detail: messages.saveConflict.detail(targetPath),
    })

    if (response.response === 3) {
      return { status: 'cancelled' }
    }

    if (response.response === 1) {
      const saveAsResult = await showSaveDialog(parentWindow, {
        defaultPath: defaultFileName,
        filters: [
          { name: messages.fileDialog.markdownFilter, extensions: ['md', 'markdown', 'txt'] },
          { name: messages.fileDialog.allFilesFilter, extensions: ['*'] },
        ],
      })

      if (saveAsResult.canceled || !saveAsResult.filePath) {
        writeLog('INFO', 'ipc', 'save-file cancelled during save-as after conflict')
        return { status: 'cancelled' }
      }

      targetPath = saveAsResult.filePath
    }

    if (response.response === 2) {
      try {
        if (!currentDiskFile) {
          throw new Error('The local file no longer exists, so merge save is unavailable.')
        }

        if (typeof payload?.baseContent !== 'string') {
          throw new Error('Merge save requires the last synchronized document content.')
        }

        const patch = createPatch(targetPath || 'document.md', baseContent, content)
        const mergedContent = applyPatch(currentDiskFile.content, patch)

        if (typeof mergedContent !== 'string') {
          throw new Error('The local file changed in a way that could not be merged automatically.')
        }

        const mergePreview = await showMessageBox(parentWindow, {
          type: 'question',
          buttons: [messages.saveConflict.mergePreviewContinue, messages.buttons.saveAs, messages.buttons.cancel],
          defaultId: 0,
          cancelId: 2,
          noLink: true,
          title: messages.saveConflict.mergePreviewTitle,
          message: messages.saveConflict.mergePreviewMessage,
          detail: messages.saveConflict.mergePreviewDetail(
            targetPath,
            buildMergePreviewText(baseContent, content, mergedContent, currentDiskFile.content),
          ),
        })

        if (mergePreview.response === 2) {
          return { status: 'cancelled' }
        }

        if (mergePreview.response === 1) {
          const saveAsResult = await showSaveDialog(parentWindow, {
            defaultPath: defaultFileName,
            filters: [
              { name: messages.fileDialog.markdownFilter, extensions: ['md', 'markdown', 'txt'] },
              { name: messages.fileDialog.allFilesFilter, extensions: ['*'] },
            ],
          })

          if (saveAsResult.canceled || !saveAsResult.filePath) {
            writeLog('INFO', 'ipc', 'save-file cancelled during save-as after merge preview')
            return { status: 'cancelled' }
          }

          targetPath = saveAsResult.filePath
          nextContent = content
        } else {
          nextContent = mergedContent
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await showMessageBox(parentWindow, {
          type: 'error',
          buttons: [messages.buttons.close],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
          title: messages.saveConflict.mergeFailedTitle,
          message: messages.saveConflict.mergeFailedMessage,
          detail: message,
        })
        return {
          status: 'merge-failed',
          message,
        }
      }
    }
  }
  if (!currentPath && (payload?.draftWorkspace || payload?.recoveryKey)) {
    nextContent = await materializeDraftWorkspaceAssets(payload.draftWorkspace, targetPath, nextContent, payload?.recoveryKey)
  }

  if (currentPath && targetPath !== currentPath && payload?.pendingImportedAssets) {
    nextContent = await materializePendingImportedAssets(payload.pendingImportedAssets, currentPath, targetPath, nextContent)
  }

  await fsPromises.writeFile(targetPath, nextContent, 'utf8')
  const stat = await fsPromises.stat(targetPath)
  writeLog('INFO', 'ipc', 'save-file wrote', targetPath)

  return {
    status: 'saved',
    path: targetPath,
    content: nextContent,
    snapshot: buildFileSnapshot(targetPath, nextContent, stat),
  }
}
async function saveHtmlExportToPath(parentWindow, payload) {
  const content = typeof payload?.content === 'string' ? payload.content : ''
  const defaultFileName = typeof payload?.defaultFileName === 'string' && payload.defaultFileName.trim().length > 0
    ? payload.defaultFileName.trim()
    : 'document.html'
  const messages = getMainI18n()
  const result = await showSaveDialog(parentWindow, {
    defaultPath: defaultFileName,
    filters: [
      { name: messages.fileDialog.htmlFilter, extensions: ['html', 'htm'] },
      { name: messages.fileDialog.allFilesFilter, extensions: ['*'] },
    ],
  })

  if (result.canceled || !result.filePath) {
    writeLog('INFO', 'ipc', 'export-html cancelled')
    return null
  }

  await fsPromises.writeFile(result.filePath, content, 'utf8')
  writeLog('INFO', 'ipc', 'export-html wrote', result.filePath)

  return {
    path: result.filePath,
  }
}

async function showUnsavedChangesDialog(window, payload) {
  const messages = getMainI18n()
  const currentFilePath = typeof payload?.currentFilePath === 'string' ? payload.currentFilePath : ''
  const displayTitle = typeof payload?.displayTitle === 'string' && payload.displayTitle.trim().length > 0
    ? payload.displayTitle.trim()
    : messages.untitledTitle
  const proceedLabel = typeof payload?.proceedLabel === 'string' && payload.proceedLabel.trim().length > 0
    ? payload.proceedLabel.trim()
    : messages.buttons.continue
  const detailLines = [
    `${messages.unsaved.file}: ${currentFilePath || displayTitle}`,
    messages.unsaved.hasUnsavedChanges,
  ]
  const response = await showMessageBox(window, {
    type: 'warning',
    buttons: [messages.buttons.save, messages.buttons.cancel, proceedLabel],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: messages.unsaved.title,
    message: messages.unsaved.message(proceedLabel),
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
  const messages = getMainI18n()
  const response = await showMessageBox(window, {
    type: 'warning',
    buttons: [messages.buttons.cancel, messages.buttons.close],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: messages.closeFallback.title,
    message: messages.closeFallback.message,
    detail: messages.closeFallback.detail,
  })

  return response.response === 1
}

async function requestEditorCloseState(editorWindow) {
  return requestEditorWindowData(editorWindow, {
    type: 'get-close-state',
  })
}

function closeAuxiliaryWindowsForEditor(editorWindow) {
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
    await cleanupDraftWorkspace({ draftWorkspace: closeState?.snapshot?.draftWorkspace || null })
    closeAuxiliaryWindowsForEditor(window)
    approveAndCloseWindow(window)
    return
  }

  const messages = getMainI18n()
  const snapshot = closeState.snapshot || {
    markdownText: '',
    persistedMarkdown: '',
    currentFilePath: null,
    pendingImportedAssets: [],
    displayTitle: messages.untitledTitle,
    activePanel: 'write',
    isUntouchedUntitledBuffer: true,
  }
  const response = await showUnsavedChangesDialog(window, {
    currentFilePath: snapshot.currentFilePath,
    displayTitle: snapshot.displayTitle,
    proceedLabel: messages.buttons.close,
  })

  if (response.action === 'cancel') {
    return
  }

  if (response.action === 'save') {
    const saveResult = await saveContentToPath(window, {
      path: snapshot.currentFilePath,
      content: snapshot.markdownText,
      recoveryKey: snapshot.recoveryKey || null,
      defaultFileName: snapshot.displayTitle || messages.untitledTitle,
      expectedSnapshot: snapshot.fileSnapshot || null,
      baseContent: snapshot.persistedMarkdown,
      draftWorkspace: snapshot.draftWorkspace || null,
      pendingImportedAssets: snapshot.pendingImportedAssets || [],
    })

    if (!saveResult || saveResult.status !== 'saved') {
      return
    }

    const referencedAssetPaths = new Set(collectReferencedDraftAssetPaths(saveResult.content))
    await cleanupImportedAssetFiles((snapshot.pendingImportedAssets || [])
      .filter((asset) => typeof asset?.relativePath === 'string' && !referencedAssetPaths.has(asset.relativePath))
      .map((asset) => asset.filePath))

    if (snapshot.currentFilePath && saveResult.path !== snapshot.currentFilePath) {
      await cleanupImportedAssetFiles((snapshot.pendingImportedAssets || []).map((asset) => asset.filePath))
    }

    if (!snapshot.currentFilePath && snapshot.draftWorkspace) {
      await cleanupDraftWorkspace({ draftWorkspace: snapshot.draftWorkspace })
    }

    clearAutosaveRecovery({
      recoveryKey: snapshot.recoveryKey || null,
      filePath: snapshot.currentFilePath || null,
    })

    if (saveResult.path && saveResult.path !== snapshot.currentFilePath) {
      clearAutosaveRecovery({ filePath: saveResult.path })
    }
  }

  if (response.action === 'discard') {
    await cleanupImportedAssetFiles((snapshot.pendingImportedAssets || []).map((asset) => asset.filePath))
    await cleanupDraftWorkspace({ draftWorkspace: snapshot.draftWorkspace || null })
    clearAutosaveRecovery({
      recoveryKey: snapshot.recoveryKey || null,
      filePath: snapshot.currentFilePath || null,
    })
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

  const appMetadata = getAppMetadata()
  const registration = {
    clientId: managedClientId,
    windowId: managedWindowId,
    pid: process.pid,
    filePath: pendingLaunchFilePath,
    version: appMetadata.version,
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
  const [content, stat] = await Promise.all([
    fsPromises.readFile(filePath, 'utf8'),
    fsPromises.stat(filePath),
  ])

  return {
    path: filePath,
    content,
    snapshot: buildFileSnapshot(filePath, content, stat),
  }
}

function buildFileSnapshot(filePath, content, stat) {
  return {
    path: filePath,
    contentHash: hashText(content),
    size: Buffer.byteLength(content, 'utf8'),
    mtimeMs: Number.isFinite(Number(stat?.mtimeMs)) ? Number(stat.mtimeMs) : null,
  }
}

function areFileSnapshotsEqual(left, right) {
  if (!left || !right) {
    return false
  }

  return left.path === right.path
    && left.contentHash === right.contentHash
    && Number(left.size) === Number(right.size)
}

async function readOptionalUtf8File(filePath) {
  try {
    return await readUtf8File(filePath)
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return null
    }

    throw error
  }
}

function getMimeTypeForFile(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.svg':
      return 'image/svg+xml'
    case '.bmp':
      return 'image/bmp'
    case '.ico':
      return 'image/x-icon'
    case '.avif':
      return 'image/avif'
    default:
      return 'application/octet-stream'
  }
}

function isInlineExportImagePath(filePath) {
  return getMimeTypeForFile(filePath).startsWith('image/')
}

async function readRelativeAssetAsDataUrl(baseFilePath, source) {
  const normalizedBasePath = typeof baseFilePath === 'string' ? baseFilePath.trim() : ''
  const normalizedSource = typeof source === 'string' ? source.trim() : ''

  if (!normalizedBasePath || !normalizedSource || normalizedSource.startsWith('//')) {
    return null
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(normalizedSource)) {
    return null
  }

  const sourcePath = normalizedSource.split('#', 1)[0].split('?', 1)[0]
  let decodedSourcePath = sourcePath

  try {
    decodedSourcePath = decodeURI(sourcePath)
  } catch {
    return null
  }

  if (!decodedSourcePath || path.posix.isAbsolute(decodedSourcePath) || path.win32.isAbsolute(decodedSourcePath)) {
    return null
  }

  const resolvedPath = path.resolve(path.dirname(normalizedBasePath), decodedSourcePath)

  if (!isInlineExportImagePath(resolvedPath)) {
    return null
  }

  const content = await fsPromises.readFile(resolvedPath)

  return {
    path: resolvedPath,
    dataUrl: `data:${getMimeTypeForFile(resolvedPath)};base64,${content.toString('base64')}`,
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
  const messages = getMainI18n().menu
  const template = [
    ...(process.platform === 'darwin'
      ? [{ role: 'appMenu' }]
      : []),
    {
      label: messages.file,
      submenu: [
        {
          label: messages.newDocument,
          accelerator: 'CmdOrCtrl+N',
          click: () => sendMenuAction('new-document'),
        },
        { type: 'separator' },
        {
          label: messages.open,
          accelerator: 'CmdOrCtrl+O',
          click: () => sendMenuAction('open'),
        },
        {
          label: messages.save,
          accelerator: 'CmdOrCtrl+S',
          click: () => sendMenuAction('save'),
        },
        {
          label: messages.saveAs,
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => sendMenuAction('save-as'),
        },
        { type: 'separator' },
        {
          label: messages.settings,
          accelerator: 'CmdOrCtrl+,',
          click: () => openSettingsWindow(BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]),
        },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: messages.view,
      submenu: [
        {
          label: messages.aiChat,
          accelerator: 'CmdOrCtrl+I',
          click: () => openAiChatWindow(BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]),
        },
        { type: 'separator' },
        {
          label: messages.editor,
          accelerator: 'CmdOrCtrl+1',
          click: () => sendMenuAction('show-editor'),
        },
        {
          label: messages.renderedPreview,
          accelerator: 'CmdOrCtrl+2',
          click: () => sendMenuAction('show-preview'),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: messages.help,
      submenu: [
        {
          label: messages.about,
          click: () => openAboutWindow(BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]),
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function createWindow(initialLaunchRequest = null) {
  const mainWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    show: !Boolean(initialLaunchRequest?.filePath),
    backgroundColor: '#fffaf4',
    autoHideMenuBar: true,
    icon: windowIcon,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  emitDebugChannelEvent('window:created', {
    windowId: mainWindow.id,
    hiddenForLaunch: Boolean(initialLaunchRequest?.filePath),
  })

  launchStateByWindowId.set(mainWindow.id, {
    filePath: initialLaunchRequest?.filePath || null,
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

  if (initialLaunchRequest?.filePath) {
    const revealTimer = setTimeout(() => {
      hiddenLaunchRevealTimerByWindowId.delete(mainWindow.id)

      if (mainWindow.isDestroyed() || mainWindow.isVisible()) {
        return
      }

      writeLog('WARN', 'main', 'Revealing hidden launch window after startup timeout', initialLaunchRequest.filePath)
      mainWindow.show()
      focusWindow(mainWindow)
    }, 1500)

    hiddenLaunchRevealTimerByWindowId.set(mainWindow.id, revealTimer)
  }

  mainWindow.on('closed', () => {
    emitDebugChannelEvent('window:closed', { windowId: mainWindow.id })
    const revealTimer = hiddenLaunchRevealTimerByWindowId.get(mainWindow.id)
    if (revealTimer) {
      clearTimeout(revealTimer)
      hiddenLaunchRevealTimerByWindowId.delete(mainWindow.id)
    }

    approvedWindowCloseIds.delete(mainWindow.id)
    pendingWindowCloseIds.delete(mainWindow.id)
    launchStateByWindowId.delete(mainWindow.id)
    if (settingsWindowOwnerEditorId === mainWindow.id) {
      settingsWindowOwnerEditorId = null
    }
    if (fetchPermissionsWindowOwnerEditorId === mainWindow.id) {
      fetchPermissionsWindowOwnerEditorId = null
    }
    if (aboutWindowOwnerEditorId === mainWindow.id) {
      aboutWindowOwnerEditorId = null
    }

    clearEditorRuntimeState(mainWindow.id)

    if (!getDefaultEditorWindow() && settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.close()
    }
    if (!getDefaultEditorWindow() && fetchPermissionsWindow && !fetchPermissionsWindow.isDestroyed()) {
      fetchPermissionsWindow.close()
    }
    if (!getDefaultEditorWindow() && aboutWindow && !aboutWindow.isDestroyed()) {
      aboutWindow.close()
    }
  })
  managedMainWindow = mainWindow
  writeLog('INFO', 'main', 'BrowserWindow created')

  mainWindow.once('ready-to-show', () => {
    emitDebugChannelEvent('window:ready-to-show', { windowId: mainWindow.id })
  })

  mainWindow.webContents.on('did-finish-load', () => {
    emitDebugChannelEvent('window:did-finish-load', {
      windowId: mainWindow.id,
      url: mainWindow.webContents.getURL(),
    })

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

registerMainIpcHandlers({
  ipcMain,
  BrowserWindow,
  app,
  randomUUID,
  writeLog,
  getMainI18n,
  showOpenDialog,
  findEditorWindowByTrackedFilePath,
  focusWindow,
  readUtf8File,
  emitDebugChannelEvent,
  upsertAutosaveRecovery,
  clearAutosaveRecovery,
  getLatestAutosaveRecovery,
  getAutosaveRecoveryForFile,
  getMdastCapabilities,
  extractHeadingOutline,
  trackCurrentFileForWindow,
  readRelativeAssetAsDataUrl,
  hiddenLaunchRevealTimerByWindowId,
  saveHtmlExportToPath,
  openSettingsWindow,
  openFetchPermissionsWindow,
  openAboutWindow,
  launchStateByWindowId,
  getSettingsState: () => settingsState,
  getHasPersistedSettings,
  getHasReadableSettings,
  getUpdaterStateSnapshot,
  checkForAppUpdates,
  downloadAvailableUpdate,
  installDownloadedUpdate,
  sanitizeSettings,
  mergePlainObjects,
  isPlainObject,
  persistSettings,
  broadcastSettingsChanged,
  normalizeSecret,
  getSecretsState: () => secretsState,
  setSecretsState: (nextSecretsState) => {
    settingsController.setSecretsState(nextSecretsState)
    secretsState = nextSecretsState
  },
  sanitizeSecrets,
  persistSecrets,
  getProviderStatus,
  getAppMetadata,
  getEditorWindowForAiAction,
  requestEditorContext,
  ensureEditorRuntimeState,
  readAiTargetForWindow,
  exactSearchForWindow,
  statsAiSliceForWindow,
  semanticSearchForWindow,
  writeAiTargetForWindow,
  listAiBuffersForWindow,
  requestOpenAiChatResponse,
  emitAiChatStreamEvent,
  openExternalLink,
  ensureDraftWorkspace,
  importImageAsset,
  cleanupImportedAssetFiles,
  cleanupDraftWorkspace,
  saveContentToPath,
  showUnsavedChangesDialog,
  pendingAiEditorRequests,
  isManagedClient,
  pendingServerRequests,
  managedClientId,
  postServerJson,
  logFilePath,
  setSettingsState: (nextSettingsState) => {
    settingsController.setSettingsState(nextSettingsState)
    settingsState = nextSettingsState
  },
})
registerAppLifecycle({
  app,
  BrowserWindow,
  writeLog,
  processRef: process,
  resolveLaunchRequest,
  findEditorWindowByTrackedFilePath,
  focusWindow,
  isManagedClient,
  createWindow,
  getDefaultEditorWindow,
  queueOrDispatchOpenFile,
  startDebugChannelServer,
  emitDebugChannelEvent,
  initializeAutoUpdater,
  createApplicationMenu,
  getPendingLaunchRequest: () => pendingLaunchRequest,
  clearPendingLaunchRequest: () => {
    pendingLaunchRequest = null
  },
  stopDebugChannelServer,
  flushAutosaveRecoveryStoreSync,
  clearCommandPollTimer: () => {
    if (commandPollTimer) {
      clearInterval(commandPollTimer)
      commandPollTimer = null
    }
  },
  isDev,
  forceStaticRenderer,
})
