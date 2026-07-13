import { useEffect, useEffectEvent, useRef } from 'react'

type ChangePreviewDialogLabels = {
  title: string
  description: string
  summary: (hunkCount: number, bytes: number) => string
  expiresAt: (formattedTime: string) => string
  hunk: (index: number, total: number) => string
  includeHunk: string
  contextLine: string
  addedLine: string
  removedLine: string
  cancel: string
  applySelected: (count: number) => string
  applyConsequence: (selectedCount: number, totalCount: number) => string
  applying: string
  cancelling: string
  loading: string
}

type ChangePreviewDialogProps = {
  summary: MdvAiChangeProposalSummary
  proposal: MdvAiChangeProposalDetail | null
  acceptedHunkIds: ReadonlySet<string>
  resolvingAction: 'apply' | 'cancel' | null
  error: string | null
  labels: ChangePreviewDialogLabels
  onToggleHunk: (hunkId: string) => void
  onApply: () => void
  onCancel: () => void
}

type ChangePreviewLine = {
  kind: 'added' | 'removed' | 'context' | 'note'
  marker: string
  text: string
  oldLine: number | null
  newLine: number | null
}

function buildChangePreviewLines(hunk: MdvAiChangeProposalHunk): ChangePreviewLine[] {
  let oldLine = hunk.oldStart
  let newLine = hunk.newStart

  return hunk.lines.map((line) => {
    const marker = line.slice(0, 1)
    const text = line.slice(1)

    if (marker === '+') {
      const row = { kind: 'added' as const, marker, text, oldLine: null, newLine }
      newLine += 1
      return row
    }

    if (marker === '-') {
      const row = { kind: 'removed' as const, marker, text, oldLine, newLine: null }
      oldLine += 1
      return row
    }

    if (marker === ' ') {
      const row = { kind: 'context' as const, marker: ' ', text, oldLine, newLine }
      oldLine += 1
      newLine += 1
      return row
    }

    return {
      kind: 'note' as const,
      marker: '',
      text: line,
      oldLine: null,
      newLine: null,
    }
  })
}

function lineAriaLabel(line: ChangePreviewLine, labels: ChangePreviewDialogLabels) {
  if (line.kind === 'added') {
    return labels.addedLine
  }
  if (line.kind === 'removed') {
    return labels.removedLine
  }
  return labels.contextLine
}

