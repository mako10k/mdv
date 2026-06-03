import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'
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
  dialogResponses?: {
    messageBox?: Array<{ response: number; checkboxChecked?: boolean }>
  }
}) {
  return electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: {
      ...process.env,
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
  await expect.poll(async () => page.title()).toMatch(/(無題\.md\*?|Untitled\.md\*?) - MDV/i)
  await expect(page.locator('.toastui-editor-md-container .toastui-editor').first()).not.toContainText('text to replace')
  await expect(page.locator('.toastui-editor-md-container .toastui-editor').first()).toHaveText('')
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
