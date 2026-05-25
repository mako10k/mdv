const http = require('node:http')
const os = require('node:os')
const fs = require('node:fs')
const fsPromises = require('node:fs/promises')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')

const cliOptions = parseCliOptions(process.argv.slice(2))
const runtimeDir = process.env.MDV_SERVER_RUNTIME_DIR || path.join(os.homedir(), '.mdv-server')
const stateFilePath = path.join(runtimeDir, 'state.json')
const host = cliOptions.host || process.env.MDV_SERVER_HOST || '127.0.0.1'
const port = Number.parseInt(cliOptions.port || process.env.MDV_SERVER_PORT || '45931', 10)
const restoreStatePath = cliOptions['restore-state'] || null
const logFilePath = path.join(runtimeDir, 'mdv-server.log')
const commandPollTimeoutMs = 300

const state = loadInitialState()
let server = null
let shuttingDown = false

main().catch((error) => {
  writeLog('ERROR', 'bootstrap', error)
  process.exitCode = 1
})

async function main() {
  fs.mkdirSync(runtimeDir, { recursive: true })
  writeLog('INFO', 'bootstrap', {
    pid: process.pid,
    host,
    port,
    runtimeDir,
    restoreStatePath,
    scriptPath: __filename,
  })

  server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      writeLog('ERROR', 'http', error)
      writeJson(res, 500, { error: 'internal_error', message: error.message })
    })
  })

  await listenWithRetry(server, host, port, Boolean(restoreStatePath))
  writeLog('INFO', 'bootstrap', 'listening', { host, port })
}

function parseCliOptions(argv) {
  const options = {}

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]

    if (!token.startsWith('--')) {
      continue
    }

    const optionName = token.slice(2)
    const optionValue = argv[index + 1]

    if (!optionValue || optionValue.startsWith('--')) {
      options[optionName] = 'true'
      continue
    }

    options[optionName] = optionValue
    index += 1
  }

  return options
}

function loadInitialState() {
  const fallbackState = {
    server: {
      activeScriptPath: __filename,
      preparedCopyPath: null,
      lastHandoffAt: null,
      versionTag: new Date().toISOString(),
    },
    windows: {},
    clients: {},
    pendingCommands: {},
    clientUpdate: {
      phase: 'idle',
      suspendRequestedAt: null,
      resumeRequestedAt: null,
    },
  }

  const candidatePaths = [restoreStatePath, stateFilePath].filter(Boolean)

  for (const candidatePath of candidatePaths) {
    try {
      const raw = fs.readFileSync(candidatePath, 'utf8')
      const parsed = JSON.parse(raw)
      return {
        ...fallbackState,
        ...parsed,
        server: {
          ...fallbackState.server,
          ...(parsed.server || {}),
          activeScriptPath: __filename,
        },
      }
    } catch {
      continue
    }
  }

  return fallbackState
}

