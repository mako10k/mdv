import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createChangeProposalController } = require('../../electron/lib/main/change-proposal-controller.cjs')

function createInput(overrides = {}) {
  return {
    proposalId: 'proposal:1',
    originRequestId: 'request:1',
    ownerWindowId: 7,
    sourceWindowId: 7,
    editorId: 'editor:1',
    documentIdentity: {
      instanceId: 'document:1',
      currentFilePath: '/tmp/example.md',
    },
    title: 'Example change',
    mode: 'replace',
    span: { kind: 'document' },
    replacedSpan: {
      start: { line: 1, column: 1 },
      end: { line: 9, column: 1 },
      isEmpty: false,
    },
    wouldWriteBytes: 2,
    baselineFingerprint: 'before-hash',
    resultFingerprint: 'after-hash',
    beforeMarkdown: 'alpha\nbeta\ngamma\ndelta\nepsilon\nzeta\neta\ntheta\niota\nkappa\nlambda\nmu\n',
    proposedMarkdown: 'alpha\nBETA\ngamma\ndelta\nepsilon\nzeta\neta\ntheta\niota\nkappa\nLAMBDA\nmu\n',
    ...overrides,
  }
}

function beginApply(controller, proposalId, detail, selectedHunkIds) {
  return controller.beginApply(
    proposalId,
    7,
    detail.revision,
    detail.proposalFingerprint,
    selectedHunkIds,
  )
}

test('stores raw proposal text only in the controller and exposes canonical hunks', () => {
  const controller = createChangeProposalController()

  try {
    const summary = controller.createProposal(createInput())
    assert.equal(summary.hunkCount, 2)
    assert.equal('beforeMarkdown' in summary, false)
    assert.equal('proposedMarkdown' in summary, false)

    const detail = controller.getProposal('proposal:1', 7)
    assert.equal(detail.hunks.length, 2)
    assert.equal('beforeMarkdown' in detail, false)
    assert.equal('proposedMarkdown' in detail, false)
    assert.equal(detail.revision, 1)
    assert.equal(typeof detail.proposalFingerprint, 'string')
    assert.match(detail.hunks[0].lines.join('\n'), /-beta/)
    assert.match(detail.hunks[1].lines.join('\n'), /\+LAMBDA/)
    assert.deepEqual(detail.hunks[0].edit, {
      kind: 'replace-hunk-body',
      markdown: 'BETA\n',
    })
  } finally {
    controller.dispose()
  }
})

test('derives the applied Markdown from selected canonical hunk IDs', () => {
  const terminalRecords = []
  const controller = createChangeProposalController({
    onTerminal: (record) => terminalRecords.push(record),
  })

  try {
    controller.createProposal(createInput())
    const detail = controller.getProposal('proposal:1', 7)
    const applyPlan = beginApply(controller, 'proposal:1', detail, [detail.hunks[1].hunkId])

    assert.equal(applyPlan.expectedBaselineMarkdown, createInput().beforeMarkdown)
    assert.equal(applyPlan.nextMarkdown, 'alpha\nbeta\ngamma\ndelta\nepsilon\nzeta\neta\ntheta\niota\nkappa\nLAMBDA\nmu\n')

    const terminal = controller.completeApply('proposal:1', 'applied', {
      resultFingerprint: 'selected-result-hash',
    })
    assert.equal(terminal.status, 'applied')
    assert.deepEqual(terminal.selectedHunkIds, [detail.hunks[1].hunkId])
    assert.equal(terminalRecords.length, 1)
    assert.throws(
      () => beginApply(controller, 'proposal:1', detail, [detail.hunks[1].hunkId]),
      /already resolved as applied/,
    )
  } finally {
    controller.dispose()
  }
})

test('normalizes selected hunks back to canonical patch order', () => {
  const controller = createChangeProposalController()

  try {
    controller.createProposal(createInput())
    const detail = controller.getProposal('proposal:1', 7)
    const applyPlan = beginApply(controller, 'proposal:1', detail, [
      detail.hunks[1].hunkId,
      detail.hunks[0].hunkId,
    ])

    assert.equal(applyPlan.nextMarkdown, createInput().proposedMarkdown)
    const terminal = controller.completeApply('proposal:1', 'applied', {
      resultFingerprint: 'selected-result-hash',
    })
    assert.deepEqual(terminal.selectedHunkIds, detail.hunks.map((hunk) => hunk.hunkId))
  } finally {
    controller.dispose()
  }
})

