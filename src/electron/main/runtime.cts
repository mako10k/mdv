const fs = require('node:fs') as typeof import('node:fs')
const path = require('node:path') as typeof import('node:path')

type AppSetPathName = 'userData' | 'logs'
type AppGetPathName = 'appData' | 'userData' | 'logs'

type AppLike = {
  isPackaged: boolean
  setPath: (name: AppSetPathName, value: string) => void
  disableHardwareAcceleration: () => void
  commandLine: {
    appendSwitch: (value: string) => void
  }
  setName: (value: string) => void
  setAppLogsPath: (value?: string) => void
  getPath: (name: AppGetPathName) => string
}

type ConfigureMainProcessAppOptions = {
  e2eUserDataPath: string | null
  appDisplayName: string
  legacyUserDataDirName: string
}

type MainProcessRuntime = {
  e2eUserDataPath: string | null
  forceStaticRenderer: boolean
  debugChannelPort: number | null
  managedServerUrl: string | null
  managedClientId: string | null
  managedWindowId: string | null
  appDisplayName: string
  defaultOpenAiModel: string
  defaultUpdateFeedUrl: string
  isDev: boolean
  windowIcon: string
  logFilePath: string
  allowedLinkRulesPath: string
  settingsPath: string
  secretsPath: string
  semanticCachePath: string
  autosaveRecoveryPath: string
  stateRootPath: string
  draftWorkspaceRootPath: string
}

function resolveOptionalAbsoluteEnvPath(rawValue: unknown) {
  return typeof rawValue === 'string' && rawValue.trim().length > 0
    ? path.resolve(rawValue.trim())
    : null
}

function resolveDebugChannelPort(rawValue: unknown) {
  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    return null
  }

  const parsedPort = Number.parseInt(rawValue.trim(), 10)

  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    return null
  }

  return parsedPort
}

function resolveUserDataPath(app: AppLike, options: ConfigureMainProcessAppOptions) {
  // ENG-BL-001 / user-data migration policy:
  // - Existing users may have data under the legacy "mdv" folder (from early 0.x builds).
  // - Prefer that folder if it exists on disk (upgrade continuity, no data loss/migration).
  // - Otherwise fall back to the branded "MarkDownViewer" folder (or create legacy for new installs
  //   so that the on-disk name stays stable across the 0.x line).
  // - E2E overrides via MDV_E2E_USER_DATA_DIR bypass this entirely.
  // This is a *persistent default*, not a one-time migration. Documented here because the policy
  // affects settings, secrets, recovery, drafts, logs, semantic cache, etc. for all users.
  // See also: DEVELOPMENT.md (paths), the GitHub #1 title/AI fixes that touched launch paths,
  // and tests/node/electron-main-runtime.spec.mjs for the two cases (legacy present vs. absent).
  if (options.e2eUserDataPath) {
    return options.e2eUserDataPath
  }

  const appDataPath = app.getPath('appData')
  const legacyUserDataPath = path.join(appDataPath, options.legacyUserDataDirName)
  const brandedUserDataPath = path.join(appDataPath, options.appDisplayName)

  if (fs.existsSync(legacyUserDataPath)) {
    return legacyUserDataPath
  }

  if (fs.existsSync(brandedUserDataPath)) {
    return brandedUserDataPath
  }

  return legacyUserDataPath
}

function configureMainProcessApp(app: AppLike, options: ConfigureMainProcessAppOptions) {
  const userDataPath = resolveUserDataPath(app, options)
  app.setPath('userData', userDataPath)

  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
  app.setName(options.appDisplayName)
  app.setAppLogsPath(path.join(userDataPath, 'logs'))
}

function createMainProcessRuntime(app: AppLike): MainProcessRuntime {
  const e2eUserDataPath = resolveOptionalAbsoluteEnvPath(process.env.MDV_E2E_USER_DATA_DIR)
  const forceStaticRenderer = process.env.MDV_FORCE_STATIC_RENDERER === '1'
  const debugChannelPort = resolveDebugChannelPort(process.env.MDV_DEBUG_CHANNEL_PORT)
  const managedServerUrl = process.env.MDV_SERVER_URL || null
  const managedClientId = process.env.MDV_CLIENT_ID || null
  const managedWindowId = process.env.MDV_WINDOW_ID || managedClientId || null
  const appDisplayName = 'MarkDownViewer'
  const legacyUserDataDirName = 'mdv'
  const defaultOpenAiModel = process.env.MDV_OPENAI_MODEL || 'gpt-5.4-mini'
  const defaultUpdateFeedUrl = process.env.MDV_UPDATE_FEED_URL || 'https://github.com/mako10k/mdv/releases/latest/download'

  configureMainProcessApp(app, { appDisplayName, e2eUserDataPath, legacyUserDataDirName })

  return {
    e2eUserDataPath,
    forceStaticRenderer,
    debugChannelPort,
    managedServerUrl,
    managedClientId,
    managedWindowId,
    appDisplayName,
    defaultOpenAiModel,
    defaultUpdateFeedUrl,
    isDev: !app.isPackaged && !forceStaticRenderer,
    windowIcon: path.join(__dirname, '..', '..', '..', 'build', 'icon.png'),
    logFilePath: path.join(app.getPath('logs'), 'mdv.log'),
    allowedLinkRulesPath: path.join(app.getPath('userData'), 'allowed-link-rules.json'),
    settingsPath: path.join(app.getPath('userData'), 'settings.json'),
    secretsPath: path.join(app.getPath('userData'), 'secrets.json'),
    semanticCachePath: path.join(app.getPath('userData'), 'semantic-cache-v1.json'),
    autosaveRecoveryPath: path.join(app.getPath('userData'), 'autosave-recovery-v1.json'),
    stateRootPath: path.join(app.getPath('userData'), 'state'),
    draftWorkspaceRootPath: path.join(app.getPath('userData'), 'state', 'drafts'),
  }
}

export {
  createMainProcessRuntime,
  resolveDebugChannelPort,
}
