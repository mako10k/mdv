import { useEffect, useRef, useState } from 'react'
import { useDesktopTheme } from '../shared/useDesktopTheme'
import { getTranslations, isLocale, useI18n } from '../shared/i18n'
import ChatMarkdown from './ChatMarkdown'

type ChatAppProps = {
  variant?: 'window' | 'dock'
  autoFocusNonce?: number
  onRequestClose?: () => void
}

type ContextAttachmentKind = 'editor' | 'document' | 'selection'

const DEFAULT_MODEL_CONTEXT_WINDOW = 16000
const MODEL_CONTEXT_WINDOW_BY_NAME: Record<string, number> = {
  'gpt-5.4-mini': 128000,
}
const ATTACHMENT_PREVIEW_LIMIT = 220

type AttachmentTransport = 'inline' | 'hint'

type ContextAttachment = {
  id: string
  kind: ContextAttachmentKind
  label: string
  compactLabel: string
  detail: string
  detailContext?: MdvAiContextPayload | null
  target: MdvAiEditorTarget | null
  pageTarget: MdvAiEditorTarget | null
  span: MdvAiNormalizedSpan | null
  estimatedTokens: number
  truncated: boolean
  transport: AttachmentTransport
  inlineText: string | null
  previewText: string
}

type Message = MdvAiChatMessage & {
  id: string
  contextAttachments?: ContextAttachment[]
  excludeFromModel?: boolean
}

type ExternalAnchor = {
  href: string
  hostname: string
}

function createInitialMessages(welcome: string): Message[] {
  return [
    {
      id: 'assistant-welcome',
      role: 'assistant',
      content: welcome,
    },
  ]
}

function buildMessageContent(message: Message, chatText: ReturnType<typeof useI18n>['t']['chat']): string {
  if (!message.contextAttachments?.length) {
    return message.content
  }

  const attachments = message.contextAttachments.map((attachment) => {
    const pageTargetLine = attachment.pageTarget
      ? `PageTargetRef: ${JSON.stringify(attachment.pageTarget)}`
      : null
    const attachmentHeaderLines = [
      attachment.transport === 'inline' && attachment.inlineText ? `${chatText.attachedContextLabel}: ${attachment.label}` : `${chatText.attachedContextHintLabel}: ${attachment.label}`,
      attachment.target ? `TargetRef: ${JSON.stringify(attachment.target)}` : chatText.metadataOnlyAttachment,
      ...(pageTargetLine ? [pageTargetLine] : []),
      `${chatText.resolvedSpan}: ${formatSpanLabel(attachment.span, chatText)}`,
      `${chatText.estimatedTokens}: ${attachment.estimatedTokens}`,
    ]

    if (attachment.transport === 'inline' && attachment.inlineText) {
      return [...attachmentHeaderLines, attachment.inlineText].join('\n')
    }

    const hintLines = [
      ...attachmentHeaderLines,
      `${chatText.preview}: ${attachment.previewText || chatText.empty}`,
      attachment.target ? chatText.useReadTarget : chatText.useMetadataOnly,
    ]

    if (attachment.truncated) {
      hintLines.splice(4, 0, chatText.attachmentTruncated)
    }

    return hintLines.join('\n')
  })

  return [...attachments, message.content].join('\n\n')
}

function toModelMessages(messages: Message[], chatText: ReturnType<typeof useI18n>['t']['chat']): MdvAiChatMessage[] {
  return messages
    .filter((message) => !message.excludeFromModel && message.id !== 'assistant-welcome')
    .map((message) => ({
      role: message.role,
      content: buildMessageContent(message, chatText),
      title: message.title,
    }))
}

function resolveExternalAnchor(target: EventTarget | null): ExternalAnchor | null {
  if (!(target instanceof Element)) {
    return null
  }

  const anchor = target.closest('a')
  if (!(anchor instanceof Element)) {
    return null
  }

  const href = anchor.getAttribute('href') ?? anchor.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
  if (!href) {
    return null
  }

  let targetUrl: URL

  try {
    targetUrl = new URL(href, window.location.href)
  } catch {
    return null
  }

  if (!/^https?:$/i.test(targetUrl.protocol)) {
    return null
  }

  return {
    href: targetUrl.href,
    hostname: targetUrl.hostname,
  }
}

