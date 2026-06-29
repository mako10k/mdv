import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchElectronApp as launchElectronAppBase } from './support/electron-launch'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control'

async function makeTempDir(prefix: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

async function launchElectronApp(options: {
  userDataDir: string
  args?: string[]
  env?: Record<string, string>
  dialogResponses?: {
    messageBox?: Array<{ response: number; checkboxChecked?: boolean }>
    saveDialog?: Array<{ canceled?: boolean; filePath?: string }>
    openDialog?: Array<{ canceled?: boolean; filePaths?: string[] }>
  }
}) {
  return launchElectronAppBase({
    repoRoot,
    args: ['.', ...(options.args ?? [])],
    env: {
      MDV_FORCE_STATIC_RENDERER: '1',
      MDV_E2E_USER_DATA_DIR: options.userDataDir,
      MDV_E2E_DIALOG_RESPONSES: JSON.stringify(options.dialogResponses ?? {}),
      ...(options.env ?? {}),
    },
  })
}

async function openWritePanel(page: import('@playwright/test').Page) {
  await page.locator('.view-switch button').nth(0).click()
  await expect(page.locator('.view-switch button').nth(0)).toHaveClass(/active/)
}

async function replaceMarkdownDocument(page: import('@playwright/test').Page, markdown: string) {
  const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()
  const selectAllShortcut = `${primaryModifier}+A`

  await editor.click()
  await page.keyboard.press(selectAllShortcut)
  await page.keyboard.press('Backspace')
  await page.keyboard.insertText(markdown)
}

async function triggerPrimaryShortcut(
  page: import('@playwright/test').Page,
  key: string,
  options?: { shiftKey?: boolean },
) {
  await page.evaluate(({ shortcutKey, isMac, shiftKey }) => {
    const event = new KeyboardEvent('keydown', {
      key: shortcutKey,
      bubbles: true,
      cancelable: true,
      ctrlKey: !isMac,
      metaKey: isMac,
      shiftKey,
    })

    window.dispatchEvent(event)
  }, {
    shortcutKey: key,
    isMac: process.platform === 'darwin',
    shiftKey: options?.shiftKey === true,
  })
}

function acceptBrowserDialogs(page: import('@playwright/test').Page) {
  page.on('dialog', async (dialog) => {
    try {
      await dialog.accept()
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('already handled')) {
        throw error
      }
    }
  })
}

async function stubMainReadFileForManualReload(
  app: import('playwright').ElectronApplication,
  targetFileName: string,
  content: string,
  contentHashes: string[] = [],
) {
  await app.evaluate(({ ipcMain }, { content: nextContent, contentHashes: nextContentHashes, targetFileName: nextTargetFileName }) => {
    let readFileCallCount = 0

    ipcMain.removeHandler('mdv:read-file')
    Reflect.set(globalThis, '__mdvManualReloadReadFileCallCount', () => readFileCallCount)

    ipcMain.handle('mdv:read-file', async (_event, filePath: unknown) => {
      readFileCallCount += 1

      if (typeof filePath !== 'string' || !filePath.replaceAll('\\', '/').endsWith(`/${nextTargetFileName}`)) {
        return null
      }

      return {
        path: filePath,
        content: nextContent,
        snapshot: {
          path: filePath,
          contentHash: nextContentHashes[readFileCallCount - 1] ?? `manual-reload-${readFileCallCount}`,
          size: new TextEncoder().encode(nextContent).length,
          mtimeMs: Date.now(),
        },
      }
    })
  }, { content, contentHashes, targetFileName })
}

async function getManualReloadReadFileCallCount(app: import('playwright').ElectronApplication) {
  return app.evaluate(() => {
    const getCount = Reflect.get(globalThis, '__mdvManualReloadReadFileCallCount')

    return typeof getCount === 'function' ? getCount() : 0
  })
}

async function readRecoveryStoreEntries(userDataDir: string) {
  const recoveryPath = path.join(userDataDir, 'autosave-recovery-v1.json')

  try {
    const parsed = JSON.parse(await fs.readFile(recoveryPath, 'utf8')) as { entries?: unknown[] }
    return Array.isArray(parsed.entries) ? parsed.entries : []
  } catch {
    return []
  }
}

async function forceCloseApp(app: import('playwright').ElectronApplication) {
  await app
    .evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.destroy()
      }
    })
    .catch(() => {})
}

async function buildSeedFileSnapshot(filePath: string, content: string) {
  const stat = await fs.stat(filePath)

  return {
    path: filePath,
    contentHash: createHash('sha256').update(content).digest('hex'),
    size: Buffer.byteLength(content, 'utf8'),
    mtimeMs: Number.isFinite(Number(stat.mtimeMs)) ? Number(stat.mtimeMs) : null,
  }
}

function unrelatedRecoveryEntry(filePath: string) {
  return {
    recoveryKey: `file:${filePath}`,
    savedAt: new Date().toISOString(),
    snapshot: {
      markdownText: '# Unrelated\n\nkeep me\n',
      persistedMarkdown: '# Unrelated\n\nbase\n',
      currentFilePath: filePath,
      fileSnapshot: null,
      displayTitle: path.basename(filePath),
      activePanel: 'write' as const,
      recoveryKey: 'unrelated-recovery',
    },
  }
}

function expectRecoveryKeys(entries: unknown[], expectedKeys: string[]) {
  expect(entries).toHaveLength(expectedKeys.length)
  expect(entries.map((entry) => (entry as { recoveryKey: string }).recoveryKey).sort()).toEqual([...expectedKeys].sort())
}

