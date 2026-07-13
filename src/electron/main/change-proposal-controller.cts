import type { StructuredPatch, StructuredPatchHunk } from 'diff'

const { applyPatch, structuredPatch } = require('diff') as typeof import('diff')

type ChangeProposalState = 'pending' | 'applying'
type ChangeProposalTerminalStatus = 'applied' | 'cancelled' | 'stale' | 'indeterminate' | 'invalidated'

type DocumentIdentity = {
  instanceId: string
  currentFilePath: string | null
}

type ChangeProposalHunk = StructuredPatchHunk & {
  hunkId: string
}

type ChangeProposalRecord = {
  proposalId: string
  originRequestId: string
  ownerWindowId: number
  sourceWindowId: number
  editorId: string
  documentIdentity: DocumentIdentity
  title: string
  mode: 'replace' | 'insert' | 'append'
  span: unknown
  replacedSpan: unknown
  wouldWriteBytes: number
  baselineFingerprint: string
  resultFingerprint: string
  beforeMarkdown: string
  proposedMarkdown: string
  patch: StructuredPatch
  hunks: ChangeProposalHunk[]
  state: ChangeProposalState
  selectedHunkIds: string[]
  createdAt: string
  expiresAt: string
  expiryTimer: ReturnType<typeof setTimeout>
}

type ChangeProposalTerminalRecord = {
  proposalId: string
  originRequestId: string
  ownerWindowId: number
  sourceWindowId: number
  editorId: string
  title: string
  status: ChangeProposalTerminalStatus
  reason?: string
  selectedHunkIds?: string[]
  appliedHunkCount?: number
  baselineFingerprint: string
  resultFingerprint?: string
  resolvedAt: string
}

type CreateChangeProposalInput = {
  proposalId: string
  originRequestId: string
  ownerWindowId: number
  sourceWindowId: number
  editorId: string
  documentIdentity: DocumentIdentity
  title?: string
  mode: 'replace' | 'insert' | 'append'
  span: unknown
  replacedSpan: unknown
  wouldWriteBytes: number
  baselineFingerprint: string
  resultFingerprint: string
  beforeMarkdown: string
  proposedMarkdown: string
}

type ChangeProposalControllerOptions = {
  now?: () => number
  proposalTtlMs?: number
  maxRawBytes?: number
  onTerminal?: (record: ChangeProposalTerminalRecord) => void
}

const DEFAULT_PROPOSAL_TTL_MS = 10 * 60_000
const DEFAULT_MAX_RAW_BYTES = 2 * 1024 * 1024
const MAX_TERMINAL_TOMBSTONES = 128

function copyDocumentIdentity(identity: DocumentIdentity): DocumentIdentity {
  return {
    instanceId: identity.instanceId,
    currentFilePath: identity.currentFilePath,
  }
}

function toPublicHunk(hunk: ChangeProposalHunk) {
  return {
    hunkId: hunk.hunkId,
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
    lines: [...hunk.lines],
  }
}

function toSummary(record: ChangeProposalRecord) {
  return {
    proposalId: record.proposalId,
    originRequestId: record.originRequestId,
    editorId: record.editorId,
    title: record.title,
    mode: record.mode,
    hunkCount: record.hunks.length,
    wouldWriteBytes: record.wouldWriteBytes,
    span: record.span,
    replacedSpan: record.replacedSpan,
    baselineFingerprint: record.baselineFingerprint,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  }
}

function toDetail(record: ChangeProposalRecord) {
  return {
    ...toSummary(record),
    hunks: record.hunks.map(toPublicHunk),
  }
}

