const http = require('node:http') as typeof import('node:http')

type IncomingMessage = import('node:http').IncomingMessage
type Server = import('node:http').Server
type ServerResponse = import('node:http').ServerResponse<IncomingMessage>

type DebugChannelEvent = {
  id: string
  type: string
  timestamp: string
  payload: unknown
}

type ServerResponseLike = ServerResponse & {
  write: (chunk: string) => boolean
  end: (chunk?: string) => void
}

type DebugChannelState = {
  port: number
  nextEventId: number
  server: Server | null
  clients: Set<ServerResponseLike>
  history: DebugChannelEvent[]
}

type DebugChannelControllerOptions = {
  port: number | null | undefined
  writeLog: (level: string, scope: string, ...parts: unknown[]) => void
}

type DebugChannelController = {
  emitEvent: (type: string, payload?: unknown) => void
  startServer: () => void
  stopServer: () => void
  getState: () => DebugChannelState | null
}

function formatDebugChannelEvent(event: DebugChannelEvent) {
  return `event: mdv-debug\nid: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`
}

function readDebugChannelRequestBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []

    request.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })

    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'))
    })

    request.on('error', reject)
  })
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function createDebugChannelController(options: DebugChannelControllerOptions): DebugChannelController {
  const { port, writeLog } = options

  if (!port) {
    return {
      emitEvent() {},
      startServer() {},
      stopServer() {},
      getState() {
        return null
      },
    }
  }

  const state: DebugChannelState = {
    port,
    nextEventId: 0,
    server: null,
    clients: new Set(),
    history: [],
  }

  function emitEvent(type: string, payload: unknown = null) {
    state.nextEventId += 1

    const event: DebugChannelEvent = {
      id: String(state.nextEventId),
      type,
      timestamp: new Date().toISOString(),
      payload,
    }

    state.history.push(event)

    if (state.history.length > 200) {
      state.history.shift()
    }

    const serializedEvent = formatDebugChannelEvent(event)

    for (const client of state.clients) {
      client.write(serializedEvent)
    }
  }

  function startServer() {
    if (state.server) {
      return
    }

    const server = http.createServer(async (request, response) => {
      const requestUrl = new URL(request.url || '/', `http://127.0.0.1:${state.port}`)

      if (request.method === 'GET' && requestUrl.pathname === '/health') {
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify({ ok: true, port: state.port, clients: state.clients.size }))
        return
      }

      if (request.method === 'GET' && requestUrl.pathname === '/events') {
        const eventResponse = response as ServerResponseLike
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'access-control-allow-origin': '*',
        })
        eventResponse.write(': connected\n\n')
        state.clients.add(eventResponse)

        if (requestUrl.searchParams.get('replay') !== '0') {
          for (const event of state.history) {
            eventResponse.write(formatDebugChannelEvent(event))
          }
        }

        const heartbeat = setInterval(() => {
          eventResponse.write(': heartbeat\n\n')
        }, 15_000)

        request.on('close', () => {
          clearInterval(heartbeat)
          state.clients.delete(eventResponse)
        })
        return
      }

      if (request.method === 'POST' && requestUrl.pathname === '/publish') {
        try {
          const rawBody = await readDebugChannelRequestBody(request)
          const parsedBody: unknown = rawBody.trim().length > 0 ? JSON.parse(rawBody) : {}
          const parsedRecord = isObjectRecord(parsedBody) ? parsedBody : null
          const eventType = typeof parsedRecord?.type === 'string' && parsedRecord.type.trim().length > 0
            ? parsedRecord.type.trim()
            : 'external:message'

          emitEvent(eventType, parsedRecord?.payload ?? null)
          response.writeHead(202, { 'content-type': 'application/json; charset=utf-8' })
          response.end(JSON.stringify({ ok: true }))
        } catch (error) {
          response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
          response.end(JSON.stringify({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }))
        }
        return
      }

      response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ ok: false, error: 'Not found' }))
    })

    server.on('error', (error: Error) => {
      writeLog('ERROR', 'debug-channel', 'Debug channel server failed', error.message)
    })

    server.listen(state.port, '127.0.0.1', () => {
      writeLog('INFO', 'debug-channel', 'Debug channel listening', { port: state.port })
      emitEvent('debug-channel:listening', { port: state.port })
    })

    state.server = server
  }

  function stopServer() {
    if (!state.server) {
      return
    }

    for (const client of state.clients) {
      client.end()
    }

    state.clients.clear()
    state.server.close()
    state.server = null
  }

  return {
    emitEvent,
    startServer,
    stopServer,
    getState() {
      return state
    },
  }
}

export {
  createDebugChannelController,
}
