import path from 'node:path'

import { validateReleaseWorkspace } from './release-utils.mjs'

function parseArgs(argv) {
  const options = {
    rootDir: process.cwd(),
    requireCleanGit: true,
    expectedTag: null,
    json: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--root') {
      index += 1
      options.rootDir = path.resolve(argv[index] ?? process.cwd())
      continue
    }

    if (arg === '--expect-tag') {
      index += 1
      options.expectedTag = argv[index] ?? null
      continue
    }

    if (arg === '--skip-git') {
      options.requireCleanGit = false
      continue
    }

    if (arg === '--json') {
      options.json = true
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return options
}

const options = parseArgs(process.argv.slice(2))
const result = await validateReleaseWorkspace(options)

if (options.json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} else if (result.ok) {
  process.stdout.write(`Release candidate is ready for ${result.expectedTag}\n`)
  for (const artifact of result.artifacts) {
    process.stdout.write(`- ${artifact.label}: ${artifact.path}\n`)
  }
} else {
  process.stderr.write(`Release candidate check failed for ${result.expectedTag}\n`)
  for (const error of result.errors) {
    process.stderr.write(`- ${error}\n`)
  }
}

process.exit(result.ok ? 0 : 1)