test('revises a stable hunk envelope, regenerates its canonical preview, and shifts later display coordinates', () => {
  const controller = createChangeProposalController()

  try {
    controller.createProposal(createInput())
    const initial = controller.getProposal('proposal:1', 7)
    const initialHunkIds = initial.hunks.map((hunk) => hunk.hunkId)
    const revised = controller.reviseHunk('proposal:1', 7, {
      hunkId: initial.hunks[0].hunkId,
      expectedRevision: initial.revision,
      expectedProposalFingerprint: initial.proposalFingerprint,
      edit: {
        kind: 'replace-hunk-body',
        markdown: 'CUSTOM\nEXTRA\n',
      },
    })

    assert.equal(revised.revision, 2)
    assert.notEqual(revised.proposalFingerprint, initial.proposalFingerprint)
    assert.equal(revised.expiresAt, initial.expiresAt)
    assert.deepEqual(revised.hunks.map((hunk) => hunk.hunkId), initialHunkIds)
    assert.equal(revised.hunks[0].edit.markdown, 'CUSTOM\nEXTRA\n')
    assert.deepEqual(revised.hunks[0].lines, ['-beta', '+CUSTOM', '+EXTRA'])
    assert.equal(revised.hunks[1].oldStart, initial.hunks[1].oldStart)
    assert.equal(revised.hunks[1].newStart, initial.hunks[1].newStart + 1)

    const applyPlan = beginApply(controller, 'proposal:1', revised, [revised.hunks[0].hunkId])
    assert.equal(
      applyPlan.nextMarkdown,
      'alpha\nCUSTOM\nEXTRA\ngamma\ndelta\nepsilon\nzeta\neta\ntheta\niota\nkappa\nlambda\nmu\n',
    )
  } finally {
    controller.dispose()
  }
})

test('final hunk selection discards a saved manual edit together with the AI candidate', () => {
  const controller = createChangeProposalController()

  try {
    controller.createProposal(createInput())
    const initial = controller.getProposal('proposal:1', 7)
    const revised = controller.reviseHunk('proposal:1', 7, {
      hunkId: initial.hunks[1].hunkId,
      expectedRevision: initial.revision,
      expectedProposalFingerprint: initial.proposalFingerprint,
      edit: {
        kind: 'replace-hunk-body',
        markdown: 'MANUAL\n',
      },
    })
    const applyPlan = beginApply(controller, 'proposal:1', revised, [revised.hunks[0].hunkId])

    assert.equal(
      applyPlan.nextMarkdown,
      'alpha\nBETA\ngamma\ndelta\nepsilon\nzeta\neta\ntheta\niota\nkappa\nlambda\nmu\n',
    )
    assert.doesNotMatch(applyPlan.nextMarkdown, /MANUAL|LAMBDA/)
  } finally {
    controller.dispose()
  }
})

test('hunk revision validation is fail closed and never includes raw edited Markdown in errors', () => {
  const controller = createChangeProposalController({ maxRawBytes: 190 })

  try {
    controller.createProposal(createInput())
    const initial = controller.getProposal('proposal:1', 7)
    const hunkId = initial.hunks[0].hunkId
    const validRequest = {
      hunkId,
      expectedRevision: initial.revision,
      expectedProposalFingerprint: initial.proposalFingerprint,
      edit: {
        kind: 'replace-hunk-body',
        markdown: 'SAFE\n',
      },
    }

    assert.throws(() => controller.reviseHunk('proposal:1', 8, validRequest), /another editor window/)
    assert.throws(() => controller.reviseHunk('proposal:1', 7, { ...validRequest, hunkId: 'unknown' }), /Unknown change hunk/)
    assert.throws(() => controller.reviseHunk('proposal:1', 7, { ...validRequest, expectedRevision: 1.5 }), /revision is stale/)
    assert.throws(() => controller.reviseHunk('proposal:1', 7, { ...validRequest, expectedRevision: 2 }), /revision is stale/)
    assert.throws(() => controller.reviseHunk('proposal:1', 7, { ...validRequest, expectedProposalFingerprint: 'stale' }), /fingerprint is stale/)
    assert.throws(() => controller.reviseHunk('proposal:1', 7, {
      ...validRequest,
      edit: { kind: 'replace-hunk-body', markdown: 42 },
    }), /edit is invalid/)

    const rawEditSecret = 'RAW_EDIT_SECRET\r\n'
    assert.throws(
      () => controller.reviseHunk('proposal:1', 7, {
        ...validRequest,
        edit: { kind: 'replace-hunk-body', markdown: rawEditSecret },
      }),
      (error) => {
        assert.doesNotMatch(error.message, /RAW_EDIT_SECRET/)
        return /canonical LF/.test(error.message)
      },
    )
    assert.throws(() => controller.reviseHunk('proposal:1', 7, {
      ...validRequest,
      edit: { kind: 'replace-hunk-body', markdown: `${'x'.repeat(100)}\n` },
    }), /size limit/)
    assert.deepEqual(controller.getProposal('proposal:1', 7), initial)
    assert.throws(
      () => controller.beginApply(
        'proposal:1',
        7,
        initial.revision + 1,
        initial.proposalFingerprint,
        [hunkId],
      ),
      /revision is stale/,
    )
    assert.deepEqual(controller.getProposal('proposal:1', 7), initial)
  } finally {
    controller.dispose()
  }
})

