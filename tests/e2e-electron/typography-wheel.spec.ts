import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchElectronApp as launchElectronAppBase } from './support/electron-launch'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

async function launchElectronApp(userDataDir: string) {
  return launchElectronAppBase({
    repoRoot,
    args: ['.'],
    env: {
      MDV_FORCE_STATIC_RENDERER: '1',
      MDV_E2E_USER_DATA_DIR: userDataDir,
      MDV_E2E_DIALOG_RESPONSES: JSON.stringify({}),
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

async function dispatchPrimaryWheel(page: Page, deltaY: number) {
  return page.locator('.toastui-editor-md-container').evaluate((element, options) => {
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: !options.isMac,
      metaKey: options.isMac,
      deltaY: options.deltaY,
    })
    element.dispatchEvent(event)
    return event.defaultPrevented
  }, { deltaY, isMac: process.platform === 'darwin' })
}

async function readEditorFontSize(page: Page) {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--editor-font-size'))
}

test('typography wheel keeps Electron zoom fixed and persists across editor windows and restart', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-electron-typography-wheel-'))
  const userDataDir = path.join(tempRoot, 'user-data')
  await fs.mkdir(userDataDir, { recursive: true })

  let app = await launchElectronApp(userDataDir)

  try {
    const firstPage = await app.firstWindow()
    await expect(firstPage.locator('.toastui-editor-md-container')).toBeVisible()
    const initialTopbarHeight = await firstPage.locator('.topbar').evaluate((element) => element.getBoundingClientRect().height)

    expect(await dispatchPrimaryWheel(firstPage, -100)).toBe(true)
    await expect.poll(() => readEditorFontSize(firstPage)).toBe('14px')
    await expect.poll(() => firstPage.evaluate(async () => (await window.mdvDesktop?.settings.getSettings())?.editor.fontSizePx)).toBe(14)

    const secondWindowPromise = app.waitForEvent('window')
    await firstPage.evaluate(() => window.mdvDesktop?.newDocumentWindow())
    const secondPage = await secondWindowPromise
    await expect.poll(() => readEditorFontSize(secondPage)).toBe('14px')

    expect(await dispatchPrimaryWheel(secondPage, -100)).toBe(true)
    await expect.poll(() => readEditorFontSize(secondPage)).toBe('15px')
    await expect.poll(() => readEditorFontSize(firstPage)).toBe('15px')

    const zoomFactors = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => window.webContents.getZoomFactor()))
    expect(zoomFactors).toEqual(zoomFactors.map(() => 1))
    await expect(firstPage.locator('.topbar').evaluate((element) => element.getBoundingClientRect().height)).resolves.toBe(initialTopbarHeight)

    await forceCloseApp(app)
    await app.close().catch(() => {})
    app = await launchElectronApp(userDataDir)

    const restartedPage = await app.firstWindow()
    await expect.poll(() => readEditorFontSize(restartedPage)).toBe('15px')
    await expect.poll(() => restartedPage.evaluate(async () => (await window.mdvDesktop?.settings.getSettings())?.editor.fontSizePx)).toBe(15)
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }
})
