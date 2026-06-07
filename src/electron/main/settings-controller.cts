const fs = require('node:fs') as typeof import('node:fs')
const fsPromises = require('node:fs/promises') as typeof import('node:fs/promises')
const path = require('node:path') as typeof import('node:path')

type ThemeMode = 'light' | 'dark' | 'system'
type LocaleCode = 'ja' | 'en'
type StartPanel = 'preview' | 'write'
type OpenLinksBehavior = 'block-untrusted' | 'confirm-if-untrusted'
type InitialEditType = 'wysiwyg' | 'markdown'
type PreviewStyle = 'vertical' | 'tab'
type WriteMode = 'suggest' | 'direct'
type SearchDepth = 'advanced' | 'basic'

type FetchSettings = {
  aclText: string
  requestTimeoutMs: number
  idleTimeoutMs: number
  autoDisposeAfterMs: number
  maxResponseBytes: number
}

type ToolPermissions = {
  readActiveDocument: boolean
  readActiveSelection: boolean
  writeActiveDocument: boolean
  writeActiveSelection: boolean
  writeNewDocument: boolean
  sliceSearch: boolean
  workspaceGrep: boolean
  tavilyWebSearch: boolean
  fetchUrl: boolean
}

type SettingsState = {
  version: 3
  general: {
    locale: LocaleCode
    themeMode: ThemeMode
    defaultStartPanel: StartPanel
    openLinksBehavior: OpenLinksBehavior
  }
  editor: {
    initialEditType: InitialEditType
    showModeSwitch: boolean
    previewStyle: PreviewStyle
    fontSizePx: number
  }
  ai: {
    defaultWriteMode: WriteMode
    chatFontSizePx: number
    toolPermissions: ToolPermissions
    openai: {
      enabled: boolean
      baseUrl: string | null
      model: string
    }
    tavily: {
      enabled: boolean
      defaultSearchDepth: SearchDepth
      defaultMaxResults: number
    }
    fetch: FetchSettings
  }
  safety: {
    confirmBeforeFullDocumentOverwrite: boolean
    confirmBeforeNewDocumentFromAi: boolean
    confirmBeforeExternalUrlOpen: boolean
  }
  updates: {
    enabled: boolean
    autoCheckOnLaunch: boolean
    feedUrl: string | null
  }
}

type SecretsState = {
  openaiApiKey: string | null
  tavilyApiKey: string | null
}

type ProviderStatus = {
  openaiConfigured: boolean
  tavilyConfigured: boolean
}

type LegacyFetchConfig = Record<string, unknown>
type PlainObject = Record<string, unknown>
type SettingsControllerOptions = {
  settingsPath: string
  secretsPath: string
  defaultOpenAiModel: string
  defaultUpdateFeedUrl: string | null
  appLocale: string
  createDefaultFetchAclText: () => string
  migrateLegacyFetchConfig: (candidateFetch: LegacyFetchConfig) => string
  assertSafeFetchAclText: (value: unknown) => string
  DEFAULT_FETCH_REQUEST_TIMEOUT_MS: number
  DEFAULT_FETCH_IDLE_TIMEOUT_MS: number
  DEFAULT_FETCH_AUTO_DISPOSE_AFTER_MS: number
  DEFAULT_FETCH_MAX_RESPONSE_BYTES: number
  writeLog: (level: string, scope: string, ...parts: unknown[]) => void
}

type SettingsController = {
  createDefaultSettings: () => SettingsState
  getHasPersistedSettings: () => boolean
  getHasReadableSettings: () => boolean
  getProviderStatus: () => ProviderStatus
  getSecretsState: () => SecretsState
  getSettingsState: () => SettingsState
  isPlainObject: (value: unknown) => value is PlainObject
  mergePlainObjects: <T>(base: T, patch: unknown) => T
  normalizeAllowedHeaderList: (value: unknown) => string[]
  normalizeAllowedMethodList: (value: unknown) => string[]
  normalizeSecret: (value: unknown) => string | null
  persistSecrets: () => Promise<void>
  persistSettings: () => Promise<void>
  sanitizeSecrets: (candidate: Record<string, unknown> | null | undefined) => SecretsState
  sanitizeSettings: (candidate: Record<string, unknown> | null | undefined) => SettingsState
  setSecretsState: (nextSecretsState: SecretsState) => void
  setSettingsState: (nextSettingsState: SettingsState) => void
}