function formatContext(context: MdvAiContextPayload | null, chatText: ReturnType<typeof useI18n>['t']['chat'], commonText: ReturnType<typeof useI18n>['t']['common']): string {
  if (!context) {
    return chatText.noEditorContext
  }

  return [
    `${chatText.titleLabel}: ${context.title}`,
    `${chatText.pathLabel}: ${context.currentFilePath ?? chatText.untitledPath}`,
    `${chatText.panelLabel}: ${context.activePanel}`,
    `${chatText.textLengthLabel}: ${context.textLength}`,
    `${chatText.selectionLengthLabel}: ${context.selectionTextLength}`,
    `${chatText.dirtyLabel}: ${context.isDirty ? commonText.yes : commonText.no}`,
  ].join('\n')
}

function relocalizeAttachment(
  attachment: ContextAttachment,
  chatText: ReturnType<typeof useI18n>['t']['chat'],
  commonText: ReturnType<typeof useI18n>['t']['common'],
  inlineAttachmentTokenBudget: number,
): ContextAttachment {
  if (attachment.kind !== 'editor') {
    return attachment
  }

  const nextDetail = formatContext(attachment.detailContext ?? null, chatText, commonText)
  const estimatedTokens = attachment.detailContext?.tokenEstimate ?? estimateTokens(nextDetail)
  const truncated = attachment.truncated === true
  const transport: AttachmentTransport = !truncated && estimatedTokens <= inlineAttachmentTokenBudget ? 'inline' : 'hint'

  return {
    ...attachment,
    detail: nextDetail,
    estimatedTokens,
    transport,
    inlineText: transport === 'inline' ? nextDetail : null,
    previewText: createPreviewText(nextDetail),
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function tryFormatJson(text: string): string | null {
  if (typeof text !== 'string') {
    return null
  }

  const trimmed = text.trim()

  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) {
    return null
  }

  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return null
  }
}

function isLikelyJsonLike(text: string): boolean {
  if (typeof text !== 'string') {
    return false
  }

  const trimmed = text.trim()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

function summarizeJsonLikeText(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== '{' && line !== '[' && line !== '}' && line !== ']' && line !== '...')

  if (lines.length === 0) {
    return null
  }

  const preview = lines[0].replace(/^[",'{[]+/, '')
  return preview.length > 72 ? `${preview.slice(0, 72)}...` : preview
}

function summarizeJsonValue(text: string): string | null {
  try {
    const parsed = JSON.parse(text)

    if (Array.isArray(parsed)) {
      return parsed.length === 0 ? '[] empty array' : `[] ${parsed.length} items`
    }

    if (parsed && typeof parsed === 'object') {
      const keys = Object.keys(parsed)
      if (keys.length === 0) {
        return '{} empty object'
      }

      const preview = keys.slice(0, 4).join(', ')
      return keys.length > 4 ? `{ ${preview}, ... }` : `{ ${preview} }`
    }

    return String(parsed)
  } catch {
    return null
  }
}

function summarizeToolMessage(content: string, chatText: ReturnType<typeof useI18n>['t']['chat']): string {
  const trimmed = content.trim()

  if (!trimmed) {
    return chatText.emptyToolOutput
  }

  const jsonPreview = tryFormatJson(trimmed)

  if (jsonPreview) {
    const jsonSummary = summarizeJsonValue(trimmed) || jsonPreview.split('\n', 1)[0]
    return jsonSummary.length > 72 ? `${jsonSummary.slice(0, 72)}...` : jsonSummary
  }

  if (isLikelyJsonLike(trimmed)) {
    return summarizeJsonLikeText(trimmed) || chatText.jsonOutput
  }

  const firstLine = trimmed.split(/\r?\n/, 1)[0]
  return firstLine.length > 96 ? `${firstLine.slice(0, 96)}...` : firstLine
}

function countLines(text: string): number {
  if (!text) {
    return 0
  }

  return text.split(/\r?\n/).length
}

function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / 4)
}

function getModelContextWindow(model: string | null | undefined): number {
  return MODEL_CONTEXT_WINDOW_BY_NAME[typeof model === 'string' ? model : ''] || DEFAULT_MODEL_CONTEXT_WINDOW
}

function getInlineAttachmentTokenBudget(model: string | null | undefined): number {
  return Math.max(512, Math.floor(getModelContextWindow(model) * 0.05))
}

function formatLineBadge(text: string, span: MdvAiNormalizedSpan | null): string {
  if (span) {
    return `${Math.max(1, span.end.line - span.start.line + 1)}L`
  }

  return `${countLines(text)}L`
}