async function handleRequest(req, res) {
  const requestUrl = new URL(req.url || '/', `http://${host}:${port}`)
  const pathname = requestUrl.pathname

  if (req.method === 'GET' && pathname === '/health') {
    return writeJson(res, 200, {
      status: 'ok',
      pid: process.pid,
      host,
      port,
      activeScriptPath: state.server.activeScriptPath,
    })
  }

  if (req.method === 'GET' && pathname === '/api/status') {
    return writeJson(res, 200, buildStatusPayload())
  }

  if (req.method === 'POST' && pathname === '/api/windows/open') {
    const payload = await readJson(req)
    const windowRecord = await launchManagedWindow(payload)
    persistState()
    return writeJson(res, 201, { window: windowRecord })
  }

  if (req.method === 'POST' && pathname === '/api/clients/register') {
    const payload = await readJson(req)
    const clientRecord = registerClient(payload)
    persistState()
    return writeJson(res, 200, { client: clientRecord })
  }

  if (req.method === 'POST' && pathname === '/api/updates/client/suspend') {
    const payload = await readJson(req)
    const targetedClients = issueSuspendRequest(payload)
    persistState()
    return writeJson(res, 202, {
      phase: state.clientUpdate.phase,
      targetedClients,
    })
  }

  if (req.method === 'POST' && pathname === '/api/updates/client/resume') {
    const payload = await readJson(req)
    const resumedClients = issueResumeRequest(payload)
    persistState()
    return writeJson(res, 202, {
      phase: state.clientUpdate.phase,
      resumedClients,
    })
  }

  if (req.method === 'POST' && pathname === '/api/server/update/prepare-copy') {
    const copyPath = await prepareServerCopy()
    state.server.preparedCopyPath = copyPath
    persistState()
    return writeJson(res, 201, {
      preparedCopyPath: copyPath,
      activeScriptPath: state.server.activeScriptPath,
    })
  }

  if (req.method === 'POST' && pathname === '/api/server/update/failover') {
    const payload = await readJson(req)
    const targetScriptPath = payload?.targetScriptPath || state.server.preparedCopyPath

    if (!targetScriptPath) {
      return writeJson(res, 400, { error: 'missing_target_script_path' })
    }

    const handoffStatePath = await prepareHandoffState(targetScriptPath)
    writeJson(res, 202, {
      targetScriptPath,
      handoffStatePath,
      message: 'handoff_scheduled',
    })

    res.on('finish', () => {
      void handoffToReplacement(targetScriptPath, handoffStatePath)
    })
    return undefined
  }

  const commandsMatch = pathname.match(/^\/api\/clients\/([^/]+)\/commands$/)
  if (req.method === 'GET' && commandsMatch) {
    const clientId = decodeURIComponent(commandsMatch[1])
    const commands = drainClientCommands(clientId)
    persistState()
    return writeJson(res, 200, { commands, pollTimeoutMs: commandPollTimeoutMs })
  }

  const stateMatch = pathname.match(/^\/api\/clients\/([^/]+)\/state$/)
  if (req.method === 'POST' && stateMatch) {
    const clientId = decodeURIComponent(stateMatch[1])
    const payload = await readJson(req)
    const clientRecord = updateClientState(clientId, payload)
    persistState()
    return writeJson(res, 200, { client: clientRecord })
  }

  const resultMatch = pathname.match(/^\/api\/clients\/([^/]+)\/command-result$/)
  if (req.method === 'POST' && resultMatch) {
    const clientId = decodeURIComponent(resultMatch[1])
    const payload = await readJson(req)
    const result = recordClientCommandResult(clientId, payload)
    persistState()
    return writeJson(res, 200, { result })
  }

  return writeJson(res, 404, { error: 'not_found' })
}

function buildStatusPayload() {
  return {
    server: {
      pid: process.pid,
      host,
      port,
      activeScriptPath: state.server.activeScriptPath,
      preparedCopyPath: state.server.preparedCopyPath,
      lastHandoffAt: state.server.lastHandoffAt,
      versionTag: state.server.versionTag,
    },
    clientUpdate: state.clientUpdate,
    windows: Object.values(state.windows),
    clients: Object.values(state.clients),
  }
}

async function launchManagedWindow(payload) {
  const windowId = payload?.windowId || randomUUID()
  const clientId = payload?.clientId || windowId
  const filePath = typeof payload?.filePath === 'string' ? payload.filePath : null
  const launcher = resolveClientLauncher()
  const child = spawn(launcher.command, [...launcher.args, ...(filePath ? [filePath] : [])], {
    cwd: launcher.cwd,
    env: {
      ...process.env,
      MDV_SERVER_URL: `http://${host}:${port}`,
      MDV_CLIENT_ID: clientId,
      MDV_WINDOW_ID: windowId,
      MDV_ALLOW_MULTI_INSTANCE: '1',
    },
    stdio: 'ignore',
  })

  const now = new Date().toISOString()
  const windowRecord = {
    windowId,
    clientId,
    pid: child.pid,
    status: 'launching',
    filePath,
    launchedAt: now,
    updatedAt: now,
  }

  state.windows[windowId] = windowRecord
  state.clients[clientId] = {
    clientId,
    windowId,
    pid: child.pid,
    status: 'launching',
    filePath,
    lastSeenAt: now,
    snapshot: null,
    lastCommandResult: null,
  }

  child.on('exit', (code, signal) => {
    const existingWindow = state.windows[windowId]
    const existingClient = state.clients[clientId]

    if (existingWindow) {
      existingWindow.status = 'stopped'
      existingWindow.exitCode = code
      existingWindow.exitSignal = signal
      existingWindow.updatedAt = new Date().toISOString()
    }

    if (existingClient) {
      existingClient.status = 'stopped'
      existingClient.exitCode = code
      existingClient.exitSignal = signal
      existingClient.lastSeenAt = new Date().toISOString()
    }

    persistState()
    writeLog('INFO', 'window', 'child-exit', { windowId, clientId, code, signal })
  })

  writeLog('INFO', 'window', 'launched', windowRecord)
  return windowRecord
}

