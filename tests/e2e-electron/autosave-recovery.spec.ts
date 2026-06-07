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

test.describe('close dialog clears recovery entries', () => {
  test('save on close materializes an unsaved pasted image draft', async () => {
    const tempRoot = await makeTempDir('mdv-electron-e2e-')
    const userDataDir = path.join(tempRoot, 'user-data')
    const saveFilePath = path.join(tempRoot, 'close-save-image.md')
    const materializedAssetPath = path.join(tempRoot, 'assets', 'close-save-image.svg')

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

      await expect(editor).toContainText('![close-save-image.svg](assets/close-save-image.svg)')

      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.close()
      })

      await expect.poll(async () => (await app.windows()).length).toBe(0)
      await expect.poll(async () => fs.readFile(saveFilePath, 'utf8')).toContain('![close-save-image.svg](assets/close-save-image.svg)')
      await expect.poll(async () => fs.readFile(materializedAssetPath, 'utf8')).toContain('<svg')
      await expect.poll(async () => readRecoveryStoreEntries(userDataDir)).toEqual([])
    } finally {
      await forceCloseApp(app)
      await app.close().catch(() => {})
      await fs.rm(tempRoot, { recursive: true, force: true })
    }
  })

  test('discard on close removes draft workspace assets from an unsaved document', async () => {
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

      await expect(editor).toContainText('![draft-discard-image.svg](assets/draft-discard-image.svg)')
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

  test('save as on close migrates imported image assets after a save conflict', async () => {
    const tempRoot = await makeTempDir('mdv-electron-e2e-')
    const userDataDir = path.join(tempRoot, 'user-data')
    const sourceDir = path.join(tempRoot, 'close-save-as-source')
    const targetDir = path.join(tempRoot, 'close-save-as-target')
    const filePath = path.join(sourceDir, 'close-save-as.md')
    const saveAsPath = path.join(targetDir, 'close-save-as-target.md')
    const sourceAssetPath = path.join(tempRoot, 'close-save-as-image.svg')
    const originalImportedAssetPath = path.join(sourceDir, 'assets', 'close-save-as-image.svg')
    const movedImportedAssetPath = path.join(targetDir, 'assets', 'close-save-as-image.svg')

    await fs.mkdir(userDataDir, { recursive: true })
    await fs.mkdir(sourceDir, { recursive: true })
    await fs.mkdir(targetDir, { recursive: true })
    await fs.writeFile(filePath, '# Close Save As\n\nbase\n', 'utf8')
    await fs.writeFile(sourceAssetPath, '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#3b82f6"/></svg>', 'utf8')

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
      await page.evaluate((assetUrl) => {
        const file = new File(['placeholder'], 'close-save-as-image.svg', { type: 'image/svg+xml' })
        const dataTransfer = new DataTransfer()
        dataTransfer.items.add(file)
        dataTransfer.setData('text/uri-list', assetUrl)
        const dropEvent = new DragEvent('drop', {
          dataTransfer,
          bubbles: true,
          cancelable: true,
        })

        document.querySelector('.workspace')?.dispatchEvent(dropEvent)
      }, `file://${sourceAssetPath}`)

      await expect(editor).toContainText('![close-save-as-image.svg](assets/close-save-as-image.svg)')
      await expect.poll(async () => fs.readFile(originalImportedAssetPath, 'utf8')).toContain('<svg')
      await fs.writeFile(filePath, '# Close Save As\n\ndisk update\n', 'utf8')

      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.close()
      })

      await expect.poll(async () => (await app.windows()).length).toBe(0)
      await expect.poll(async () => fs.readFile(saveAsPath, 'utf8')).toContain('![close-save-as-image.svg](assets/close-save-as-image.svg)')
      await expect.poll(async () => fs.readFile(movedImportedAssetPath, 'utf8')).toContain('<svg')
      await expect.poll(async () => fs.access(originalImportedAssetPath).then(() => true).catch(() => false)).toBe(false)
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

  test('discard on close removes imported image assets from a saved document', async () => {
    const tempRoot = await makeTempDir('mdv-electron-e2e-')
    const userDataDir = path.join(tempRoot, 'user-data')
    const filePath = path.join(tempRoot, 'close-discard-image.md')
    const sourceAssetPath = path.join(tempRoot, 'close-discard-image-source.svg')
    const importedAssetPath = path.join(tempRoot, 'assets', 'close-discard-image-source.svg')

    await fs.mkdir(userDataDir, { recursive: true })
    await fs.writeFile(filePath, '# Close Discard Image\n\nbase\n', 'utf8')
    await fs.writeFile(sourceAssetPath, '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="8" fill="#ef4444"/></svg>', 'utf8')

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
      await page.evaluate((assetUrl) => {
        const file = new File(['placeholder'], 'close-discard-image-source.svg', { type: 'image/svg+xml' })
        const dataTransfer = new DataTransfer()
        dataTransfer.items.add(file)
        dataTransfer.setData('text/uri-list', assetUrl)
        const dropEvent = new DragEvent('drop', {
          dataTransfer,
          bubbles: true,
          cancelable: true,
        })

        document.querySelector('.workspace')?.dispatchEvent(dropEvent)
      }, `file://${sourceAssetPath}`)

      await expect(editor).toContainText('![close-discard-image-source.svg](assets/close-discard-image-source.svg)')
      await expect.poll(async () => fs.readFile(importedAssetPath, 'utf8')).toContain('<svg')

      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.close()
      })

      await expect.poll(async () => (await app.windows()).length).toBe(0)
      await expect.poll(async () => fs.readFile(filePath, 'utf8')).toContain('base')
      await expect.poll(async () => fs.readFile(filePath, 'utf8')).not.toContain('close-discard-image-source.svg')
      await expect.poll(async () => fs.access(importedAssetPath).then(() => true).catch(() => false)).toBe(false)
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

test('pasted image into an unsaved document is materialized on first save', async () => {
  const tempRoot = await makeTempDir('mdv-electron-e2e-')
  const userDataDir = path.join(tempRoot, 'user-data')
  const saveFilePath = path.join(tempRoot, 'pasted-image.md')
  const materializedAssetPath = path.join(tempRoot, 'assets', 'diagram.svg')

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

    await expect(editor).toContainText('![diagram.svg](assets/diagram.svg)')
    await triggerPrimaryShortcut(page, 's')

    await expect(page.locator('.statusbar-status')).toContainText('pasted-image.md')
    await expect.poll(async () => fs.readFile(saveFilePath, 'utf8')).toContain('![diagram.svg](assets/diagram.svg)')
    await expect.poll(async () => fs.readFile(materializedAssetPath, 'utf8')).toContain('<svg')
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('removed draft image reference is not materialized on first save', async () => {
  const tempRoot = await makeTempDir('mdv-electron-e2e-')
  const userDataDir = path.join(tempRoot, 'user-data')
  const saveFilePath = path.join(tempRoot, 'removed-draft-image.md')
  const materializedAssetPath = path.join(tempRoot, 'assets', 'removed-diagram.svg')

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

    await expect(editor).toContainText('![removed-diagram.svg](assets/removed-diagram.svg)')
    await replaceMarkdownDocument(page, '# Removed Draft Image\n\nno image\n')
    await triggerPrimaryShortcut(page, 's')

    await expect(page.locator('.statusbar-status')).toContainText('removed-draft-image.md')
    await expect.poll(async () => fs.readFile(saveFilePath, 'utf8')).toContain('no image')
    await expect.poll(async () => fs.readFile(saveFilePath, 'utf8')).not.toContain('removed-diagram.svg')
    await expect.poll(async () => fs.access(materializedAssetPath).then(() => true).catch(() => false)).toBe(false)
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('restored unsaved pasted image draft is materialized on first save after restart', async () => {
  const tempRoot = await makeTempDir('mdv-electron-e2e-')
  const userDataDir = path.join(tempRoot, 'user-data')
  const saveFilePath = path.join(tempRoot, 'restored-image.md')
  const materializedAssetPath = path.join(tempRoot, 'assets', 'restored-diagram.svg')

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

    await expect(editor).toContainText('![restored-diagram.svg](assets/restored-diagram.svg)')
    await expect.poll(async () => readRecoveryStoreEntries(userDataDir)).toEqual([
      expect.objectContaining({
        snapshot: expect.objectContaining({
          draftWorkspace: expect.objectContaining({ workspaceId: expect.any(String) }),
        }),
      }),
    ])
    await expect.poll(async () => {
      const [entry] = await readRecoveryStoreEntries(userDataDir) as Array<{
        snapshot?: { draftWorkspace?: { assetDir?: string | null } | null }
      }>
      const assetDir = entry?.snapshot?.draftWorkspace?.assetDir

      if (!assetDir) {
        return ''
      }

      return fs.readFile(path.join(assetDir, 'restored-diagram.svg'), 'utf8')
    }).toContain('<svg')
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
    await expect(editor).toContainText('![restored-diagram.svg](assets/restored-diagram.svg)')

    await triggerPrimaryShortcut(page, 's')

    await expect(page.locator('.statusbar-status')).toContainText('restored-image.md')
    await expect.poll(async () => fs.readFile(saveFilePath, 'utf8')).toContain('![restored-diagram.svg](assets/restored-diagram.svg)')
    await expect.poll(async () => fs.readFile(materializedAssetPath, 'utf8')).toContain('<svg')
  } finally {
    await forceCloseApp(secondApp)
    await secondApp.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('declining saved-file recovery removes imported assets created before restart', async () => {
  const tempRoot = await makeTempDir('mdv-electron-e2e-')
  const userDataDir = path.join(tempRoot, 'user-data')
  const filePath = path.join(tempRoot, 'recovery-decline-target.md')
  const sourceAssetPath = path.join(tempRoot, 'recovery-decline-source.svg')
  const importedAssetPath = path.join(tempRoot, 'assets', 'recovery-decline-source.svg')

  await fs.mkdir(userDataDir, { recursive: true })
  await fs.writeFile(filePath, '# Recovery Decline\n\nbase\n', 'utf8')
  await fs.writeFile(sourceAssetPath, '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="8" fill="#14b8a6"/></svg>', 'utf8')

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
    await page.evaluate((assetUrl) => {
      const file = new File(['placeholder'], 'recovery-decline-source.svg', { type: 'image/svg+xml' })
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file)
      dataTransfer.setData('text/uri-list', assetUrl)
      const dropEvent = new DragEvent('drop', {
        dataTransfer,
        bubbles: true,
        cancelable: true,
      })

      document.querySelector('.workspace')?.dispatchEvent(dropEvent)
    }, `file://${sourceAssetPath}`)

    await expect(editor).toContainText('![recovery-decline-source.svg](assets/recovery-decline-source.svg)')
    await expect.poll(async () => fs.readFile(importedAssetPath, 'utf8')).toContain('<svg')
    await expect.poll(async () => readRecoveryStoreEntries(userDataDir)).toEqual([
      expect.objectContaining({
        snapshot: expect.objectContaining({
          pendingImportedAssets: [expect.objectContaining({ filePath: importedAssetPath })],
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
    await expect.poll(async () => fs.access(importedAssetPath).then(() => true).catch(() => false)).toBe(false)
    await expect.poll(async () => readRecoveryStoreEntries(userDataDir)).toEqual([])
  } finally {
    await forceCloseApp(secondApp)
    await secondApp.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('save as moves imported saved-document assets beside the new markdown file', async () => {
  const tempRoot = await makeTempDir('mdv-electron-e2e-')
  const userDataDir = path.join(tempRoot, 'user-data')
  const sourceDir = path.join(tempRoot, 'source')
  const targetDir = path.join(tempRoot, 'target')
  const filePath = path.join(sourceDir, 'save-as-source.md')
  const saveAsPath = path.join(targetDir, 'save-as-target.md')
  const sourceAssetPath = path.join(tempRoot, 'save-as-image-source.svg')
  const originalImportedAssetPath = path.join(sourceDir, 'assets', 'save-as-image-source.svg')
  const movedImportedAssetPath = path.join(targetDir, 'assets', 'save-as-image-source.svg')

  await fs.mkdir(userDataDir, { recursive: true })
  await fs.mkdir(sourceDir, { recursive: true })
  await fs.mkdir(targetDir, { recursive: true })
  await fs.writeFile(filePath, '# Save As Source\n\nbody\n', 'utf8')
  await fs.writeFile(sourceAssetPath, '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#22c55e"/></svg>', 'utf8')

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
    await page.evaluate((assetUrl) => {
      const file = new File(['placeholder'], 'save-as-image-source.svg', { type: 'image/svg+xml' })
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file)
      dataTransfer.setData('text/uri-list', assetUrl)
      const dropEvent = new DragEvent('drop', {
        dataTransfer,
        bubbles: true,
        cancelable: true,
      })

      document.querySelector('.workspace')?.dispatchEvent(dropEvent)
    }, `file://${sourceAssetPath}`)

    await expect(editor).toContainText('![save-as-image-source.svg](assets/save-as-image-source.svg)')
    await expect.poll(async () => fs.readFile(originalImportedAssetPath, 'utf8')).toContain('<svg')

    await triggerPrimaryShortcut(page, 's', { shiftKey: true })

    await expect(page.locator('.statusbar-status')).toContainText('save-as-target.md')
    await expect.poll(async () => fs.readFile(saveAsPath, 'utf8')).toContain('![save-as-image-source.svg](assets/save-as-image-source.svg)')
    await expect.poll(async () => fs.readFile(movedImportedAssetPath, 'utf8')).toContain('<svg')
    await expect.poll(async () => fs.access(originalImportedAssetPath).then(() => true).catch(() => false)).toBe(false)
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

test('dropped image into a saved document is stored beside the file and saved as relative markdown', async () => {
  const tempRoot = await makeTempDir('mdv-electron-e2e-')
  const userDataDir = path.join(tempRoot, 'user-data')
  const filePath = path.join(tempRoot, 'drop-target.md')
  const sourceAssetPath = path.join(tempRoot, 'dropped-diagram.svg')
  const materializedAssetPath = path.join(tempRoot, 'assets', 'dropped-diagram.svg')

  await fs.mkdir(userDataDir, { recursive: true })
  await fs.writeFile(filePath, '# Drop Target\n\nbody\n', 'utf8')
  await fs.writeFile(sourceAssetPath, '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="8" fill="#22c55e"/></svg>', 'utf8')

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
    await page.evaluate((assetUrl) => {
      const file = new File(['placeholder'], 'dropped-diagram.svg', { type: 'image/svg+xml' })
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file)
      dataTransfer.setData('text/uri-list', assetUrl)
      const dropEvent = new DragEvent('drop', {
        dataTransfer,
        bubbles: true,
        cancelable: true,
      })

      document.querySelector('.workspace')?.dispatchEvent(dropEvent)
    }, `file://${sourceAssetPath}`)

    await expect(editor).toContainText('![dropped-diagram.svg](assets/dropped-diagram.svg)')
    await triggerPrimaryShortcut(page, 's')

    await expect(page.locator('.statusbar-status')).toContainText('drop-target.md')
    await expect.poll(async () => fs.readFile(filePath, 'utf8')).toContain('![dropped-diagram.svg](assets/dropped-diagram.svg)')
    await expect.poll(async () => fs.readFile(materializedAssetPath, 'utf8')).toContain('<svg')
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})
