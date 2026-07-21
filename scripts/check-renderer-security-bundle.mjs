import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'))
const indexHtml = await fs.readFile(path.join(rootDir, 'dist/index.html'), 'utf8')
const entryMatch = indexHtml.match(/<script type="module"[^>]*src="\.\/(assets\/main-[^"]+\.js)"/)

if (!entryMatch) {
  throw new Error('Could not locate the renderer main entry in dist/index.html.')
}

const expectedDomPurifyVersion = packageJson.dependencies?.dompurify
if (typeof expectedDomPurifyVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(expectedDomPurifyVersion)) {
  throw new Error('package.json must declare DOMPurify as an exact direct dependency.')
}

const entryPath = path.join(rootDir, 'dist', entryMatch[1])
const entrySource = await fs.readFile(entryPath, 'utf8')

if (!entrySource.includes(expectedDomPurifyVersion)) {
  throw new Error(`Renderer bundle does not contain the expected DOMPurify ${expectedDomPurifyVersion} implementation.`)
}

if (/DOMPurify 2\.3\.3|\.version=["'`]2\.3\.3["'`]/.test(entrySource)) {
  throw new Error('Renderer bundle still contains Toast UI Editor\'s legacy DOMPurify 2.3.3 implementation.')
}

console.log(`Renderer security bundle check passed: DOMPurify ${expectedDomPurifyVersion}.`)
