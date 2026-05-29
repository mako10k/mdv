import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const mdastRoot = path.join(repoRoot, 'vendor', 'mdast-control')
const mdastPackageJsonPath = path.join(mdastRoot, 'package.json')
const mdastPackageLockJsonPath = path.join(mdastRoot, 'package-lock.json')
const mdastNodeModulesPath = path.join(mdastRoot, 'node_modules')
const mdastInstallStatePath = path.join(mdastNodeModulesPath, '.mdv-install-state.json')
const shouldSkipPostinstallBootstrap = process.env.MDV_SKIP_MDAST_POSTINSTALL === '1'

function getFileHash(filePath) {
  if (!existsSync(filePath)) {
    return null
  }

  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function getDependencyState() {
  return {
    packageJson: getFileHash(mdastPackageJsonPath),
    packageLockJson: getFileHash(mdastPackageLockJsonPath),
  }
}

function readDependencyState() {
  if (!existsSync(mdastInstallStatePath)) {
    return null
  }

  try {
    return JSON.parse(readFileSync(mdastInstallStatePath, 'utf8'))
  } catch {
    return null
  }
}

function writeDependencyState() {
  writeFileSync(mdastInstallStatePath, `${JSON.stringify(getDependencyState())}\n`)
}

function runNpm(args) {
  const npmCommand = process.platform === 'win32'
    ? process.execPath
    : 'npm'
  const commandArgs = process.platform === 'win32'
    ? [path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), ...args]
    : args
  const result = spawnSync(npmCommand, commandArgs, {
    cwd: mdastRoot,
    stdio: 'inherit',
  })

  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function hasMdastSubmodule() {
  return existsSync(mdastPackageJsonPath)
}

function ensureMdastInitialized() {
  if (hasMdastSubmodule()) {
    return
  }

  console.error('mdast-control submodule is not initialized. Run "git submodule update --init --recursive vendor/mdast-control" first.')
  process.exit(1)
}

function ensureMdastDependencies() {
  ensureMdastInitialized()

  const currentState = getDependencyState()
  const previousState = readDependencyState()
  const hasMatchingState =
    previousState?.packageJson === currentState.packageJson &&
    previousState?.packageLockJson === currentState.packageLockJson

  if (existsSync(mdastNodeModulesPath) && hasMatchingState) {
    return
  }

  runNpm(['install'])
  writeDependencyState()
}

const action = process.argv[2]

switch (action) {
  case 'postinstall':
    if (shouldSkipPostinstallBootstrap) {
      console.warn('Skipping mdast bootstrap because MDV_SKIP_MDAST_POSTINSTALL=1 is set.')
      break
    }

    if (hasMdastSubmodule()) {
      ensureMdastDependencies()
    } else {
      console.warn('Skipping mdast bootstrap because vendor/mdast-control is not initialized yet. Run "git submodule update --init --recursive vendor/mdast-control" before mdast-aware builds.')
    }
    break
  case 'install':
    ensureMdastInitialized()
    runNpm(['install'])
    writeDependencyState()
    break
  case 'build':
    ensureMdastDependencies()
    runNpm(['run', 'build'])
    break
  case 'check':
    ensureMdastDependencies()
    runNpm(['run', 'check'])
    break
  case 'watch':
    ensureMdastDependencies()
    runNpm(['run', 'build', '--', '--watch'])
    break
  default:
    console.error('Usage: node ./scripts/mdast-submodule.mjs <postinstall|install|build|check|watch>')
    process.exit(1)
}