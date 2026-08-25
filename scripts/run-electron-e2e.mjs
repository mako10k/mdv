import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const defaultRepoRoot = path.resolve(scriptDir, '..')
const electronPlaywrightConfig = 'playwright.electron.config.ts'

export function parseElectronE2eRunnerArgs(argv) {
  const playwrightArgs = []
  let visible = false

  for (const argument of argv) {
    if (argument === '--visible') {
      visible = true
      continue
    }
    playwrightArgs.push(argument)
  }

  return { visible, playwrightArgs }
}

export function buildElectronE2eInvocation(options = {}) {
  const platform = options.platform ?? process.platform
  const nodeExecutable = options.nodeExecutable ?? process.execPath
  const repoRoot = options.repoRoot ?? defaultRepoRoot
  const playwrightCliPath = options.playwrightCliPath
    ?? path.join(repoRoot, 'node_modules', 'playwright', 'cli.js')
  const visible = options.visible ?? false
  const playwrightArgs = options.playwrightArgs ?? []
  const cliArgs = [
    playwrightCliPath,
    'test',
    '-c',
    electronPlaywrightConfig,
    ...playwrightArgs,
  ]

  if (platform === 'linux' && !visible) {
    return {
      command: 'xvfb-run',
      args: ['-a', nodeExecutable, ...cliArgs],
      displayMode: 'xvfb',
      repoRoot,
    }
  }

  return {
    command: nodeExecutable,
    args: cliArgs,
    displayMode: 'visible',
    repoRoot,
  }
}

function spawnAndWait(invocation) {
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.repoRoot,
      env: process.env,
      stdio: 'inherit',
    })

    child.once('error', reject)
    child.once('exit', (code, signal) => {
      resolve({
        exitCode: typeof code === 'number' ? code : 1,
        signal,
      })
    })
  })
}

export async function runElectronE2e(argv, options = {}) {
  const {
    executeInvocation = spawnAndWait,
    statusWriter = (message) => process.stdout.write(message),
    ...invocationOptions
  } = options
  const parsed = parseElectronE2eRunnerArgs(argv)
  const invocation = buildElectronE2eInvocation({
    ...invocationOptions,
    visible: parsed.visible,
    playwrightArgs: parsed.playwrightArgs,
  })

  const modeDescription = invocation.displayMode === 'xvfb'
    ? 'isolated Xvfb display (background)'
    : 'host display (visible)'
  statusWriter(`Electron E2E display mode: ${modeDescription}\n`)

  try {
    return await executeInvocation(invocation)
  } catch (error) {
    if (invocation.displayMode === 'xvfb'
      && error !== null
      && typeof error === 'object'
      && 'code' in error
      && error.code === 'ENOENT') {
      throw new Error('Electron E2E background mode requires xvfb-run. Install Xvfb or use npm run test:e2e:electron:visible.', { cause: error })
    }
    throw error
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await runElectronE2e(process.argv.slice(2))
    if (result.signal) {
      process.stderr.write(`Electron E2E runner stopped by signal ${result.signal}.\n`)
    }
    process.exitCode = result.exitCode
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
