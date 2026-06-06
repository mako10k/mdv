type BrowserWindowLike = {
  isDestroyed: () => boolean
  webContents: {
    send: (channel: string, payload: unknown) => void
  }
}

type ManagedServerCommand = {
  requestId?: string
  type?: string
}

type ManagedServerRequestRecord = {
  type: 'suspend' | 'resume'
}

type ManagedClientControllerOptions = {
  fetch: typeof fetch
  URL: typeof URL
  processRef: Pick<NodeJS.Process, 'pid'>
  setInterval: typeof setInterval
  clearInterval: typeof clearInterval
  managedServerUrl: string | null
  managedClientId: string
  managedWindowId: string
  getPendingLaunchFilePath: () => string | null
  getAppMetadata: () => { version?: string | null } | Promise<{ version?: string | null }>
  writeLog: (level: string, scope: string, ...parts: unknown[]) => void
}

type ManagedClientController = {
  isManagedClient: () => boolean
  setManagedMainWindow: (window: BrowserWindowLike | null) => void
  registerManagedClient: (window: BrowserWindowLike | null) => Promise<void>
  pendingServerRequests: Map<string, ManagedServerRequestRecord>
  postServerJson: (routePath: string, payload: unknown) => Promise<unknown>
  clearCommandPollTimer: () => void
}

function createManagedClientController(options: ManagedClientControllerOptions): ManagedClientController {
  const {
    fetch,
    URL,
    processRef,
    setInterval,
    clearInterval,
    managedServerUrl,
    managedClientId,
    managedWindowId,
    getPendingLaunchFilePath,
    getAppMetadata,
    writeLog,
  } = options

  let managedMainWindow: BrowserWindowLike | null = null
  let commandPollTimer: ReturnType<typeof setInterval> | null = null
  const pendingServerRequests = new Map<string, ManagedServerRequestRecord>()

  function isManagedClient() {
    return Boolean(managedServerUrl && managedClientId && managedWindowId)
  }

  function setManagedMainWindow(window: BrowserWindowLike | null) {
    managedMainWindow = window
  }

  function dispatchServerCommand(command: unknown) {
    if (!managedMainWindow || managedMainWindow.isDestroyed()) {
      return
    }

    managedMainWindow.webContents.send('mdv:server-command', command)
  }

  async function postServerJson(routePath: string, payload: unknown) {
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

  async function getServerJson(routePath: string) {
    if (!managedServerUrl) {
      return null
    }

    const response = await fetch(new URL(routePath, managedServerUrl))

    if (!response.ok) {
      throw new Error(`Server request failed: ${response.status} ${routePath}`)
    }

    return response.json()
  }

  async function handleManagedServerCommand(window: BrowserWindowLike | null, command: ManagedServerCommand | null) {
    if (!window || !command || typeof command.type !== 'string') {
      return
    }

    writeLog('INFO', 'server-client', 'command', command)

    if ((command.type === 'suspend' || command.type === 'resume') && typeof command.requestId === 'string') {
      pendingServerRequests.set(command.requestId, { type: command.type })
      dispatchServerCommand(command)
    }
  }

  async function pollManagedServerCommands(window: BrowserWindowLike | null) {
    if (!isManagedClient() || !window || window.isDestroyed()) {
      return
    }

    const payload = await getServerJson(`/api/clients/${encodeURIComponent(managedClientId)}/commands`) as {
      commands?: ManagedServerCommand[]
    } | null
    const commands = Array.isArray(payload?.commands) ? payload.commands : []

    for (const command of commands) {
      await handleManagedServerCommand(window, command)
    }
  }

  async function registerManagedClient(window: BrowserWindowLike | null) {
    if (!window || !isManagedClient()) {
      return
    }

    const appMetadata = await getAppMetadata()
    const registration = {
      clientId: managedClientId,
      windowId: managedWindowId,
      pid: processRef.pid,
      filePath: getPendingLaunchFilePath(),
      version: appMetadata?.version ?? null,
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

  function clearCommandPollTimer() {
    if (commandPollTimer) {
      clearInterval(commandPollTimer)
      commandPollTimer = null
    }
  }

  return {
    isManagedClient,
    setManagedMainWindow,
    registerManagedClient,
    pendingServerRequests,
    postServerJson,
    clearCommandPollTimer,
  }
}

export { createManagedClientController }
