import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

import { createPackage } from '@electron/asar'
import YAML from 'yaml'

import { computeReleaseSourceFingerprint } from '../../scripts/release-source-fingerprint.mjs'

function sha512Base64(text) {
  return createHash('sha512').update(text).digest('base64')
}

async function readWorkspacePackageJson() {
  return JSON.parse(await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8'))
}

async function readWorkspacePackageLock() {
  return JSON.parse(await fs.readFile(path.join(process.cwd(), 'package-lock.json'), 'utf8'))
}

import { runReleaseCheck } from '../../scripts/check-release-candidate.mjs'
import { runGithubReleasePreparation } from '../../scripts/prepare-github-release.mjs'

async function makeTempRepo(version, options = {}) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-release-workflow-'))
  const artifactSource = options.artifactSource ?? 'release'
  const artifactRoot = path.join(rootDir, 'release', artifactSource === 'candidate' ? 'windows-host-candidate' : 'windows-host')
  await fs.mkdir(path.join(artifactRoot, 'portable'), { recursive: true })
  await fs.mkdir(path.join(artifactRoot, 'installer'), { recursive: true })
  await fs.mkdir(path.join(artifactRoot, 'win-unpacked', 'resources'), { recursive: true })
  await fs.mkdir(path.join(rootDir, 'docs', 'release-notes'), { recursive: true })
  await fs.mkdir(path.join(rootDir, 'src'), { recursive: true })
  await fs.writeFile(path.join(rootDir, 'src', 'App.tsx'), 'export const fixture = true\n')

  await fs.writeFile(path.join(rootDir, 'package.json'), JSON.stringify({
    name: 'fixture',
    version,
    build: {
      publish: [
        {
          provider: 'generic',
          url: 'https://github.com/mako10k/mdv/releases/latest/download',
          updaterCacheDirName: 'fixture-updater',
        },
      ],
    },
  }, null, 2))

  if (options.includePortable !== false) {
    await fs.writeFile(path.join(artifactRoot, 'portable', `MarkDownViewer-${version}-win.exe`), 'portable')
  }

  if (options.includeInstaller !== false) {
    await fs.writeFile(path.join(artifactRoot, 'installer', `MarkDownViewer-${version}-win.exe`), 'installer')
  }

  if (options.includeBlockmap !== false) {
    await fs.writeFile(path.join(artifactRoot, 'installer', `MarkDownViewer-${version}-win.exe.blockmap`), 'blockmap')
  }

  if (options.includeLatestManifest !== false) {
    const installerSha512 = sha512Base64('installer')
    await fs.writeFile(path.join(artifactRoot, 'installer', 'latest.yml'), YAML.stringify({
      version,
      files: [
        {
          url: `MarkDownViewer-${version}-win.exe`,
          sha512: installerSha512,
          size: 'installer'.length,
          blockMapSize: 'blockmap'.length,
        },
      ],
      path: `MarkDownViewer-${version}-win.exe`,
      sha512: installerSha512,
      releaseDate: '2026-06-03T00:00:00.000Z',
    }))
  }

  if (options.includeUnpacked !== false) {
    await fs.writeFile(path.join(artifactRoot, 'win-unpacked', 'MarkDownViewer.exe'), 'unpacked')
  }

  if (options.includeAppArchive !== false) {
    const asarInput = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-release-asar-'))
    await fs.mkdir(path.join(asarInput, 'dist', 'assets'), { recursive: true })
    await fs.writeFile(path.join(asarInput, 'package.json'), JSON.stringify({
      version: options.packagedVersion ?? version,
      dependencies: { dompurify: '3.4.12' },
    }))
    await fs.writeFile(
      path.join(asarInput, 'dist', 'index.html'),
      '<script type="module" src="./assets/main-fixture.js"></script>\n',
    )
    await fs.writeFile(
      path.join(asarInput, 'dist', 'assets', 'main-fixture.js'),
      options.legacyPackagedSanitizer
        ? 'sanitizer.version="3.4.12";legacy.version="2.3.3";\n'
        : 'sanitizer.version="3.4.12";\n',
    )
    await createPackage(asarInput, path.join(artifactRoot, 'win-unpacked', 'resources', 'app.asar'))
    await fs.rm(asarInput, { recursive: true, force: true })
  }

  if (options.includeUpdaterConfig !== false) {
    const updaterConfig = {
      provider: 'generic',
      url: 'https://github.com/mako10k/mdv/releases/latest/download',
      updaterCacheDirName: 'fixture-updater',
      ...(options.updaterConfigOverrides ?? {}),
    }
    await fs.writeFile(path.join(artifactRoot, 'win-unpacked', 'resources', 'app-update.yml'), YAML.stringify({
      ...updaterConfig,
    }))
  }

  if (options.includeMetadata !== false) {
    const metadataVersion = options.metadataVersion ?? version
    const metadataArtifactSource = options.metadataArtifactSource ?? artifactSource
    const versionedExeName = `MarkDownViewer-${metadataVersion}-win.exe`
    const sourceFingerprintSha256 = options.metadataSourceFingerprint
      ?? await computeReleaseSourceFingerprint(rootDir)
    await fs.writeFile(path.join(artifactRoot, 'artifact-metadata.json'), JSON.stringify({
      productName: 'MarkDownViewer',
      version: metadataVersion,
      releaseTag: `v${metadataVersion}`,
      artifactSource: metadataArtifactSource,
      generatedAt: '2026-07-22T00:00:00.000Z',
      generationId: '12345678-1234-4123-8123-123456789abc',
      sourceFingerprintSha256,
      artifacts: {
        portableExe: path.posix.join('portable', versionedExeName),
        installerExe: path.posix.join('installer', versionedExeName),
        installerBlockmap: path.posix.join('installer', `${versionedExeName}.blockmap`),
        updaterManifest: path.posix.join('installer', 'latest.yml'),
        winUnpackedExe: path.posix.join('win-unpacked', 'MarkDownViewer.exe'),
        appArchive: path.posix.join('win-unpacked', 'resources', 'app.asar'),
        updaterConfig: path.posix.join('win-unpacked', 'resources', 'app-update.yml'),
      },
    }, null, 2))
  }

  await fs.writeFile(path.join(rootDir, 'docs', 'release-notes', `v${version}.md`), '# Notes\n')

  runGit(rootDir, ['init'])
  runGit(rootDir, ['config', 'user.name', 'Copilot Test'])
  runGit(rootDir, ['config', 'user.email', 'copilot@example.com'])
  runGit(rootDir, ['add', '.'])
  runGit(rootDir, ['commit', '-m', 'fixture'])

  if (options.createTag !== false) {
    runGit(rootDir, ['tag', '-a', `v${version}`, '-m', `Release v${version}`])
  }

  return rootDir
}

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })

  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed`)
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

async function readDirNames(targetPath) {
  return (await fs.readdir(targetPath)).sort()
}

async function runReleaseCheckCli(args) {
  const result = await runReleaseCheck(args)

  return {
    status: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

async function runGithubReleaseCli(args) {
  const result = await runGithubReleasePreparation(args)

  return {
    status: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

test('release check passes for a clean repo with version-matching artifacts', async () => {
  const rootDir = await makeTempRepo('1.2.3')
  const result = await runReleaseCheckCli(['--root', rootDir, '--expect-tag', 'v1.2.3'])

  assert.equal(result.status, 0)
  assert.match(result.stdout, /Release candidate is ready for v1\.2\.3 \(release\)/)
  assert.match(result.stdout, /portable executable/)
})

test('release check passes for candidate artifacts when artifact source is candidate', async () => {
  const rootDir = await makeTempRepo('1.2.3', { artifactSource: 'candidate' })
  const result = await runReleaseCheckCli(['--root', rootDir, '--artifact-source', 'candidate'])

  assert.equal(result.status, 0)
  assert.match(result.stdout, /Release candidate is ready for v1\.2\.3 \(candidate\)/)
})

test('release check fails when a required artifact is missing', async () => {
  const rootDir = await makeTempRepo('1.2.3', { includePortable: false })
  const result = await runReleaseCheckCli(['--root', rootDir])

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Missing portable executable/)
})

test('release check fails when updater manifest is missing', async () => {
  const rootDir = await makeTempRepo('1.2.3', { includeLatestManifest: false })
  const result = await runReleaseCheckCli(['--root', rootDir])

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Missing installer update manifest/)
})

test('release check fails when win-unpacked updater config is missing', async () => {
  const rootDir = await makeTempRepo('1.2.3', { includeUpdaterConfig: false })
  const result = await runReleaseCheckCli(['--root', rootDir])

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Missing win-unpacked updater config/)
})

test('release check fails when win-unpacked updater config content drifts from package config', async () => {
  const rootDir = await makeTempRepo('1.2.3', {
    updaterConfigOverrides: {
      url: 'https://example.com/wrong-feed',
    },
  })
  const result = await runReleaseCheckCli(['--root', rootDir])

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /app-update\.yml url mismatch/)
})

test('release check fails when artifact metadata version drifts from package version', async () => {
  const rootDir = await makeTempRepo('1.2.3', { metadataVersion: '1.2.4' })
  const result = await runReleaseCheckCli(['--root', rootDir])

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Artifact metadata version mismatch/)
})

test('release check fails when candidate source inputs drift after generation', async () => {
  const rootDir = await makeTempRepo('1.2.3', { artifactSource: 'candidate' })
  await fs.writeFile(path.join(rootDir, 'src', 'App.tsx'), 'export const fixture = false\n')

  const result = await runReleaseCheckCli(['--root', rootDir, '--artifact-source', 'candidate', '--skip-git'])

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Artifact metadata source fingerprint mismatch/)
})

test('release check fails when packaged renderer still contains legacy DOMPurify', async () => {
  const rootDir = await makeTempRepo('1.2.3', {
    artifactSource: 'candidate',
    legacyPackagedSanitizer: true,
  })

  const result = await runReleaseCheckCli(['--root', rootDir, '--artifact-source', 'candidate', '--skip-git'])

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Packaged renderer security check failed.*legacy DOMPurify 2\.3\.3/)
})

test('release check fails when the expected tag does not match package version', async () => {
  const rootDir = await makeTempRepo('1.2.3')
  const result = await runReleaseCheckCli(['--root', rootDir, '--expect-tag', 'v1.2.4'])

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /does not match package\.json version 1\.2\.3/)
})

test('release check fails when the git worktree is dirty', async () => {
  const rootDir = await makeTempRepo('1.2.3')
  await fs.writeFile(path.join(rootDir, 'dirty.txt'), 'pending')
  const result = await runReleaseCheckCli(['--root', rootDir])

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Git worktree must be clean before tagging/)
})

test('github release helper prints the exact gh command for the tagged artifacts', async () => {
  const rootDir = await makeTempRepo('1.2.3')
  const notesPath = 'docs/release-notes/v1.2.3.md'
  const result = await runGithubReleaseCli(['--root', rootDir, '--notes', notesPath])

  assert.equal(result.status, 0)
  assert.match(result.stdout, /secdat exec gh release create v1\.2\.3/)
  assert.match(result.stdout, /MarkDownViewer-1\.2\.3-portable-win\.exe/)
  assert.match(result.stdout, /MarkDownViewer-1\.2\.3-win\.exe/)
  assert.match(result.stdout, /MarkDownViewer-1\.2\.3-win\.exe\.blockmap/)
  assert.match(result.stdout, /latest\.yml/)
  assert.match(result.stdout, /--verify-tag/)
  assert.match(result.stdout, /--notes-file/)

  const uploadDir = path.join(rootDir, 'release', '.github-upload')
  assert.equal(await pathExists(path.join(uploadDir, 'MarkDownViewer-1.2.3-portable-win.exe')), true)
  assert.equal(await pathExists(path.join(uploadDir, 'MarkDownViewer-1.2.3-win.exe')), true)
  assert.equal(await pathExists(path.join(uploadDir, 'MarkDownViewer-1.2.3-win.exe.blockmap')), true)
  assert.equal(await pathExists(path.join(uploadDir, 'latest.yml')), true)
  assert.deepEqual(await readDirNames(uploadDir), [
    'MarkDownViewer-1.2.3-portable-win.exe',
    'MarkDownViewer-1.2.3-win.exe',
    'MarkDownViewer-1.2.3-win.exe.blockmap',
    'latest.yml',
  ])
})

test('github release helper fails when the release tag does not point to HEAD', async () => {
  const rootDir = await makeTempRepo('1.2.3')
  await fs.writeFile(path.join(rootDir, 'post-tag.txt'), 'changed after tag')
  runGit(rootDir, ['add', 'post-tag.txt'])
  runGit(rootDir, ['commit', '-m', 'post tag commit'])

  const result = await runGithubReleaseCli(['--root', rootDir, '--notes', 'docs/release-notes/v1.2.3.md'])

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /points to .* but HEAD is .*/)
})

test('workspace package config includes Windows updater publish metadata', async () => {
  const packageJson = await readWorkspacePackageJson()

  assert.deepEqual(packageJson.build.publish, [
    {
      provider: 'generic',
      url: 'https://github.com/mako10k/mdv/releases/latest/download',
    },
  ])
})

test('workspace resolves the patched Markdown security dependency set', async () => {
  const packageJson = await readWorkspacePackageJson()
  const packageLock = await readWorkspacePackageLock()

  assert.equal(packageJson.dependencies['markdown-it'], '^14.3.0')
  assert.equal(packageJson.dependencies.dompurify, '3.4.12')
  assert.equal(packageJson.overrides.dompurify, '3.4.12')
  assert.equal(packageLock.packages['node_modules/markdown-it'].version, '14.3.0')
  assert.equal(packageLock.packages['node_modules/linkify-it'].version, '5.0.2')
  assert.equal(packageLock.packages['node_modules/js-yaml'].version, '4.3.0')
  assert.equal(packageLock.packages['node_modules/dompurify'].version, '3.4.12')
})

test('Windows host generation invalidates stale candidates and promotion requires full validation', async () => {
  const script = await fs.readFile(path.join(process.cwd(), 'scripts', 'build-win-host.ps1'), 'utf8')
  const invalidateIndex = script.indexOf('Invalidated previous candidate artifacts')
  const buildIndex = script.indexOf("Write-Host 'Building Windows unpacked app'")
  const validationIndex = script.indexOf('Assert-ValidatedCandidateArtifacts', script.indexOf('function Promote-CandidateArtifacts'))
  const promotionCopyIndex = script.indexOf('Sync-Directory -SourcePath $candidateArtifactDest', validationIndex)

  assert.ok(invalidateIndex >= 0 && invalidateIndex < buildIndex)
  assert.ok(validationIndex >= 0 && validationIndex < promotionCopyIndex)
  assert.match(script, /sourceFingerprintSha256 = \$SourceFingerprintSha256/)
  assert.match(script, /generationId = \[Guid\]::NewGuid\(\)\.ToString\(\)/)
  assert.match(script, /Write-ArtifactMetadata -ArtifactRoot \$artifactStageDest -ArtifactSource 'release' -SourceFingerprintSha256 \$validatedSourceFingerprint/)
})
