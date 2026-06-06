import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createDebugChannelController } = require('../../electron/lib/main/debug-channel.cjs')

async function readStreamBody(stream) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const chunks = []

  while (true) {
    const { value, done } = await reader.read()
    if (done) {
      break
    }
    chunks.push(decoder.decode(value, { stream: true }))
  }

  chunks.push(decoder.decode())
  return chunks.join('')
}

test('disabled debug channel is inert when port is not configured', () => {
  const controller = createDebugChannelController({ port: 0, writeLog: () => {} })

  controller.startServer()
  controller.emitEvent('test:event', { ok: true })

  assert.equal(controller.getState(), null)
})

test('debug channel health and replay endpoints work', async () => {
  const logs = []
  const controller = createDebugChannelController({
    port: 48123,
    writeLog: (...parts) => logs.push(parts),
  })

  controller.startServer()
  await new Promise((resolve) => setTimeout(resolve, 30))

  const healthResponse = await fetch('http://127.0.0.1:48123/health')
  const healthPayload = await healthResponse.json()
  assert.equal(healthResponse.status, 200)
  assert.equal(healthPayload.ok, true)
  assert.equal(healthPayload.port, 48123)

  controller.emitEvent('custom:event', { value: 1 })

  const replayResponse = await fetch('http://127.0.0.1:48123/events')
  const replayTextPromise = readStreamBody(replayResponse.body)
  await new Promise((resolve) => setTimeout(resolve, 30))
  controller.stopServer()
  const replayText = await replayTextPromise

  assert.match(replayText, /debug-channel:listening/)
  assert.match(replayText, /custom:event/)
  assert.ok(logs.some((entry) => entry[2] === 'Debug channel listening'))
})

test('publish endpoint emits external message event', async () => {
  const controller = createDebugChannelController({ port: 48124, writeLog: () => {} })

  controller.startServer()
  await new Promise((resolve) => setTimeout(resolve, 30))

  const eventsResponse = await fetch('http://127.0.0.1:48124/events?replay=0')
  const reader = eventsResponse.body.getReader()
  await reader.read()

  const publishResponse = await fetch('http://127.0.0.1:48124/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'remote:event', payload: { ok: true } }),
  })
  const publishPayload = await publishResponse.json()
  assert.equal(publishResponse.status, 202)
  assert.equal(publishPayload.ok, true)

  const { value } = await reader.read()
  const text = new TextDecoder().decode(value)
  controller.stopServer()

  assert.match(text, /remote:event/)
  assert.match(text, /"ok":true/)
})