function resolveClientLauncher() {
  const overrideCommand = process.env.MDV_CLIENT_COMMAND
  const overrideArgs = safeParseJson(process.env.MDV_CLIENT_ARGS_JSON, [])
  const overrideCwd = process.env.MDV_CLIENT_CWD || path.resolve(__dirname, '..')

  if (overrideCommand) {
    return {
      command: overrideCommand,
      args: Array.isArray(overrideArgs) ? overrideArgs : [],
      cwd: overrideCwd,
    }
  }

  const repoRoot = path.resolve(__dirname, '..')
  const electronCliPath = path.join(repoRoot, 'node_modules', 'electron', 'cli.js')

  if (fs.existsSync(electronCliPath)) {
    return {
      command: process.execPath,
      args: [electronCliPath, repoRoot],
      cwd: repoRoot,
    }
  }

  throw new Error('MDV client launcher is not configured. Set MDV_CLIENT_COMMAND.')
}

function registerClient(payload) {
  const clientId = typeof payload?.clientId === 'string' ? payload.clientId : randomUUID()
  const windowId = typeof payload?.windowId === 'string' ? payload.windowId : clientId
  const now = new Date().toISOString()
  const existingRecord = state.clients[clientId] || {}
  const snapshot = payload?.snapshot && typeof payload.snapshot === 'object' ? payload.snapshot : existingRecord.snapshot || null

  const clientRecord = {
    ...existingRecord,
    clientId,
    windowId,
    pid: payload?.pid || existingRecord.pid || null,
    filePath: payload?.filePath || existingRecord.filePath || null,
    status: 'running',
    lastSeenAt: now,
    snapshot,
    version: payload?.version || existingRecord.version || null,
  }

  state.clients[clientId] = clientRecord
  state.windows[windowId] = {
    ...(state.windows[windowId] || {}),
    windowId,
    clientId,
    pid: clientRecord.pid,
    filePath: clientRecord.filePath,
    status: 'running',
    updatedAt: now,
  }

  if (state.clientUpdate.phase === 'resume-pending' && clientRecord.snapshot) {
    enqueueCommand(clientId, {
      type: 'resume',
      requestId: randomUUID(),
      requestedAt: state.clientUpdate.resumeRequestedAt,
      snapshot: clientRecord.snapshot,
    })
  }

  return clientRecord
}

function issueSuspendRequest(payload) {
  state.clientUpdate.phase = 'suspending'
  state.clientUpdate.suspendRequestedAt = new Date().toISOString()

  const targetedClients = Object.keys(state.clients)
  for (const clientId of targetedClients) {
    enqueueCommand(clientId, {
      type: 'suspend',
      requestId: randomUUID(),
      reason: payload?.reason || 'client-update',
      requestedAt: state.clientUpdate.suspendRequestedAt,
    })
  }

  return targetedClients
}

function issueResumeRequest(payload) {
  state.clientUpdate.phase = 'resume-pending'
  state.clientUpdate.resumeRequestedAt = new Date().toISOString()

  const resumedClients = Object.keys(state.clients)
  for (const clientId of resumedClients) {
    enqueueCommand(clientId, {
      type: 'resume',
      requestId: randomUUID(),
      requestedAt: state.clientUpdate.resumeRequestedAt,
      snapshot: state.clients[clientId]?.snapshot || null,
      metadata: payload?.metadata || null,
    })
  }

  return resumedClients
}

function enqueueCommand(clientId, command) {
  if (!state.pendingCommands[clientId]) {
    state.pendingCommands[clientId] = []
  }

  state.pendingCommands[clientId].push(command)
}

function drainClientCommands(clientId) {
  const commands = state.pendingCommands[clientId] || []
  state.pendingCommands[clientId] = []
  return commands
}

function updateClientState(clientId, payload) {
  const now = new Date().toISOString()
  const clientRecord = state.clients[clientId]

  if (!clientRecord) {
    throw new Error(`unknown client: ${clientId}`)
  }

  clientRecord.snapshot = payload?.snapshot || clientRecord.snapshot || null
  clientRecord.filePath = payload?.filePath || clientRecord.filePath || null
  clientRecord.lastSeenAt = now
  clientRecord.status = payload?.status || 'running'

  if (state.windows[clientRecord.windowId]) {
    state.windows[clientRecord.windowId].filePath = clientRecord.filePath
    state.windows[clientRecord.windowId].status = clientRecord.status
    state.windows[clientRecord.windowId].updatedAt = now
  }

  return clientRecord
}