export default function ChangePreviewDialog({
  summary,
  proposal,
  acceptedHunkIds,
  resolvingAction,
  error,
  labels,
  onToggleHunk,
  onApply,
  onCancel,
}: ChangePreviewDialogProps) {
  const isResolving = resolvingAction !== null
  const expiryDate = new Date(summary.expiresAt)
  const formattedExpiry = Number.isNaN(expiryDate.getTime())
    ? summary.expiresAt
    : expiryDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const backdropRef = useRef<HTMLDivElement | null>(null)
  const dialogRef = useRef<HTMLElement | null>(null)
  const cancelFromKeyboard = useEffectEvent(() => {
    if (!isResolving) {
      onCancel()
    }
  })

  useEffect(() => {
    const dialog = dialogRef.current
    const backdrop = backdropRef.current
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const inertSiblings = backdrop?.parentElement
      ? Array.from(backdrop.parentElement.children)
          .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== backdrop)
          .map((element) => ({ element, wasInert: element.inert }))
      : []

    for (const { element } of inertSiblings) {
      element.inert = true
    }
    const focusFrame = window.requestAnimationFrame(() => dialog?.focus())

    const getFocusableElements = () => dialog
      ? Array.from(dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        )).filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true')
      : []

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        cancelFromKeyboard()
        return
      }

      if (event.key !== 'Tab') {
        return
      }

      const focusableElements = getFocusableElements()
      if (focusableElements.length === 0) {
        event.preventDefault()
        dialog?.focus()
        return
      }

      event.preventDefault()
      event.stopPropagation()
      const activeElement = document.activeElement
      const activeIndex = activeElement instanceof HTMLElement ? focusableElements.indexOf(activeElement) : -1
      const nextIndex = event.shiftKey
        ? activeIndex <= 0 ? focusableElements.length - 1 : activeIndex - 1
        : activeIndex < 0 || activeIndex === focusableElements.length - 1 ? 0 : activeIndex + 1
      focusableElements[nextIndex].focus()
    }

    const handleFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog?.contains(event.target)) {
        dialog?.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('focusin', handleFocusIn, true)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('focusin', handleFocusIn, true)
      for (const { element, wasInert } of inertSiblings) {
        element.inert = wasInert
      }
      if (previouslyFocused?.isConnected && !previouslyFocused.inert) {
        previouslyFocused.focus()
      }
    }
  }, [])

  return (
    <div ref={backdropRef} className="change-preview-backdrop">
      <section
        ref={dialogRef}
        className="change-preview-dialog"
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="change-preview-title"
        aria-describedby="change-preview-description"
      >
        <header className="change-preview-header">
          <div>
            <p className="change-preview-eyebrow">AI</p>
            <h2 id="change-preview-title">{labels.title}</h2>
            <p id="change-preview-description">{labels.description}</p>
          </div>
          <div className="change-preview-summary">
            <strong>{summary.title}</strong>
            <span>{labels.summary(summary.hunkCount, summary.wouldWriteBytes)}</span>
            <time dateTime={summary.expiresAt}>{labels.expiresAt(formattedExpiry)}</time>
          </div>
        </header>

        <div className="change-preview-hunks">
          {!proposal ? (
            error ? null : <p className="change-preview-loading" role="status">{labels.loading}</p>
          ) : proposal.hunks.map((hunk, index) => {
            const isAccepted = acceptedHunkIds.has(hunk.hunkId)

            return (
              <article key={hunk.hunkId} className={isAccepted ? 'change-preview-hunk accepted' : 'change-preview-hunk discarded'}>
                <header className="change-preview-hunk-header">
                  <div>
                    <strong>{labels.hunk(index + 1, proposal.hunks.length)}</strong>
                    <span>@@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@</span>
                  </div>
                  <label className="change-preview-toggle">
                    <input
                      type="checkbox"
                      checked={isAccepted}
                      disabled={isResolving}
                      onChange={() => onToggleHunk(hunk.hunkId)}
                    />
                    <span>{labels.includeHunk}</span>
                  </label>
                </header>
                <pre className="change-preview-code">
                  {buildChangePreviewLines(hunk).map((line, lineIndex) => (
                    <span
                      key={`${hunk.hunkId}:${lineIndex}`}
                      className={`change-preview-line ${line.kind}`}
                      aria-label={lineAriaLabel(line, labels)}
                    >
                      <span className="change-preview-line-number">{line.oldLine ?? ''}</span>
                      <span className="change-preview-line-number">{line.newLine ?? ''}</span>
                      <span className="change-preview-line-marker">{line.marker}</span>
                      <span className="change-preview-line-text">{line.text || ' '}</span>
                    </span>
                  ))}
                </pre>
              </article>
            )
          })}
        </div>

        {error ? <p className="change-preview-error" role="alert">{error}</p> : null}

        <footer className="change-preview-actions">
          {proposal ? (
            <p className="change-preview-action-note">
              {labels.applyConsequence(acceptedHunkIds.size, proposal.hunks.length)}
            </p>
          ) : null}
          <button type="button" className="secondary-button" disabled={isResolving} onClick={onCancel}>
            {resolvingAction === 'cancel' ? labels.cancelling : labels.cancel}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!proposal || isResolving || acceptedHunkIds.size === 0}
            onClick={onApply}
          >
            {resolvingAction === 'apply' ? labels.applying : labels.applySelected(acceptedHunkIds.size)}
          </button>
        </footer>
      </section>
    </div>
  )
}
