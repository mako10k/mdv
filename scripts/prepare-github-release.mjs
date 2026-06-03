import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import { quoteShellArg, readGitRevision, validateReleaseWorkspace } from './release-utils.mjs'

export function parseArgs(argv) {
  const options = {
    rootDir: process.cwd(),
    requireCleanGit: true,
    execute: false,
    expectedTag: null,
    notesFile: null,
    title: null,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--root') {
      index += 1
      options.rootDir = path.resolve(argv[index] ?? process.cwd())
      continue
    }

    if (arg === '--skip-git') {
      options.requireCleanGit = false
      continue
    }

    if (arg === '--execute') {
      options.execute = true
      continue
    }

    if (arg === '--tag') {
      index += 1
      options.expectedTag = argv[index] ?? null
      continue
    }

    if (arg === '--notes') {
      index += 1
      options.notesFile = argv[index] ?? null
      continue
    }

    if (arg === '--title') {
      index += 1
      options.title = argv[index] ?? null
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return options
}

export async function runGithubReleasePreparation(argv) {
  const options = parseArgs(argv)
  const validation = await validateReleaseWorkspace(options)

  if (!validation.ok) {
    let stderr = `GitHub release preparation failed for ${validation.expectedTag}\n`
    for (const error of validation.errors) {
      stderr += `- ${error}\n`
    }

    return { stdout: '', stderr, exitCode: 1 }
  }

  let headRevision
  let tagRevision

  try {
    headRevision = readGitRevision(validation.rootDir, 'HEAD')
    tagRevision = readGitRevision(validation.rootDir, `${validation.expectedTag}^{commit}`)
  } catch (error) {
    return {
      stdout: '',
      stderr: `GitHub release preparation failed for ${validation.expectedTag}\n- ${error instanceof Error ? error.message : String(error)}\n`,
      exitCode: 1,
    }
  }

  if (headRevision !== tagRevision) {
    return {
      stdout: '',
      stderr: `GitHub release preparation failed for ${validation.expectedTag}\n- Tag ${validation.expectedTag} points to ${tagRevision}, but HEAD is ${headRevision}\n`,
      exitCode: 1,
    }
  }

  const notesFile = options.notesFile ? path.resolve(validation.rootDir, options.notesFile) : null

  if (!notesFile) {
    return { stdout: '', stderr: 'GitHub release preparation requires --notes <path>\n', exitCode: 1 }
  }

  try {
    await fs.access(notesFile)
  } catch {
    return { stdout: '', stderr: `Release notes file does not exist: ${notesFile}\n`, exitCode: 1 }
  }

  const title = options.title ?? `MDV ${validation.expectedTag}`
  const uploadArtifacts = validation.artifacts
    .filter((artifact) => typeof artifact.githubAssetName === 'string' && artifact.githubAssetName.length > 0)
    .map((artifact) => ({
      sourcePath: artifact.path,
      uploadName: artifact.githubAssetName ?? path.basename(artifact.path),
    }))

  const uploadDir = path.join(validation.rootDir, 'release', '.github-upload')
  const stagedUploadPaths = uploadArtifacts.map((artifact) => path.join(uploadDir, artifact.uploadName))

  const ghArgs = [
    'release',
    'create',
    validation.expectedTag,
    ...stagedUploadPaths,
    '--verify-tag',
    '--title',
    title,
    '--notes-file',
    notesFile,
  ]

  const secdatArgs = ['exec', 'gh', ...ghArgs]
  const printableCommand = ['secdat', ...secdatArgs].map((part) => quoteShellArg(part)).join(' ')

  await fs.rm(uploadDir, { recursive: true, force: true })
  await fs.mkdir(uploadDir, { recursive: true })

  for (const artifact of uploadArtifacts) {
    await fs.copyFile(artifact.sourcePath, path.join(uploadDir, artifact.uploadName))
  }

  if (!options.execute) {
    return { stdout: `${printableCommand}\n`, stderr: '', exitCode: 0 }
  }

  const result = spawnSync('secdat', secdatArgs, {
    cwd: validation.rootDir,
    stdio: 'inherit',
  })

  await fs.rm(uploadDir, { recursive: true, force: true })

  if (result.error && result.status === null) {
    throw result.error
  }

  return { stdout: '', stderr: '', exitCode: result.status ?? 1 }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runGithubReleasePreparation(process.argv.slice(2))
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  process.exit(result.exitCode)
}
