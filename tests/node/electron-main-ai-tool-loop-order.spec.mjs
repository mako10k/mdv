import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  isInteractiveAiChangeProposalArgs,
  normalizeAiWriteDestinationEditorId,
  prioritizeInteractiveProposalCall,
} = require('../../electron/lib/main/ai-tool-loop-order.cjs')

test('prioritizes every interactive proposal candidate before sibling calls while preserving group order', () => {
  const calls = [
    { name: 'write_target', kind: 'direct-write' },
    { name: 'write_target', kind: 'interactive-proposal-1' },
    { name: 'read_target', kind: 'read' },
    { name: 'write_target', kind: 'interactive-proposal-2' },
    { name: 'web_search', kind: 'search' },
  ]

  const ordered = prioritizeInteractiveProposalCall(
    calls,
    (call) => call.kind.startsWith('interactive-proposal'),
  )

  assert.deepEqual(ordered.map((call) => call.kind), [
    'interactive-proposal-1',
    'interactive-proposal-2',
    'direct-write',
    'read',
    'search',
  ])
  assert.deepEqual(calls.map((call) => call.kind), [
    'direct-write',
    'interactive-proposal-1',
    'read',
    'interactive-proposal-2',
    'search',
  ])
})

test('preserves source order when no interactive proposal candidate exists', () => {
  const calls = [{ name: 'read_target' }, { name: 'web_search' }]
  const ordered = prioritizeInteractiveProposalCall(calls, () => false)

  assert.deepEqual(ordered, calls)
  assert.notEqual(ordered, calls)
})

test('uses the execution destination normalization when ordering an empty editorId candidate', () => {
  const calls = [
    { name: 'write_target', arguments: { destination: { editorId: 'buffer:1' }, dryRun: false } },
    { name: 'write_target', arguments: { destination: { editorId: '' }, dryRun: true } },
  ]
  const isActiveEditorAlias = (editorId) => editorId === 'editor:active'
  const ordered = prioritizeInteractiveProposalCall(
    calls,
    (call) => isInteractiveAiChangeProposalArgs(
      call.name,
      call.arguments,
      'editor:runtime',
      isActiveEditorAlias,
    ),
  )

  assert.equal(normalizeAiWriteDestinationEditorId({ editorId: '' }), 'editor:active')
  assert.equal(ordered[0], calls[1])
})
