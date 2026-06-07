import { expect, test } from '@playwright/test'
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
  dialogResponses?: {
    messageBox?: Array<{ response: number; checkboxChecked?: boolean }>
  }
}) {
  return launchElectronAppBase({
    repoRoot,
    args: ['.'],
    env: {
      MDV_FORCE_STATIC_RENDERER: '1',
      MDV_E2E_USER_DATA_DIR: options.userDataDir,
      MDV_E2E_DIALOG_RESPONSES: JSON.stringify(options.dialogResponses ?? {}),
    },
  })
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

async function openWritePanel(page: import('@playwright/test').Page) {
  await page.locator('.view-switch button').nth(0).click()
  await expect(page.locator('.view-switch button').nth(0)).toHaveClass(/active/)
}

async function replaceMarkdownDocument(page: import('@playwright/test').Page, markdown: string) {
  const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()

  await editor.click()
  await page.keyboard.press(`${primaryModifier}+A`)
  await page.keyboard.press('Backspace')
  await page.keyboard.insertText(markdown)
}

async function switchToastEditorMode(page: import('@playwright/test').Page, mode: 'markdown' | 'wysiwyg') {
  const modeIndex = mode === 'markdown' ? 0 : 1
  const modeTab = page.locator('.toastui-editor-mode-switch .tab-item').nth(modeIndex)

  await modeTab.click()
  await expect(modeTab).toHaveClass(/active/)
}

async function triggerPrimaryShortcut(page: import('@playwright/test').Page, key: string) {
  await page.evaluate(({ shortcutKey, isMac }) => {
    const event = new KeyboardEvent('keydown', {
      key: shortcutKey,
      bubbles: true,
      cancelable: true,
      ctrlKey: !isMac,
      metaKey: isMac,
    })

    window.dispatchEvent(event)
  }, { shortcutKey: key, isMac: process.platform === 'darwin' })
}

async function expectFreshUntitledDocument(page: import('@playwright/test').Page) {
  await expect(page.locator('.view-switch button').nth(0)).toHaveClass(/active/)
  await expect.poll(async () => page.title()).toMatch(/(無題\.md|Untitled\.md) - MDV/i)
  await expect(page.locator('.toastui-editor-md-container .toastui-editor').first()).not.toContainText('text to replace')
  await expect(page.locator('.editor-sample-placeholder').first()).toContainText('MarkDownViewer')
  await expect(page.locator('.preview-scroll-placeholder')).toHaveCount(1)
  await expect.poll(async () => page.locator('.outline-item[disabled]').count()).toBeGreaterThan(0)
}

test('Ctrl/Cmd+N opens a fresh untitled editor document', async () => {
  const tempRoot = await makeTempDir('mdv-electron-new-document-')
  const userDataDir = path.join(tempRoot, 'user-data')

  await fs.mkdir(userDataDir, { recursive: true })

  const app = await launchElectronApp({
    userDataDir,
    dialogResponses: {
      messageBox: [{ response: 2 }],
    },
  })

  try {
    const page = await app.firstWindow()

    await openWritePanel(page)
    await replaceMarkdownDocument(page, '# Existing\n\ntext to replace\n')

    await triggerPrimaryShortcut(page, 'n')

    await expectFreshUntitledDocument(page)
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }
})

test('File menu click opens a fresh untitled editor document', async () => {
  const tempRoot = await makeTempDir('mdv-electron-new-document-')
  const userDataDir = path.join(tempRoot, 'user-data')

  await fs.mkdir(userDataDir, { recursive: true })

  const app = await launchElectronApp({
    userDataDir,
    dialogResponses: {
      messageBox: [{ response: 2 }],
    },
  })

  try {
    const page = await app.firstWindow()

    await openWritePanel(page)
    await replaceMarkdownDocument(page, '# Existing\n\ntext to replace\n')

    await app.evaluate(({ BrowserWindow, Menu }) => {
      const targetWindow = BrowserWindow.getAllWindows()[0]
      const fileMenuIndex = process.platform === 'darwin' ? 1 : 0
      const menuItem = Menu.getApplicationMenu()?.items[fileMenuIndex]?.submenu?.items[0]

      menuItem?.click?.(menuItem, targetWindow, undefined)
    })

    await expectFreshUntitledDocument(page)
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }
})

test('typing into a fresh untitled document clears placeholder-only outline state immediately', async () => {
  const tempRoot = await makeTempDir('mdv-electron-new-document-')
  const userDataDir = path.join(tempRoot, 'user-data')

  await fs.mkdir(userDataDir, { recursive: true })

  const app = await launchElectronApp({
    userDataDir,
  })

  try {
    const page = await app.firstWindow()

    await openWritePanel(page)
    await expectFreshUntitledDocument(page)

    const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()
    await editor.click()
    await page.keyboard.insertText('# Real heading\n')

    await expect.poll(async () => page.locator('.editor-sample-placeholder').count()).toBe(0)
    await expect(editor).toContainText('Real heading')
    await expect.poll(async () => page.title()).toMatch(/(無題\.md\*|Untitled\.md\*) - MDV/i)
    await expect(page.locator('.preview-scroll-placeholder')).toHaveCount(0)
    await expect.poll(async () => page.locator('.outline-item[disabled]').count()).toBe(0)
    await expect.poll(async () => page.locator('.outline-item').count()).toBeGreaterThan(0)
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }
})

test('typing into a fresh untitled document in WYSIWYG mode does not crash the renderer', async () => {
  const tempRoot = await makeTempDir('mdv-electron-new-document-')
  const userDataDir = path.join(tempRoot, 'user-data')

  await fs.mkdir(userDataDir, { recursive: true })

  const app = await launchElectronApp({
    userDataDir,
  })

  try {
    const page = await app.firstWindow()
    const pageErrors: string[] = []

    page.on('pageerror', (error) => {
      pageErrors.push(error.message)
    })

    await openWritePanel(page)
    await expectFreshUntitledDocument(page)
    await switchToastEditorMode(page, 'wysiwyg')

    const wysiwygEditor = page.locator('.toastui-editor-ww-container .ProseMirror').first()
    await wysiwygEditor.click()
    await page.keyboard.insertText('fresh wysiwyg text')

    await expect.poll(() => pageErrors, {
      message: 'renderer should not emit pageerror while editing a fresh untitled WYSIWYG document',
    }).toEqual([])
    await expect(wysiwygEditor).toContainText('fresh wysiwyg text')
    await expect.poll(async () => page.title()).toMatch(/(無題\.md\*|Untitled\.md\*) - MDV/i)
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }
})

test('AI write_target with :new creates a populated new document window', async () => {
  const tempRoot = await makeTempDir('mdv-electron-new-document-')
  const userDataDir = path.join(tempRoot, 'user-data')

  await fs.mkdir(userDataDir, { recursive: true })

  const app = await launchElectronApp({
    userDataDir,
    dialogResponses: {
      messageBox: [{ response: 0 }],
    },
  })

  try {
    const page = await app.firstWindow()
    const nextWindowPromise = app.waitForEvent('window')

    const writeResult = await page.evaluate(async () => {
      return window.mdvDesktop?.writeAiTarget({
        destination: {
          editorId: ':new',
          span: { kind: 'document' },
        },
        sources: [
          {
            type: 'literal',
            text: '# Draft\n\nCreated by AI.\n',
          },
        ],
        mode: 'replace',
        title: 'Draft.md',
      })
    })

    const nextPage = await nextWindowPromise

    expect(writeResult).toMatchObject({
      created: true,
      mode: 'replace',
      text: '# Draft\n\nCreated by AI.\n',
    })

    await openWritePanel(nextPage)
    await expect.poll(async () => nextPage.title()).toMatch(/Draft\.md\*? - MDV/i)
    await expect(nextPage.locator('.toastui-editor-md-container .toastui-editor').first()).toContainText('Created by AI.')
    await expect(nextPage.locator('.editor-sample-placeholder')).toHaveCount(0)
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }
})
