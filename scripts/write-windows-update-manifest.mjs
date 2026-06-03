import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

import YAML from 'yaml'

const PRODUCT_NAME = 'MarkDownViewer'

export function parseArgs(argv) {
  const options = {
    rootDir: process.cwd(),
    artifactSource: 'release',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--root') {
      index += 1
      options.rootDir = path.resolve(argv[index] ?? process.cwd())
      continue
    }

    if (arg === '--artifact-source') {
      index += 1
      const artifactSource = argv[index] ?? 'release'
      if (artifactSource !== 'release' && artifactSource !== 'candidate') {
        throw new Error(`Unsupported artifact source: ${artifactSource}`)
      }
      options.artifactSource = artifactSource
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return options
}

function resolveArtifactRoot(rootDir, artifactSource) {
  return path.join(rootDir, 'release', artifactSource === 'candidate' ? 'windows-host-candidate' : 'windows-host')
}

async function readPackageVersion(rootDir) {
  const packageText = await fs.readFile(path.join(rootDir, 'package.json'), 'utf8')
  const packageJson = JSON.parse(packageText)

  if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
    throw new Error('package.json does not contain a valid version')
  }

  return packageJson.version
}

async function hashFileSha512Base64(filePath) {
  const buffer = await fs.readFile(filePath)
  return createHash('sha512').update(buffer).digest('base64')
}

export async function writeWindowsUpdateManifest(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? process.cwd())
  const artifactSource = options.artifactSource === 'candidate' ? 'candidate' : 'release'
  const version = await readPackageVersion(rootDir)
  const artifactRoot = resolveArtifactRoot(rootDir, artifactSource)
  const versionedExeName = `${PRODUCT_NAME}-${version}-win.exe`
  const installerExePath = path.join(artifactRoot, 'installer', versionedExeName)
  const blockmapPath = path.join(artifactRoot, 'installer', `${versionedExeName}.blockmap`)
  const latestYmlPath = path.join(artifactRoot, 'installer', 'latest.yml')

  const [installerStat, blockmapStat, installerSha512] = await Promise.all([
    fs.stat(installerExePath),
    fs.stat(blockmapPath),
    hashFileSha512Base64(installerExePath),
  ])

  const latestManifest = {
    version,
    files: [
      {
        url: versionedExeName,
        sha512: installerSha512,
        size: installerStat.size,
        blockMapSize: blockmapStat.size,
      },
    ],
    path: versionedExeName,
    sha512: installerSha512,
    releaseDate: new Date().toISOString(),
  }

  await fs.writeFile(latestYmlPath, YAML.stringify(latestManifest), 'utf8')

  return {
    rootDir,
    artifactSource,
    latestYmlPath,
    version,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2))
  const result = await writeWindowsUpdateManifest(options)
  process.stdout.write(`${result.latestYmlPath}\n`)
}