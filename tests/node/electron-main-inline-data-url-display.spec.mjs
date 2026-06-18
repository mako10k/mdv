import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  abbreviateInlineDataImageMarkdown,
  abbreviateInlineDataImageMarkdownInText,
  abbreviateInlineDataImageMarkdownSlice,
} = require('../../electron/lib/main/inline-data-url-display.cjs')

test('abbreviateInlineDataImageMarkdown shortens base64 image markdown', () => {
  assert.equal(
    abbreviateInlineDataImageMarkdown('![logo](data:image/png;base64,QUJDRA==)'),
    '![logo](data:image/png;base64,<4 B omitted>)',
  )
})

test('abbreviateInlineDataImageMarkdownInText leaves non-data-url markdown untouched', () => {
  assert.equal(
    abbreviateInlineDataImageMarkdownInText('![logo](./logo.png)'),
    '![logo](./logo.png)',
  )
})

test('abbreviateInlineDataImageMarkdownInText shortens inline data image references inside larger text', () => {
  assert.equal(
    abbreviateInlineDataImageMarkdownInText('# Title\n\n![logo](data:image/png;base64,QUJDRA==)\n'),
    '# Title\n\n![logo](data:image/png;base64,<4 B omitted>)\n',
  )
})

test('abbreviateInlineDataImageMarkdownSlice redacts pages starting inside data image base64', () => {
  const markdown = `# Title\n\n![logo](data:image/png;base64,${'A'.repeat(256)})\n`
  const startOffset = markdown.indexOf('A'.repeat(32))

  assert.equal(
    abbreviateInlineDataImageMarkdownSlice(markdown, startOffset, startOffset + 64),
    'data:image/*;base64,<continued data image omitted>',
  )
})
