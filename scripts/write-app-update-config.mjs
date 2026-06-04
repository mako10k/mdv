import fs from 'node:fs/promises'
import path from 'node:path'

import YAML from 'yaml'

function parseArgs(argv) {
  const options = {
    rootDir: process.cwd(),
    appOutDir: null,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--root') {
      index += 1
      options.rootDir = path.resolve(argv[index] ?? process.cwd())
      continue
    }

    if (arg === '--app-out-dir') {
      index += 1
      options.appOutDir = path.resolve(argv[index] ?? '')
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!options.appOutDir) {
    throw new Error('--app-out-dir is required')
  }

  return options
}

function sanitizeUpdaterCacheBase(name) {
  return name
    .trim()
    .replace(/^@/, '')
    .replace(/[\\/]/g, '-')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

async function main(argv) {
  const options = parseArgs(argv)
  const packageJsonPath = path.join(options.rootDir, 'package.json')
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'))
  const publishConfig = Array.isArray(packageJson?.build?.publish)
    ? packageJson.build.publish[0] ?? null
    : packageJson?.build?.publish ?? null

  if (!publishConfig || typeof publishConfig !== 'object') {
    throw new Error(`package.json at ${packageJsonPath} does not contain a build.publish object`)
  }

  if (publishConfig.provider !== 'generic') {
    throw new Error(`write-app-update-config only supports generic publish providers, got ${String(publishConfig.provider)}`)
  }

  if (typeof publishConfig.url !== 'string' || publishConfig.url.length === 0) {
    throw new Error(`package.json at ${packageJsonPath} does not contain a valid generic publish url`)
  }

  const packageName = typeof packageJson.name === 'string' && packageJson.name.length > 0
    ? packageJson.name
    : 'mdv'
  const updaterConfig = {
    ...publishConfig,
    updaterCacheDirName: publishConfig.updaterCacheDirName ?? `${sanitizeUpdaterCacheBase(packageName)}-updater`,
  }

  const resourcesDir = path.join(options.appOutDir, 'resources')
  const targetPath = path.join(resourcesDir, 'app-update.yml')
  await fs.mkdir(resourcesDir, { recursive: true })
  await fs.writeFile(targetPath, YAML.stringify(updaterConfig), 'utf8')
  process.stdout.write(`${targetPath}\n`)
}

await main(process.argv.slice(2))