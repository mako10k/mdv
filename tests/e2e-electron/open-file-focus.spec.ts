import { expect, test } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchElectronApp as launchElectronAppBase } from './support/electron-launch'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

async function makeTempDir(prefix: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
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

test('opening the same file in a second instance focuses the existing editor window', async () => {
  const tempRoot = await makeTempDir('mdv-electron-open-file-focus-')
  const userDataDir = path.join(tempRoot, 'user-data')
  const filePath = path.join(tempRoot, 'focus-target.md')

  await fs.mkdir(userDataDir, { recursive: true })
  await fs.writeFile(filePath, '# Focus Target\n\nbody\n', 'utf8')

  const app = await launchElectronAppBase({
    repoRoot,
    args: ['.', filePath],
    env: {
      MDV_FORCE_STATIC_RENDERER: '1',
      MDV_E2E_USER_DATA_DIR: userDataDir,
      MDV_E2E_DIALOG_RESPONSES: JSON.stringify({
        openDialog: [
          {
            canceled: false,
            filePaths: [filePath],
          },
        ],
      }),
    },
  })

  try {
    const page = await app.firstWindow()

    await expect.poll(async () => page.title()).toMatch(/focus-target\.md - MDV/i)
    await expect(page.locator('.preview-panel')).toContainText('Focus Target')

    await app.evaluate(({ app }, targetPath) => {
      const argv = process.defaultApp
        ? [process.execPath, process.argv[1], targetPath]
        : [process.execPath, targetPath]

      app.emit('second-instance', {}, argv)
    }, filePath)

    await expect.poll(async () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    await expect.poll(async () => page.title()).toMatch(/focus-target\.md - MDV/i)

    const duplicateOpenResult = await page.evaluate(() => {
      const desktopWindow = window as Window & {
        mdvDesktop?: {
          openFile?: () => Promise<unknown>
        }
      }

      return desktopWindow.mdvDesktop?.openFile?.() ?? null
    })

    expect(duplicateOpenResult).toBeNull()
    await expect.poll(async () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    await expect(page.locator('.preview-panel')).toContainText('Focus Target')
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }
})
