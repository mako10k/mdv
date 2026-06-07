import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

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
  const previousEnv = {
    MDV_E2E_USER_DATA_DIR: process.env.MDV_E2E_USER_DATA_DIR,
    MDV_FORCE_STATIC_RENDERER: process.env.MDV_FORCE_STATIC_RENDERER,
    MDV_DEBUG_CHANNEL_PORT: process.env.MDV_DEBUG_CHANNEL_PORT,
    MDV_SERVER_URL: process.env.MDV_SERVER_URL,
    MDV_CLIENT_ID: process.env.MDV_CLIENT_ID,
    MDV_WINDOW_ID: process.env.MDV_WINDOW_ID,
    MDV_OPENAI_MODEL: process.env.MDV_OPENAI_MODEL,
    MDV_UPDATE_FEED_URL: process.env.MDV_UPDATE_FEED_URL,
  }
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
    getPath: (name) => {
      if (name === 'logs') {
        return '/tmp/mdv-user/logs'
      }

      if (name === 'appData') {
        return '/tmp'
      }

      return '/tmp/mdv-user'
    },
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

  for (const [key, value] of Object.entries(previousEnv)) {
    if (typeof value === 'string') {
      process.env[key] = value
    } else {
      delete process.env[key]
    }
  }
})

test('createMainProcessRuntime prefers legacy mdv userData when present', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-runtime-'))
  const legacyUserDataPath = path.join(tempRoot, 'mdv')
  const brandedUserDataPath = path.join(tempRoot, 'MarkDownViewer')

  await fs.mkdir(legacyUserDataPath, { recursive: true })
  await fs.mkdir(brandedUserDataPath, { recursive: true })
  delete process.env.MDV_E2E_USER_DATA_DIR

  const calls = []
  let currentUserDataPath = brandedUserDataPath
  let currentLogsPath = path.join(brandedUserDataPath, 'logs')
  const app = {
    isPackaged: true,
    setPath: (name, value) => {
      calls.push(['setPath', name, value])

      if (name === 'userData') {
        currentUserDataPath = value
      }

      if (name === 'logs') {
        currentLogsPath = value
      }
    },
    disableHardwareAcceleration: () => calls.push(['disableHardwareAcceleration']),
    commandLine: { appendSwitch: (value) => calls.push(['appendSwitch', value]) },
    setName: (value) => calls.push(['setName', value]),
    setAppLogsPath: (value) => {
      calls.push(['setAppLogsPath', value])
      currentLogsPath = value
    },
    getPath: (name) => {
      if (name === 'appData') {
        return tempRoot
      }

      if (name === 'logs') {
        return currentLogsPath
      }

      return currentUserDataPath
    },
  }

  try {
    const runtime = createMainProcessRuntime(app)

    assert.equal(runtime.settingsPath, path.join(legacyUserDataPath, 'settings.json'))
    assert.equal(runtime.secretsPath, path.join(legacyUserDataPath, 'secrets.json'))
    assert.ok(calls.some((entry) => entry[0] === 'setPath' && entry[1] === 'userData' && entry[2] === legacyUserDataPath))
    assert.ok(calls.some((entry) => entry[0] === 'setAppLogsPath' && entry[1] === path.join(legacyUserDataPath, 'logs')))
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('createMainProcessRuntime falls back to branded userData when legacy path is absent', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-runtime-'))
  const brandedUserDataPath = path.join(tempRoot, 'MarkDownViewer')

  await fs.mkdir(brandedUserDataPath, { recursive: true })
  delete process.env.MDV_E2E_USER_DATA_DIR

  const calls = []
  let currentUserDataPath = brandedUserDataPath
  let currentLogsPath = path.join(brandedUserDataPath, 'logs')
  const app = {
    isPackaged: true,
    setPath: (name, value) => {
      calls.push(['setPath', name, value])

      if (name === 'userData') {
        currentUserDataPath = value
      }

      if (name === 'logs') {
        currentLogsPath = value
      }
    },
    disableHardwareAcceleration: () => calls.push(['disableHardwareAcceleration']),
    commandLine: { appendSwitch: (value) => calls.push(['appendSwitch', value]) },
    setName: (value) => calls.push(['setName', value]),
    setAppLogsPath: (value) => {
      calls.push(['setAppLogsPath', value])
      currentLogsPath = value
    },
    getPath: (name) => {
      if (name === 'appData') {
        return tempRoot
      }

      if (name === 'logs') {
        return currentLogsPath
      }

      return currentUserDataPath
    },
  }

  try {
    const runtime = createMainProcessRuntime(app)

    assert.equal(runtime.settingsPath, path.join(brandedUserDataPath, 'settings.json'))
    assert.ok(calls.some((entry) => entry[0] === 'setPath' && entry[1] === 'userData' && entry[2] === brandedUserDataPath))
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})
