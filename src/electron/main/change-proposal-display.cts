type JsonRecord = Record<string, unknown>

const KNOWN_SPAN_KINDS = new Set([
  'selection',
  'document',
  'point',
  'line',
  'line-range',
  'from-start',
  'to-end',
  'range',
])

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function summarizePoint(point: unknown) {
  if (!isRecord(point)) {
    return null
  }

  const line = Number(point.line)
  const column = Number(point.column)
  return Number.isFinite(line) && Number.isFinite(column) ? { line, column } : null
}

function summarizeSpan(span: unknown) {
  if (!isRecord(span)) {
    return null
  }

  const summary: JsonRecord = {}
  if (typeof span.kind === 'string') {
    summary.kind = KNOWN_SPAN_KINDS.has(span.kind) ? span.kind : 'unknown'
  }
  for (const key of ['line', 'startLine', 'endLine'] as const) {
    const value = Number(span[key])
    if (Number.isFinite(value)) {
      summary[key] = value
    }
  }
  for (const key of ['at', 'start', 'end'] as const) {
    const point = summarizePoint(span[key])
    if (point) {
      summary[key] = point
    }
  }
  if (typeof span.isEmpty === 'boolean') {
    summary.isEmpty = span.isEmpty
  }
  return summary
}

function summarizeTarget(target: unknown) {
  if (!isRecord(target)) {
    return null
  }

  return {
    editorId: typeof target.editorId === 'string' ? target.editorId : null,
    span: summarizeSpan(target.span),
  }
}

function summarizeSources(sources: unknown) {
  if (!Array.isArray(sources)) {
    return []
  }

  return sources.map((source) => {
    if (!isRecord(source)) {
      return { type: 'unknown' }
    }

    if (source.type === 'literal' || typeof source.text === 'string') {
      return {
        type: 'literal',
        bytes: typeof source.text === 'string' ? Buffer.byteLength(source.text, 'utf8') : 0,
      }
    }

    const legacyTarget = typeof source.editorId === 'string'
      ? { editorId: source.editorId, span: source.span }
      : null

    return {
      type: 'slice-ref',
      target: summarizeTarget(source.target ?? legacyTarget),
    }
  })
}

export function sanitizeInteractiveProposalCallArgs(args: unknown) {
  const record = isRecord(args) ? args : {}
  const sources = summarizeSources(record.sources)

  return {
    destination: summarizeTarget(record.destination),
    mode: record.mode === 'insert' || record.mode === 'append' ? record.mode : 'replace',
    dryRun: record.dryRun === true,
    sourceCount: sources.length,
    sources,
  }
}

function sanitizeProposalSummary(proposal: unknown) {
  if (!isRecord(proposal)) {
    return null
  }

  return {
    proposalId: typeof proposal.proposalId === 'string' ? proposal.proposalId : null,
    originRequestId: typeof proposal.originRequestId === 'string' ? proposal.originRequestId : null,
    editorId: typeof proposal.editorId === 'string' ? proposal.editorId : null,
    mode: typeof proposal.mode === 'string' ? proposal.mode : null,
    hunkCount: Number.isFinite(Number(proposal.hunkCount)) ? Number(proposal.hunkCount) : null,
    wouldWriteBytes: Number.isFinite(Number(proposal.wouldWriteBytes)) ? Number(proposal.wouldWriteBytes) : null,
    span: summarizeSpan(proposal.span),
    replacedSpan: summarizeSpan(proposal.replacedSpan),
    baselineFingerprint: typeof proposal.baselineFingerprint === 'string' ? proposal.baselineFingerprint : null,
    createdAt: typeof proposal.createdAt === 'string' ? proposal.createdAt : null,
    expiresAt: typeof proposal.expiresAt === 'string' ? proposal.expiresAt : null,
  }
}

export function sanitizeInteractiveProposalResult(result: unknown) {
  const record = isRecord(result) ? result : {}

  if (record.ok === false) {
    const error = isRecord(record.error) ? record.error : {}
    return {
      ok: false,
      toolName: typeof record.toolName === 'string' ? record.toolName : 'write_target',
      error: {
        code: typeof error.code === 'string' ? error.code : 'tool_execution_failed',
        reason: 'The interactive proposal could not be created.',
        fix: 'Review the tool arguments and request a new proposal.',
      },
    }
  }

  return {
    editorId: typeof record.editorId === 'string' ? record.editorId : null,
    span: summarizeSpan(record.span),
    replacedSpan: summarizeSpan(record.replacedSpan),
    mode: typeof record.mode === 'string' ? record.mode : null,
    bytesWritten: Number.isFinite(Number(record.bytesWritten)) ? Number(record.bytesWritten) : null,
    wouldWriteBytes: Number.isFinite(Number(record.wouldWriteBytes)) ? Number(record.wouldWriteBytes) : null,
    dryRun: record.dryRun === true,
    wouldCreate: record.wouldCreate === true,
    markdownPreviewTruncated: record.markdownPreviewTruncated === true,
    markdownPreviewAbbreviated: record.markdownPreviewAbbreviated === true,
    changeProposal: sanitizeProposalSummary(record.changeProposal),
  }
}

module.exports = {
  sanitizeInteractiveProposalCallArgs,
  sanitizeInteractiveProposalResult,
}
