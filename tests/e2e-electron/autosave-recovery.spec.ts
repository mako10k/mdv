import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

async function makeTempDir(prefix: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
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

  const app = await electron.launch({
    args: ['.', launchFilePath],
    cwd: repoRoot,
    env: {
      ...process.env,
      MDV_FORCE_STATIC_RENDERER: '1',
      MDV_E2E_USER_DATA_DIR: userDataDir,
    },
  })

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
    await app.close()
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})
