import { createHash } from 'node:crypto'
import type { StructuredPatchHunk } from 'diff'

const { structuredPatch } = require('diff') as typeof import('diff')

type ChangeProposalState = 'pending' | 'applying'
type ChangeProposalTerminalStatus = 'applied' | 'cancelled' | 'stale' | 'indeterminate' | 'invalidated'

type DocumentIdentity = {
  instanceId: string
  currentFilePath: string | null
}

type ChangeProposalHunk = {
  hunkId: string
  baselineStartOffset: number
  baselineEndOffset: number
  baselineStartLine: number
  baselineLineCount: number
  baselineMarkdown: string
  candidateMarkdown: string
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
  proposalFingerprint: string
  revision: number
  beforeMarkdown: string
  proposedMarkdown: string
  documentEol: '\n' | '\r\n'
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
  revision: number
  proposalFingerprint: string
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
  beforeMarkdown: string
  proposedMarkdown: string
}

type ReviseChangeProposalHunkInput = {
  hunkId: string
  expectedRevision: number
  expectedProposalFingerprint: string
  edit: {
    kind: 'replace-hunk-body'
    markdown: string
  }
}

type ChangeProposalControllerOptions = {
  now?: () => number
  proposalTtlMs?: number
  maxRawBytes?: number
  fingerprintMarkdown?: (markdown: string) => string
  onTerminal?: (record: ChangeProposalTerminalRecord) => void
}

const DEFAULT_PROPOSAL_TTL_MS = 10 * 60_000
const DEFAULT_MAX_RAW_BYTES = 2 * 1024 * 1024
const MAX_TERMINAL_TOMBSTONES = 128

function defaultFingerprintMarkdown(markdown: string) {
  return createHash('sha1').update(markdown, 'utf8').digest('hex').slice(0, 16)
}

function copyDocumentIdentity(identity: DocumentIdentity): DocumentIdentity {
  return {
    instanceId: identity.instanceId,
    currentFilePath: identity.currentFilePath,
  }
}

function getDocumentEol(markdown: string): '\n' | '\r\n' {
  const withoutCrLf = markdown.replace(/\r\n/g, '')
  return markdown.includes('\r\n') && !withoutCrLf.includes('\n') && !withoutCrLf.includes('\r')
    ? '\r\n'
    : '\n'
}

function toCanonicalMarkdown(markdown: string) {
  return markdown.replace(/\r\n|\r/g, '\n')
}

function materializeCanonicalMarkdown(markdown: string, eol: '\n' | '\r\n') {
  return eol === '\r\n' ? markdown.replace(/\n/g, '\r\n') : markdown
}

function getLineStartOffsets(markdown: string) {
  const offsets = [0]

  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] === '\r' && markdown[index + 1] === '\n') {
      index += 1
      offsets.push(index + 1)
    } else if (markdown[index] === '\n' || markdown[index] === '\r') {
      offsets.push(index + 1)
    }
  }

  return offsets
}

function getLineRangeOffsets(markdown: string, startLine: number, lineCount: number) {
  const lineStartOffsets = getLineStartOffsets(markdown)
  const startIndex = Math.max(0, startLine - 1)
  const startOffset = startIndex < lineStartOffsets.length
    ? lineStartOffsets[startIndex]
    : markdown.length
  const endIndex = startIndex + lineCount
  const endOffset = endIndex < lineStartOffsets.length
    ? lineStartOffsets[endIndex]
    : markdown.length

  return { startOffset, endOffset }
}

function countCanonicalLines(markdown: string) {
  if (markdown.length === 0) {
    return 0
  }

  const newlineCount = markdown.match(/\n/g)?.length ?? 0
  return newlineCount + (markdown.endsWith('\n') ? 0 : 1)
}

function markerConsumesOldLine(marker: string) {
  return marker === ' ' || marker === '-'
}

function markerConsumesNewLine(marker: string) {
  return marker === ' ' || marker === '+'
}