test('canonical hunk edits preserve CRLF policy, EOF choice, and patch-looking Markdown literals', () => {
  const controller = createChangeProposalController()
  const beforeMarkdown = 'one\r\ntwo\r\nthree'
  const proposedMarkdown = 'one\r\nTWO\r\nthree'
  const literalEdit = '@@ literal\n+++ literal\n\\ No newline at end of file\n<script>alert(1)</script>\n'

  try {
    controller.createProposal(createInput({ beforeMarkdown, proposedMarkdown }))
    const initial = controller.getProposal('proposal:1', 7)
    const revised = controller.reviseHunk('proposal:1', 7, {
      hunkId: initial.hunks[0].hunkId,
      expectedRevision: initial.revision,
      expectedProposalFingerprint: initial.proposalFingerprint,
      edit: {
        kind: 'replace-hunk-body',
        markdown: literalEdit,
      },
    })

    assert.equal(revised.hunks[0].edit.markdown, literalEdit)
    const applyPlan = beginApply(controller, 'proposal:1', revised, [revised.hunks[0].hunkId])
    assert.equal(
      applyPlan.nextMarkdown,
      `one\r\n${literalEdit.replace(/\n/g, '\r\n')}three`,
    )
  } finally {
    controller.dispose()
  }

  const eofController = createChangeProposalController()
  try {
    eofController.createProposal(createInput({
      beforeMarkdown: 'one\r\ntwo',
      proposedMarkdown: 'one\r\nTWO',
    }))
    const initial = eofController.getProposal('proposal:1', 7)
    const revised = eofController.reviseHunk('proposal:1', 7, {
      hunkId: initial.hunks[0].hunkId,
      expectedRevision: initial.revision,
      expectedProposalFingerprint: initial.proposalFingerprint,
      edit: { kind: 'replace-hunk-body', markdown: 'TAIL' },
    })
    assert.equal(beginApply(eofController, 'proposal:1', revised, [revised.hunks[0].hunkId]).nextMarkdown, 'one\r\nTAIL')
  } finally {
    eofController.dispose()
  }
})

test('canonicalizes a missing non-final line boundary before composing the revised candidate', () => {
  const controller = createChangeProposalController()

  try {
    controller.createProposal(createInput())
    const initial = controller.getProposal('proposal:1', 7)
    const revised = controller.reviseHunk('proposal:1', 7, {
      hunkId: initial.hunks[0].hunkId,
      expectedRevision: initial.revision,
      expectedProposalFingerprint: initial.proposalFingerprint,
      edit: { kind: 'replace-hunk-body', markdown: 'MANUAL' },
    })

    assert.equal(revised.hunks[0].edit.markdown, 'MANUAL\n')
    assert.equal(
      beginApply(controller, 'proposal:1', revised, [revised.hunks[0].hunkId]).nextMarkdown,
      'alpha\nMANUAL\ngamma\ndelta\nepsilon\nzeta\neta\ntheta\niota\nkappa\nlambda\nmu\n',
    )
  } finally {
    controller.dispose()
  }
})

test('rejects current-candidate and baseline no-op hunk edits without mutating the proposal', () => {
  const controller = createChangeProposalController()

  try {
    controller.createProposal(createInput())
    const initial = controller.getProposal('proposal:1', 7)
    const request = {
      hunkId: initial.hunks[0].hunkId,
      expectedRevision: initial.revision,
      expectedProposalFingerprint: initial.proposalFingerprint,
      edit: { kind: 'replace-hunk-body', markdown: 'BETA' },
    }

    assert.throws(() => controller.reviseHunk('proposal:1', 7, request), /does not change/)
    assert.throws(() => controller.reviseHunk('proposal:1', 7, {
      ...request,
      edit: { kind: 'replace-hunk-body', markdown: 'beta\n' },
    }), /Discard the change hunk/)
    assert.deepEqual(controller.getProposal('proposal:1', 7), initial)
  } finally {
    controller.dispose()
  }
})