type LoadSettingsFn = (() => SettingsState) & { didLoadPersisted?: boolean }

function createSettingsController(options: SettingsControllerOptions): SettingsController {
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

  function isPlainObject(value: unknown): value is PlainObject {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  }

  function mergePlainObjects<T>(base: T, patch: unknown): T {
    if (!isPlainObject(base) || !isPlainObject(patch)) {
      return patch as T
    }

    const merged: PlainObject = { ...base }

    for (const [key, value] of Object.entries(patch)) {
      const currentValue = merged[key]

      if (isPlainObject(value) && isPlainObject(currentValue)) {
        merged[key] = mergePlainObjects(currentValue, value)
        continue
      }

      merged[key] = value
    }

    return merged as T
  }

  function normalizeThemeMode(value: unknown): ThemeMode {
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
  }

  function normalizeLocale(value: unknown): LocaleCode {
    return typeof value === 'string' && value.toLowerCase().startsWith('ja') ? 'ja' : 'en'
  }

  function normalizeStartPanel(value: unknown): StartPanel {
    return value === 'preview' ? 'preview' : 'write'
  }

  function normalizeOpenLinksBehavior(value: unknown): OpenLinksBehavior {
    return value === 'block-untrusted' ? 'block-untrusted' : 'confirm-if-untrusted'
  }

  function normalizeInitialEditType(value: unknown): InitialEditType {
    return value === 'wysiwyg' ? 'wysiwyg' : 'markdown'
  }

  function normalizePreviewStyle(value: unknown): PreviewStyle {
    return value === 'vertical' ? 'vertical' : 'tab'
  }

  function clampEditorFontSizePx(value: unknown) {
    const numericValue = Number(value)
    if (!Number.isFinite(numericValue)) {
      return 13
    }
    return Math.min(18, Math.max(11, Math.round(numericValue)))
  }

  function clampChatFontSizePx(value: unknown) {
    const numericValue = Number(value)
    if (!Number.isFinite(numericValue)) {
      return 12
    }
    return Math.min(16, Math.max(11, Math.round(numericValue)))
  }

  function normalizeWriteMode(value: unknown): WriteMode {
    return value === 'suggest' ? 'suggest' : 'direct'
  }

  function normalizeOpenAiModel(value: unknown) {
    if (typeof value !== 'string') {
      return defaultOpenAiModel
    }

    const trimmedValue = value.trim()
    return trimmedValue.length === 0 ? defaultOpenAiModel : trimmedValue
  }

  function normalizeSearchDepth(value: unknown): SearchDepth {
    return value === 'advanced' ? 'advanced' : 'basic'
  }

  function normalizeSecret(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
  }

  function normalizeUpdateFeedUrl(value: unknown) {
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

  function clampDefaultMaxResults(value: unknown) {
    const numericValue = Number(value)
    if (!Number.isFinite(numericValue)) {
      return 5
    }
    return Math.min(10, Math.max(1, Math.round(numericValue)))
  }

  function sanitizeStringList(value: unknown) {
    if (!Array.isArray(value)) {
      return []
    }

    return Array.from(new Set(value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)))
  }

  function normalizeAllowedMethodList(value: unknown) {
    const normalized = sanitizeStringList(value)
      .map((entry) => entry.toUpperCase())
      .filter((entry) => /^[A-Z]+$/.test(entry))

    return normalized.length > 0 ? normalized : ['GET']
  }

  function normalizeAllowedHeaderList(value: unknown) {
    return sanitizeStringList(value)
      .map((entry) => entry.toLowerCase())
      .filter((entry) => /^[a-z0-9-]+$/.test(entry))
  }

  function normalizeFetchAclTextSetting(candidateFetch: unknown, fallbackFetch: FetchSettings) {
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

    return assertSafeFetchAclText(fallbackFetch.aclText)
  }

  function clampFetchTimeoutMs(value: unknown, fallback: number) {
    const numericValue = Number(value)
    if (!Number.isFinite(numericValue)) {
      return fallback
    }
    return Math.min(120_000, Math.max(1_000, Math.round(numericValue)))
  }

  function clampFetchAutoDisposeMs(value: unknown) {
    const numericValue = Number(value)
    if (!Number.isFinite(numericValue)) {
      return DEFAULT_FETCH_AUTO_DISPOSE_AFTER_MS
    }
    return Math.min(24 * 60 * 60_000, Math.max(10_000, Math.round(numericValue)))
  }

  function clampFetchResponseBytes(value: unknown) {
    const numericValue = Number(value)
    if (!Number.isFinite(numericValue)) {
      return DEFAULT_FETCH_MAX_RESPONSE_BYTES
    }
    return Math.min(4 * 1024 * 1024, Math.max(16 * 1024, Math.round(numericValue)))
  }

  function createDefaultSettings(): SettingsState {
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

  function sanitizeSettings(candidate: Record<string, unknown> | null | undefined): SettingsState {
    const defaults = createDefaultSettings()
    const merged = isPlainObject(candidate) ? mergePlainObjects(defaults, candidate) : defaults
    const candidateAi = isPlainObject(candidate?.ai) ? candidate.ai : null
    const candidateFetch = isPlainObject(candidateAi?.fetch) ? candidateAi.fetch : null
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
          aclText: normalizeFetchAclTextSetting(candidateFetch, defaults.ai.fetch),
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

  function sanitizeSecrets(candidate: Record<string, unknown> | null | undefined): SecretsState {
    return {
      openaiApiKey: normalizeSecret(candidate?.openaiApiKey),
      tavilyApiKey: normalizeSecret(candidate?.tavilyApiKey),
    }
  }

  const loadSettings: LoadSettingsFn = function loadSettings() {
    try {
      if (!fs.existsSync(settingsPath)) {
        loadSettings.didLoadPersisted = false
        return createDefaultSettings()
      }

      const raw = fs.readFileSync(settingsPath, 'utf8')
      loadSettings.didLoadPersisted = true
      return sanitizeSettings(JSON.parse(raw) as Record<string, unknown>)
    } catch (error) {
      loadSettings.didLoadPersisted = false
      writeLog('WARN', 'settings', 'Falling back to default settings', error instanceof Error ? error.message : String(error))
      return createDefaultSettings()
    }
  }

  loadSettings.didLoadPersisted = false

  function loadSecrets(): SecretsState {
    try {
      if (!fs.existsSync(secretsPath)) {
        return sanitizeSecrets({})
      }

      const raw = fs.readFileSync(secretsPath, 'utf8')
      return sanitizeSecrets(JSON.parse(raw) as Record<string, unknown>)
    } catch (error) {
      writeLog('WARN', 'settings', 'Falling back to empty secrets store', error instanceof Error ? error.message : String(error))
      return sanitizeSecrets({})
    }
  }

  let settingsState = loadSettings()
  let secretsState = loadSecrets()
  let hasPersistedSettings = fs.existsSync(settingsPath)
  let hasReadableSettings = Boolean(loadSettings.didLoadPersisted)

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

  function getProviderStatus(): ProviderStatus {
    const openAiApiKey = secretsState.openaiApiKey
      || (typeof process.env.OPENAI_API_KEY === 'string' && process.env.OPENAI_API_KEY.trim().length > 0
        ? process.env.OPENAI_API_KEY.trim()
        : null)
    const tavilyApiKey = secretsState.tavilyApiKey
      || (typeof process.env.TAVILY_API_KEY === 'string' && process.env.TAVILY_API_KEY.trim().length > 0
        ? process.env.TAVILY_API_KEY.trim()
        : null)

    return {
      openaiConfigured: openAiApiKey !== null,
      tavilyConfigured: tavilyApiKey !== null,
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