function formatSpanLabel(span: MdvAiNormalizedSpan | null, chatText: ReturnType<typeof useI18n>['t']['chat']): string {
  if (!span) {
    return chatText.metadata
  }

  return `${span.start.line}:${span.start.column}-${span.end.line}:${span.end.column}`
}

function createPreviewText(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= ATTACHMENT_PREVIEW_LIMIT) {
    return collapsed
  }

  return `${collapsed.slice(0, ATTACHMENT_PREVIEW_LIMIT)}...`
}

function normalizedSpanToRangeRef(span: MdvAiNormalizedSpan): MdvAiSpanRef {
  return {
    kind: 'range',
    start: span.start,
    end: span.end,
  }
}

function createAttachmentTarget(kind: ContextAttachmentKind, editorId: string, span: MdvAiNormalizedSpan | null): MdvAiEditorTarget | null {
  if (kind === 'editor' && !span) {
    return null
  }

  return {
    editorId,
    span: span ? normalizedSpanToRangeRef(span) : { kind: 'document' },
  }
}

function createAttachmentPageTarget(editorId: string, span: MdvAiNormalizedSpan | null): MdvAiEditorTarget | null {
  if (!span) {
    return null
  }

  return {
    editorId,
    span: normalizedSpanToRangeRef(span),
  }
}

function createContextAttachment(kind: ContextAttachmentKind, payload: {
  detail: string
  detailContext?: MdvAiContextPayload | null
  editorId: string
  span?: MdvAiNormalizedSpan | null
  target?: MdvAiEditorTarget | null
  pageTarget?: MdvAiEditorTarget | null
  estimatedTokens?: number
  truncated?: boolean
}, inlineAttachmentTokenBudget: number): ContextAttachment {
  const compactPrefix = kind === 'editor' ? 'ED' : kind === 'document' ? 'DOC' : 'SEL'
  const estimatedTokens = typeof payload.estimatedTokens === 'number' ? payload.estimatedTokens : estimateTokens(payload.detail)
  const truncated = payload.truncated === true
  const transport: AttachmentTransport = !truncated && estimatedTokens <= inlineAttachmentTokenBudget ? 'inline' : 'hint'

  return {
    id: crypto.randomUUID(),
    kind,
    label: `${compactPrefix} ${formatLineBadge(payload.detail, payload.span ?? null)}`,
    compactLabel: `${compactPrefix} ${formatLineBadge(payload.detail, payload.span ?? null)}`,
    detail: payload.detail,
    detailContext: payload.detailContext,
    target: payload.target ?? createAttachmentTarget(kind, payload.editorId, payload.span ?? null),
    pageTarget: payload.pageTarget ?? createAttachmentPageTarget(payload.editorId, payload.span ?? null),
    span: payload.span ?? null,
    estimatedTokens,
    truncated,
    transport,
    inlineText: transport === 'inline' ? payload.detail : null,
    previewText: createPreviewText(payload.detail),
  }
}

