import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createDocumentLinkController } = require('../../electron/lib/main/document-link-controller.cjs')

function createHarness(overrides = {}) {
  const calls = []
  const sourceWindow = { id: 1, isDestroyed: () => false }
  const controller = createDocumentLinkController({
    fsPromises: {
      stat: async (filePath) => {
        calls.push(['stat', filePath])
        return { isFile: () => true }
      },
    },
    pathImpl: path.posix,
    isEligibleSourceWindow: () => true,
    ensureEditorRuntimeState: () => ({ trackedFilePath: '/workspace/docs/source.md' }),
    openExternalLink: async (_window, href) => {
      calls.push(['external', href])
      return { status: 'opened' }
    },
    findEditorWindowByTrackedFilePath: () => null,
    focusWindow: (window) => calls.push(['focus', window.id]),
    createWindow: async (launchRequest) => {
      calls.push(['create', launchRequest])
      return { id: 2, isDestroyed: () => false }
    },
    isManagedClient: () => false,
    writeLog: (...parts) => calls.push(['log', ...parts]),
    ...overrides,
  })

  return { controller, sourceWindow, calls }
}

test('openDocumentLink rejects auxiliary or drifted source windows before resolving a target', async () => {
  const { controller, sourceWindow, calls } = createHarness({
    isEligibleSourceWindow: () => false,
  })

  const result = await controller.openDocumentLink(sourceWindow, '/workspace/docs/target.md')

  assert.deepEqual(result, { status: 'blocked', target: 'local', reason: 'invalid-source' })
  assert.equal(calls.some((call) => call[0] === 'stat'), false)
  assert.equal(calls.some((call) => call[0] === 'create'), false)
})

test('openDocumentLink resolves a relative path from the tracked source file and opens MDV', async () => {
  const { controller, sourceWindow, calls } = createHarness()

  const result = await controller.openDocumentLink(sourceWindow, '../guide/next%20step.md#overview')

  assert.deepEqual(result, { status: 'opened', target: 'local', displayName: 'next step.md' })
  assert.deepEqual(calls.find((call) => call[0] === 'stat'), ['stat', '/workspace/guide/next step.md'])
  assert.deepEqual(calls.find((call) => call[0] === 'create'), ['create', {
    filePath: '/workspace/guide/next step.md',
    explicitInitialPanel: 'preview',
  }])
})

test('openDocumentLink delegates HTTP links to the external permission flow', async () => {
  const { controller, sourceWindow, calls } = createHarness()

  const result = await controller.openDocumentLink(sourceWindow, 'https://example.com/docs')

  assert.deepEqual(result, { status: 'opened', target: 'external', displayName: 'example.com' })
  assert.deepEqual(calls.find((call) => call[0] === 'external'), ['external', 'https://example.com/docs'])
  assert.equal(calls.some((call) => call[0] === 'stat'), false)
})

test('openDocumentLink focuses an editor already tracking the local target', async () => {
  const existingWindow = { id: 7, isDestroyed: () => false }
  const { controller, sourceWindow, calls } = createHarness({
    findEditorWindowByTrackedFilePath: () => existingWindow,
  })

  const result = await controller.openDocumentLink(sourceWindow, '/workspace/docs/target.md')

  assert.deepEqual(result, { status: 'focused', target: 'local', displayName: 'target.md' })
  assert.deepEqual(calls.find((call) => call[0] === 'focus'), ['focus', 7])
  assert.equal(calls.some((call) => call[0] === 'create'), false)
})

test('openDocumentLink blocks relative paths for an untitled source and missing targets', async () => {
  const untitledHarness = createHarness({
    ensureEditorRuntimeState: () => ({ trackedFilePath: null }),
  })
  const untitledResult = await untitledHarness.controller.openDocumentLink(untitledHarness.sourceWindow, 'next.md')
  assert.deepEqual(untitledResult, { status: 'blocked', target: 'local', reason: 'missing-source-path' })

  const missingHarness = createHarness({
    fsPromises: { stat: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) } },
  })
  const missingResult = await missingHarness.controller.openDocumentLink(missingHarness.sourceWindow, '/workspace/missing.md')
  assert.deepEqual(missingResult, {
    status: 'blocked',
    target: 'local',
    reason: 'missing-file',
    displayName: 'missing.md',
  })
})

test('openDocumentLink resolves UNC-relative targets with Windows path semantics', async () => {
  const { controller, sourceWindow, calls } = createHarness({
    pathImpl: path.win32,
    ensureEditorRuntimeState: () => ({
      trackedFilePath: '\\\\wsl.localhost\\Ubuntu\\home\\user\\repo\\docs\\source.md',
    }),
  })

  await controller.openDocumentLink(sourceWindow, 'specs/graph%20semantics.md')

  assert.deepEqual(calls.find((call) => call[0] === 'stat'), [
    'stat',
    '\\\\wsl.localhost\\Ubuntu\\home\\user\\repo\\docs\\specs\\graph semantics.md',
  ])
})

test('openDocumentLink accepts a Markdown-normalized Windows drive absolute path', async () => {
  const { controller, sourceWindow, calls } = createHarness({
    pathImpl: path.win32,
  })

  const result = await controller.openDocumentLink(sourceWindow, 'C:%5CUsers%5Cwriter%5Cdocs%5Ctarget.md')

  assert.deepEqual(result, { status: 'opened', target: 'local', displayName: 'target.md' })
  assert.deepEqual(calls.find((call) => call[0] === 'stat'), [
    'stat',
    'C:\\Users\\writer\\docs\\target.md',
  ])
})

test('openDocumentLink blocks unsupported schemes and new managed-client windows', async () => {
  const unsupportedHarness = createHarness()
  const unsupportedResult = await unsupportedHarness.controller.openDocumentLink(unsupportedHarness.sourceWindow, 'mailto:user@example.com')
  assert.deepEqual(unsupportedResult, { status: 'blocked', target: 'local', reason: 'unsupported-scheme' })

  const managedHarness = createHarness({ isManagedClient: () => true })
  const managedResult = await managedHarness.controller.openDocumentLink(managedHarness.sourceWindow, '/workspace/docs/target.md')
  assert.deepEqual(managedResult, {
    status: 'blocked',
    target: 'local',
    reason: 'managed-client',
    displayName: 'target.md',
  })
  assert.equal(managedHarness.calls.some((call) => call[0] === 'create'), false)
})