function extractInitialHunk(
  proposalId: string,
  index: number,
  patchHunk: StructuredPatchHunk,
  beforeMarkdown: string,
  proposedMarkdown: string,
): ChangeProposalHunk | null {
  const firstChangedIndex = patchHunk.lines.findIndex((line) => line.startsWith('+') || line.startsWith('-'))
  let lastChangedIndex = -1
  for (let lineIndex = patchHunk.lines.length - 1; lineIndex >= 0; lineIndex -= 1) {
    const line = patchHunk.lines[lineIndex]
    if (line.startsWith('+') || line.startsWith('-')) {
      lastChangedIndex = lineIndex
      break
    }
  }

  if (firstChangedIndex < 0 || lastChangedIndex < firstChangedIndex) {
    return null
  }

  const leadingLines = patchHunk.lines.slice(0, firstChangedIndex)
  const changedLines = patchHunk.lines.slice(firstChangedIndex, lastChangedIndex + 1)
  const oldLeadingCount = leadingLines.filter((line) => markerConsumesOldLine(line.slice(0, 1))).length
  const newLeadingCount = leadingLines.filter((line) => markerConsumesNewLine(line.slice(0, 1))).length
  const baselineLineCount = changedLines.filter((line) => markerConsumesOldLine(line.slice(0, 1))).length
  const candidateLineCount = changedLines.filter((line) => markerConsumesNewLine(line.slice(0, 1))).length
  const baselineStartLine = patchHunk.oldStart + oldLeadingCount
  const candidateStartLine = patchHunk.newStart + newLeadingCount
  const baselineRange = getLineRangeOffsets(beforeMarkdown, baselineStartLine, baselineLineCount)
  const candidateRange = getLineRangeOffsets(proposedMarkdown, candidateStartLine, candidateLineCount)

  return {
    hunkId: `${proposalId}:hunk:${index + 1}`,
    baselineStartOffset: baselineRange.startOffset,
    baselineEndOffset: baselineRange.endOffset,
    baselineStartLine,
    baselineLineCount,
    baselineMarkdown: beforeMarkdown.slice(baselineRange.startOffset, baselineRange.endOffset),
    candidateMarkdown: proposedMarkdown.slice(candidateRange.startOffset, candidateRange.endOffset),
  }
}

function composeCandidateMarkdown(beforeMarkdown: string, hunks: readonly ChangeProposalHunk[], selectedHunkIds?: ReadonlySet<string>) {
  let markdown = beforeMarkdown

  for (let index = hunks.length - 1; index >= 0; index -= 1) {
    const hunk = hunks[index]
    if (selectedHunkIds && !selectedHunkIds.has(hunk.hunkId)) {
      continue
    }
    markdown = `${markdown.slice(0, hunk.baselineStartOffset)}${hunk.candidateMarkdown}${markdown.slice(hunk.baselineEndOffset)}`
  }

  return markdown
}

function buildPublicHunks(hunks: readonly ChangeProposalHunk[]) {
  let precedingLineDelta = 0

  return hunks.map((hunk) => {
    const candidateCanonical = toCanonicalMarkdown(hunk.candidateMarkdown)
    const candidateLineCount = countCanonicalLines(candidateCanonical)
    const context = Math.max(hunk.baselineLineCount, candidateLineCount, 3) + 1
    const displayPatch = structuredPatch(
      'hunk.md',
      'hunk.md',
      hunk.baselineMarkdown,
      hunk.candidateMarkdown,
      '',
      '',
      { context, timeout: 2_000 },
    )

    if (!displayPatch || displayPatch.hunks.length !== 1) {
      throw new Error('Edited change hunk could not be canonicalized')
    }

    const displayHunk = displayPatch.hunks[0]
    const publicHunk = {
      hunkId: hunk.hunkId,
      oldStart: hunk.baselineStartLine + displayHunk.oldStart - 1,
      oldLines: displayHunk.oldLines,
      newStart: hunk.baselineStartLine + precedingLineDelta + displayHunk.newStart - 1,
      newLines: displayHunk.newLines,
      lines: [...displayHunk.lines],
      edit: {
        kind: 'replace-hunk-body' as const,
        markdown: candidateCanonical,
      },
    }

    precedingLineDelta += candidateLineCount - hunk.baselineLineCount
    return publicHunk
  })
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
    proposalFingerprint: record.proposalFingerprint,
    revision: record.revision,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  }
}

function toDetail(record: ChangeProposalRecord) {
  return {
    ...toSummary(record),
    hunks: buildPublicHunks(record.hunks),
  }
}

