import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'
import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { waitForDebugEvent } from '../support/debug-channel'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control'
const moveEditorCursorToStartShortcut = process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home'

async function makeTempDir(prefix: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

async function reserveDebugPort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer()

    server.listen(0, '127.0.0.1', () => {
      const address = server.address()

      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to reserve a debug port')))
        return
      }

      const { port } = address
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve(port)
      })
    })

    server.on('error', reject)
  })
}

async function launchElectronApp(userDataDir: string, debugPort: number) {
  return electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: {
      ...process.env,
      MDV_FORCE_STATIC_RENDERER: '1',
      MDV_E2E_USER_DATA_DIR: userDataDir,
      MDV_E2E_DIALOG_RESPONSES: JSON.stringify({}),
      MDV_DEBUG_CHANNEL_PORT: String(debugPort),
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

async function placeEditorCursorFromStart(page: import('@playwright/test').Page, offset: number) {
  const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()

  await editor.click()
  await page.keyboard.press(moveEditorCursorToStartShortcut)

  for (let index = 0; index < offset; index += 1) {
    await page.keyboard.press('ArrowRight')
  }
}

test('outline active heading follows the editor caret', async () => {
  const tempRoot = await makeTempDir('mdv-electron-outline-')
  const userDataDir = path.join(tempRoot, 'user-data')
  const debugPort = await reserveDebugPort()

  await fs.mkdir(userDataDir, { recursive: true })

  const app = await launchElectronApp(userDataDir, debugPort)

  try {
    const page = await app.firstWindow()
    const markdown = '# Alpha\n\nalpha body\n\n## Beta\n\nbeta body\n'
    const betaBodyOffset = markdown.indexOf('beta body') + 2

    await waitForDebugEvent({
      port: debugPort,
      eventType: 'renderer:workspace-interactive',
      timeoutMs: 15_000,
    })

    await openWritePanel(page)
    await replaceMarkdownDocument(page, markdown)

    const alphaOutline = page.locator('.outline-item', { hasText: 'Alpha' })
    const betaOutline = page.locator('.outline-item', { hasText: 'Beta' })

    await expect(alphaOutline).toBeVisible()
    await expect(betaOutline).toBeVisible()

    await placeEditorCursorFromStart(page, 0)
    await expect(alphaOutline).toHaveAttribute('aria-current', 'location')
    await expect(betaOutline).not.toHaveAttribute('aria-current', 'location')

    await placeEditorCursorFromStart(page, betaBodyOffset)
    await expect(betaOutline).toHaveAttribute('aria-current', 'location')
    await expect(alphaOutline).not.toHaveAttribute('aria-current', 'location')
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }
})