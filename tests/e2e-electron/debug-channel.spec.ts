import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'
import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { publishDebugEvent, waitForDebugEvent } from '../support/debug-channel'

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

test('debug channel emits readiness events and accepts external publish', async () => {
  const tempRoot = await makeTempDir('mdv-electron-debug-channel-')
  const userDataDir = path.join(tempRoot, 'user-data')
  const debugPort = await reserveDebugPort()

  await fs.mkdir(userDataDir, { recursive: true })

  const app = await launchElectronApp(userDataDir, debugPort)

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