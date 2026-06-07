import { expect, test } from '@playwright/test'
import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { publishDebugEvent, waitForDebugEvent } from '../support/debug-channel'
import { launchElectronApp as launchElectronAppBase } from './support/electron-launch'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

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

async function launchElectronApp(options: {
  userDataDir: string
  debugPort: number
  env?: Record<string, string>
}) {
  return launchElectronAppBase({
    repoRoot,
    args: ['.'],
    env: {
      MDV_FORCE_STATIC_RENDERER: '1',
      MDV_E2E_USER_DATA_DIR: options.userDataDir,
      MDV_E2E_DIALOG_RESPONSES: JSON.stringify({}),
      MDV_DEBUG_CHANNEL_PORT: String(options.debugPort),
      ...(options.env ?? {}),
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

test('debug channel emits readiness events and accepts external publish', async () => {
  const tempRoot = await makeTempDir('mdv-electron-debug-channel-')
  const userDataDir = path.join(tempRoot, 'user-data')
  const debugPort = await reserveDebugPort()

  await fs.mkdir(userDataDir, { recursive: true })

  const app = await launchElectronApp({ userDataDir, debugPort })

  try {
    await app.firstWindow()

    const appReady = await waitForDebugEvent({
      port: debugPort,
      eventType: 'app:ready',
      replay: true,
      timeoutMs: 15_000,
    })
    const interactiveReady = await waitForDebugEvent({
      port: debugPort,
      eventType: 'renderer:workspace-interactive',
      replay: true,
      timeoutMs: 15_000,
    })

    expect(appReady.type).toBe('app:ready')
    expect((interactiveReady.payload as { payload?: { activePanel?: string } }).payload?.activePanel).toBeTruthy()

    const publishedEventPromise = waitForDebugEvent({
      port: debugPort,
      eventType: 'test:ping',
      timeoutMs: 5_000,
    })

    await publishDebugEvent(debugPort, 'test:ping', { source: 'spec' })

    const publishedEvent = await publishedEventPromise
    expect((publishedEvent.payload as { source?: string }).source).toBe('spec')
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }
})

test('debug channel reports startup recovery pending and resolved states', async () => {
  const tempRoot = await makeTempDir('mdv-electron-debug-channel-')
  const userDataDir = path.join(tempRoot, 'user-data')
  const debugPort = await reserveDebugPort()

  await fs.mkdir(userDataDir, { recursive: true })
  await fs.writeFile(
    path.join(userDataDir, 'autosave-recovery-v1.json'),
    JSON.stringify({
      version: 1,
      entries: [
        {
          recoveryKey: 'draft:startup-shell-recovery',
          savedAt: new Date().toISOString(),
          snapshot: {
            markdownText: '# Startup Recovery\n\nrestored after pending shell\n',
            persistedMarkdown: '',
            currentFilePath: null,
            fileSnapshot: null,
            displayTitle: '無題.md',
            activePanel: 'write',
            recoveryKey: 'startup-shell-recovery',
          },
        },
      ],
    }, null, 2),
    'utf8',
  )

  const app = await launchElectronApp({
    userDataDir,
    debugPort,
    env: {
      MDV_E2E_AUTO_ACCEPT_RECOVERY: '1',
      MDV_E2E_STARTUP_RECOVERY_DELAY_MS: '1200',
    },
  })

  try {
    const page = await app.firstWindow()

    const appReady = await waitForDebugEvent({
      port: debugPort,
      eventType: 'app:ready',
      replay: true,
      timeoutMs: 15_000,
    })
    const interactiveReady = await waitForDebugEvent({
      port: debugPort,
      eventType: 'renderer:workspace-interactive',
      replay: true,
      timeoutMs: 15_000,
    })

    expect((interactiveReady.payload as { payload?: { isPlaceholderDocument?: boolean } }).payload?.isPlaceholderDocument).toBe(false)
    expect(Date.parse(interactiveReady.timestamp) - Date.parse(appReady.timestamp)).toBeGreaterThanOrEqual(500)
    await expect(page.locator('.toastui-editor-md-container .toastui-editor').first()).toContainText('restored after pending shell')
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }
})
