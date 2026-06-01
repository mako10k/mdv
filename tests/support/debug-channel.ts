import { setTimeout as delay } from 'node:timers/promises'

export type MdvDebugEvent = {
  id: string
  type: string
  timestamp: string
  payload: unknown
}

type SubscribeOptions = {
  port: number
  replay?: boolean
  signal?: AbortSignal
  onEvent: (event: MdvDebugEvent) => void
}

type WaitForEventOptions = {
  port: number
  eventType: string
  timeoutMs?: number
  replay?: boolean
  predicate?: (event: MdvDebugEvent) => boolean
}

export async function waitForDebugChannel(port: number, options?: { timeoutMs?: number }) {
  const timeoutMs = options?.timeoutMs ?? 10_000
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`)

      if (response.ok) {
        return
      }
    } catch {
      // Server not ready yet.
    }

    await delay(100)
  }

  throw new Error(`Debug channel on port ${port} did not become ready within ${timeoutMs}ms`)
}

export async function publishDebugEvent(port: number, type: string, payload?: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}/publish`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ type, payload }),
  })

  if (!response.ok) {
    throw new Error(`Failed to publish debug event ${type}: ${response.status}`)
  }
}

export async function subscribeDebugChannel(options: SubscribeOptions) {
  const response = await fetch(`http://127.0.0.1:${options.port}/events?replay=${options.replay === false ? '0' : '1'}`, {
    headers: {
      accept: 'text/event-stream',
    },
    signal: options.signal,
  })

  if (!response.ok || !response.body) {
    throw new Error(`Failed to subscribe to debug channel: ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const flushBuffer = () => {
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''

    for (const frame of frames) {
      const trimmedFrame = frame.trim()

      if (!trimmedFrame || trimmedFrame.startsWith(':')) {
        continue
      }

      const dataLines = trimmedFrame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())

      if (dataLines.length === 0) {
        continue
      }

      options.onEvent(JSON.parse(dataLines.join('\n')) as MdvDebugEvent)
    }
  }

  const loop = (async () => {
    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })
      flushBuffer()
    }
  })()

  return {
    close: async () => {
      await reader.cancel().catch(() => {})
      await loop.catch(() => {})
    },
  }
}

export async function waitForDebugEvent(options: WaitForEventOptions) {
  const timeoutMs = options.timeoutMs ?? 10_000

  try {
    await waitForDebugChannel(options.port, { timeoutMs })

    return await new Promise<MdvDebugEvent>((resolve, reject) => {
      let settled = false
      let subscription: { close: () => Promise<void> } | null = null
      const timeoutId = setTimeout(() => {
        if (settled) {
          return
        }

        settled = true
        void subscription?.close().catch(() => {})
        reject(new Error(`Timed out waiting for debug event ${options.eventType}`))
      }, timeoutMs)

      void subscribeDebugChannel({
        port: options.port,
        replay: options.replay,
        onEvent: (event) => {
          if (settled || event.type !== options.eventType) {
            return
          }

          if (options.predicate && !options.predicate(event)) {
            return
          }

          settled = true
          clearTimeout(timeoutId)
          void subscription?.close().catch(() => {})
          resolve(event)
        },
      }).then((value) => {
        subscription = value
      }).catch((error) => {
        if (settled) {
          return
        }

        settled = true
        clearTimeout(timeoutId)
        reject(error)
      })
    })
  } finally {
    // No-op: timeout is scoped inside the Promise so it can be cleared on resolve.
  }
}