export function createChangeProposalController(options: ChangeProposalControllerOptions = {}) {
  const now = options.now ?? Date.now
  const proposalTtlMs = options.proposalTtlMs ?? DEFAULT_PROPOSAL_TTL_MS
  const maxRawBytes = options.maxRawBytes ?? DEFAULT_MAX_RAW_BYTES
  const fingerprintMarkdown = options.fingerprintMarkdown ?? defaultFingerprintMarkdown
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
      revision: record.revision,
      proposalFingerprint: record.proposalFingerprint,
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

    const hunks = patch.hunks.map((hunk, index) => extractInitialHunk(
      input.proposalId,
      index,
      hunk,
      input.beforeMarkdown,
      input.proposedMarkdown,
    ))
    if (hunks.some((hunk) => hunk === null)) {
      return null
    }
    const canonicalHunks = hunks.filter((hunk): hunk is ChangeProposalHunk => hunk !== null)
    if (composeCandidateMarkdown(input.beforeMarkdown, canonicalHunks) !== input.proposedMarkdown) {
      return null
    }

    try {
      buildPublicHunks(canonicalHunks)
    } catch {
      return null
    }

    invalidateOtherProposalForWindow(input.ownerWindowId)

    const createdAtMs = now()
    const proposalId = input.proposalId
    const expiryTimer = setTimeout(() => {
      const current = pendingById.get(proposalId)
      if (current?.state === 'pending') {
        finishRecord(current, 'invalidated', { reason: 'expired' })
      }
    }, proposalTtlMs)
    const record: ChangeProposalRecord = {
      ...input,
      title: input.title?.trim() || 'AI change proposal',
      documentIdentity: copyDocumentIdentity(input.documentIdentity),
      proposalFingerprint: fingerprintMarkdown(input.proposedMarkdown),
      revision: 1,
      documentEol: getDocumentEol(input.beforeMarkdown),
      hunks: canonicalHunks,
      state: 'pending',
      selectedHunkIds: [],
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(createdAtMs + proposalTtlMs).toISOString(),
      expiryTimer,
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

  function reviseHunk(proposalId: string, requesterWindowId: number, input: ReviseChangeProposalHunkInput) {
    const record = getPendingRecord(proposalId)
    assertOwner(record, requesterWindowId)

    if (record.state !== 'pending') {
      throw new Error('Change proposal is not available for editing')
    }
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== record.revision) {
      throw new Error('Change proposal revision is stale')
    }
    if (!input.expectedProposalFingerprint || input.expectedProposalFingerprint !== record.proposalFingerprint) {
      throw new Error('Change proposal fingerprint is stale')
    }
    if (input.edit?.kind !== 'replace-hunk-body' || typeof input.edit.markdown !== 'string') {
      throw new Error('Change proposal hunk edit is invalid')
    }
    if (input.edit.markdown.includes('\r') || input.edit.markdown.includes('\0')) {
      throw new Error('Change proposal hunk edit must use canonical LF Markdown')
    }

    const hunkIndex = record.hunks.findIndex((hunk) => hunk.hunkId === input.hunkId)
    if (hunkIndex < 0) {
      throw new Error('Unknown change hunk')
    }
    const currentHunk = record.hunks[hunkIndex]
    const canonicalMarkdown = currentHunk.baselineEndOffset < record.beforeMarkdown.length
      && input.edit.markdown.length > 0
      && !input.edit.markdown.endsWith('\n')
      ? `${input.edit.markdown}\n`
      : input.edit.markdown
    const candidateMarkdown = materializeCanonicalMarkdown(canonicalMarkdown, record.documentEol)
    if (candidateMarkdown === currentHunk.candidateMarkdown) {
      throw new Error('Change proposal hunk edit does not change the current candidate')
    }
    if (candidateMarkdown === currentHunk.baselineMarkdown) {
      throw new Error('Discard the change hunk instead of replacing it with its baseline')
    }

    const nextHunks = record.hunks.map((hunk, index) => index === hunkIndex
      ? { ...hunk, candidateMarkdown }
      : hunk)
    const proposedMarkdown = composeCandidateMarkdown(record.beforeMarkdown, nextHunks)
    const rawBytes = Buffer.byteLength(record.beforeMarkdown, 'utf8') + Buffer.byteLength(proposedMarkdown, 'utf8')
    if (rawBytes > maxRawBytes) {
      throw new Error('Edited change proposal exceeds the raw Markdown size limit')
    }

    const publicHunks = buildPublicHunks(nextHunks)

    record.hunks = nextHunks
    record.proposedMarkdown = proposedMarkdown
    record.proposalFingerprint = fingerprintMarkdown(proposedMarkdown)
    record.revision += 1
    return {
      ...toSummary(record),
      hunks: publicHunks,
    }
  }

  function beginApply(
    proposalId: string,
    requesterWindowId: number,
    expectedRevision: number,
    expectedProposalFingerprint: string,
    selectedHunkIds: string[],
  ) {
    const record = getPendingRecord(proposalId)
    assertOwner(record, requesterWindowId)

    if (record.state !== 'pending') {
      throw new Error('Change proposal is already being applied')
    }
    if (!Number.isInteger(expectedRevision) || expectedRevision !== record.revision) {
      throw new Error('Change proposal revision is stale')
    }
    if (!expectedProposalFingerprint || expectedProposalFingerprint !== record.proposalFingerprint) {
      throw new Error('Change proposal fingerprint is stale')
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
    const selectedIds = record.hunks
      .filter((hunk) => selectedIdSet.has(hunk.hunkId))
      .map((hunk) => hunk.hunkId)
    const nextMarkdown = composeCandidateMarkdown(record.beforeMarkdown, record.hunks, selectedIdSet)

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
    reviseHunk,
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
