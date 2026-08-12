import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { assertRendererSecurityEntry, findRendererEntryPath } from './renderer-security-check.mjs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'))
for (const htmlFileName of ['index.html', 'mermaid-viewer.html']) {
  const rendererHtml = await fs.readFile(path.join(rootDir, 'dist', htmlFileName), 'utf8')
  const rendererEntryPath = findRendererEntryPath(rendererHtml)
  const entryPath = path.join(rootDir, 'dist', rendererEntryPath)
  const entrySource = await fs.readFile(entryPath, 'utf8')
  const result = assertRendererSecurityEntry(packageJson, rendererHtml, entrySource)
  console.log(`${htmlFileName} security bundle check passed: DOMPurify ${result.domPurifyVersion}.`)
}