test('launch-open request wins before startup draft recovery prompt', async () => {
  const tempRoot = await makeTempDir('mdv-electron-e2e-')
  const userDataDir = path.join(tempRoot, 'user-data')
  const launchFilePath = path.join(tempRoot, 'launch-target.md')

  await fs.mkdir(userDataDir, { recursive: true })
  await fs.writeFile(launchFilePath, '# Launch Target\n\nopened via argv\n', 'utf8')
  await fs.writeFile(
    path.join(userDataDir, 'autosave-recovery-v1.json'),
    JSON.stringify({
      version: 1,
      entries: [
        {
          recoveryKey: 'draft:seed-draft-recovery',
          savedAt: new Date().toISOString(),
          snapshot: {
            markdownText: '# Recovery Draft\n\nthis should not interrupt launch open\n',
            persistedMarkdown: '',
            currentFilePath: null,
            fileSnapshot: null,
            displayTitle: '無題.md',
            activePanel: 'preview',
            recoveryKey: 'seed-draft-recovery',
          },
        },
      ],
    }, null, 2),
    'utf8',
  )

  const app = await launchElectronApp({ userDataDir, args: [launchFilePath] })

  try {
    const page = await app.firstWindow()
    const dialogs: string[] = []

    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message())
      await dialog.dismiss()
    })

    await expect.poll(async () => page.title()).toContain('launch-target.md - MDV')
    await expect(page.locator('.statusbar-status')).toContainText('launch-target.md')
    await expect(page.locator('.preview-panel')).toContainText('opened via argv')

    await page.waitForTimeout(1200)
    expect(dialogs).toEqual([])
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('conflict Save As clears stale recovery entries for both old and new paths', async () => {
  const tempRoot = await makeTempDir('mdv-electron-e2e-')
  const userDataDir = path.join(tempRoot, 'user-data')
  const originalFilePath = path.join(tempRoot, 'original.md')
  const saveAsFilePath = path.join(tempRoot, 'saved-as.md')
  const unrelatedFilePath = path.join(tempRoot, 'keep.md')

  await fs.mkdir(userDataDir, { recursive: true })
  await fs.writeFile(originalFilePath, '# Original\n\nbase\n', 'utf8')
  await fs.writeFile(saveAsFilePath, '# Stale Save As Recovery\n\nold\n', 'utf8')
  await fs.writeFile(unrelatedFilePath, '# Keep\n\nbase\n', 'utf8')
  const originalFileSnapshot = await buildSeedFileSnapshot(originalFilePath, '# Original\n\nbase\n')
  const saveAsFileSnapshot = await buildSeedFileSnapshot(saveAsFilePath, '# Stale Save As Recovery\n\nold\n')
  await fs.writeFile(
    path.join(userDataDir, 'autosave-recovery-v1.json'),
    JSON.stringify({
      version: 1,
      entries: [
        {
          recoveryKey: `file:${originalFilePath}`,
          savedAt: new Date().toISOString(),
          snapshot: {
            markdownText: '# Original\n\nrecovery A\n',
            persistedMarkdown: '# Original\n\nbase\n',
            currentFilePath: originalFilePath,
            fileSnapshot: originalFileSnapshot,
            displayTitle: 'original.md',
            activePanel: 'write',
            recoveryKey: 'original-recovery',
          },
        },
        {
          recoveryKey: `file:${saveAsFilePath}`,
          savedAt: new Date().toISOString(),
          snapshot: {
            markdownText: '# Saved As\n\nrecovery B\n',
            persistedMarkdown: '# Saved As\n\nbase\n',
            currentFilePath: saveAsFilePath,
            fileSnapshot: saveAsFileSnapshot,
            displayTitle: 'saved-as.md',
            activePanel: 'write',
            recoveryKey: 'save-as-recovery',
          },
        },
        unrelatedRecoveryEntry(unrelatedFilePath),
      ],
    }, null, 2),
    'utf8',
  )

  const app = await launchElectronApp({
    userDataDir,
    args: [originalFilePath],
    dialogResponses: {
      messageBox: [{ response: 1 }],
      saveDialog: [{ canceled: false, filePath: saveAsFilePath }],
    },
  })

  try {
    const page = await app.firstWindow()

    acceptBrowserDialogs(page)

    await expect.poll(async () => page.title()).toContain('original.md* - MDV')
    await openWritePanel(page)
    await replaceMarkdownDocument(page, '# Original\n\nupdated in editor\n')
    await fs.writeFile(originalFilePath, '# Original\n\nchanged on disk\n', 'utf8')

    await triggerPrimaryShortcut(page, 's')
    await expect(page.locator('.statusbar-status')).toContainText('saved-as.md')
    await expect.poll(async () => fs.readFile(saveAsFilePath, 'utf8')).toContain('updated in editor')

    await expect.poll(async () => readRecoveryStoreEntries(userDataDir)).toEqual([
      expect.objectContaining({ recoveryKey: `file:${unrelatedFilePath}` }),
    ])
  } finally {
    await app.close()
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('conflict Save As cancel preserves recovery entries and disk content', async () => {
  const tempRoot = await makeTempDir('mdv-electron-e2e-')
  const userDataDir = path.join(tempRoot, 'user-data')
  const originalFilePath = path.join(tempRoot, 'save-as-cancel.md')
  const unrelatedFilePath = path.join(tempRoot, 'save-as-cancel-keep.md')

  await fs.mkdir(userDataDir, { recursive: true })
  await fs.writeFile(originalFilePath, '# Save As Cancel\n\nbase\n', 'utf8')
  await fs.writeFile(unrelatedFilePath, '# Keep\n\nbase\n', 'utf8')
  const originalFileSnapshot = await buildSeedFileSnapshot(originalFilePath, '# Save As Cancel\n\nbase\n')
  await fs.writeFile(
    path.join(userDataDir, 'autosave-recovery-v1.json'),
    JSON.stringify({
      version: 1,
      entries: [
        {
          recoveryKey: `file:${originalFilePath}`,
          savedAt: new Date().toISOString(),
          snapshot: {
            markdownText: '# Save As Cancel\n\nrecovery\n',
            persistedMarkdown: '# Save As Cancel\n\nbase\n',
            currentFilePath: originalFilePath,
            fileSnapshot: originalFileSnapshot,
            displayTitle: 'save-as-cancel.md',
            activePanel: 'write',
            recoveryKey: 'save-as-cancel-recovery',
          },
        },
        unrelatedRecoveryEntry(unrelatedFilePath),
      ],
    }, null, 2),
    'utf8',
  )

  const app = await launchElectronApp({
    userDataDir,
    args: [originalFilePath],
    dialogResponses: {
      messageBox: [{ response: 1 }, { response: 2 }],
      saveDialog: [{ canceled: true }],
    },
  })

  try {
    const page = await app.firstWindow()

    acceptBrowserDialogs(page)

    await expect.poll(async () => page.title()).toContain('save-as-cancel.md* - MDV')
    await openWritePanel(page)
    await replaceMarkdownDocument(page, '# Save As Cancel\n\neditor update\n')
    await fs.writeFile(originalFilePath, '# Save As Cancel\n\ndisk update\n', 'utf8')

    await triggerPrimaryShortcut(page, 's')

    await expect(page.locator('.statusbar-status')).not.toContainText('保存しました')
    await expect.poll(async () => page.title()).toContain('save-as-cancel.md* - MDV')
    await expect.poll(async () => fs.readFile(originalFilePath, 'utf8')).toContain('disk update')
    const entries = await readRecoveryStoreEntries(userDataDir)
    expectRecoveryKeys(entries, [`file:${originalFilePath}`, `file:${unrelatedFilePath}`])
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('merge preview can redirect conflict save into Save As before writing', async () => {
  const tempRoot = await makeTempDir('mdv-electron-e2e-')
  const userDataDir = path.join(tempRoot, 'user-data')
  const originalFilePath = path.join(tempRoot, 'merge-preview.md')
  const saveAsFilePath = path.join(tempRoot, 'merge-preview-saved-as.md')

  await fs.mkdir(userDataDir, { recursive: true })
  await fs.writeFile(
    originalFilePath,
    '# Merge Preview\n\nline-01\nline-02\nline-03\nline-04\nline-05\nline-06\nline-07\nline-08\nline-09\nline-10\nline-11\nline-12\n',
    'utf8',
  )

  const app = await launchElectronApp({
    userDataDir,
    args: [originalFilePath],
    dialogResponses: {
      messageBox: [{ response: 2 }, { response: 1 }],
      saveDialog: [{ canceled: false, filePath: saveAsFilePath }],
    },
  })

  try {
    const page = await app.firstWindow()

    acceptBrowserDialogs(page)

    await expect.poll(async () => page.title()).toContain('merge-preview.md - MDV')
    await openWritePanel(page)
    await replaceMarkdownDocument(
      page,
      '# Merge Preview\n\nline-01\nline-02 editor\nline-03\nline-04\nline-05\nline-06\nline-07\nline-08\nline-09\nline-10\nline-11\nline-12\n',
    )
    await fs.writeFile(
      originalFilePath,
      '# Merge Preview\n\nline-01\nline-02\nline-03\nline-04\nline-05\nline-06\nline-07\nline-08\nline-09\nline-10\nline-11 disk\nline-12\n',
      'utf8',
    )

    await triggerPrimaryShortcut(page, 's')

    await expect(page.locator('.statusbar-status')).toContainText('merge-preview-saved-as.md')
    await expect.poll(async () => fs.readFile(saveAsFilePath, 'utf8')).toContain('line-02 editor')
    await expect.poll(async () => fs.readFile(saveAsFilePath, 'utf8')).not.toContain('line-11 disk')
    await expect.poll(async () => fs.readFile(originalFilePath, 'utf8')).toContain('line-11 disk')
    await expect.poll(async () => fs.readFile(originalFilePath, 'utf8')).not.toContain('line-02 editor')
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('clean tracked files auto-reload on-disk changes and report the refresh', async () => {
  const tempRoot = await makeTempDir('mdv-electron-e2e-')
  const userDataDir = path.join(tempRoot, 'user-data')
  const filePath = path.join(tempRoot, 'external-refresh.md')

  await fs.mkdir(userDataDir, { recursive: true })
  await fs.writeFile(filePath, '# External Refresh\n\nbase\n', 'utf8')

  const app = await launchElectronApp({
    userDataDir,
    args: [filePath],
  })

  try {
    const page = await app.firstWindow()

    acceptBrowserDialogs(page)

    await openWritePanel(page)
    const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()
    await expect(editor).toContainText('base')

    await fs.writeFile(filePath, '# External Refresh\n\nchanged on disk\n', 'utf8')

    await expect(editor).toContainText('changed on disk')
    await expect(page.locator('.statusbar-status')).toContainText(/(自動反映|Auto-reloaded)/)
    await expect(page.locator('.statusbar-status')).toContainText('external-refresh.md')
    await expect.poll(async () => page.title()).toContain('external-refresh.md - MDV')
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('manual file reload refreshes clean files, reports unchanged files, and preserves dirty buffers', async () => {
  const tempRoot = await makeTempDir('mdv-electron-e2e-')
  const userDataDir = path.join(tempRoot, 'user-data')
  const filePath = path.join(tempRoot, 'manual-reload.md')
  const reloadedContent = '# Manual Reload\n\nmanual bridge reload\n'

  await fs.mkdir(userDataDir, { recursive: true })
  await fs.writeFile(filePath, '# Manual Reload\n\nbase\n', 'utf8')

  const app = await launchElectronApp({
    userDataDir,
    args: [filePath],
  })

  try {
    const page = await app.firstWindow()

    acceptBrowserDialogs(page)

    await openWritePanel(page)
    const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()
    await expect(editor).toContainText('base')

    await stubMainReadFileForManualReload(app, 'manual-reload.md', reloadedContent, ['manual-reload-refreshed', 'manual-reload-refreshed'])
    await page.locator('button[title*="F5"]').first().click()

    await expect.poll(async () => getManualReloadReadFileCallCount(app)).toBeGreaterThan(0)
    await expect(editor).toContainText('manual bridge reload')
    await expect(page.locator('.statusbar-status')).toContainText(/(再読み込み|Reloaded)/)

    await page.locator('button[title*="F5"]').first().click()
    await expect.poll(async () => getManualReloadReadFileCallCount(app)).toBe(2)
    await expect(page.locator('.statusbar-status')).toContainText(/(最新|up to date)/)

    await replaceMarkdownDocument(page, '# Manual Reload\n\nunsaved edit\n')
    await expect.poll(async () => page.title()).toContain('manual-reload.md* - MDV')
    const readFileCallCountBeforeF5 = await getManualReloadReadFileCallCount(app)
    await page.keyboard.press('F5')

    await expect(editor).toContainText('unsaved edit')
    await expect(editor).not.toContainText('manual bridge reload')
    await expect.poll(async () => getManualReloadReadFileCallCount(app)).toBe(readFileCallCountBeforeF5)
    await expect(page.locator('.statusbar-status')).toContainText(/(未保存|unsaved)/)
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test.describe('close dialog clears recovery entries', () => {
  test('save on close preserves an unsaved pasted inline image draft', async () => {
    const tempRoot = await makeTempDir('mdv-electron-e2e-')
    const userDataDir = path.join(tempRoot, 'user-data')
    const saveFilePath = path.join(tempRoot, 'close-save-image.md')

    await fs.mkdir(userDataDir, { recursive: true })

    const app = await launchElectronApp({
      userDataDir,
      dialogResponses: {
        messageBox: [{ response: 0 }],
        saveDialog: [{ canceled: false, filePath: saveFilePath }],
      },
    })

    try {
      const page = await app.firstWindow()

      acceptBrowserDialogs(page)

      await openWritePanel(page)
      const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()
      await editor.click()
      await page.evaluate(() => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#0ea5e9"/></svg>'
        const file = new File([svg], 'close-save-image.svg', { type: 'image/svg+xml' })
        const dataTransfer = new DataTransfer()
        dataTransfer.items.add(file)
        const pasteEvent = new ClipboardEvent('paste', {
          clipboardData: dataTransfer,
          bubbles: true,
          cancelable: true,
        })

        document.dispatchEvent(pasteEvent)
      })

      await expect(editor).toContainText('![close-save-image.svg](')
      await expect(page.locator('.inline-data-image-widget').first()).toContainText('data:image/svg+xml;base64,')

      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.close()
      })

      await expect.poll(async () => (await app.windows()).length).toBe(0)
      await expect.poll(async () => fs.readFile(saveFilePath, 'utf8')).toContain('![close-save-image.svg](data:image/svg+xml;base64,')
      await expect.poll(async () => readRecoveryStoreEntries(userDataDir)).toEqual([])
    } finally {
      await forceCloseApp(app)
      await app.close().catch(() => {})
      await fs.rm(tempRoot, { recursive: true, force: true })
    }
  })

  test('discard on close removes an unsaved pasted inline image draft', async () => {
    const tempRoot = await makeTempDir('mdv-electron-e2e-')
    const userDataDir = path.join(tempRoot, 'user-data')
    const draftRoot = path.join(userDataDir, 'state', 'drafts')

    await fs.mkdir(userDataDir, { recursive: true })

    const app = await launchElectronApp({
      userDataDir,
      dialogResponses: {
        messageBox: [{ response: 2 }],
      },
    })

    try {
      const page = await app.firstWindow()

      acceptBrowserDialogs(page)

      await openWritePanel(page)
      const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()
      await editor.click()
      await page.evaluate(() => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#f59e0b"/></svg>'
        const file = new File([svg], 'draft-discard-image.svg', { type: 'image/svg+xml' })
        const dataTransfer = new DataTransfer()
        dataTransfer.items.add(file)
        const pasteEvent = new ClipboardEvent('paste', {
          clipboardData: dataTransfer,
          bubbles: true,
          cancelable: true,
        })

        document.dispatchEvent(pasteEvent)
      })

      await expect(editor).toContainText('![draft-discard-image.svg](')
      await expect(page.locator('.inline-data-image-widget').first()).toContainText('data:image/svg+xml;base64,')
      await expect.poll(async () => fs.readdir(draftRoot)).toHaveLength(1)

      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.close()
      })

      await expect.poll(async () => (await app.windows()).length).toBe(0)
      await expect.poll(async () => fs.readdir(draftRoot).catch(() => [])).toEqual([])
      await expect.poll(async () => readRecoveryStoreEntries(userDataDir)).toEqual([])
    } finally {
      await forceCloseApp(app)
      await app.close().catch(() => {})
      await fs.rm(tempRoot, { recursive: true, force: true })
    }
  })

  test('save on close clears recovery and writes editor content', async () => {
    const tempRoot = await makeTempDir('mdv-electron-e2e-')
    const userDataDir = path.join(tempRoot, 'user-data')
    const filePath = path.join(tempRoot, 'close-save.md')
    const unrelatedFilePath = path.join(tempRoot, 'close-save-keep.md')

    await fs.mkdir(userDataDir, { recursive: true })
    await fs.writeFile(filePath, '# Close Save\n\nbase\n', 'utf8')
    await fs.writeFile(unrelatedFilePath, '# Keep\n\nbase\n', 'utf8')
    const fileSnapshot = await buildSeedFileSnapshot(filePath, '# Close Save\n\nbase\n')
    await fs.writeFile(
      path.join(userDataDir, 'autosave-recovery-v1.json'),
      JSON.stringify({
        version: 1,
        entries: [
          {
            recoveryKey: `file:${filePath}`,
            savedAt: new Date().toISOString(),
            snapshot: {
              markdownText: '# Close Save\n\nrecovery\n',
              persistedMarkdown: '# Close Save\n\nbase\n',
              currentFilePath: filePath,
              fileSnapshot,
              displayTitle: 'close-save.md',
              activePanel: 'write',
              recoveryKey: 'close-save-recovery',
            },
          },
          unrelatedRecoveryEntry(unrelatedFilePath),
        ],
      }, null, 2),
      'utf8',
    )

    const app = await launchElectronApp({
      userDataDir,
      args: [filePath],
      dialogResponses: {
        messageBox: [{ response: 0 }],
      },
    })

    try {
      const page = await app.firstWindow()

      acceptBrowserDialogs(page)

      await expect.poll(async () => page.title()).toContain('close-save.md* - MDV')
      await openWritePanel(page)
      await replaceMarkdownDocument(page, '# Close Save\n\nsaved on close\n')

      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.close()
      })

      await expect.poll(async () => (await app.windows()).length).toBe(0)
      await expect.poll(async () => fs.readFile(filePath, 'utf8')).toContain('saved on close')
      await expect.poll(async () => readRecoveryStoreEntries(userDataDir)).toEqual([
        expect.objectContaining({ recoveryKey: `file:${unrelatedFilePath}` }),
      ])
    } finally {
      await forceCloseApp(app)
      await app.close().catch(() => {})
      await fs.rm(tempRoot, { recursive: true, force: true })
    }
  })

  test('save as on close preserves inline image Markdown after a save conflict', async () => {
    const tempRoot = await makeTempDir('mdv-electron-e2e-')
    const userDataDir = path.join(tempRoot, 'user-data')
    const sourceDir = path.join(tempRoot, 'close-save-as-source')
    const targetDir = path.join(tempRoot, 'close-save-as-target')
    const filePath = path.join(sourceDir, 'close-save-as.md')
    const saveAsPath = path.join(targetDir, 'close-save-as-target.md')

    await fs.mkdir(userDataDir, { recursive: true })
    await fs.mkdir(sourceDir, { recursive: true })
    await fs.mkdir(targetDir, { recursive: true })
    await fs.writeFile(filePath, '# Close Save As\n\nbase\n', 'utf8')

    const app = await launchElectronApp({
      userDataDir,
      args: [filePath],
      dialogResponses: {
        messageBox: [{ response: 0 }, { response: 1 }],
        saveDialog: [{ canceled: false, filePath: saveAsPath }],
      },
    })

    try {
      const page = await app.firstWindow()

      acceptBrowserDialogs(page)

      await openWritePanel(page)
      const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()
      await editor.click()
      await page.evaluate(() => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#3b82f6"/></svg>'
        const file = new File([svg], 'close-save-as-image.svg', { type: 'image/svg+xml' })
        const dataTransfer = new DataTransfer()
        dataTransfer.items.add(file)
        const dropEvent = new DragEvent('drop', {
          dataTransfer,
          bubbles: true,
          cancelable: true,
        })

        document.querySelector('.workspace')?.dispatchEvent(dropEvent)
      })

      await expect(editor).toContainText('![close-save-as-image.svg](')
      await expect(page.locator('.inline-data-image-widget').first()).toContainText('data:image/svg+xml;base64,')
      await fs.writeFile(filePath, '# Close Save As\n\ndisk update\n', 'utf8')

      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.close()
      })

      await expect.poll(async () => (await app.windows()).length).toBe(0)
      await expect.poll(async () => fs.readFile(saveAsPath, 'utf8')).toContain('![close-save-as-image.svg](data:image/svg+xml;base64,')
      await expect.poll(async () => fs.readFile(filePath, 'utf8')).toContain('disk update')
    } finally {
      await forceCloseApp(app)
      await app.close().catch(() => {})
      await fs.rm(tempRoot, { recursive: true, force: true })
    }
  })

  test('discard on close clears recovery and keeps disk content unchanged', async () => {
    const tempRoot = await makeTempDir('mdv-electron-e2e-')
    const userDataDir = path.join(tempRoot, 'user-data')
    const filePath = path.join(tempRoot, 'close-discard.md')
    const unrelatedFilePath = path.join(tempRoot, 'close-discard-keep.md')

    await fs.mkdir(userDataDir, { recursive: true })
    await fs.writeFile(filePath, '# Close Discard\n\nbase\n', 'utf8')
    await fs.writeFile(unrelatedFilePath, '# Keep\n\nbase\n', 'utf8')
    const fileSnapshot = await buildSeedFileSnapshot(filePath, '# Close Discard\n\nbase\n')
    await fs.writeFile(
      path.join(userDataDir, 'autosave-recovery-v1.json'),
      JSON.stringify({
        version: 1,
        entries: [
          {
            recoveryKey: `file:${filePath}`,
            savedAt: new Date().toISOString(),
            snapshot: {
              markdownText: '# Close Discard\n\nrecovery\n',
              persistedMarkdown: '# Close Discard\n\nbase\n',
              currentFilePath: filePath,
              fileSnapshot,
              displayTitle: 'close-discard.md',
              activePanel: 'write',
              recoveryKey: 'close-discard-recovery',
            },
          },
          unrelatedRecoveryEntry(unrelatedFilePath),
        ],
      }, null, 2),
      'utf8',
    )

    const app = await launchElectronApp({
      userDataDir,
      args: [filePath],
      dialogResponses: {
        messageBox: [{ response: 2 }],
      },
    })

    try {
      const page = await app.firstWindow()

      acceptBrowserDialogs(page)

      await expect.poll(async () => page.title()).toContain('close-discard.md* - MDV')
      await openWritePanel(page)
      await replaceMarkdownDocument(page, '# Close Discard\n\nunsaved discarded\n')

      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.close()
      })

      await expect.poll(async () => (await app.windows()).length).toBe(0)
      await expect.poll(async () => fs.readFile(filePath, 'utf8')).toContain('base')
      await expect.poll(async () => fs.readFile(filePath, 'utf8')).not.toContain('unsaved discarded')
      await expect.poll(async () => readRecoveryStoreEntries(userDataDir)).toEqual([
        expect.objectContaining({ recoveryKey: `file:${unrelatedFilePath}` }),
      ])
    } finally {
      await forceCloseApp(app)
      await app.close().catch(() => {})
      await fs.rm(tempRoot, { recursive: true, force: true })
    }
  })

  test('discard on close drops unsaved inline image Markdown from a saved document', async () => {
    const tempRoot = await makeTempDir('mdv-electron-e2e-')
    const userDataDir = path.join(tempRoot, 'user-data')
    const filePath = path.join(tempRoot, 'close-discard-image.md')

    await fs.mkdir(userDataDir, { recursive: true })
    await fs.writeFile(filePath, '# Close Discard Image\n\nbase\n', 'utf8')

    const app = await launchElectronApp({
      userDataDir,
      args: [filePath],
      dialogResponses: {
        messageBox: [{ response: 2 }],
      },
    })

    try {
      const page = await app.firstWindow()

      acceptBrowserDialogs(page)

      await openWritePanel(page)
      const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()
      await editor.click()
      await page.evaluate(() => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="8" fill="#ef4444"/></svg>'
        const file = new File([svg], 'close-discard-image-source.svg', { type: 'image/svg+xml' })
        const dataTransfer = new DataTransfer()
        dataTransfer.items.add(file)
        const dropEvent = new DragEvent('drop', {
          dataTransfer,
          bubbles: true,
          cancelable: true,
        })

        document.querySelector('.workspace')?.dispatchEvent(dropEvent)
      })

      await expect(editor).toContainText('![close-discard-image-source.svg](')
      await expect(page.locator('.inline-data-image-widget').first()).toContainText('data:image/svg+xml;base64,')

      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.close()
      })

      await expect.poll(async () => (await app.windows()).length).toBe(0)
      await expect.poll(async () => fs.readFile(filePath, 'utf8')).toContain('base')
      await expect.poll(async () => fs.readFile(filePath, 'utf8')).not.toContain('close-discard-image-source.svg')
    } finally {
      await forceCloseApp(app)
      await app.close().catch(() => {})
      await fs.rm(tempRoot, { recursive: true, force: true })
    }
  })

  test('cancel on close preserves recovery entries and keeps the window open', async () => {
    const tempRoot = await makeTempDir('mdv-electron-e2e-')
    const userDataDir = path.join(tempRoot, 'user-data')
    const filePath = path.join(tempRoot, 'close-cancel.md')
    const unrelatedFilePath = path.join(tempRoot, 'close-cancel-keep.md')

    await fs.mkdir(userDataDir, { recursive: true })
    await fs.writeFile(filePath, '# Close Cancel\n\nbase\n', 'utf8')
    await fs.writeFile(unrelatedFilePath, '# Keep\n\nbase\n', 'utf8')
    const fileSnapshot = await buildSeedFileSnapshot(filePath, '# Close Cancel\n\nbase\n')
    await fs.writeFile(
      path.join(userDataDir, 'autosave-recovery-v1.json'),
      JSON.stringify({
        version: 1,
        entries: [
          {
            recoveryKey: `file:${filePath}`,
            savedAt: new Date().toISOString(),
            snapshot: {
              markdownText: '# Close Cancel\n\nrecovery\n',
              persistedMarkdown: '# Close Cancel\n\nbase\n',
              currentFilePath: filePath,
              fileSnapshot,
              displayTitle: 'close-cancel.md',
              activePanel: 'write',
              recoveryKey: 'close-cancel-recovery',
            },
          },
          unrelatedRecoveryEntry(unrelatedFilePath),
        ],
      }, null, 2),
      'utf8',
    )

    const app = await launchElectronApp({
      userDataDir,
      args: [filePath],
      dialogResponses: {
        messageBox: [{ response: 1 }, { response: 2 }],
      },
    })

    try {
      const page = await app.firstWindow()

      acceptBrowserDialogs(page)

      await expect.poll(async () => page.title()).toContain('close-cancel.md* - MDV')
      await openWritePanel(page)
      await replaceMarkdownDocument(page, '# Close Cancel\n\nunsaved edit\n')

      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.close()
      })

      await expect.poll(async () => (await app.windows()).length).toBe(1)
      await expect.poll(async () => page.title()).toContain('close-cancel.md* - MDV')
      await expect.poll(async () => fs.readFile(filePath, 'utf8')).toContain('base')
      const entries = await readRecoveryStoreEntries(userDataDir)
      expectRecoveryKeys(entries, [`file:${filePath}`, `file:${unrelatedFilePath}`])
    } finally {
      await forceCloseApp(app)
      await app.close().catch(() => {})
      await fs.rm(tempRoot, { recursive: true, force: true })
    }
  })
})