export function createChangeProposalController(options: ChangeProposalControllerOptions = {}) {
  const now = options.now ?? Date.now
  const proposalTtlMs = options.proposalTtlMs ?? DEFAULT_PROPOSAL_TTL_MS
  const maxRawBytes = options.maxRawBytes ?? DEFAULT_MAX_RAW_BYTES
  const pendingById = new Map<string, ChangeProposalRecord>()
  const terminalById = new Map<string, { record: ChangeProposalTerminalRecord; expiresAt: number }>()

  function pruneTerminalRecords() {
    const currentTime = now()
    for (const [proposalId, terminal] of terminalById.entries()) {
      if (terminal.expiresAt <= currentTime) {
        terminalById.delete(proposalId)
      }
    }

    while (terminalById.size >= MAX_TERMINAL_TOMBSTONES) {
      const oldestProposalId = terminalById.keys().next().value
      if (typeof oldestProposalId !== 'string') {
        break
      }
      terminalById.delete(oldestProposalId)
    }
  }

  function rememberTerminal(record: ChangeProposalTerminalRecord) {
    pruneTerminalRecords()
    terminalById.set(record.proposalId, {
      record,
      expiresAt: now() + proposalTtlMs,
    })
    options.onTerminal?.({ ...record })
    return { ...record }
  }

  function finishRecord(
    record: ChangeProposalRecord,
    status: ChangeProposalTerminalStatus,
    terminalOptions: {
      reason?: string
      resultFingerprint?: string
    } = {},
  ) {
    clearTimeout(record.expiryTimer)
    pendingById.delete(record.proposalId)

    return rememberTerminal({
      proposalId: record.proposalId,
      originRequestId: record.originRequestId,
      ownerWindowId: record.ownerWindowId,
      sourceWindowId: record.sourceWindowId,
      editorId: record.editorId,
      title: record.title,
      status,
      ...(terminalOptions.reason ? { reason: terminalOptions.reason } : {}),
      ...(record.selectedHunkIds.length > 0 ? {
        selectedHunkIds: [...record.selectedHunkIds],
      } : {}),
      ...(status === 'applied' ? { appliedHunkCount: record.selectedHunkIds.length } : {}),
      baselineFingerprint: record.baselineFingerprint,
      ...(terminalOptions.resultFingerprint ? { resultFingerprint: terminalOptions.resultFingerprint } : {}),
      resolvedAt: new Date(now()).toISOString(),
    })
  }

  function assertOwner(record: ChangeProposalRecord, requesterWindowId: number) {
    if (record.ownerWindowId !== requesterWindowId) {
      throw new Error('Change proposal belongs to another editor window')
    }
  }

  function getPendingRecord(proposalId: string) {
    const record = pendingById.get(proposalId)

    if (record) {
      return record
    }

    pruneTerminalRecords()
    const terminal = terminalById.get(proposalId)?.record
    if (terminal) {
      throw new Error(`Change proposal is already resolved as ${terminal.status}`)
    }

    throw new Error('Unknown or expired change proposal')
  }

  function invalidateOtherProposalForWindow(ownerWindowId: number) {
    for (const record of pendingById.values()) {
      if (record.ownerWindowId !== ownerWindowId) {
        continue
      }

      if (record.state === 'applying') {
        throw new Error('Another change proposal is currently applying in this editor window')
      }

      finishRecord(record, 'invalidated', { reason: 'replaced-by-new-proposal' })
    }
  }

  function createProposal(input: CreateChangeProposalInput) {
    pruneTerminalRecords()
    if (!input.proposalId || pendingById.has(input.proposalId) || terminalById.has(input.proposalId)) {
      throw new Error('Change proposal ID must be unique')
    }

    if (!input.documentIdentity.instanceId) {
      throw new Error('Change proposal requires a document instance identity')
    }

    if (input.beforeMarkdown === input.proposedMarkdown) {
      return null
    }

    const rawBytes = Buffer.byteLength(input.beforeMarkdown, 'utf8') + Buffer.byteLength(input.proposedMarkdown, 'utf8')
    if (rawBytes > maxRawBytes) {
      return null
    }

    const patch = structuredPatch(
      'document.md',
      'document.md',
      input.beforeMarkdown,
      input.proposedMarkdown,
      '',
      '',
      { context: 3, timeout: 2_000 },
    )

    if (!patch || patch.hunks.length === 0) {
      return null
    }

    invalidateOtherProposalForWindow(input.ownerWindowId)

    const createdAtMs = now()
    const proposalId = input.proposalId
    const record = {
      ...input,
      title: input.title?.trim() || 'AI change proposal',
      documentIdentity: copyDocumentIdentity(input.documentIdentity),
      patch,
      hunks: patch.hunks.map((hunk, index) => ({
        ...hunk,
        lines: [...hunk.lines],
        hunkId: `${proposalId}:hunk:${index + 1}`,
      })),
      state: 'pending' as const,
      selectedHunkIds: [],
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(createdAtMs + proposalTtlMs).toISOString(),
      expiryTimer: setTimeout(() => {
        const current = pendingById.get(proposalId)
        if (current?.state === 'pending') {
          finishRecord(current, 'invalidated', { reason: 'expired' })
        }
      }, proposalTtlMs),
    }

    record.expiryTimer.unref?.()
    pendingById.set(proposalId, record)
    return toSummary(record)
  }

  function getProposal(proposalId: string, requesterWindowId: number) {
    const record = getPendingRecord(proposalId)
    assertOwner(record, requesterWindowId)

    if (record.state !== 'pending') {
      throw new Error('Change proposal is not available for review')
    }

    return toDetail(record)
  }

  function beginApply(proposalId: string, requesterWindowId: number, selectedHunkIds: string[]) {
    const record = getPendingRecord(proposalId)
    assertOwner(record, requesterWindowId)

    if (record.state !== 'pending') {
      throw new Error('Change proposal is already being applied')
    }

    const selectedIdSet = new Set(selectedHunkIds)
    if (selectedIdSet.size === 0) {
      throw new Error('Select at least one change hunk before applying')
    }

    const hunkById = new Map(record.hunks.map((hunk) => [hunk.hunkId, hunk]))
    for (const hunkId of selectedIdSet) {
      if (!hunkById.has(hunkId)) {
        throw new Error(`Unknown change hunk: ${hunkId}`)
      }
    }
    const selectedHunks = record.hunks.filter((hunk) => selectedIdSet.has(hunk.hunkId))
    const selectedIds = selectedHunks.map((hunk) => hunk.hunkId)
    const selectedPatch: StructuredPatch = {
      ...record.patch,
      hunks: selectedHunks.map(({ hunkId: _hunkId, ...hunk }) => ({ ...hunk, lines: [...hunk.lines] })),
    }
    const nextMarkdown = applyPatch(record.beforeMarkdown, selectedPatch)

    if (nextMarkdown === false) {
      throw new Error('Selected change hunks could not be applied to the proposal baseline')
    }

    record.state = 'applying'
    record.selectedHunkIds = selectedIds

    return {
      proposalId: record.proposalId,
      originRequestId: record.originRequestId,
      ownerWindowId: record.ownerWindowId,
      sourceWindowId: record.sourceWindowId,
      editorId: record.editorId,
      documentIdentity: copyDocumentIdentity(record.documentIdentity),
      expectedBaselineMarkdown: record.beforeMarkdown,
      nextMarkdown,
      resultFingerprint: record.resultFingerprint,
    }
  }

  function completeApply(
    proposalId: string,
    status: Extract<ChangeProposalTerminalStatus, 'applied' | 'stale' | 'indeterminate'>,
    completion: { reason?: string; resultFingerprint?: string } = {},
  ) {
    const record = pendingById.get(proposalId)

    if (!record) {
      pruneTerminalRecords()
      const terminal = terminalById.get(proposalId)?.record
      if (terminal && (terminal.status === 'applied' || terminal.status === 'stale' || terminal.status === 'indeterminate')) {
        return { ...terminal }
      }

      return getPendingRecord(proposalId)
    }

    if (record.state !== 'applying') {
      throw new Error('Change proposal is not being applied')
    }

    return finishRecord(record, status, completion)
  }

  function cancelProposal(proposalId: string, requesterWindowId: number) {
    const record = getPendingRecord(proposalId)
    assertOwner(record, requesterWindowId)

    if (record.state !== 'pending') {
      throw new Error('Change proposal cannot be cancelled while applying')
    }

    return finishRecord(record, 'cancelled')
  }

  function clearWindow(windowId: number) {
    for (const record of Array.from(pendingById.values())) {
      if (record.ownerWindowId === windowId || record.sourceWindowId === windowId) {
        finishRecord(
          record,
          record.state === 'applying' ? 'indeterminate' : 'invalidated',
          { reason: record.state === 'applying' ? 'window-closed-during-apply' : 'window-closed' },
        )
      }
    }
  }

  function dispose() {
    for (const record of pendingById.values()) {
      clearTimeout(record.expiryTimer)
    }
    pendingById.clear()
    terminalById.clear()
  }

  return {
    createProposal,
    getProposal,
    beginApply,
    completeApply,
    cancelProposal,
    clearWindow,
    dispose,
  }
}

module.exports = {
  createChangeProposalController,
}
