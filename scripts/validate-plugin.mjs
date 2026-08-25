import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  validatePluginPackageInAsar,
  validatePluginPackageRoot,
} from './plugin-conformance.mjs'

export function parsePluginValidatorArgs(argv) {
  const options = {
    rootDir: null,
    asarPath: null,
    manifestPath: null,
    hostVersion: null,
    json: false,
  }

  const readOptionValue = (index, option) => {
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`${option} requires a value`)
    }
    return value
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--root') {
      options.rootDir = path.resolve(readOptionValue(index, argument))
      index += 1
      continue
    }
    if (argument === '--asar') {
      options.asarPath = path.resolve(readOptionValue(index, argument))
      index += 1
      continue
    }
    if (argument === '--manifest') {
      options.manifestPath = readOptionValue(index, argument)
      index += 1
      continue
    }
    if (argument === '--host-version') {
      options.hostVersion = readOptionValue(index, argument)
      index += 1
      continue
    }
    if (argument === '--json') {
      options.json = true
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }

  if (Boolean(options.rootDir) === Boolean(options.asarPath)) {
    throw new Error('Specify exactly one of --root <package-root> or --asar <app.asar>')
  }
  if (options.asarPath && !options.manifestPath) {
    throw new Error('--asar requires the explicit bundle-relative --manifest path')
  }
  return options
}

async function readDefaultHostVersion() {
  const packageJson = JSON.parse(await fs.readFile(path.resolve('package.json'), 'utf8'))
  if (!packageJson || typeof packageJson.version !== 'string') {
    throw new Error('package.json does not contain a valid version')
  }
  return packageJson.version
}

function formatHumanReport(report) {
  let output = `Plugin conformance ${report.ok ? 'passed' : 'failed'} for MDV ${report.hostVersion}\n`
  for (const packageResult of report.packages) {
    output += `- ${packageResult.packageId ?? packageResult.catalogId} ${packageResult.version ?? ''}: ${packageResult.status}\n`
    for (const diagnostic of packageResult.diagnostics) {
      output += `  - ${diagnostic.code}${diagnostic.relativeLocation ? ` (${diagnostic.relativeLocation})` : ''}: ${diagnostic.detail}\n`
      output += `    remediation: ${diagnostic.remediation}\n`
    }
  }
  return output
}

export async function runPluginValidator(argv) {
  const options = parsePluginValidatorArgs(argv)
  const hostVersion = options.hostVersion ?? await readDefaultHostVersion()
  const report = options.rootDir
    ? await validatePluginPackageRoot({
        packageRoot: options.rootDir,
        manifestRelativePath: options.manifestPath ?? 'plugin.json',
        hostVersion,
      })
    : await validatePluginPackageInAsar({
        asarPath: options.asarPath,
        manifestPath: options.manifestPath,
        hostVersion,
      })

  return {
    exitCode: report.ok ? 0 : 1,
    output: options.json ? `${JSON.stringify(report, null, 2)}\n` : formatHumanReport(report),
    report,
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) {
  try {
    const result = await runPluginValidator(process.argv.slice(2))
    process.stdout.write(result.output)
    process.exit(result.exitCode)
  } catch (error) {
    process.stderr.write(`Plugin validator failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(2)
  }
}
