import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control'

async function makeTempDir(prefix: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

async function launchElectronApp(options: {
  userDataDir: string
  args?: string[]
  dialogResponses?: {
    messageBox?: Array<{ response: number; checkboxChecked?: boolean }>
    saveDialog?: Array<{ canceled?: boolean; filePath?: string }>
    openDialog?: Array<{ canceled?: boolean; filePaths?: string[] }>
  }
}) {
  return electron.launch({
    args: ['.', ...(options.args ?? [])],
    cwd: repoRoot,
    env: {
      ...process.env,
      MDV_FORCE_STATIC_RENDERER: '1',
      MDV_E2E_USER_DATA_DIR: options.userDataDir,
      MDV_E2E_DIALOG_RESPONSES: JSON.stringify(options.dialogResponses ?? {}),
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

function acceptBrowserDialogs(page: import('@playwright/test').Page) {
  page.on('dialog', async (dialog) => {
    await dialog.accept()
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

    await page.keyboard.press(`${primaryModifier}+S`)
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

    await page.keyboard.press(`${primaryModifier}+S`)

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

test.describe('close dialog clears recovery entries', () => {
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
