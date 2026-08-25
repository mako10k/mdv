import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildElectronE2eInvocation,
  parseElectronE2eRunnerArgs,
  runElectronE2e,
} from '../../scripts/run-electron-e2e.mjs'

const invocationFixture = {
  nodeExecutable: '/runtime/node',
  playwrightCliPath: '/workspace/node_modules/playwright/cli.js',
  repoRoot: '/workspace',
}

test('Electron E2E runner isolates Linux execution in Xvfb and forwards Playwright arguments', () => {
  const parsed = parseElectronE2eRunnerArgs(['--grep', 'window lifecycle'])
  const invocation = buildElectronE2eInvocation({
    ...invocationFixture,
    platform: 'linux',
    ...parsed,
  })

  assert.equal(invocation.command, 'xvfb-run')
  assert.equal(invocation.displayMode, 'xvfb')
  assert.deepEqual(invocation.args, [
    '-a',
    '/runtime/node',
    '/workspace/node_modules/playwright/cli.js',
    'test',
    '-c',
    'playwright.electron.config.ts',
    '--grep',
    'window lifecycle',
  ])
})

test('Electron E2E runner keeps an explicit Linux visible override', () => {
  const parsed = parseElectronE2eRunnerArgs(['--visible', '--grep', 'focus'])
  const invocation = buildElectronE2eInvocation({
    ...invocationFixture,
    platform: 'linux',
    ...parsed,
  })

  assert.equal(parsed.visible, true)
  assert.deepEqual(parsed.playwrightArgs, ['--grep', 'focus'])
  assert.equal(invocation.command, '/runtime/node')
  assert.equal(invocation.displayMode, 'visible')
  assert.deepEqual(invocation.args.slice(-2), ['--grep', 'focus'])
})

test('Electron E2E runner preserves the host display on non-Linux platforms', () => {
  const invocation = buildElectronE2eInvocation({
    ...invocationFixture,
    platform: 'win32',
    playwrightArgs: ['tests/e2e-electron/new-document.spec.ts'],
  })

  assert.equal(invocation.command, '/runtime/node')
  assert.equal(invocation.displayMode, 'visible')
  assert.deepEqual(invocation.args.slice(-1), ['tests/e2e-electron/new-document.spec.ts'])
})

test('Electron E2E runner fails closed when xvfb-run is unavailable', async () => {
  const missingCommandError = Object.assign(new Error('spawn xvfb-run ENOENT'), {
    code: 'ENOENT',
  })

  await assert.rejects(
    runElectronE2e([], {
      ...invocationFixture,
      platform: 'linux',
      statusWriter: () => {},
      executeInvocation: async () => {
        throw missingCommandError
      },
    }),
    /background mode requires xvfb-run/,
  )
})

test('Electron E2E runner returns the child process exit result', async () => {
  const expectedResult = { exitCode: 23, signal: null }

  const result = await runElectronE2e(['--visible'], {
    ...invocationFixture,
    platform: 'linux',
    statusWriter: () => {},
    executeInvocation: async (invocation) => {
      assert.equal(invocation.displayMode, 'visible')
      return expectedResult
    },
  })

  assert.deepEqual(result, expectedResult)
})