test('pasted image into an unsaved document remains inline on first save', async () => {
  const tempRoot = await makeTempDir('mdv-electron-e2e-')
  const userDataDir = path.join(tempRoot, 'user-data')
  const saveFilePath = path.join(tempRoot, 'pasted-image.md')

  await fs.mkdir(userDataDir, { recursive: true })

  const app = await launchElectronApp({
    userDataDir,
    dialogResponses: {
      saveDialog: [{ canceled: false, filePath: saveFilePath }],
    },
  })

  try {
    const page = await app.firstWindow()

    acceptBrowserDialogs(page)

    await openWritePanel(page)
    const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()
    await editor.click()
    await page.evaluate(() => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#0ea5e9"/></svg>'
      const file = new File([svg], 'diagram.svg', { type: 'image/svg+xml' })
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file)
      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true,
      })

      document.dispatchEvent(pasteEvent)
    })

    await expect(editor).toContainText('![diagram.svg](')
    await expect(page.locator('.inline-data-image-widget').first()).toContainText('data:image/svg+xml;base64,')
    await triggerPrimaryShortcut(page, 's')

    await expect(page.locator('.statusbar-status')).toContainText('pasted-image.md')
    await expect.poll(async () => fs.readFile(saveFilePath, 'utf8')).toContain('![diagram.svg](data:image/svg+xml;base64,')
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('pasted image remains visible in preview after first save', async () => {
  const tempRoot = await makeTempDir('mdv-electron-e2e-')
  const userDataDir = path.join(tempRoot, 'user-data')
  const saveFilePath = path.join(tempRoot, 'pasted-image-preview.md')

  await fs.mkdir(userDataDir, { recursive: true })

  const app = await launchElectronApp({
    userDataDir,
    dialogResponses: {
      saveDialog: [{ canceled: false, filePath: saveFilePath }],
    },
  })

  try {
    const page = await app.firstWindow()

    acceptBrowserDialogs(page)

    await openWritePanel(page)
    const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()
    await editor.click()
    await page.evaluate(() => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#0ea5e9"/></svg>'
      const file = new File([svg], 'diagram.svg', { type: 'image/svg+xml' })
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file)
      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true,
      })

      document.dispatchEvent(pasteEvent)
    })

    await expect(editor).toContainText('![diagram.svg](')
    await expect(page.locator('.inline-data-image-widget').first()).toContainText('data:image/svg+xml;base64,')
    await triggerPrimaryShortcut(page, 's')

    await expect(page.locator('.statusbar-status')).toContainText('pasted-image-preview.md')
    await page.locator('.view-switch button').nth(1).click()
    await expect(page.locator('.view-switch button').nth(1)).toHaveClass(/active/)

    const image = page.locator('.preview-panel img').first()
    await expect(image).toHaveAttribute('alt', 'diagram.svg')
    await expect(image).toHaveAttribute('src', /^data:image\/svg\+xml;base64,|^data:image\/svg;base64,/)
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('repeated pasted images into an unsaved document remain widgetized on first save', async () => {
  const tempRoot = await makeTempDir('mdv-electron-e2e-')
  const userDataDir = path.join(tempRoot, 'user-data')
  const saveFilePath = path.join(tempRoot, 'repeated-pasted-images.md')

  await fs.mkdir(userDataDir, { recursive: true })

  const app = await launchElectronApp({
    userDataDir,
    dialogResponses: {
      saveDialog: [{ canceled: false, filePath: saveFilePath }],
    },
  })

  try {
    const page = await app.firstWindow()

    acceptBrowserDialogs(page)

    await openWritePanel(page)
    const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()
    await editor.click()

    async function pasteSvg(fileName: string, color: string) {
      await page.evaluate(({ pastedFileName, fillColor }) => {
        const target = document.querySelector('.toastui-editor-md-container .ProseMirror')

        if (!target) {
          throw new Error('ProseMirror target not found')
        }

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="${fillColor}"/></svg>`
        const file = new File([svg], pastedFileName, { type: 'image/svg+xml' })
        const dataTransfer = new DataTransfer()
        dataTransfer.items.add(file)
        const pasteEvent = new ClipboardEvent('paste', {
          clipboardData: dataTransfer,
          bubbles: true,
          cancelable: true,
        })

        target.dispatchEvent(pasteEvent)
      }, { pastedFileName: fileName, fillColor: color })
    }

    await page.evaluate(() => {
      const target = document.querySelector('.toastui-editor-md-container .ProseMirror')

      if (!target) {
        throw new Error('ProseMirror target not found')
      }

      target.addEventListener('paste', () => {
        const smokeWindow = window as Window & { __mdvDownstreamPasteCount?: number }
        smokeWindow.__mdvDownstreamPasteCount = (smokeWindow.__mdvDownstreamPasteCount ?? 0) + 1
      })
    })

    await pasteSvg('first-paste.svg', '#22c55e')
    await expect(editor).toContainText('![first-paste.svg](')

    await pasteSvg('second-paste.svg', '#38bdf8')
    await expect(editor).toContainText('![first-paste.svg](')
    await expect(editor).toContainText('![second-paste.svg](')
    await expect.poll(async () => page.locator('.inline-data-image-widget').count()).toBeGreaterThanOrEqual(2)
    await expect(editor).not.toContainText('PHN2Zy')
    await expect(editor).not.toContainText('<svg')
    await expect.poll(async () => page.evaluate(() => {
      const smokeWindow = window as Window & { __mdvDownstreamPasteCount?: number }
      return smokeWindow.__mdvDownstreamPasteCount ?? 0
    })).toBe(0)

    await triggerPrimaryShortcut(page, 's')

    await expect(page.locator('.statusbar-status')).toContainText('repeated-pasted-images.md')
    await expect.poll(async () => fs.readFile(saveFilePath, 'utf8')).toContain('![first-paste.svg](data:image/svg+xml;base64,')
    await expect.poll(async () => fs.readFile(saveFilePath, 'utf8')).toContain('![second-paste.svg](data:image/svg+xml;base64,')
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('saved relative image renders in preview when opening an existing file', async () => {
  const tempRoot = await makeTempDir('mdv-electron-e2e-')
  const userDataDir = path.join(tempRoot, 'user-data')
  const assetsDir = path.join(tempRoot, 'assets')
  const filePath = path.join(tempRoot, 'saved-preview-image.md')
  const imagePath = path.join(assetsDir, 'preview-diagram.svg')

  await fs.mkdir(userDataDir, { recursive: true })
  await fs.mkdir(assetsDir, { recursive: true })
  await fs.writeFile(imagePath, '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#22c55e"/></svg>', 'utf8')
  await fs.writeFile(filePath, '# Saved Preview Image\n\n![preview-diagram](assets/preview-diagram.svg)\n', 'utf8')

  const app = await launchElectronApp({
    userDataDir,
    args: [filePath],
  })

  try {
    const page = await app.firstWindow()

    await expect.poll(async () => page.title()).toContain('saved-preview-image.md - MDV')
    await expect(page.locator('.view-switch button').nth(1)).toHaveClass(/active/)

    const image = page.locator('.preview-panel img').first()
    await expect(image).toHaveAttribute('alt', 'preview-diagram')
    await expect(image).toHaveAttribute('src', /^data:image\/svg\+xml;base64,|^data:image\/svg;base64,/)
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('saved relative image export inlines image data', async () => {
  const tempRoot = await makeTempDir('mdv-electron-e2e-')
  const userDataDir = path.join(tempRoot, 'user-data')
  const assetsDir = path.join(tempRoot, 'assets')
  const filePath = path.join(tempRoot, 'saved-export-image.md')
  const imagePath = path.join(assetsDir, 'export-diagram.svg')
  const exportPath = path.join(tempRoot, 'saved-export-image.html')

  await fs.mkdir(userDataDir, { recursive: true })
  await fs.mkdir(assetsDir, { recursive: true })
  await fs.writeFile(imagePath, '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#22c55e"/></svg>', 'utf8')
  await fs.writeFile(filePath, '# Saved Export Image\n\n![export-diagram](assets/export-diagram.svg)\n', 'utf8')

  const app = await launchElectronApp({
    userDataDir,
    args: [filePath],
    dialogResponses: {
      saveDialog: [{ canceled: false, filePath: exportPath }],
    },
  })

  try {
    const page = await app.firstWindow()

    await expect.poll(async () => page.title()).toContain('saved-export-image.md - MDV')
    await expect(page.locator('.preview-panel img').first()).toHaveAttribute('src', /^data:image\/svg\+xml;base64,|^data:image\/svg;base64,/)
    await page.locator('button[aria-label="HTML を書き出し"], button[aria-label="Export HTML"]').click()

    await expect.poll(async () => fs.readFile(exportPath, 'utf8')).toContain('Saved Export Image')
    const html = await fs.readFile(exportPath, 'utf8')
    expect(html).toContain('src="data:image/svg+xml;base64,')
    expect(html).toContain('alt="export-diagram"')
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('missing relative image shows a preview fallback when opening an existing file', async () => {
  const tempRoot = await makeTempDir('mdv-electron-e2e-')
  const userDataDir = path.join(tempRoot, 'user-data')
  const filePath = path.join(tempRoot, 'missing-preview-image.md')

  await fs.mkdir(userDataDir, { recursive: true })
  await fs.writeFile(filePath, '# Missing Preview Image\n\n![missing-diagram](assets/missing-diagram.svg)\n', 'utf8')

  const app = await launchElectronApp({
    userDataDir,
    args: [filePath],
  })

  try {
    const page = await app.firstWindow()

    await expect.poll(async () => page.title()).toContain('missing-preview-image.md - MDV')
    await expect(page.locator('.view-switch button').nth(1)).toHaveClass(/active/)
    await expect(page.locator('.preview-image-fallback')).toContainText('Missing image: assets/missing-diagram.svg')
    await expect(page.locator('.preview-panel img').first()).toHaveAttribute('data-mdv-image-state', 'missing')
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('removed inline image reference is not saved on first save', async () => {
  const tempRoot = await makeTempDir('mdv-electron-e2e-')
  const userDataDir = path.join(tempRoot, 'user-data')
  const saveFilePath = path.join(tempRoot, 'removed-draft-image.md')

  await fs.mkdir(userDataDir, { recursive: true })

  const app = await launchElectronApp({
    userDataDir,
    dialogResponses: {
      saveDialog: [{ canceled: false, filePath: saveFilePath }],
    },
  })

  try {
    const page = await app.firstWindow()

    acceptBrowserDialogs(page)

    await openWritePanel(page)
    const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()
    await editor.click()
    await page.evaluate(() => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#8b5cf6"/></svg>'
      const file = new File([svg], 'removed-diagram.svg', { type: 'image/svg+xml' })
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file)
      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true,
      })

      document.dispatchEvent(pasteEvent)
    })

    await expect(editor).toContainText('![removed-diagram.svg](')
    await expect(page.locator('.inline-data-image-widget').first()).toContainText('data:image/svg+xml;base64,')
    await replaceMarkdownDocument(page, '# Removed Draft Image\n\nno image\n')
    await triggerPrimaryShortcut(page, 's')

    await expect(page.locator('.statusbar-status')).toContainText('removed-draft-image.md')
    await expect.poll(async () => fs.readFile(saveFilePath, 'utf8')).toContain('no image')
    await expect.poll(async () => fs.readFile(saveFilePath, 'utf8')).not.toContain('removed-diagram.svg')
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('restored unsaved pasted inline image draft remains inline after restart', async () => {
  const tempRoot = await makeTempDir('mdv-electron-e2e-')
  const userDataDir = path.join(tempRoot, 'user-data')
  const saveFilePath = path.join(tempRoot, 'restored-image.md')

  await fs.mkdir(userDataDir, { recursive: true })

  const firstApp = await launchElectronApp({ userDataDir })

  try {
    const page = await firstApp.firstWindow()

    acceptBrowserDialogs(page)

    await openWritePanel(page)
    const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()
    await editor.click()
    await page.evaluate(() => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#f97316"/></svg>'
      const file = new File([svg], 'restored-diagram.svg', { type: 'image/svg+xml' })
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file)
      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true,
      })

      document.dispatchEvent(pasteEvent)
    })

    await expect(editor).toContainText('![restored-diagram.svg](')
    await expect(page.locator('.inline-data-image-widget').first()).toContainText('data:image/svg+xml;base64,')
    await expect.poll(async () => readRecoveryStoreEntries(userDataDir)).toEqual([
      expect.objectContaining({
        snapshot: expect.objectContaining({
          markdownText: expect.stringContaining('![restored-diagram.svg](data:image/svg+xml;base64,'),
        }),
      }),
    ])
  } finally {
    await forceCloseApp(firstApp)
    await firstApp.close().catch(() => {})
  }

  const secondApp = await launchElectronApp({
    userDataDir,
    env: {
      MDV_E2E_AUTO_ACCEPT_RECOVERY: '1',
    },
    dialogResponses: {
      saveDialog: [{ canceled: false, filePath: saveFilePath }],
    },
  })

  try {
    secondApp.context().on('page', acceptBrowserDialogs)
    const page = await secondApp.firstWindow()

    const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()
    await openWritePanel(page)
    await expect(editor).toContainText('![restored-diagram.svg](')
    await expect(page.locator('.inline-data-image-widget').first()).toContainText('data:image/svg+xml;base64,')

    await triggerPrimaryShortcut(page, 's')

    await expect(page.locator('.statusbar-status')).toContainText('restored-image.md')
    await expect.poll(async () => fs.readFile(saveFilePath, 'utf8')).toContain('![restored-diagram.svg](data:image/svg+xml;base64,')
  } finally {
    await forceCloseApp(secondApp)
    await secondApp.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('declining saved-file recovery drops unsaved inline image Markdown created before restart', async () => {
  const tempRoot = await makeTempDir('mdv-electron-e2e-')
  const userDataDir = path.join(tempRoot, 'user-data')
  const filePath = path.join(tempRoot, 'recovery-decline-target.md')

  await fs.mkdir(userDataDir, { recursive: true })
  await fs.writeFile(filePath, '# Recovery Decline\n\nbase\n', 'utf8')

  const firstApp = await launchElectronApp({
    userDataDir,
    args: [filePath],
  })

  try {
    const page = await firstApp.firstWindow()

    acceptBrowserDialogs(page)

    await openWritePanel(page)
    const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()
    await editor.click()
    await page.evaluate(() => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="8" fill="#14b8a6"/></svg>'
      const file = new File([svg], 'recovery-decline-source.svg', { type: 'image/svg+xml' })
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file)
      const dropEvent = new DragEvent('drop', {
        dataTransfer,
        bubbles: true,
        cancelable: true,
      })

      document.querySelector('.workspace')?.dispatchEvent(dropEvent)
    })

    await expect(editor).toContainText('![recovery-decline-source.svg](')
    await expect(page.locator('.inline-data-image-widget').first()).toContainText('data:image/svg+xml;base64,')
    await expect.poll(async () => readRecoveryStoreEntries(userDataDir)).toEqual([
      expect.objectContaining({
        snapshot: expect.objectContaining({
          markdownText: expect.stringContaining('![recovery-decline-source.svg](data:image/svg+xml;base64,'),
        }),
      }),
    ])
  } finally {
    await forceCloseApp(firstApp)
    await firstApp.close().catch(() => {})
  }

  const secondApp = await launchElectronApp({
    userDataDir,
    args: [filePath],
    env: {
      MDV_E2E_AUTO_DECLINE_RECOVERY: '1',
    },
  })

  try {
    const page = await secondApp.firstWindow()

    acceptBrowserDialogs(page)

    await expect.poll(async () => page.title()).toContain('recovery-decline-target.md - MDV')
    await expect.poll(async () => fs.readFile(filePath, 'utf8')).toContain('base')
    await expect.poll(async () => fs.readFile(filePath, 'utf8')).not.toContain('recovery-decline-source.svg')
    await expect.poll(async () => readRecoveryStoreEntries(userDataDir)).toEqual([])
  } finally {
    await forceCloseApp(secondApp)
    await secondApp.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('save as preserves pasted inline image Markdown beside the new markdown file', async () => {
  const tempRoot = await makeTempDir('mdv-electron-e2e-')
  const userDataDir = path.join(tempRoot, 'user-data')
  const sourceDir = path.join(tempRoot, 'source')
  const targetDir = path.join(tempRoot, 'target')
  const filePath = path.join(sourceDir, 'save-as-source.md')
  const saveAsPath = path.join(targetDir, 'save-as-target.md')

  await fs.mkdir(userDataDir, { recursive: true })
  await fs.mkdir(sourceDir, { recursive: true })
  await fs.mkdir(targetDir, { recursive: true })
  await fs.writeFile(filePath, '# Save As Source\n\nbody\n', 'utf8')

  const app = await launchElectronApp({
    userDataDir,
    args: [filePath],
    dialogResponses: {
      saveDialog: [{ canceled: false, filePath: saveAsPath }],
    },
  })

  try {
    const page = await app.firstWindow()

    acceptBrowserDialogs(page)

    await openWritePanel(page)
    const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()
    await editor.click()
    await page.evaluate(() => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#22c55e"/></svg>'
      const file = new File([svg], 'save-as-image-source.svg', { type: 'image/svg+xml' })
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file)
      const dropEvent = new DragEvent('drop', {
        dataTransfer,
        bubbles: true,
        cancelable: true,
      })

      document.querySelector('.workspace')?.dispatchEvent(dropEvent)
    })

    await expect(editor).toContainText('![save-as-image-source.svg](')
    await expect(page.locator('.inline-data-image-widget').first()).toContainText('data:image/svg+xml;base64,')

    await triggerPrimaryShortcut(page, 's', { shiftKey: true })

    await expect(page.locator('.statusbar-status')).toContainText('save-as-target.md')
    await expect.poll(async () => fs.readFile(saveAsPath, 'utf8')).toContain('![save-as-image-source.svg](data:image/svg+xml;base64,')
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('opening a file from a clean untitled buffer cleans up the proactive draft workspace', async () => {
  const tempRoot = await makeTempDir('mdv-electron-e2e-')
  const userDataDir = path.join(tempRoot, 'user-data')
  const droppedFilePath = path.join(tempRoot, 'opened-from-clean-drop.md')
  const draftRoot = path.join(userDataDir, 'state', 'drafts')

  await fs.mkdir(userDataDir, { recursive: true })
  await fs.writeFile(droppedFilePath, '# Clean Drop\n\nopened\n', 'utf8')

  const app = await launchElectronApp({ userDataDir })

  try {
    const page = await app.firstWindow()

    acceptBrowserDialogs(page)

    await expect.poll(async () => fs.readdir(draftRoot).catch(() => [])).toHaveLength(1)
    await page.evaluate((assetUrl) => {
      const file = new File(['# Clean Drop\n\nopened\n'], 'opened-from-clean-drop.md', { type: 'text/markdown' })
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file)
      dataTransfer.setData('text/uri-list', assetUrl)
      const dropEvent = new DragEvent('drop', {
        dataTransfer,
        bubbles: true,
        cancelable: true,
      })

      document.querySelector('.workspace')?.dispatchEvent(dropEvent)
    }, `file://${droppedFilePath}`)

    await expect.poll(async () => page.title()).toContain('opened-from-clean-drop.md - MDV')
    await expect.poll(async () => fs.readdir(draftRoot).catch(() => [])).toEqual([])
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('closing a clean untitled buffer cleans up the proactive draft workspace', async () => {
  const tempRoot = await makeTempDir('mdv-electron-e2e-')
  const userDataDir = path.join(tempRoot, 'user-data')
  const draftRoot = path.join(userDataDir, 'state', 'drafts')

  await fs.mkdir(userDataDir, { recursive: true })

  const app = await launchElectronApp({ userDataDir })

  try {
    await app.firstWindow()

    await expect.poll(async () => fs.readdir(draftRoot).catch(() => [])).toHaveLength(1)

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close()
    })

    await expect.poll(async () => (await app.windows()).length).toBe(0)
    await expect.poll(async () => fs.readdir(draftRoot).catch(() => [])).toEqual([])
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('dropped image into a saved document is saved as inline image Markdown', async () => {
  const tempRoot = await makeTempDir('mdv-electron-e2e-')
  const userDataDir = path.join(tempRoot, 'user-data')
  const filePath = path.join(tempRoot, 'drop-target.md')

  await fs.mkdir(userDataDir, { recursive: true })
  await fs.writeFile(filePath, '# Drop Target\n\nbody\n', 'utf8')

  const app = await launchElectronApp({
    userDataDir,
    args: [filePath],
  })

  try {
    const page = await app.firstWindow()

    acceptBrowserDialogs(page)

    await openWritePanel(page)
    const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()
    await editor.click()
    await page.evaluate(() => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="8" fill="#22c55e"/></svg>'
      const file = new File([svg], 'dropped-diagram.svg', { type: 'image/svg+xml' })
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file)
      const dropEvent = new DragEvent('drop', {
        dataTransfer,
        bubbles: true,
        cancelable: true,
      })

      document.querySelector('.workspace')?.dispatchEvent(dropEvent)
    })

    await expect(editor).toContainText('![dropped-diagram.svg](')
    await expect(page.locator('.inline-data-image-widget').first()).toContainText('data:image/svg+xml;base64,')
    await triggerPrimaryShortcut(page, 's')

    await expect(page.locator('.statusbar-status')).toContainText('drop-target.md')
    await expect.poll(async () => fs.readFile(filePath, 'utf8')).toContain('![dropped-diagram.svg](data:image/svg+xml;base64,')
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('repeated dropped images into a saved document do not leak inline image data', async () => {
  const tempRoot = await makeTempDir('mdv-electron-e2e-')
  const userDataDir = path.join(tempRoot, 'user-data')
  const filePath = path.join(tempRoot, 'repeated-drop-target.md')

  await fs.mkdir(userDataDir, { recursive: true })
  await fs.writeFile(filePath, '# Repeated Drop Target\n\nbody\n', 'utf8')

  const app = await launchElectronApp({
    userDataDir,
    args: [filePath],
  })

  try {
    const page = await app.firstWindow()

    acceptBrowserDialogs(page)

    await openWritePanel(page)
    const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()
    await editor.click()

    async function dropSvg(fileName: string, color: string) {
      await page.evaluate(({ droppedFileName, fillColor }) => {
        const file = new File(
          [`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="${fillColor}"/></svg>`],
          droppedFileName,
          { type: 'image/svg+xml' },
        )
        const dataTransfer = new DataTransfer()
        dataTransfer.items.add(file)
        const dropEvent = new DragEvent('drop', {
          dataTransfer,
          bubbles: true,
          cancelable: true,
        })

        document.querySelector('.toastui-editor-md-container .ProseMirror')?.dispatchEvent(dropEvent)
      }, { droppedFileName: fileName, fillColor: color })
    }

    await dropSvg('first-drop.svg', '#22c55e')
    await expect(editor).toContainText('![first-drop.svg](')

    await dropSvg('second-drop.svg', '#38bdf8')
    await expect(editor).toContainText('![first-drop.svg](')
    await expect(editor).toContainText('![second-drop.svg](')
    await expect(page.locator('.inline-data-image-widget').first()).toContainText('data:image/svg+xml;base64,')
    await expect(editor).not.toContainText('PHN2Zy')
    await expect(editor).not.toContainText('<svg')

    await triggerPrimaryShortcut(page, 's')

    await expect.poll(async () => fs.readFile(filePath, 'utf8')).toContain('![first-drop.svg](data:image/svg+xml;base64,')
    await expect.poll(async () => fs.readFile(filePath, 'utf8')).toContain('![second-drop.svg](data:image/svg+xml;base64,')
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})
