import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

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

  await fs.writeFile(path.join(rootDir, 'package.json'), JSON.stringify({ name: 'fixture', version }, null, 2))

  if (options.includePortable !== false) {
    await fs.writeFile(path.join(artifactRoot, 'portable', `MarkDownViewer-${version}-win.exe`), 'portable')
  }

  if (options.includeInstaller !== false) {
    await fs.writeFile(path.join(artifactRoot, 'installer', `MarkDownViewer-${version}-win.exe`), 'installer')
  }

  if (options.includeBlockmap !== false) {
    await fs.writeFile(path.join(artifactRoot, 'installer', `MarkDownViewer-${version}-win.exe.blockmap`), 'blockmap')
  }

  if (options.includeUnpacked !== false) {
    await fs.writeFile(path.join(artifactRoot, 'win-unpacked', 'MarkDownViewer.exe'), 'unpacked')
  }

  if (options.includeAppArchive !== false) {
    await fs.writeFile(path.join(artifactRoot, 'win-unpacked', 'resources', 'app.asar'), 'asar')
  }

  if (options.includeMetadata !== false) {
    const metadataVersion = options.metadataVersion ?? version
    const metadataArtifactSource = options.metadataArtifactSource ?? artifactSource
    const versionedExeName = `MarkDownViewer-${metadataVersion}-win.exe`
    await fs.writeFile(path.join(artifactRoot, 'artifact-metadata.json'), JSON.stringify({
      productName: 'MarkDownViewer',
      version: metadataVersion,
      releaseTag: `v${metadataVersion}`,
      artifactSource: metadataArtifactSource,
      artifacts: {
        portableExe: path.posix.join('portable', versionedExeName),
        installerExe: path.posix.join('installer', versionedExeName),
        installerBlockmap: path.posix.join('installer', `${versionedExeName}.blockmap`),
        winUnpackedExe: path.posix.join('win-unpacked', 'MarkDownViewer.exe'),
        appArchive: path.posix.join('win-unpacked', 'resources', 'app.asar'),
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

test('release check fails when artifact metadata version drifts from package version', async () => {
  const rootDir = await makeTempRepo('1.2.3', { metadataVersion: '1.2.4' })
  const result = await runReleaseCheckCli(['--root', rootDir])

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Artifact metadata version mismatch/)
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
  assert.match(result.stdout, /MarkDownViewer-1\.2\.3-installer-win\.exe/)
  assert.match(result.stdout, /MarkDownViewer-1\.2\.3-installer-win\.exe\.blockmap/)
  assert.match(result.stdout, /--verify-tag/)
  assert.match(result.stdout, /--notes-file/)

  const uploadDir = path.join(rootDir, 'release', '.github-upload')
  assert.equal(await pathExists(path.join(uploadDir, 'MarkDownViewer-1.2.3-portable-win.exe')), true)
  assert.equal(await pathExists(path.join(uploadDir, 'MarkDownViewer-1.2.3-installer-win.exe')), true)
  assert.equal(await pathExists(path.join(uploadDir, 'MarkDownViewer-1.2.3-installer-win.exe.blockmap')), true)
  assert.deepEqual(await readDirNames(uploadDir), [
    'MarkDownViewer-1.2.3-installer-win.exe',
    'MarkDownViewer-1.2.3-installer-win.exe.blockmap',
    'MarkDownViewer-1.2.3-portable-win.exe',
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
