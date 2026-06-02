import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { validateReleaseWorkspace } from './release-utils.mjs'

export function parseArgs(argv) {
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

export function formatReleaseCheckResult(result, options) {
  if (options.json) {
    return {
      stdout: `${JSON.stringify(result, null, 2)}\n`,
      stderr: '',
    }
  }

  if (result.ok) {
    let stdout = `Release candidate is ready for ${result.expectedTag}\n`
    for (const artifact of result.artifacts) {
      stdout += `- ${artifact.label}: ${artifact.path}\n`
    }

    return { stdout, stderr: '' }
  }

  let stderr = `Release candidate check failed for ${result.expectedTag}\n`
  for (const error of result.errors) {
    stderr += `- ${error}\n`
  }

  return { stdout: '', stderr }
}

export async function runReleaseCheck(argv) {
  const options = parseArgs(argv)
  const result = await validateReleaseWorkspace(options)
  const output = formatReleaseCheckResult(result, options)

  return {
    ...output,
    exitCode: result.ok ? 0 : 1,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runReleaseCheck(process.argv.slice(2))
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  process.exit(result.exitCode)
}
