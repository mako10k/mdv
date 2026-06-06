const path = require('node:path') as typeof import('node:path')

type AppPathName = 'userData' | 'logs'

type AppLike = {
  isPackaged: boolean
  setPath: (name: AppPathName, value: string) => void
  disableHardwareAcceleration: () => void
  commandLine: {
    appendSwitch: (value: string) => void
  }
  setName: (value: string) => void
  setAppLogsPath: (value?: string) => void
  getPath: (name: AppPathName) => string
}

type ConfigureMainProcessAppOptions = {
  e2eUserDataPath: string | null
  appDisplayName: string
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

function configureMainProcessApp(app: AppLike, options: ConfigureMainProcessAppOptions) {
  const e2eUserDataPath = options.e2eUserDataPath

  if (e2eUserDataPath) {
    app.setPath('userData', e2eUserDataPath)
  }

  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
  app.setName(options.appDisplayName)
  app.setAppLogsPath(e2eUserDataPath ? path.join(e2eUserDataPath, 'logs') : undefined)
}

function createMainProcessRuntime(app: AppLike): MainProcessRuntime {
  const e2eUserDataPath = resolveOptionalAbsoluteEnvPath(process.env.MDV_E2E_USER_DATA_DIR)
  const forceStaticRenderer = process.env.MDV_FORCE_STATIC_RENDERER === '1'
  const debugChannelPort = resolveDebugChannelPort(process.env.MDV_DEBUG_CHANNEL_PORT)
  const managedServerUrl = process.env.MDV_SERVER_URL || null
  const managedClientId = process.env.MDV_CLIENT_ID || null
  const managedWindowId = process.env.MDV_WINDOW_ID || managedClientId || null
  const appDisplayName = 'MarkDownViewer'
  const defaultOpenAiModel = process.env.MDV_OPENAI_MODEL || 'gpt-5.4-mini'
  const defaultUpdateFeedUrl = process.env.MDV_UPDATE_FEED_URL || 'https://github.com/mako10k/mdv/releases/latest/download'

  configureMainProcessApp(app, { appDisplayName, e2eUserDataPath })

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
