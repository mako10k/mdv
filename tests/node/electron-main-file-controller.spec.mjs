import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createFileController } = require('../../electron/lib/main/file-controller.cjs')

function createMessages() {
  return {
    buttons: {
      cancel: 'Cancel',
      close: 'Close',
      overwriteSave: 'Overwrite',
      saveAs: 'Save As',
      mergeSave: 'Merge',
    },
    externalLink: {
      allowAndRemember: 'Allow and remember',
      openOnce: 'Open once',
      title: 'Open external link',
      message: 'This link is not trusted yet.',
      suggestedRuleLabel: 'Suggested rule',
    },
    fileDialog: {
      markdownFilter: 'Markdown',
      htmlFilter: 'HTML',
      allFilesFilter: 'All files',
    },
    saveConflict: {
      title: 'Conflict',
      message: 'The file changed on disk.',
      detail: (targetPath) => `Conflict: ${targetPath}`,
      mergePreviewTitle: 'Merge preview',
      mergePreviewMessage: 'Preview merged result.',
      mergePreviewDetail: (targetPath, preview) => `${targetPath}\n${preview}`,
      mergePreviewContinue: 'Continue',
      mergeFailedTitle: 'Merge failed',
      mergeFailedMessage: 'Automatic merge failed.',
    },
  }
}

function createInMemoryFs(initialFiles = {}) {
  const files = new Map(Object.entries(initialFiles))

  return {
    files,
    readFileSync(filePath) {
      if (!files.has(filePath)) {
        const error = new Error('ENOENT')
        error.code = 'ENOENT'
        throw error
      }
      return files.get(filePath)
    },
    mkdirSync() {},
    writeFileSync(filePath, content) {
      files.set(filePath, content)
    },
  }
}

test('openExternalLink remembers allowed origin rule', async () => {
  const fs = createInMemoryFs()
  const opened = []
  const controller = createFileController({
    fs,
    fsPromises: {
      writeFile: async () => {},
      stat: async () => ({ mtimeMs: 1 }),
      readFile: async () => Buffer.from(''),
    },
    shell: {
      openExternal: async (href) => {
        opened.push(href)
      },
    },
    allowedLinkRulesPath: '/tmp/allowed-link-rules.json',
    getMainI18n: createMessages,
    getSettingsState: () => ({
      general: { openLinksBehavior: 'prompt' },
      safety: { confirmBeforeExternalUrlOpen: true },
    }),
    showMessageBox: async () => ({ response: 0 }),
    showSaveDialog: async () => ({ canceled: true }),
    writeLog: () => {},
    readOptionalUtf8File: async () => null,
    areFileSnapshotsEqual: () => false,
    buildMergePreviewText: () => '',
    createPatch: () => '',
    applyPatch: () => '',
    materializeDraftWorkspaceAssets: async (_workspace, _target, content) => content,
    materializePendingImportedAssets: async (_assets, _current, _target, content) => content,
    buildFileSnapshot: () => ({ path: '/tmp/out.md' }),
  })

  const result = await controller.openExternalLink(undefined, 'https://example.com/docs')

  assert.deepEqual(result, { status: 'opened' })
  assert.deepEqual(opened, ['https://example.com/docs'])
  assert.match(fs.files.get('/tmp/allowed-link-rules.json'), /https:\/\/example\.com\/\*/)
})

test('saveContentToPath writes content when no conflict is present', async () => {
  const writes = []
  const controller = createFileController({
    fs: createInMemoryFs(),
    fsPromises: {
      writeFile: async (filePath, content) => {
        writes.push({ filePath, content })
      },
      stat: async () => ({ mtimeMs: 1 }),
      readFile: async () => Buffer.from(''),
    },
    shell: { openExternal: async () => {} },
    allowedLinkRulesPath: '/tmp/allowed-link-rules.json',
    getMainI18n: createMessages,
    getSettingsState: () => ({
      general: { openLinksBehavior: 'prompt' },
      safety: { confirmBeforeExternalUrlOpen: true },
    }),
    showMessageBox: async () => ({ response: 0 }),
    showSaveDialog: async () => ({ canceled: false, filePath: '/tmp/out.md' }),
    writeLog: () => {},
    readOptionalUtf8File: async () => null,
    areFileSnapshotsEqual: () => false,
    buildMergePreviewText: () => '',
    createPatch: () => '',
    applyPatch: () => '',
    materializeDraftWorkspaceAssets: async (_workspace, _target, content) => content,
    materializePendingImportedAssets: async (_assets, _current, _target, content) => content,
    buildFileSnapshot: (filePath, content) => ({ path: filePath, size: content.length }),
  })

  const result = await controller.saveContentToPath(undefined, {
    content: '# Hello\n',
    defaultFileName: 'hello.md',
  })

  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0], { filePath: '/tmp/out.md', content: '# Hello\n' })
  assert.deepEqual(result, {
    status: 'saved',
    path: '/tmp/out.md',
    content: '# Hello\n',
    snapshot: { path: '/tmp/out.md', size: 8 },
  })
})

test('readRelativeAssetAsDataUrl ignores unsupported absolute urls', async () => {
  const controller = createFileController({
    fs: createInMemoryFs(),
    fsPromises: {
      writeFile: async () => {},
      stat: async () => ({ mtimeMs: 1 }),
      readFile: async () => Buffer.from('png'),
    },
    shell: { openExternal: async () => {} },
    allowedLinkRulesPath: '/tmp/allowed-link-rules.json',
    getMainI18n: createMessages,
    getSettingsState: () => ({
      general: { openLinksBehavior: 'prompt' },
      safety: { confirmBeforeExternalUrlOpen: true },
    }),
    showMessageBox: async () => ({ response: 0 }),
    showSaveDialog: async () => ({ canceled: true }),
    writeLog: () => {},
    readOptionalUtf8File: async () => null,
    areFileSnapshotsEqual: () => false,
    buildMergePreviewText: () => '',
    createPatch: () => '',
    applyPatch: () => '',
    materializeDraftWorkspaceAssets: async (_workspace, _target, content) => content,
    materializePendingImportedAssets: async (_assets, _current, _target, content) => content,
    buildFileSnapshot: () => ({ path: '/tmp/out.md' }),
  })

  assert.equal(await controller.readRelativeAssetAsDataUrl('/tmp/doc.md', 'https://example.com/a.png'), null)
  assert.equal(await controller.readRelativeAssetAsDataUrl('/tmp/doc.md', '/abs/a.png'), null)
})