function ChatApp({ variant = 'dock', autoFocusNonce = 0, onRequestClose }: ChatAppProps) {
  const { resolvedTheme } = useDesktopTheme()
  const { t } = useI18n()
  const i18nRef = useRef(t)
  const rootRef = useRef<HTMLElement | null>(null)
  const transcriptRef = useRef<HTMLElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const shouldStickToBottomRef = useRef(true)
  const forceScrollOnNextRenderRef = useRef(false)
  const [messages, setMessages] = useState<Message[]>(() => createInitialMessages(t.chat.welcome))
  const [pendingContexts, setPendingContexts] = useState<ContextAttachment[]>([])
  const [composerText, setComposerText] = useState('')
  const [statusText, setStatusText] = useState<string>(t.chat.statusBase)
  const [isSending, setIsSending] = useState(false)
  const [inlineAttachmentTokenBudget, setInlineAttachmentTokenBudget] = useState(() => getInlineAttachmentTokenBudget('gpt-5.4-mini'))
  const inlineAttachmentTokenBudgetRef = useRef(inlineAttachmentTokenBudget)
  const localeRef = useRef<'ja' | 'en'>(document.documentElement.lang === 'ja' ? 'ja' : 'en')

  useEffect(() => {
    i18nRef.current = t
    inlineAttachmentTokenBudgetRef.current = inlineAttachmentTokenBudget
  })

  useEffect(() => {
    if (variant !== 'window') {
      return
    }

    document.title = `MDV ${t.chat.title}`
  }, [t, variant])

  useEffect(() => {
    if (variant !== 'dock' || autoFocusNonce <= 0) {
      return
    }

    composerRef.current?.focus({ preventScroll: true })
  }, [variant, autoFocusNonce])

  useEffect(() => {
    let active = true
    const applyBudgetFromSettings = (nextSettings: MdvSettings) => {
      setInlineAttachmentTokenBudget(getInlineAttachmentTokenBudget(nextSettings.ai.openai.model))
    }
    const unsubscribe = window.mdvDesktop?.settings.onSettingsChanged((nextSettings) => {
      if (!active) {
        return
      }

      applyBudgetFromSettings(nextSettings)

      if (!isLocale(nextSettings.general.locale) || nextSettings.general.locale === localeRef.current) {
        return
      }

      localeRef.current = nextSettings.general.locale
      const nextTranslations = getTranslations(nextSettings.general.locale)
      setStatusText(nextTranslations.chat.statusBase)
      setMessages((currentMessages) => currentMessages.map((message) => ({
        ...message,
        content: message.id === 'assistant-welcome' ? nextTranslations.chat.welcome : message.content,
        contextAttachments: message.contextAttachments?.map((attachment) => relocalizeAttachment(attachment, nextTranslations.chat, nextTranslations.common, inlineAttachmentTokenBudgetRef.current)),
      })))
      setPendingContexts((currentContexts) => currentContexts.map((attachment) => relocalizeAttachment(attachment, nextTranslations.chat, nextTranslations.common, inlineAttachmentTokenBudgetRef.current)))
    })

    void window.mdvDesktop?.settings.getSettings().then((nextSettings) => {
      if (!active || !nextSettings) {
        return
      }

      applyBudgetFromSettings(nextSettings)
    })

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [])

  const appendMessage = (message: Message, options?: { forceScroll?: boolean }) => {
    forceScrollOnNextRenderRef.current = options?.forceScroll ?? false
    setMessages((currentMessages) => [...currentMessages, message])
  }

  const queueContextAttachment = (attachment: ContextAttachment) => {
    setPendingContexts((currentContexts) => {
      const nextContexts = currentContexts.filter((item) => item.kind !== attachment.kind)
      return [...nextContexts, attachment]
    })
    setStatusText(t.chat.status.contextQueued(attachment.label))
  }

  const removePendingContext = (attachmentId: string) => {
    const hasTarget = pendingContexts.some((attachment) => attachment.id === attachmentId)
    setPendingContexts((currentContexts) => {
      return currentContexts.filter((attachment) => attachment.id !== attachmentId)
    })

    if (hasTarget) {
      setStatusText(t.chat.status.pendingContextRemoved)
    }
  }

  const clearPendingContexts = () => {
    if (pendingContexts.length === 0) {
      return
    }

    setPendingContexts([])
    setStatusText(t.chat.status.pendingContextCleared)
  }

  useEffect(() => {
    const root = rootRef.current

    if (!root) {
      return
    }

    const handleDocumentClick = (event: MouseEvent) => {
      const anchor = resolveExternalAnchor(event.target)

      if (!anchor) {
        return
      }

      event.preventDefault()
      void window.mdvDesktop?.openExternalLink(anchor.href).then((result) => {
        if (!result || result.status === 'opened') {
          setStatusText(i18nRef.current.chat.status.openedLink(anchor.hostname))
          return
        }

        if (result.status === 'cancelled') {
          setStatusText(i18nRef.current.chat.status.cancelledExternalLink)
          return
        }

        setStatusText(i18nRef.current.chat.status.blockedExternalLink)
      })
    }

    root.addEventListener('click', handleDocumentClick, true)

    return () => {
      root.removeEventListener('click', handleDocumentClick, true)
    }
  }, [])

  useEffect(() => {
    const transcript = transcriptRef.current

    if (!transcript) {
      return
    }

    if (!forceScrollOnNextRenderRef.current && !shouldStickToBottomRef.current) {
      return
    }

    transcript.scrollTo({
      top: transcript.scrollHeight,
      behavior: 'smooth',
    })
    forceScrollOnNextRenderRef.current = false
  }, [messages])

  useEffect(() => {
    const transcript = transcriptRef.current

    if (!transcript) {
      return
    }

    const handleScroll = () => {
      const distanceFromBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight
      shouldStickToBottomRef.current = distanceFromBottom < 24
    }

    handleScroll()
    transcript.addEventListener('scroll', handleScroll)

    return () => {
      transcript.removeEventListener('scroll', handleScroll)
    }
  }, [])

  const handleRefreshContext = () => {
    setStatusText(t.chat.status.readingEditorContext)
    void window.mdvDesktop?.getAiChatContext()
      .then((context) => {
        queueContextAttachment(createContextAttachment('editor', {
          detail: formatContext(context ?? null, t.chat, t.common),
          detailContext: context ?? null,
          editorId: context?.editorId ?? 'editor:active',
          span: null,
          estimatedTokens: context?.tokenEstimate ?? estimateTokens(formatContext(context ?? null, t.chat, t.common)),
        }, inlineAttachmentTokenBudget))
      })
      .catch((error: unknown) => {
        setStatusText(t.chat.status.contextFailed)
        appendMessage({
          id: crypto.randomUUID(),
          role: 'tool',
          title: 'get_context',
          content: toErrorMessage(error),
          excludeFromModel: true,
        })
      })
  }

  const handleReadDocument = () => {
    setStatusText(t.chat.status.readingActiveDocument)
    void window.mdvDesktop?.readAiActiveDocument()
      .then((payload) => {
        queueContextAttachment(createContextAttachment('document', {
          detail: payload?.text ?? '',
          editorId: payload?.editorId ?? 'editor:active',
          span: payload?.span ?? null,
          target: payload?.target ?? null,
          pageTarget: payload?.pageTarget ?? null,
          estimatedTokens: payload?.estimatedTokens,
          truncated: payload?.truncated,
        }, inlineAttachmentTokenBudget))
      })
      .catch((error: unknown) => {
        appendMessage({
          id: crypto.randomUUID(),
          role: 'tool',
          title: 'read active:document',
          content: toErrorMessage(error),
          excludeFromModel: true,
        })
        setStatusText(t.chat.status.readFailed)
      })
  }

  const handleReadSelection = () => {
    setStatusText(t.chat.status.readingSelection)
    void window.mdvDesktop?.readAiActiveSelection()
      .then((payload) => {
        queueContextAttachment(createContextAttachment('selection', {
          detail: payload?.text ?? '',
          editorId: payload?.editorId ?? 'editor:active',
          span: payload?.span ?? null,
          target: payload?.target ?? null,
          pageTarget: payload?.pageTarget ?? null,
          estimatedTokens: payload?.estimatedTokens,
          truncated: payload?.truncated,
        }, inlineAttachmentTokenBudget))
      })
      .catch((error: unknown) => {
        appendMessage({
          id: crypto.randomUUID(),
          role: 'tool',
          title: 'read active:selection',
          content: toErrorMessage(error),
          excludeFromModel: true,
        })
        setStatusText(t.chat.status.selectionFailed)
      })
  }

  const handleSendMessage = () => {
    if (isSending) {
      return
    }

    const trimmedMessage = composerText.trim()

    if (!trimmedMessage) {
      return
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmedMessage,
      contextAttachments: pendingContexts,
    }
    const nextMessages = [...messages, userMessage]

    forceScrollOnNextRenderRef.current = true
    setMessages(nextMessages)
    setComposerText('')
    setPendingContexts([])
    setIsSending(true)
    setStatusText(t.chat.status.sendingToOpenAi)

    void window.mdvDesktop?.sendAiChatMessage({
      messages: toModelMessages(nextMessages, t.chat),
    })
      .then((response) => {
        response.toolEvents?.forEach((toolEvent) => {
          appendMessage({
            id: crypto.randomUUID(),
            role: 'tool',
            title: toolEvent.title,
            content: toolEvent.content,
          })
        })
        appendMessage({
          id: crypto.randomUUID(),
          role: 'assistant',
          title: response.model,
          content: response.reply,
        })
        setStatusText(t.chat.status.assistantReplied(response.model))
      })
      .catch((error: unknown) => {
        appendMessage({
          id: crypto.randomUUID(),
          role: 'assistant',
          title: 'openai error',
          content: toErrorMessage(error),
          excludeFromModel: true,
        })
        setStatusText(t.chat.status.openAiRequestFailed)
      })
      .finally(() => {
        setIsSending(false)
      })
  }

  const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isSending) {
      return
    }

    if (event.nativeEvent.isComposing) {
      return
    }

    if (event.key !== 'Enter' || event.shiftKey) {
      return
    }

    event.preventDefault()
    handleSendMessage()
  }

  return (
    <section ref={rootRef} className={`ai-chat-shell ${variant === 'dock' ? 'embedded' : 'windowed'}`}>
      <header className="ai-chat-header">
        <div>
          <p className="ai-chat-eyebrow">{t.chat.eyebrow}</p>
          <h1>{t.chat.title}</h1>
          <p className="ai-chat-subtitle">{t.chat.subtitle}</p>
        </div>
        <div className="ai-chat-header-actions">
          <span className="ai-chat-status">{statusText}</span>
          {variant === 'dock' && onRequestClose ? (
            <button type="button" className="ai-chat-close-button" onClick={onRequestClose} aria-label={t.common.close} title={t.common.close}>
              <span aria-hidden="true">×</span>
            </button>
          ) : null}
        </div>
      </header>

      <section ref={transcriptRef} className="ai-chat-transcript" aria-label={t.chat.transcript}>
        {messages.map((message) => {
          if (message.role === 'tool') {
            const formattedJson = tryFormatJson(message.content)
            const isJsonLike = formattedJson !== null || isLikelyJsonLike(message.content)

            return (
              <article key={message.id} className="chat-tool-entry">
                <details className="chat-tool-accordion">
                  <summary>
                    <span className="chat-tool-summary-title">{message.title || t.chat.toolOutput}</span>
                    <span className="chat-tool-summary-meta">{summarizeToolMessage(message.content, t.chat)}</span>
                  </summary>
                  <div className="chat-tool-content">
                    {isJsonLike ? (
                      <pre className="chat-tool-json">{formattedJson || message.content.trim()}</pre>
                    ) : (
                      <ChatMarkdown markdown={message.content} theme={resolvedTheme} />
                    )}
                  </div>
                </details>
              </article>
            )
          }

          return (
            <article
              key={message.id}
              className={`chat-bubble ${message.role}`}
            >
              {message.title ? <p className="chat-bubble-title">{message.title}</p> : null}
              {message.contextAttachments?.length ? (
                <div className="chat-context-badges" aria-label={t.chat.attachedContext}>
                  {message.contextAttachments.map((attachment) => (
                    <span key={attachment.id} className="chat-context-badge" title={attachment.detail}>
                      {attachment.compactLabel}
                    </span>
                  ))}
                </div>
              ) : null}
              <ChatMarkdown markdown={message.id === 'assistant-welcome' ? t.chat.welcome : message.content} theme={resolvedTheme} />
            </article>
          )
        })}
      </section>

      <footer className="ai-chat-composer-shell">
        <div className="ai-chat-context-row">
          <span className="ai-chat-composer-label">{t.chat.context}</span>
          <div className="ai-chat-actions">
            <button type="button" className="ai-chat-icon-button" onClick={handleRefreshContext} title={t.chat.queueEditorContext} aria-label={t.chat.queueEditorContext}>
              <span aria-hidden="true">◫</span>
            </button>
            <button type="button" className="ai-chat-icon-button" onClick={handleReadDocument} title={t.chat.queueWholeDocument} aria-label={t.chat.queueWholeDocument}>
              <span aria-hidden="true">▤</span>
            </button>
            <button type="button" className="ai-chat-icon-button" onClick={handleReadSelection} title={t.chat.queueSelection} aria-label={t.chat.queueSelection}>
              <span aria-hidden="true">✂</span>
            </button>
          </div>
        </div>
        {pendingContexts.length ? (
          <div className="chat-context-badges ai-chat-pending-contexts" aria-label={t.chat.pendingContext}>
            {pendingContexts.map((attachment) => (
              <span key={attachment.id} className="chat-context-badge chat-context-badge-pending" title={attachment.detail}>
                <span>{attachment.compactLabel}</span>
                <button
                  type="button"
                  className="chat-context-badge-remove"
                  onClick={() => removePendingContext(attachment.id)}
                  aria-label={t.chat.removePendingContext(attachment.compactLabel)}
                  title={t.chat.removePendingContextShort}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </span>
            ))}
            <button type="button" className="ai-chat-clear-contexts" onClick={clearPendingContexts}>
              {t.chat.clearAll}
            </button>
          </div>
        ) : null}
        <textarea
          id="ai-chat-input"
          ref={composerRef}
          className="ai-chat-composer"
          placeholder={t.chat.messagePlaceholder}
          value={composerText}
          onChange={(event) => setComposerText(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          disabled={isSending}
        />
        <div className="ai-chat-footer-row">
          <span>{t.chat.sendHint}</span>
          <div className="ai-chat-actions">
            <button type="button" className="ai-chat-send" onClick={handleSendMessage} disabled={isSending || composerText.trim().length === 0}>
              {isSending ? t.chat.sending : t.common.send}
            </button>
          </div>
        </div>
      </footer>
    </section>
  )
}

export default ChatApp