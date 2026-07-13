import http from 'node:http'

type OpenAiFunctionCall = {
  name: string
  arguments: Record<string, unknown>
  callId?: string
}

type OpenAiResponsesRequest = {
  method: string
  url: string
  headers: http.IncomingHttpHeaders
  rawBody: string
  body: unknown
}

type OpenAiResponsesServer = {
  baseUrl: string
  requests: OpenAiResponsesRequest[]
  close: () => Promise<void>
}

type StartOpenAiResponsesServerOptions = {
  functionCalls: readonly OpenAiFunctionCall[]
  outputText?: string
}

function parseJsonBody(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody)
  } catch {
    return rawBody
  }
}

function buildResponse(options: StartOpenAiResponsesServerOptions, status: 'in_progress' | 'completed') {
  const now = Math.floor(Date.now() / 1000)
  const isCompleted = status === 'completed'

  return {
    id: 'resp_mdv_e2e_change_proposal',
    object: 'response',
    created_at: now,
    ...(isCompleted ? { completed_at: now } : {}),
    status,
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    model: 'mdv-e2e-model',
    output_text: isCompleted ? options.outputText ?? '' : '',
    output: isCompleted
      ? options.functionCalls.map((call, index) => ({
          id: `fc_mdv_e2e_${index + 1}`,
          call_id: call.callId ?? `call_mdv_e2e_${index + 1}`,
          type: 'function_call',
          status: 'completed',
          name: call.name,
          arguments: JSON.stringify(call.arguments),
        }))
      : [],
    parallel_tool_calls: true,
    temperature: null,
    tool_choice: 'auto',
    tools: [],
    top_p: null,
  }
}

async function readRequestBody(request: http.IncomingMessage) {
  const chunks: Buffer[] = []

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return Buffer.concat(chunks).toString('utf8')
}

async function startOpenAiResponsesServer(
  options: StartOpenAiResponsesServerOptions,
): Promise<OpenAiResponsesServer> {
  const requests: OpenAiResponsesRequest[] = []
  const server = http.createServer((request, response) => {
    void (async () => {
      const rawBody = await readRequestBody(request)
      requests.push({
        method: request.method ?? '',
        url: request.url ?? '',
        headers: request.headers,
        rawBody,
        body: parseJsonBody(rawBody),
      })

      if (request.method !== 'POST' || request.url !== '/v1/responses') {
        response.writeHead(404, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'Not found' } }))
        return
      }

      response.writeHead(200, {
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Content-Type': 'text/event-stream',
      })
      response.write(`data: ${JSON.stringify({
        type: 'response.created',
        response: buildResponse(options, 'in_progress'),
      })}\n\n`)
      response.write(`data: ${JSON.stringify({
        type: 'response.completed',
        response: buildResponse(options, 'completed'),
      })}\n\n`)
      response.end('data: [DONE]\n\n')
    })().catch((error: unknown) => {
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'application/json' })
      }
      response.end(JSON.stringify({
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      }))
    })
  })

  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => {
      server.off('listening', handleListening)
      reject(error)
    }
    const handleListening = () => {
      server.off('error', handleError)
      resolve()
    }

    server.once('error', handleError)
    server.once('listening', handleListening)
    server.listen(0, '127.0.0.1')
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    throw new Error('OpenAI Responses test server did not bind a TCP port')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    }),
  }
}

export {
  startOpenAiResponsesServer,
  type OpenAiFunctionCall,
  type OpenAiResponsesRequest,
  type OpenAiResponsesServer,
}
