import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { getMarkdownStructure, mutateMarkdownStructure } = require('../../electron/mdast-adapter.cjs')

test('move adjusts a target path after removing an earlier source node', async () => {
  const result = await mutateMarkdownStructure('# A\n\n# B\n', 'move', {
    selector: { path: [0] },
    targetSelector: { path: [1] },
    position: 'after',
  })

  assert.equal(result.markdown, '# B\n\n# A\n')
  assert.equal(result.matched, 1)
  assert.equal(result.targetMatched, 1)
  assert.equal(result.changed, 1)
})

test('delete normalizes overlapping ancestor and descendant matches', async () => {
  const result = await mutateMarkdownStructure('- outer\n  - inner\n', 'delete', {
    selector: { query: 'listItem' },
  })

  assert.equal(result.matched, 2)
  assert.equal(result.changed, 1)
  assert.match(result.markdown, /^\s*$/)
})

test('move rejects targeting a descendant of the moved source', async () => {
  await assert.rejects(
    mutateMarkdownStructure('- outer\n  - inner\n', 'move', {
      selector: { query: 'listItem' },
      targetSelector: { path: [0, 0, 1, 0] },
      position: 'append',
    }),
    /Move target cannot be the same as, or nested inside, the moved source selection/,
  )
})

test('wrap rejects wrapper markdown that yields multiple top-level nodes', async () => {
  await assert.rejects(
    mutateMarkdownStructure('Paragraph\n', 'wrap', {
      selector: { query: 'paragraph' },
      markdown: '> one\n\n> two',
    }),
    /Wrap requires exactly one top-level wrapper node/,
  )
})

test('replace requires exactly one normalized target', async () => {
  await assert.rejects(
    mutateMarkdownStructure('# A\n\n# B\n', 'replace', {
      selector: { query: 'heading[depth=1]' },
      markdown: '## Replacement\n',
    }),
    /AmbiguousStructureHandle:/,
  )
})

test('replace swaps one exact node', async () => {
  const result = await mutateMarkdownStructure('# A\n\n# B\n', 'replace', {
    selector: { path: [0] },
    markdown: '## Replacement\n',
  })

  assert.equal(result.markdown, '## Replacement\n\n# B\n')
  assert.equal(result.matched, 1)
  assert.equal(result.changed, 1)
})

test('replace_all requires the exact expected match count', async () => {
  await assert.rejects(
    mutateMarkdownStructure('# A\n\n# B\n', 'replaceAll', {
      selector: { query: 'heading[depth=1]' },
      markdown: '## Replacement\n',
      expectedMatchCount: 1,
    }),
    /UnexpectedMatchCount:/,
  )
})

test('replace_all replaces every confirmed match', async () => {
  const result = await mutateMarkdownStructure('# A\n\n# B\n', 'replaceAll', {
    selector: { query: 'heading[depth=1]' },
    markdown: '## Replacement\n',
    expectedMatchCount: 2,
  })

  assert.equal(result.markdown, '## Replacement\n\n## Replacement\n')
  assert.equal(result.matched, 2)
  assert.equal(result.changed, 2)
})

test('replace_all reports the normalized confirmed match count', async () => {
  const result = await mutateMarkdownStructure('> outer\n>\n> > inner\n', 'replaceAll', {
    selector: { query: 'blockquote' },
    markdown: '> replacement\n',
    expectedMatchCount: 1,
  })

  assert.equal(result.matched, 1)
  assert.equal(result.changed, 1)
})

test('query_structure helper reports normalized match counts for overlapping selectors', async () => {
  const result = await getMarkdownStructure('> outer\n>\n> > inner\n', { query: 'blockquote' })

  assert.equal(result.totalMatches, 1)
  assert.equal(result.matches.length, 1)
})