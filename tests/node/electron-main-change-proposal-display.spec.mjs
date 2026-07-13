import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  sanitizeInteractiveProposalCallArgs,
  sanitizeInteractiveProposalResult,
} = require('../../electron/lib/main/change-proposal-display.cjs')

test('interactive proposal tool events expose metadata without literal or preview content', () => {
  const call = sanitizeInteractiveProposalCallArgs({
    destination: {
      editorId: 'editor:active',
      span: { kind: 'RAW_KIND_SECRET', start: { line: 1, column: 1, text: 'RAW_BEFORE_SECRET' } },
    },
    sources: [{ type: 'literal', text: 'RAW_AFTER_SECRET' }],
    mode: 'replace',
    dryRun: true,
  })
  const result = sanitizeInteractiveProposalResult({
    editorId: 'editor:1',
    span: { kind: 'document' },
    replacedSpan: { kind: 'document' },
    mode: 'replace',
    dryRun: true,
    wouldWriteBytes: 16,
    markdownPreview: 'RAW_AFTER_SECRET',
    replacedTextPreview: 'RAW_BEFORE_SECRET',
    preview: 'RAW_AFTER_SECRET',
    changeProposal: {
      proposalId: 'proposal:1',
      originRequestId: 'request:1',
      editorId: 'editor:1',
      title: 'Safe title',
      mode: 'replace',
      hunkCount: 1,
      wouldWriteBytes: 16,
      span: { kind: 'document' },
      replacedSpan: { kind: 'document' },
      baselineFingerprint: 'before-hash',
      createdAt: '2026-07-13T00:00:00.000Z',
      expiresAt: '2026-07-13T00:10:00.000Z',
      beforeMarkdown: 'RAW_BEFORE_SECRET',
      proposedMarkdown: 'RAW_AFTER_SECRET',
      hunks: [{ lines: ['-RAW_BEFORE_SECRET', '+RAW_AFTER_SECRET'] }],
    },
  })

  const serialized = JSON.stringify({ call, result })
  assert.doesNotMatch(serialized, /RAW_BEFORE_SECRET|RAW_AFTER_SECRET/)
  assert.deepEqual(call.sources, [{ type: 'literal', bytes: 16 }])
  assert.equal(call.destination.span.kind, 'unknown')
  assert.equal(result.changeProposal.proposalId, 'proposal:1')
  assert.equal('markdownPreview' in result, false)
  assert.equal('replacedTextPreview' in result, false)
  assert.equal('hunks' in result.changeProposal, false)
  assert.equal('title' in result.changeProposal, false)
})

test('interactive proposal error events do not echo validation payloads', () => {
  const result = sanitizeInteractiveProposalResult({
    ok: false,
    toolName: 'write_target',
    error: {
      code: 'tool_execution_failed',
      reason: 'Unsupported AI span payload: {"kind":"bad","secret":"RAW_ERROR_SECRET"}',
      fix: 'Retry with RAW_ERROR_SECRET',
    },
  })

  assert.doesNotMatch(JSON.stringify(result), /RAW_ERROR_SECRET/)
  assert.equal(result.error.code, 'tool_execution_failed')
})
