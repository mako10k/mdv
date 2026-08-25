import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

import { extractFile } from '@electron/asar'
import YAML from 'yaml'

import { assertRendererSecurityEntry, findPackagedRendererEntryPath } from './renderer-security-check.mjs'
import { computeReleaseSourceFingerprint } from './release-source-fingerprint.mjs'
import { validateBundledPluginCatalogInAsar } from './plugin-conformance.mjs'

const PRODUCT_NAME = 'MarkDownViewer'

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

async function readPackageJson(rootDir) {
  const packageJsonPath = path.join(rootDir, 'package.json')
  return JSON.parse(await fs.readFile(packageJsonPath, 'utf8'))
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
      githubAssetName: versionedExeName,
    },
    {
      label: 'installer blockmap',
      path: path.join(windowsHostDir, 'installer', `${versionedExeName}.blockmap`),
      githubAssetName: `${versionedExeName}.blockmap`,
    },
    {
      label: 'installer update manifest',
      path: path.join(windowsHostDir, 'installer', 'latest.yml'),
      githubAssetName: 'latest.yml',
    },
    {
      label: 'win-unpacked executable',
      path: path.join(windowsHostDir, 'win-unpacked', `${PRODUCT_NAME}.exe`),
    },
    {
      label: 'win-unpacked app archive',
      path: path.join(windowsHostDir, 'win-unpacked', 'resources', 'app.asar'),
    },
    {
      label: 'win-unpacked updater config',
      path: path.join(windowsHostDir, 'win-unpacked', 'resources', 'app-update.yml'),
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
      updaterManifest: path.posix.join('installer', 'latest.yml'),
      winUnpackedExe: path.posix.join('win-unpacked', `${PRODUCT_NAME}.exe`),
      appArchive: path.posix.join('win-unpacked', 'resources', 'app.asar'),
      updaterConfig: path.posix.join('win-unpacked', 'resources', 'app-update.yml'),
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

async function hashFileSha512Base64(filePath) {
  const buffer = await fs.readFile(filePath)
  return createHash('sha512').update(buffer).digest('base64')
}

function validateArtifactGenerationMetadata(metadata, metadataPath, expectedSourceFingerprint, errors) {
  if (typeof metadata.generatedAt !== 'string' || !Number.isFinite(Date.parse(metadata.generatedAt))) {
    errors.push(`Artifact metadata generatedAt is missing or invalid in ${metadataPath}`)
  }

  if (typeof metadata.generationId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(metadata.generationId)) {
    errors.push(`Artifact metadata generationId is missing or invalid in ${metadataPath}`)
  }

  if (metadata.sourceFingerprintSha256 !== expectedSourceFingerprint) {
    errors.push(
      `Artifact metadata source fingerprint mismatch in ${metadataPath}: expected ${expectedSourceFingerprint}, got ${metadata.sourceFingerprintSha256 ?? 'undefined'}`,
    )
  }
}

function validatePackagedRendererSecurity(appArchivePath, expectedVersion, errors) {
  try {
    const packagedPackageJson = JSON.parse(extractFile(appArchivePath, 'package.json').toString('utf8'))
    if (packagedPackageJson.version !== expectedVersion) {
      errors.push(`Packaged app version mismatch in ${appArchivePath}: expected ${expectedVersion}, got ${packagedPackageJson.version ?? 'undefined'}`)
    }

    for (const htmlFileName of ['index.html', 'mermaid-viewer.html']) {
      const rendererHtml = extractFile(appArchivePath, `dist/${htmlFileName}`).toString('utf8')
      const entryPath = findPackagedRendererEntryPath(rendererHtml)
      const entrySource = extractFile(appArchivePath, entryPath).toString('utf8')
      assertRendererSecurityEntry(packagedPackageJson, rendererHtml, entrySource)
    }
  } catch (error) {
    errors.push(`Packaged renderer security check failed for ${appArchivePath}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function validatePackagedPluginCatalog(appArchivePath, expectedVersion, errors) {
  try {
    const result = await validateBundledPluginCatalogInAsar({
      asarPath: appArchivePath,
      hostVersion: expectedVersion,
    })
    if (!result.ok) {
      for (const packageResult of result.packages) {
        for (const diagnostic of packageResult.diagnostics) {
          errors.push(`Packaged Plugin catalog check failed for ${packageResult.catalogId}: ${diagnostic.code}${diagnostic.relativeLocation ? ` at ${diagnostic.relativeLocation}` : ''}`)
        }
      }
    }
  } catch (error) {
    errors.push(`Packaged Plugin catalog check failed for ${appArchivePath}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function validatePackagedPluginRepresentations(appArchivePath, rootDir, errors) {
  const requiredRepresentations = [
    'plugin-contract/contract.json',
    'plugin-contract/manifest.schema.json',
    'electron/lib/main/plugin-catalog.cjs',
    'electron/lib/main/plugin-manifest-contract.generated.cjs',
  ]

  for (const relativePath of requiredRepresentations) {
    try {
      const sourceBytes = await fs.readFile(path.join(rootDir, ...relativePath.split('/')))
      const packagedBytes = extractFile(appArchivePath, relativePath)
      const sourceDigest = createHash('sha256').update(sourceBytes).digest('hex')
      const packagedDigest = createHash('sha256').update(packagedBytes).digest('hex')
      if (sourceDigest !== packagedDigest) {
        errors.push(`Packaged Plugin representation mismatch for ${relativePath} in ${appArchivePath}`)
      }
    } catch (error) {
      errors.push(`Packaged Plugin representation is missing or unreadable for ${relativePath} in ${appArchivePath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

function validatePluginPackagingConfiguration(packageJson, rootDir, errors) {
  const packagedFiles = Array.isArray(packageJson?.build?.files) ? packageJson.build.files : []
  for (const requiredInput of ['plugin-contract/**/*', 'plugins/bundled/**/*']) {
    if (!packagedFiles.includes(requiredInput)) {
      errors.push(`package.json build.files must include ${requiredInput} for bundled Plugin packaging at ${rootDir}`)
    }
  }
}

async function validateLatestYml(rootDir, artifactSource, version, expectedTag, errors) {
  const artifactRoot = resolveArtifactRoot(rootDir, artifactSource)
  const versionedExeName = `${PRODUCT_NAME}-${version}-win.exe`
  const latestYmlPath = path.join(artifactRoot, 'installer', 'latest.yml')
  const installerExePath = path.join(artifactRoot, 'installer', versionedExeName)
  const blockmapPath = path.join(artifactRoot, 'installer', `${versionedExeName}.blockmap`)
  const [installerText, installerStat, blockmapStat, installerSha512] = await Promise.all([
    fs.readFile(latestYmlPath, 'utf8'),
    fs.stat(installerExePath),
    fs.stat(blockmapPath),
    hashFileSha512Base64(installerExePath),
  ])
  const latestManifest = YAML.parse(installerText)

  if (latestManifest?.version !== version) {
    errors.push(`latest.yml version mismatch in ${latestYmlPath}: expected ${version}, got ${latestManifest?.version ?? 'undefined'}`)
  }

  if (latestManifest?.path !== versionedExeName) {
    errors.push(`latest.yml path mismatch in ${latestYmlPath}: expected ${versionedExeName}, got ${latestManifest?.path ?? 'undefined'}`)
  }

  if (!Array.isArray(latestManifest?.files) || latestManifest.files.length === 0) {
    errors.push(`latest.yml files entry is missing in ${latestYmlPath}`)
    return
  }

  const firstFile = latestManifest.files[0]

  if (firstFile?.url !== versionedExeName) {
    errors.push(`latest.yml files[0].url mismatch in ${latestYmlPath}: expected ${versionedExeName}, got ${firstFile?.url ?? 'undefined'}`)
  }

  if (Number(firstFile?.size) !== installerStat.size) {
    errors.push(`latest.yml files[0].size mismatch in ${latestYmlPath}: expected ${installerStat.size}, got ${firstFile?.size ?? 'undefined'}`)
  }

  if (Number(firstFile?.blockMapSize) !== blockmapStat.size) {
    errors.push(`latest.yml files[0].blockMapSize mismatch in ${latestYmlPath}: expected ${blockmapStat.size}, got ${firstFile?.blockMapSize ?? 'undefined'}`)
  }

  if (firstFile?.sha512 !== installerSha512) {
    errors.push(`latest.yml files[0].sha512 mismatch in ${latestYmlPath}`)
  }

  if (latestManifest?.sha512 !== installerSha512) {
    errors.push(`latest.yml sha512 mismatch in ${latestYmlPath}`)
  }

  if (latestManifest?.releaseDate && Number.isNaN(Date.parse(latestManifest.releaseDate))) {
    errors.push(`latest.yml releaseDate is invalid in ${latestYmlPath}: ${latestManifest.releaseDate}`)
  }

  if (expectedTag !== `v${version}`) {
    errors.push(`latest.yml validation requires tag ${`v${version}`} but expected ${expectedTag}`)
  }
}

async function validateAppUpdateYml(rootDir, artifactSource, errors) {
  const artifactRoot = resolveArtifactRoot(rootDir, artifactSource)
  const appUpdateYmlPath = path.join(artifactRoot, 'win-unpacked', 'resources', 'app-update.yml')
  const [packageJson, appUpdateText] = await Promise.all([
    readPackageJson(rootDir),
    fs.readFile(appUpdateYmlPath, 'utf8'),
  ])

  const publishConfig = Array.isArray(packageJson?.build?.publish)
    ? packageJson.build.publish[0] ?? null
    : packageJson?.build?.publish ?? null

  if (!publishConfig || typeof publishConfig !== 'object') {
    errors.push(`package.json does not contain a build.publish object required to validate ${appUpdateYmlPath}`)
    return
  }

  const expectedUrl = publishConfig.url
  const expectedProvider = publishConfig.provider
  const expectedUpdaterCacheDirName = publishConfig.updaterCacheDirName
    ?? `${sanitizeUpdaterCacheBase(typeof packageJson.name === 'string' && packageJson.name.length > 0 ? packageJson.name : 'mdv')}-updater`
  const appUpdateConfig = YAML.parse(appUpdateText)

  if (appUpdateConfig?.provider !== expectedProvider) {
    errors.push(`app-update.yml provider mismatch in ${appUpdateYmlPath}: expected ${expectedProvider}, got ${appUpdateConfig?.provider ?? 'undefined'}`)
  }

  if (appUpdateConfig?.url !== expectedUrl) {
    errors.push(`app-update.yml url mismatch in ${appUpdateYmlPath}: expected ${expectedUrl}, got ${appUpdateConfig?.url ?? 'undefined'}`)
  }

  if (appUpdateConfig?.updaterCacheDirName !== expectedUpdaterCacheDirName) {
    errors.push(`app-update.yml updaterCacheDirName mismatch in ${appUpdateYmlPath}: expected ${expectedUpdaterCacheDirName}, got ${appUpdateConfig?.updaterCacheDirName ?? 'undefined'}`)
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
  const packageJson = await readPackageJson(rootDir)
  const expectedTag = options.expectedTag ?? getExpectedReleaseTag(version)
  const artifacts = getReleaseArtifactManifest(rootDir, version, artifactSource)
  const errors = []
  const sourceFingerprintSha256 = await computeReleaseSourceFingerprint(rootDir)

  validatePluginPackagingConfiguration(packageJson, rootDir, errors)

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

    validateArtifactGenerationMetadata(artifactMetadata, metadataRecord.metadataPath, sourceFingerprintSha256, errors)
  } catch (error) {
    errors.push(`Missing or invalid artifact metadata: ${error instanceof Error ? error.message : String(error)}`)
  }

  try {
    await validateLatestYml(rootDir, artifactSource, version, expectedTag, errors)
  } catch (error) {
    errors.push(`Missing or invalid updater manifest: ${error instanceof Error ? error.message : String(error)}`)
  }

  try {
    await validateAppUpdateYml(rootDir, artifactSource, errors)
  } catch (error) {
    errors.push(`Missing or invalid app updater config: ${error instanceof Error ? error.message : String(error)}`)
  }

  const appArchive = artifacts.find((artifact) => artifact.label === 'win-unpacked app archive')
  if (appArchive && await pathExists(appArchive.path)) {
    validatePackagedRendererSecurity(appArchive.path, version, errors)
    await validatePackagedPluginRepresentations(appArchive.path, rootDir, errors)
    await validatePackagedPluginCatalog(appArchive.path, version, errors)
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
    sourceFingerprintSha256,
    gitStatus,
    errors,
  }
}
