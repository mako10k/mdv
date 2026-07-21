import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { rebindToastUiBundledDomPurify } from '../../scripts/toast-ui-dompurify-transform.ts'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const toastUiEditorEsmPath = path.join(rootDir, 'node_modules/@toast-ui/editor/dist/esm/index.js')

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
