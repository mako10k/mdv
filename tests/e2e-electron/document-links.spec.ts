import { expect, test } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { launchElectronApp as launchElectronAppBase } from './support/electron-launch'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

async function forceCloseApp(app: import('playwright').ElectronApplication) {
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.destroy()
    }
  }).catch(() => {})
}

test('rendered local links open in MDV while the source app document remains protected', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-electron-document-links-'))
  const userDataDir = path.join(tempRoot, 'user-data')
  const sourcePath = path.join(tempRoot, 'source.md')
  const targetPath = path.join(tempRoot, '次 の文書.md')
  const targetFileUrl = pathToFileURL(targetPath).href
  const missingPath = path.join(tempRoot, 'missing.md')
  const localImagePath = path.join(tempRoot, 'local-image.svg')
  const localImageUrl = pathToFileURL(localImagePath).href

  await fs.mkdir(userDataDir, { recursive: true })
  await fs.writeFile(targetPath, `# Linked Target\n\nopened in MDV\n\n![Blocked Markdown image](${localImageUrl})\n`, 'utf8')
  await fs.writeFile(localImagePath, '<svg xmlns="http://www.w3.org/2000/svg" width="31" height="17"><rect width="31" height="17" fill="red"/></svg>', 'utf8')
  await fs.writeFile(sourcePath, [
    '# Source',
    '',
    '[Relative target](%E6%AC%A1%20%E3%81%AE%E6%96%87%E6%9B%B8.md)',
    '',
    `[File URL target](${targetFileUrl})`,
    '',
    `[Missing target](${pathToFileURL(missingPath).href})`,
    '',
    '<span id="source-anchor">source anchor</span>',
    '',
    '[Same document](#source-anchor)',
    '',
    `![Blocked Markdown image](${localImageUrl})`,
    '',
    `<img src="${localImageUrl}" alt="Blocked raw HTML image">`,
  ].join('\n'), 'utf8')

  const app = await launchElectronAppBase({
    repoRoot,
    args: ['.', sourcePath],
    env: {
      MDV_FORCE_STATIC_RENDERER: '1',
      MDV_E2E_USER_DATA_DIR: userDataDir,
      MDV_E2E_DIALOG_RESPONSES: JSON.stringify({}),
    },
  })

  try {
    const sourcePage = await app.firstWindow()
    await expect(sourcePage.locator('.preview-panel')).toContainText('Source')
    const sourceAppEntryUrl = sourcePage.url()

    const rawHtmlImage = sourcePage.locator('.preview-panel img[alt="Blocked raw HTML image"]')
    await expect(rawHtmlImage).toHaveCount(1)
    await expect.poll(() => rawHtmlImage.evaluate((image: HTMLImageElement) => ({
      complete: image.complete,
      naturalWidth: image.naturalWidth,
    }))).toEqual({ complete: true, naturalWidth: 0 })

    await sourcePage.getByRole('link', { name: 'Same document' }).click()
    await expect.poll(() => sourcePage.url()).toBe(`${sourceAppEntryUrl}#source-anchor`)
    await expect.poll(() => app.windows().length).toBe(1)
    const sourceAppUrl = sourcePage.url()

    const targetWindowPromise = app.waitForEvent('window')
    await sourcePage.getByRole('link', { name: 'Relative target' }).click()
    const targetPage = await targetWindowPromise

    await expect.poll(async () => targetPage.title()).toMatch(/次 の文書\.md - MDV/)
    await expect(targetPage.locator('.preview-panel')).toContainText('Linked Target')
    expect(sourcePage.url()).toBe(sourceAppUrl)

    await sourcePage.getByRole('link', { name: 'File URL target' }).click()
    await expect.poll(() => app.windows().length).toBe(2)
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.getTitle() ?? '')).toMatch(/次 の文書\.md - MDV/)

    await targetPage.locator('.view-switch button').nth(0).click()
    await expect(targetPage.locator('.view-switch button').nth(0)).toHaveClass(/active/)
    const wysiwygModeTab = targetPage.locator('.toastui-editor-mode-switch .tab-item').nth(1)
    await wysiwygModeTab.click()
    await expect(wysiwygModeTab).toHaveClass(/active/)
    const wysiwygMarkdownImage = targetPage.locator('.toastui-editor-ww-container img[alt="Blocked Markdown image"]')
    await expect(wysiwygMarkdownImage).toHaveCount(1)
    await expect.poll(() => wysiwygMarkdownImage.evaluate((image: HTMLImageElement) => ({
      complete: image.complete,
      naturalWidth: image.naturalWidth,
    }))).toEqual({ complete: true, naturalWidth: 0 })

    await sourcePage.getByRole('link', { name: 'Missing target' }).click()
    await expect(sourcePage.locator('.statusbar')).toContainText(/文書リンクを開けませんでした|Could not open the document link/)
    expect(sourcePage.url()).toBe(sourceAppUrl)
    await expect.poll(() => app.windows().length).toBe(2)

    await sourcePage.evaluate(() => {
      window.location.href = 'file:///definitely-not-an-mdv-app-entry.md'
      window.open('https://example.com/blocked-window')
    })
    await sourcePage.waitForTimeout(250)

    const protectedWindowState = await app.evaluate(async ({ BrowserWindow }) => {
      const sourceWindow = BrowserWindow.getAllWindows().find((window) => window.getTitle().includes('source.md'))
      if (!sourceWindow) {
        return null
      }

      return {
        url: sourceWindow.webContents.getURL(),
        loading: sourceWindow.webContents.isLoading(),
        bodyText: await sourceWindow.webContents.executeJavaScript('document.body.innerText'),
      }
    })
    expect(protectedWindowState).toEqual(expect.objectContaining({
      url: sourceAppUrl,
      loading: false,
    }))
    expect(protectedWindowState?.bodyText).toContain('Source')
    await expect.poll(() => app.windows().length).toBe(2)

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find((window) => window.getTitle().includes('source.md'))?.close()
    })
    await expect.poll(() => app.windows().length, { timeout: 4_500 }).toBe(1)
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }
})
