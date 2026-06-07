import { _electron as electron } from 'playwright'

function buildElectronLaunchEnv(overrides: Record<string, string>) {
  const env: Record<string, string> = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      env[key] = value
    }
  }

  delete env.ELECTRON_RUN_AS_NODE

  return {
    ...env,
    ...overrides,
  }
}

async function launchElectronApp(options: {
  repoRoot: string
  args?: string[]
  env: Record<string, string>
}) {
  return electron.launch({
    args: options.args ?? ['.'],
    cwd: options.repoRoot,
    env: buildElectronLaunchEnv(options.env),
  })
}

export {
  buildElectronLaunchEnv,
  launchElectronApp,
}