test('rejects cross-window access and empty selection, while oversized raw previews stay non-interactive', () => {
  const controller = createChangeProposalController({ maxRawBytes: 64 })

  try {
    controller.createProposal(createInput({
      beforeMarkdown: 'a\nb\n',
      proposedMarkdown: 'a\nB\n',
    }))

    assert.throws(() => controller.getProposal('proposal:1', 8), /another editor window/)
    const detail = controller.getProposal('proposal:1', 7)
    assert.throws(() => beginApply(controller, 'proposal:1', detail, []), /Select at least one/)
    assert.equal(controller.createProposal(createInput({
      proposalId: 'proposal:2',
      beforeMarkdown: 'a'.repeat(40),
      proposedMarkdown: 'b'.repeat(40),
    })), null)
  } finally {
    controller.dispose()
  }
})

test('invalidates the prior pending proposal when a new proposal opens in the same editor', () => {
  const terminalRecords = []
  const controller = createChangeProposalController({
    onTerminal: (record) => terminalRecords.push(record),
  })

  try {
    controller.createProposal(createInput())
    controller.createProposal(createInput({
      proposalId: 'proposal:2',
      originRequestId: 'request:2',
      beforeMarkdown: 'one\ntwo\n',
      proposedMarkdown: 'one\nTWO\n',
    }))

    assert.equal(terminalRecords.length, 1)
    assert.equal(terminalRecords[0].status, 'invalidated')
    assert.equal(terminalRecords[0].reason, 'replaced-by-new-proposal')
    assert.throws(() => controller.getProposal('proposal:1', 7), /already resolved as invalidated/)
    assert.equal(controller.getProposal('proposal:2', 7).hunks.length, 1)
  } finally {
    controller.dispose()
  }
})

test('cancel is terminal and leaves no proposal available for apply', () => {
  const controller = createChangeProposalController()

  try {
    controller.createProposal(createInput())
    const terminal = controller.cancelProposal('proposal:1', 7)
    assert.equal(terminal.status, 'cancelled')
    assert.throws(() => controller.getProposal('proposal:1', 7), /already resolved as cancelled/)
  } finally {
    controller.dispose()
  }
})

test('preserves CRLF content and a missing final newline when applying canonical hunks', () => {
  const controller = createChangeProposalController()
  const beforeMarkdown = 'one\r\ntwo\r\nthree'
  const proposedMarkdown = 'one\r\nTWO\r\nthree'

  try {
    controller.createProposal(createInput({ beforeMarkdown, proposedMarkdown }))
    const detail = controller.getProposal('proposal:1', 7)
    const applyPlan = beginApply(controller, 'proposal:1', detail, detail.hunks.map((hunk) => hunk.hunkId))
    assert.equal(applyPlan.nextMarkdown, proposedMarkdown)
  } finally {
    controller.dispose()
  }
})

test('stale terminal metadata records the selection without claiming it was applied', () => {
  const controller = createChangeProposalController()

  try {
    controller.createProposal(createInput())
    const detail = controller.getProposal('proposal:1', 7)
    beginApply(controller, 'proposal:1', detail, [detail.hunks[0].hunkId])
    const terminal = controller.completeApply('proposal:1', 'stale', {
      reason: 'baseline-changed',
    })

    assert.deepEqual(terminal.selectedHunkIds, [detail.hunks[0].hunkId])
    assert.equal('appliedHunkCount' in terminal, false)
  } finally {
    controller.dispose()
  }
})

test('window close invalidates pending proposals but marks applying outcomes indeterminate', () => {
  const terminalRecords = []
  const controller = createChangeProposalController({
    onTerminal: (record) => terminalRecords.push(record),
  })

  try {
    controller.createProposal(createInput())
    controller.clearWindow(7)
    assert.equal(terminalRecords[0].status, 'invalidated')
    assert.equal(terminalRecords[0].reason, 'window-closed')

    controller.createProposal(createInput({
      proposalId: 'proposal:2',
      originRequestId: 'request:2',
    }))
    const detail = controller.getProposal('proposal:2', 7)
    beginApply(controller, 'proposal:2', detail, [detail.hunks[0].hunkId])
    controller.clearWindow(7)

    assert.equal(terminalRecords[1].status, 'indeterminate')
    assert.equal(terminalRecords[1].reason, 'window-closed-during-apply')
    assert.equal(
      controller.completeApply('proposal:2', 'indeterminate', {
        reason: 'renderer-acknowledgement-lost',
      }).reason,
      'window-closed-during-apply',
    )
  } finally {
    controller.dispose()
  }
})
