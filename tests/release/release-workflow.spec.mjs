import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const releaseCheckScript = path.join(repoRoot, 'scripts', 'check-release-candidate.mjs')
const githubReleaseScript = path.join(repoRoot, 'scripts', 'prepare-github-release.mjs')

async function makeTempRepo(version, options = {}) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-release-workflow-'))
  await fs.mkdir(path.join(rootDir, 'release', 'windows-host', 'portable'), { recursive: true })
  await fs.mkdir(path.join(rootDir, 'release', 'windows-host', 'installer'), { recursive: true })
  await fs.mkdir(path.join(rootDir, 'release', 'windows-host', 'win-unpacked'), { recursive: true })
  await fs.mkdir(path.join(rootDir, 'docs', 'release-notes'), { recursive: true })

  await fs.writeFile(path.join(rootDir, 'package.json'), JSON.stringify({ name: 'fixture', version }, null, 2))

  if (options.includePortable !== false) {
    await fs.writeFile(path.join(rootDir, 'release', 'windows-host', 'portable', `MarkDownViewer-${version}-win.exe`), 'portable')
  }

  if (options.includeInstaller !== false) {
    await fs.writeFile(path.join(rootDir, 'release', 'windows-host', 'installer', `MarkDownViewer-${version}-win.exe`), 'installer')
  }

  if (options.includeBlockmap !== false) {
    await fs.writeFile(path.join(rootDir, 'release', 'windows-host', 'installer', `MarkDownViewer-${version}-win.exe.blockmap`), 'blockmap')
  }

  if (options.includeUnpacked !== false) {
    await fs.writeFile(path.join(rootDir, 'release', 'windows-host', 'win-unpacked', 'MarkDownViewer.exe'), 'unpacked')
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

function runNode(scriptPath, args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
}

test('release check passes for a clean repo with version-matching artifacts', async () => {
  const rootDir = await makeTempRepo('1.2.3')
  const result = runNode(releaseCheckScript, ['--root', rootDir, '--expect-tag', 'v1.2.3'])

  assert.equal(result.status, 0)
  assert.match(result.stdout, /Release candidate is ready for v1\.2\.3/)
  assert.match(result.stdout, /portable executable/)
})

test('release check fails when a required artifact is missing', async () => {
  const rootDir = await makeTempRepo('1.2.3', { includePortable: false })
  const result = runNode(releaseCheckScript, ['--root', rootDir])

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Missing portable executable/)
})

test('release check fails when the expected tag does not match package version', async () => {
  const rootDir = await makeTempRepo('1.2.3')
  const result = runNode(releaseCheckScript, ['--root', rootDir, '--expect-tag', 'v1.2.4'])

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /does not match package\.json version 1\.2\.3/)
})

test('release check fails when the git worktree is dirty', async () => {
  const rootDir = await makeTempRepo('1.2.3')
  await fs.writeFile(path.join(rootDir, 'dirty.txt'), 'pending')
  const result = runNode(releaseCheckScript, ['--root', rootDir])

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Git worktree must be clean before tagging/)
})

test('github release helper prints the exact gh command for the tagged artifacts', async () => {
  const rootDir = await makeTempRepo('1.2.3')
  const notesPath = 'docs/release-notes/v1.2.3.md'
  const result = runNode(githubReleaseScript, ['--root', rootDir, '--notes', notesPath])

  assert.equal(result.status, 0)
  assert.match(result.stdout, /gh release create v1\.2\.3/)
  assert.match(result.stdout, /MarkDownViewer-1\.2\.3-win\.exe/)
  assert.match(result.stdout, /--verify-tag/)
  assert.match(result.stdout, /--notes-file/)
})

test('github release helper fails when the release tag does not point to HEAD', async () => {
  const rootDir = await makeTempRepo('1.2.3')
  await fs.writeFile(path.join(rootDir, 'post-tag.txt'), 'changed after tag')
  runGit(rootDir, ['add', 'post-tag.txt'])
  runGit(rootDir, ['commit', '-m', 'post tag commit'])

  const result = runNode(githubReleaseScript, ['--root', rootDir, '--notes', 'docs/release-notes/v1.2.3.md'])

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /points to .* but HEAD is .*/)
})