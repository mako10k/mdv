import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const PRODUCT_NAME = 'MarkDownViewer'

export function getExpectedReleaseTag(version) {
  return `v${version}`
}

export function quoteShellArg(value) {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
    return value
  }

  return `'${value.replace(/'/g, `'\\''`)}'`
}

export async function readPackageVersion(rootDir) {
  const packageJsonPath = path.join(rootDir, 'package.json')
  const packageText = await fs.readFile(packageJsonPath, 'utf8')
  const packageJson = JSON.parse(packageText)

  if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
    throw new Error(`package.json at ${packageJsonPath} does not contain a valid version string`)
  }

  return packageJson.version
}

export function getReleaseArtifactManifest(rootDir, version) {
  const windowsHostDir = path.join(rootDir, 'release', 'windows-host')
  const versionedExeName = `${PRODUCT_NAME}-${version}-win.exe`

  return [
    {
      label: 'portable executable',
      path: path.join(windowsHostDir, 'portable', versionedExeName),
      githubAssetName: `${PRODUCT_NAME}-${version}-portable-win.exe`,
    },
    {
      label: 'installer executable',
      path: path.join(windowsHostDir, 'installer', versionedExeName),
      githubAssetName: `${PRODUCT_NAME}-${version}-installer-win.exe`,
    },
    {
      label: 'installer blockmap',
      path: path.join(windowsHostDir, 'installer', `${versionedExeName}.blockmap`),
      githubAssetName: `${PRODUCT_NAME}-${version}-installer-win.exe.blockmap`,
    },
    {
      label: 'win-unpacked executable',
      path: path.join(windowsHostDir, 'win-unpacked', `${PRODUCT_NAME}.exe`),
    },
  ]
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

function readGitStatus(rootDir) {
  const result = spawnSync('git', ['status', '--porcelain'], {
    cwd: rootDir,
    encoding: 'utf8',
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : ''
    throw new Error(stderr || 'git status --porcelain failed')
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
}

export function readGitRevision(rootDir, revision) {
  const result = spawnSync('git', ['rev-parse', revision], {
    cwd: rootDir,
    encoding: 'utf8',
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : ''
    throw new Error(stderr || `git rev-parse ${revision} failed`)
  }

  return result.stdout.trim()
}

export async function validateReleaseWorkspace(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? process.cwd())
  const requireCleanGit = options.requireCleanGit !== false
  const version = await readPackageVersion(rootDir)
  const expectedTag = options.expectedTag ?? getExpectedReleaseTag(version)
  const artifacts = getReleaseArtifactManifest(rootDir, version)
  const errors = []

  if (expectedTag !== getExpectedReleaseTag(version)) {
    errors.push(`Expected tag ${expectedTag} does not match package.json version ${version}`)
  }

  for (const artifact of artifacts) {
    if (!(await pathExists(artifact.path))) {
      errors.push(`Missing ${artifact.label}: ${artifact.path}`)
    }
  }

  let gitStatus = []

  if (requireCleanGit) {
    gitStatus = readGitStatus(rootDir)

    if (gitStatus.length > 0) {
      errors.push(`Git worktree must be clean before tagging:\n${gitStatus.join('\n')}`)
    }
  }

  return {
    ok: errors.length === 0,
    rootDir,
    version,
    expectedTag,
    artifacts,
    gitStatus,
    errors,
  }
}