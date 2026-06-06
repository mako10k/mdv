// @ts-nocheck
const http = require('node:http')

function formatDebugChannelEvent(event) {
  return `event: mdv-debug\nid: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`
}

function readDebugChannelRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []

    request.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })

    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'))
    })

    request.on('error', reject)
  })
}

function createDebugChannelController(options) {
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

  const state = {
    port,
    nextEventId: 0,
    server: null,
    clients: new Set(),
    history: [],
  }

  function emitEvent(type, payload = null) {
    state.nextEventId += 1

    const event = {
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
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'access-control-allow-origin': '*',
        })
        response.write(': connected\n\n')
        state.clients.add(response)

        if (requestUrl.searchParams.get('replay') !== '0') {
          for (const event of state.history) {
            response.write(formatDebugChannelEvent(event))
          }
        }

        const heartbeat = setInterval(() => {
          response.write(': heartbeat\n\n')
        }, 15_000)

        request.on('close', () => {
          clearInterval(heartbeat)
          state.clients.delete(response)
        })
        return
      }

      if (request.method === 'POST' && requestUrl.pathname === '/publish') {
        try {
          const rawBody = await readDebugChannelRequestBody(request)
          const parsedBody = rawBody.trim().length > 0 ? JSON.parse(rawBody) : {}
          const eventType = typeof parsedBody?.type === 'string' && parsedBody.type.trim().length > 0
            ? parsedBody.type.trim()
            : 'external:message'

          emitEvent(eventType, parsedBody?.payload ?? null)
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

    server.on('error', (error) => {
      writeLog('ERROR', 'debug-channel', 'Debug channel server failed', error instanceof Error ? error.message : String(error))
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
