import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { quoteShellArg, readGitRevision, validateReleaseWorkspace } from './release-utils.mjs'

function parseArgs(argv) {
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

const options = parseArgs(process.argv.slice(2))
const validation = await validateReleaseWorkspace(options)

if (!validation.ok) {
  process.stderr.write(`GitHub release preparation failed for ${validation.expectedTag}\n`)
  for (const error of validation.errors) {
    process.stderr.write(`- ${error}\n`)
  }
  process.exit(1)
}

let headRevision = ''
let tagRevision = ''

try {
  headRevision = readGitRevision(validation.rootDir, 'HEAD')
  tagRevision = readGitRevision(validation.rootDir, `${validation.expectedTag}^{commit}`)
} catch (error) {
  process.stderr.write(`GitHub release preparation failed for ${validation.expectedTag}\n`)
  process.stderr.write(`- ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}

if (headRevision !== tagRevision) {
  process.stderr.write(`GitHub release preparation failed for ${validation.expectedTag}\n`)
  process.stderr.write(`- Tag ${validation.expectedTag} points to ${tagRevision}, but HEAD is ${headRevision}\n`)
  process.exit(1)
}

const notesFile = options.notesFile ? path.resolve(validation.rootDir, options.notesFile) : null

if (!notesFile) {
  process.stderr.write('GitHub release preparation requires --notes <path>\n')
  process.exit(1)
}

try {
  await fs.access(notesFile)
} catch {
  process.stderr.write(`Release notes file does not exist: ${notesFile}\n`)
  process.exit(1)
}

const title = options.title ?? `MDV ${validation.expectedTag}`
const uploadArtifacts = validation.artifacts
  .filter((artifact) => artifact.label !== 'win-unpacked executable')
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

const printableCommand = ['gh', ...ghArgs].map((part) => quoteShellArg(part)).join(' ')

if (!options.execute) {
  process.stdout.write(`${printableCommand}\n`)
  process.exit(0)
}

await fs.rm(uploadDir, { recursive: true, force: true })
await fs.mkdir(uploadDir, { recursive: true })

for (const artifact of uploadArtifacts) {
  await fs.copyFile(artifact.sourcePath, path.join(uploadDir, artifact.uploadName))
}

const result = spawnSync('gh', ghArgs, {
  cwd: validation.rootDir,
  stdio: 'inherit',
})

await fs.rm(uploadDir, { recursive: true, force: true })

if (result.error) {
  throw result.error
}

process.exit(result.status ?? 1)