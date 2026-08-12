import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT_INPUTS = [
  'about.html',
  'eslint.config.js',
  'fetch-permissions.html',
  'index.html',
  'mermaid-viewer.html',
  'package-lock.json',
  'package.json',
  'settings.html',
  'tsconfig.app.json',
  'tsconfig.electron-lib.json',
  'tsconfig.electron-openai.json',
  'tsconfig.json',
  'tsconfig.node.json',
  'vite.config.ts',
]

const DIRECTORY_INPUTS = [
  'build',
  'electron',
  'scripts',
  'src',
  'vendor/mdast-control/package.json',
  'vendor/mdast-control/package-lock.json',
  'vendor/mdast-control/src',
  'vendor/mdast-control/tsconfig.json',
]

const EXCLUDED_DIRECTORY_NAMES = new Set(['dist', 'lib', 'node_modules', 'release'])

async function collectFiles(rootDir, relativePath, files) {
  const absolutePath = path.join(rootDir, relativePath)
  let stat

  try {
    stat = await fs.lstat(absolutePath)
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return
    }
    throw error
  }

  if (stat.isSymbolicLink() || stat.isFile()) {
    files.push(relativePath.split(path.sep).join('/'))
    return
  }

  if (!stat.isDirectory()) {
    return
  }

  const entries = await fs.readdir(absolutePath, { withFileTypes: true })
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isDirectory() && EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
      continue
    }
    await collectFiles(rootDir, path.join(relativePath, entry.name), files)
  }
}

export async function computeReleaseSourceFingerprint(rootDir) {
  const files = []
  for (const input of [...ROOT_INPUTS, ...DIRECTORY_INPUTS]) {
    await collectFiles(rootDir, input, files)
  }

  const hash = createHash('sha256')
  for (const relativePath of [...new Set(files)].sort()) {
    const absolutePath = path.join(rootDir, ...relativePath.split('/'))
    const stat = await fs.lstat(absolutePath)
    const content = stat.isSymbolicLink()
      ? Buffer.from(await fs.readlink(absolutePath), 'utf8')
      : await fs.readFile(absolutePath)
    hash.update(relativePath, 'utf8')
    hash.update('\0')
    hash.update(String(content.byteLength), 'utf8')
    hash.update('\0')
    hash.update(content)
    hash.update('\0')
  }

  return hash.digest('hex')
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null
const modulePath = fileURLToPath(import.meta.url)
if (invokedPath === modulePath) {
  const rootIndex = process.argv.indexOf('--root')
  const rootDir = path.resolve(rootIndex >= 0 ? process.argv[rootIndex + 1] ?? process.cwd() : process.cwd())
  process.stdout.write(`${await computeReleaseSourceFingerprint(rootDir)}\n`)
}