function recordClientCommandResult(clientId, payload) {
  const clientRecord = state.clients[clientId]

  if (!clientRecord) {
    throw new Error(`unknown client: ${clientId}`)
  }

  clientRecord.lastCommandResult = {
    requestId: payload?.requestId || null,
    type: payload?.type || null,
    status: payload?.status || 'unknown',
    recordedAt: new Date().toISOString(),
  }

  if (payload?.snapshot) {
    clientRecord.snapshot = payload.snapshot
  }

  if (payload?.type === 'suspend' && payload?.status === 'completed') {
    clientRecord.status = 'suspended'
  }

  if (payload?.type === 'resume' && payload?.status === 'completed') {
    clientRecord.status = 'running'
  }

  if (payload?.type === 'resume' && payload?.status === 'completed') {
    const hasPendingResume = Object.keys(state.clients).some((candidateClientId) => {
      const commands = state.pendingCommands[candidateClientId] || []
      return commands.some((command) => command.type === 'resume')
    })

    if (!hasPendingResume) {
      state.clientUpdate.phase = 'idle'
    }
  }

  return clientRecord.lastCommandResult
}

async function prepareServerCopy() {
  const copyDir = path.join(runtimeDir, 'copies', new Date().toISOString().replaceAll(':', '-'))
  const copyPath = path.join(copyDir, path.basename(__filename))

  await fsPromises.mkdir(copyDir, { recursive: true })
  await fsPromises.copyFile(__filename, copyPath)

  writeLog('INFO', 'server-update', 'prepared-copy', { copyPath })
  return copyPath
}

async function prepareHandoffState(targetScriptPath) {
  state.server.lastHandoffAt = new Date().toISOString()
  state.server.activeScriptPath = targetScriptPath

  const handoffDir = path.join(runtimeDir, 'handoff')
  await fsPromises.mkdir(handoffDir, { recursive: true })

  const handoffStatePath = path.join(handoffDir, `state-${Date.now()}.json`)
  await fsPromises.writeFile(handoffStatePath, JSON.stringify(state, null, 2), 'utf8')
  await fsPromises.writeFile(stateFilePath, JSON.stringify(state, null, 2), 'utf8')

  return handoffStatePath
}

async function handoffToReplacement(targetScriptPath, handoffStatePath) {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  writeLog('INFO', 'server-update', 'handoff-start', { targetScriptPath, handoffStatePath })

  spawn(process.execPath, [targetScriptPath, '--host', host, '--port', String(port), '--restore-state', handoffStatePath], {
    cwd: path.dirname(targetScriptPath),
    env: process.env,
    detached: true,
    stdio: 'ignore',
  }).unref()

  server.close(() => {
    writeLog('INFO', 'server-update', 'handoff-finished', { targetScriptPath })
    process.exit(0)
  })

  setTimeout(() => {
    process.exit(0)
  }, 1500).unref()
}

async function listenWithRetry(httpServer, listenHost, listenPort, shouldRetry) {
  const maxAttempts = shouldRetry ? 40 : 1

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          httpServer.off('listening', onListening)
          reject(error)
        }
        const onListening = () => {
          httpServer.off('error', onError)
          resolve(undefined)
        }

        httpServer.once('error', onError)
        httpServer.once('listening', onListening)
        httpServer.listen(listenPort, listenHost)
      })
      return
    } catch (error) {
      if (!shouldRetry || error?.code !== 'EADDRINUSE' || attempt === maxAttempts) {
        throw error
      }

      await wait(200)
    }
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []

    req.on('data', (chunk) => {
      chunks.push(chunk)
    })

    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(new Error('invalid_json_body'))
      }
    })

    req.on('error', reject)
  })
}

function writeJson(res, statusCode, payload) {
  if (res.headersSent) {
    return
  }

  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload, null, 2))
}

function persistState() {
  fs.mkdirSync(runtimeDir, { recursive: true })
  fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2), 'utf8')
}

function safeParseJson(rawValue, fallbackValue) {
  if (!rawValue) {
    return fallbackValue
  }

  try {
    return JSON.parse(rawValue)
  } catch {
    return fallbackValue
  }
}

function wait(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs)
  })
}

function writeLog(level, scope, message, details) {
  const line = `[${new Date().toISOString()}] [${level}] [${scope}] ${serializeLogValue(message)} ${serializeLogValue(details)}\n`
  fs.mkdirSync(path.dirname(logFilePath), { recursive: true })
  fs.appendFileSync(logFilePath, line, 'utf8')
}

function serializeLogValue(value) {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}\n${value.stack || ''}`.trim()
  }

  if (typeof value === 'undefined') {
    return ''
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