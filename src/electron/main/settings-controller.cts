// @ts-nocheck
const fs = require('node:fs')
const fsPromises = require('node:fs/promises')
const path = require('node:path')

function createSettingsController(options) {
  const {
    settingsPath,
    secretsPath,
    defaultOpenAiModel,
    defaultUpdateFeedUrl,
    appLocale,
    createDefaultFetchAclText,
    migrateLegacyFetchConfig,
    assertSafeFetchAclText,
    DEFAULT_FETCH_REQUEST_TIMEOUT_MS,
    DEFAULT_FETCH_IDLE_TIMEOUT_MS,
    DEFAULT_FETCH_AUTO_DISPOSE_AFTER_MS,
    DEFAULT_FETCH_MAX_RESPONSE_BYTES,
    writeLog,
  } = options

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

  function normalizeLocale(value) {
    return typeof value === 'string' && value.toLowerCase().startsWith('ja') ? 'ja' : 'en'
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

  function clampEditorFontSizePx(value) {
    const numericValue = Number(value)
    if (!Number.isFinite(numericValue)) {
      return 13
    }
    return Math.min(18, Math.max(11, Math.round(numericValue)))
  }

  function clampChatFontSizePx(value) {
    const numericValue = Number(value)
    if (!Number.isFinite(numericValue)) {
      return 12
    }
    return Math.min(16, Math.max(11, Math.round(numericValue)))
  }

  function normalizeWriteMode(value) {
    return value === 'suggest' ? 'suggest' : 'direct'
  }

  function normalizeOpenAiModel(value) {
    if (typeof value !== 'string') {
      return defaultOpenAiModel
    }

    const trimmedValue = value.trim()
    return trimmedValue.length === 0 ? defaultOpenAiModel : trimmedValue
  }

  function normalizeSearchDepth(value) {
    return value === 'advanced' ? 'advanced' : 'basic'
  }

  function normalizeSecret(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
  }

  function normalizeUpdateFeedUrl(value) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return null
    }

    try {
      const parsed = new URL(value.trim())
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return null
      }
      return parsed.toString().replace(/\/$/, '')
    } catch {
      return null
    }
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

  function normalizeFetchAclTextSetting(candidateFetch, fallbackFetch) {
    if (isPlainObject(candidateFetch) && Object.prototype.hasOwnProperty.call(candidateFetch, 'aclText') && typeof candidateFetch.aclText === 'string') {
      return assertSafeFetchAclText(candidateFetch.aclText)
    }

    const hasLegacyFetchFields = isPlainObject(candidateFetch)
      && (
        Object.prototype.hasOwnProperty.call(candidateFetch, 'allowedUrlRules')
        || Object.prototype.hasOwnProperty.call(candidateFetch, 'allowedMethods')
        || Object.prototype.hasOwnProperty.call(candidateFetch, 'allowedHeaders')
      )

    if (hasLegacyFetchFields) {
      return assertSafeFetchAclText(migrateLegacyFetchConfig(candidateFetch))
    }

    return assertSafeFetchAclText(fallbackFetch?.aclText)
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

  function createDefaultSettings() {
    return {
      version: 3,
      general: {
        locale: normalizeLocale(appLocale),
        themeMode: 'system',
        defaultStartPanel: 'write',
        openLinksBehavior: 'confirm-if-untrusted',
      },
      editor: {
        initialEditType: 'markdown',
        showModeSwitch: true,
        previewStyle: 'tab',
        fontSizePx: 13,
      },
      ai: {
        defaultWriteMode: 'direct',
        chatFontSizePx: 12,
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
          aclText: createDefaultFetchAclText(),
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
      updates: {
        enabled: true,
        autoCheckOnLaunch: true,
        feedUrl: normalizeUpdateFeedUrl(defaultUpdateFeedUrl),
      },
    }
  }

  function sanitizeSettings(candidate) {
    const defaults = createDefaultSettings()
    const merged = isPlainObject(candidate) ? mergePlainObjects(defaults, candidate) : defaults
    const toolPermissions = merged.ai?.toolPermissions
    const hasExplicitSliceSearch = isPlainObject(toolPermissions) && Object.prototype.hasOwnProperty.call(toolPermissions, 'sliceSearch')
    const normalizedSliceSearch = hasExplicitSliceSearch ? toolPermissions.sliceSearch !== false : true

    return {
      version: 3,
      general: {
        locale: normalizeLocale(merged.general?.locale),
        themeMode: normalizeThemeMode(merged.general?.themeMode),
        defaultStartPanel: normalizeStartPanel(merged.general?.defaultStartPanel),
        openLinksBehavior: normalizeOpenLinksBehavior(merged.general?.openLinksBehavior),
      },
      editor: {
        initialEditType: normalizeInitialEditType(merged.editor?.initialEditType),
        showModeSwitch: merged.editor?.showModeSwitch !== false,
        previewStyle: normalizePreviewStyle(merged.editor?.previewStyle),
        fontSizePx: clampEditorFontSizePx(merged.editor?.fontSizePx),
      },
      ai: {
        defaultWriteMode: normalizeWriteMode(merged.ai?.defaultWriteMode),
        chatFontSizePx: clampChatFontSizePx(merged.ai?.chatFontSizePx),
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
          aclText: normalizeFetchAclTextSetting(candidate?.ai?.fetch, defaults.ai.fetch),
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
      updates: {
        enabled: merged.updates?.enabled !== false,
        autoCheckOnLaunch: merged.updates?.autoCheckOnLaunch !== false,
        feedUrl: normalizeUpdateFeedUrl(merged.updates?.feedUrl),
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

  let settingsState = loadSettings()
  let secretsState = loadSecrets()
  let hasPersistedSettings = fs.existsSync(settingsPath)
  let hasReadableSettings = loadSettings.didLoadPersisted === true

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
      openaiConfigured: secretsState.openaiApiKey !== null,
      tavilyConfigured: secretsState.tavilyApiKey !== null,
    }
  }

  return {
    createDefaultSettings,
    getHasPersistedSettings: () => hasPersistedSettings,
    getHasReadableSettings: () => hasReadableSettings,
    getProviderStatus,
    getSecretsState: () => secretsState,
    getSettingsState: () => settingsState,
    isPlainObject,
    mergePlainObjects,
    normalizeAllowedHeaderList,
    normalizeAllowedMethodList,
    normalizeSecret,
    persistSecrets,
    persistSettings,
    sanitizeSecrets,
    sanitizeSettings,
    setSecretsState: (nextSecretsState) => {
      secretsState = nextSecretsState
    },
    setSettingsState: (nextSettingsState) => {
      settingsState = nextSettingsState
    },
  }
}

export {
  createSettingsController,
}
