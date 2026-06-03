import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const PRODUCT_NAME = 'MarkDownViewer'

function resolveArtifactRoot(rootDir, artifactSource = 'release') {
  if (artifactSource === 'candidate') {
    return path.join(rootDir, 'release', 'windows-host-candidate')
  }

  if (artifactSource === 'release') {
    return path.join(rootDir, 'release', 'windows-host')
  }

  throw new Error(`Unsupported artifact source: ${artifactSource}`)
}

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

export function getReleaseArtifactManifest(rootDir, version, artifactSource = 'release') {
  const windowsHostDir = resolveArtifactRoot(rootDir, artifactSource)
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
    {
      label: 'win-unpacked app archive',
      path: path.join(windowsHostDir, 'win-unpacked', 'resources', 'app.asar'),
    },
  ]
}

export function getArtifactMetadataPath(rootDir, artifactSource = 'release') {
  return path.join(resolveArtifactRoot(rootDir, artifactSource), 'artifact-metadata.json')
}

function getExpectedArtifactMetadata(version, expectedTag, artifactSource) {
  const versionedExeName = `${PRODUCT_NAME}-${version}-win.exe`

  return {
    productName: PRODUCT_NAME,
    version,
    releaseTag: expectedTag,
    artifactSource,
    artifacts: {
      portableExe: path.posix.join('portable', versionedExeName),
      installerExe: path.posix.join('installer', versionedExeName),
      installerBlockmap: path.posix.join('installer', `${versionedExeName}.blockmap`),
      winUnpackedExe: path.posix.join('win-unpacked', `${PRODUCT_NAME}.exe`),
      appArchive: path.posix.join('win-unpacked', 'resources', 'app.asar'),
    },
  }
}

async function readArtifactMetadata(rootDir, artifactSource) {
  const metadataPath = getArtifactMetadataPath(rootDir, artifactSource)
  const metadataText = await fs.readFile(metadataPath, 'utf8')
  return {
    metadataPath,
    metadata: JSON.parse(metadataText),
  }
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

  if (result.error && result.status === null) {
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

  if (result.error && result.status === null) {
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
  const artifactSource = options.artifactSource === 'candidate' ? 'candidate' : 'release'
  const version = await readPackageVersion(rootDir)
  const expectedTag = options.expectedTag ?? getExpectedReleaseTag(version)
  const artifacts = getReleaseArtifactManifest(rootDir, version, artifactSource)
  const errors = []

  if (expectedTag !== getExpectedReleaseTag(version)) {
    errors.push(`Expected tag ${expectedTag} does not match package.json version ${version}`)
  }

  for (const artifact of artifacts) {
    if (!(await pathExists(artifact.path))) {
      errors.push(`Missing ${artifact.label}: ${artifact.path}`)
    }
  }

  let artifactMetadata = null

  try {
    const metadataRecord = await readArtifactMetadata(rootDir, artifactSource)
    artifactMetadata = metadataRecord.metadata
    const expectedMetadata = getExpectedArtifactMetadata(version, expectedTag, artifactSource)

    if (artifactMetadata.productName !== expectedMetadata.productName) {
      errors.push(`Artifact metadata productName mismatch in ${metadataRecord.metadataPath}: expected ${expectedMetadata.productName}, got ${artifactMetadata.productName}`)
    }

    if (artifactMetadata.version !== expectedMetadata.version) {
      errors.push(`Artifact metadata version mismatch in ${metadataRecord.metadataPath}: expected ${expectedMetadata.version}, got ${artifactMetadata.version}`)
    }

    if (artifactMetadata.releaseTag !== expectedMetadata.releaseTag) {
      errors.push(`Artifact metadata releaseTag mismatch in ${metadataRecord.metadataPath}: expected ${expectedMetadata.releaseTag}, got ${artifactMetadata.releaseTag}`)
    }

    if (artifactMetadata.artifactSource !== expectedMetadata.artifactSource) {
      errors.push(`Artifact metadata artifactSource mismatch in ${metadataRecord.metadataPath}: expected ${expectedMetadata.artifactSource}, got ${artifactMetadata.artifactSource}`)
    }

    for (const [key, expectedValue] of Object.entries(expectedMetadata.artifacts)) {
      const actualValue = artifactMetadata?.artifacts?.[key]
      if (actualValue !== expectedValue) {
        errors.push(`Artifact metadata ${key} mismatch in ${metadataRecord.metadataPath}: expected ${expectedValue}, got ${actualValue}`)
      }
    }
  } catch (error) {
    errors.push(`Missing or invalid artifact metadata: ${error instanceof Error ? error.message : String(error)}`)
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
    artifactSource,
    version,
    expectedTag,
    artifacts,
    artifactMetadata,
    gitStatus,
    errors,
  }
}
