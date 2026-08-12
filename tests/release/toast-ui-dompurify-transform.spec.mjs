import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { rebindToastUiBundledDomPurify } from '../../scripts/toast-ui-dompurify-transform.ts'
import { assertRendererSecurityEntry, findPackagedRendererEntryPath } from '../../scripts/renderer-security-check.mjs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const toastUiEditorEsmPath = path.join(rootDir, 'node_modules/@toast-ui/editor/dist/esm/index.js')
const toastUiViewerEsmPath = path.join(rootDir, 'node_modules/@toast-ui/editor/dist/esm/indexViewer.js')

test('Toast UI ESM uses the workspace DOMPurify instance after the build transform', async () => {
  const source = await fs.readFile(toastUiEditorEsmPath, 'utf8')
  const transformed = rebindToastUiBundledDomPurify(source, toastUiEditorEsmPath)

  assert.ok(transformed)
  assert.match(transformed, /^import mdvDOMPurify from 'dompurify';/)
  assert.doesNotMatch(transformed, /var purify = createDOMPurify\(\);/)
  assert.match(transformed, /var purify = mdvDOMPurify;/)
})

test('Toast UI DOMPurify transform fails closed when the upstream bundle shape drifts', () => {
  assert.throws(
    () => rebindToastUiBundledDomPurify('export default {}', toastUiEditorEsmPath),
    /expected exactly one Toast UI bundled DOMPurify instance marker, found 0/,
  )
})

test('Toast UI DOMPurify transform ignores unrelated modules', () => {
  assert.equal(
    rebindToastUiBundledDomPurify('var purify = createDOMPurify();', path.join(rootDir, 'src/App.tsx')),
    null,
  )
})

test('Toast UI DOMPurify transform handles viewer and Windows module identifiers', async () => {
  const source = await fs.readFile(toastUiViewerEsmPath, 'utf8')
  const windowsId = toastUiViewerEsmPath.replaceAll('/', '\\')
  const transformed = rebindToastUiBundledDomPurify(source, windowsId)

  assert.ok(transformed)
  assert.match(transformed, /var purify = mdvDOMPurify;/)
  assert.doesNotMatch(transformed, /var purify = createDOMPurify\(\);/)
})

test('renderer security check rejects multiple current sanitizer markers', () => {
  const packageJson = { dependencies: { dompurify: '3.4.12' } }
  const indexHtml = '<script type="module" src="./assets/main-fixture.js"></script>'

  assert.throws(
    () => assertRendererSecurityEntry(packageJson, indexHtml, 'a.version="3.4.12";b.version="3.4.12";'),
    /exactly one DOMPurify 3\.4\.12 implementation marker; found 2/,
  )
})

test('packaged renderer entry uses the host archive path separator', () => {
  const indexHtml = '<script type="module" src="./assets/main-fixture.js"></script>'

  assert.equal(findPackagedRendererEntryPath(indexHtml, path.posix), 'dist/assets/main-fixture.js')
  assert.equal(findPackagedRendererEntryPath(indexHtml, path.win32), 'dist\\assets\\main-fixture.js')
})

test('release fingerprint includes the Mermaid viewer root entry', async () => {
  const fingerprintSource = await fs.readFile(path.join(rootDir, 'scripts/release-source-fingerprint.mjs'), 'utf8')
  assert.match(fingerprintSource, /'mermaid-viewer\.html'/)
})
