import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createMainProcessRuntime, resolveDebugChannelPort } = require('../../electron/lib/main/runtime.cjs')

test('resolveDebugChannelPort validates range and format', () => {
  assert.equal(resolveDebugChannelPort('3000'), 3000)
  assert.equal(resolveDebugChannelPort('0'), null)
  assert.equal(resolveDebugChannelPort('70000'), null)
  assert.equal(resolveDebugChannelPort('abc'), null)
  assert.equal(resolveDebugChannelPort(''), null)
})

test('createMainProcessRuntime resolves env-driven paths and flags', () => {
  const env = process.env
  process.env.MDV_E2E_USER_DATA_DIR = '/tmp/mdv-user'
  process.env.MDV_FORCE_STATIC_RENDERER = '1'
  process.env.MDV_DEBUG_CHANNEL_PORT = '48100'
  process.env.MDV_SERVER_URL = 'http://127.0.0.1:9000'
  process.env.MDV_CLIENT_ID = 'client-1'
  process.env.MDV_WINDOW_ID = 'window-1'
  process.env.MDV_OPENAI_MODEL = 'gpt-test'
  process.env.MDV_UPDATE_FEED_URL = 'https://example.test/feed'

  const calls = []
  const app = {
    isPackaged: false,
    setPath: (...args) => calls.push(['setPath', ...args]),
    disableHardwareAcceleration: () => calls.push(['disableHardwareAcceleration']),
    commandLine: { appendSwitch: (value) => calls.push(['appendSwitch', value]) },
    setName: (value) => calls.push(['setName', value]),
    setAppLogsPath: (value) => calls.push(['setAppLogsPath', value]),
    getPath: (name) => name === 'logs' ? '/tmp/mdv-user/logs' : '/tmp/mdv-user',
  }

  const runtime = createMainProcessRuntime(app)

  assert.equal(runtime.e2eUserDataPath, '/tmp/mdv-user')
  assert.equal(runtime.forceStaticRenderer, true)
  assert.equal(runtime.debugChannelPort, 48100)
  assert.equal(runtime.managedServerUrl, 'http://127.0.0.1:9000')
  assert.equal(runtime.managedClientId, 'client-1')
  assert.equal(runtime.managedWindowId, 'window-1')
  assert.equal(runtime.defaultOpenAiModel, 'gpt-test')
  assert.equal(runtime.defaultUpdateFeedUrl, 'https://example.test/feed')
  assert.equal(runtime.isDev, false)
  assert.equal(runtime.settingsPath, '/tmp/mdv-user/settings.json')
  assert.ok(calls.some((entry) => entry[0] === 'setPath' && entry[1] === 'userData'))

  process.env = env
})
