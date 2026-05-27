import { useEffect, useRef, useState } from 'react'
import { useDesktopTheme } from '../shared/useDesktopTheme'
import ChatMarkdown from './ChatMarkdown'

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
  editorId: string
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

const initialMessages: Message[] = [
  {
    id: 'assistant-welcome',
    role: 'assistant',
    content: 'Attach explicit context with the buttons below, then send your request from the bottom composer.',
  },
]

function buildMessageContent(message: Message): string {
  if (!message.contextAttachments?.length) {
    return message.content
  }

  const attachments = message.contextAttachments.map((attachment) => {
    if (attachment.transport === 'inline' && attachment.inlineText) {
      return [
        `Attached context: ${attachment.label}`,
        `EditorID: ${attachment.editorId}`,
        `SPAN: ${formatSpanLabel(attachment.span)}`,
        `Estimated tokens: ${attachment.estimatedTokens}`,
        attachment.inlineText,
      ].join('\n')
    }

    const hintLines = [
      `Attached context hint: ${attachment.label}`,
      `EditorID: ${attachment.editorId}`,
      `SPAN: ${formatSpanLabel(attachment.span)}`,
      `Estimated tokens: ${attachment.estimatedTokens}`,
      `Preview: ${attachment.previewText || '(empty)'}`,
      'Use read_target when more detail is needed.',
    ]

    if (attachment.truncated) {
      hintLines.splice(4, 0, 'Attachment was truncated before queueing.')
    }

    return hintLines.join('\n')
  })

  return [...attachments, message.content].join('\n\n')
}

function toModelMessages(messages: Message[]): MdvAiChatMessage[] {
  return messages
    .filter((message) => !message.excludeFromModel && message.id !== 'assistant-welcome')
    .map((message) => ({
      role: message.role,
      content: buildMessageContent(message),
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

function formatContext(context: MdvAiContextPayload | null): string {
  if (!context) {
    return 'No editor context available.'
  }

  return [
    `Title: ${context.title}`,
    `Path: ${context.currentFilePath ?? '(untitled)'}`,
    `Panel: ${context.activePanel}`,
    `Text length: ${context.textLength}`,
    `Selection length: ${context.selectionTextLength}`,
    `Dirty: ${context.isDirty ? 'yes' : 'no'}`,
  ].join('\n')
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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

function formatSpanLabel(span: MdvAiNormalizedSpan | null): string {
  if (!span) {
    return 'metadata'
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

function createContextAttachment(kind: ContextAttachmentKind, payload: {
  detail: string
  editorId: string
  span?: MdvAiNormalizedSpan | null
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
    editorId: payload.editorId,
    span: payload.span ?? null,
    estimatedTokens,
    truncated,
    transport,
    inlineText: transport === 'inline' ? payload.detail : null,
    previewText: createPreviewText(payload.detail),
  }
}

function ChatApp() {
  const { resolvedTheme } = useDesktopTheme()
  const transcriptRef = useRef<HTMLElement | null>(null)
  const shouldStickToBottomRef = useRef(true)
  const forceScrollOnNextRenderRef = useRef(false)
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [pendingContexts, setPendingContexts] = useState<ContextAttachment[]>([])
  const [composerText, setComposerText] = useState('')
  const [statusText, setStatusText] = useState('Scaffold + IPC')
  const [isSending, setIsSending] = useState(false)
  const [inlineAttachmentTokenBudget, setInlineAttachmentTokenBudget] = useState(() => getInlineAttachmentTokenBudget('gpt-5.4-mini'))

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
    setStatusText(`Context queued: ${attachment.label}`)
  }

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      const anchor = resolveExternalAnchor(event.target)

      if (!anchor) {
        return
      }

      event.preventDefault()
      void window.mdvDesktop?.openExternalLink(anchor.href).then((result) => {
        if (!result || result.status === 'opened') {
          setStatusText(`Opened link: ${anchor.hostname}`)
          return
        }

        if (result.status === 'cancelled') {
          setStatusText('Cancelled external link')
          return
        }

        setStatusText('Blocked external link')
      })
    }

    document.addEventListener('click', handleDocumentClick, true)

    return () => {
      document.removeEventListener('click', handleDocumentClick, true)
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
    setStatusText('Reading editor context')
    void window.mdvDesktop?.getAiChatContext()
      .then((context) => {
        queueContextAttachment(createContextAttachment('editor', {
          detail: formatContext(context ?? null),
          editorId: context?.editorId ?? 'editor:active',
          span: null,
          estimatedTokens: context?.tokenEstimate ?? estimateTokens(formatContext(context ?? null)),
        }, inlineAttachmentTokenBudget))
      })
      .catch((error: unknown) => {
        setStatusText('Context failed')
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
    setStatusText('Reading active document')
    void window.mdvDesktop?.readAiActiveDocument()
      .then((payload) => {
        queueContextAttachment(createContextAttachment('document', {
          detail: payload?.text ?? '',
          editorId: payload?.editorId ?? 'editor:active',
          span: payload?.span ?? null,
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
        setStatusText('Read failed')
      })
  }

  const handleReadSelection = () => {
    setStatusText('Reading selection')
    void window.mdvDesktop?.readAiActiveSelection()
      .then((payload) => {
        queueContextAttachment(createContextAttachment('selection', {
          detail: payload?.text ?? '',
          editorId: payload?.editorId ?? 'editor:active',
          span: payload?.span ?? null,
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
        setStatusText('Selection failed')
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
    setStatusText('Sending to OpenAI')

    void window.mdvDesktop?.sendAiChatMessage({
      messages: toModelMessages(nextMessages),
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
        setStatusText(`Assistant replied with ${response.model}`)
      })
      .catch((error: unknown) => {
        appendMessage({
          id: crypto.randomUUID(),
          role: 'assistant',
          title: 'openai error',
          content: toErrorMessage(error),
          excludeFromModel: true,
        })
        setStatusText('OpenAI request failed')
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
    <main className="ai-chat-shell">
      <header className="ai-chat-header">
        <div>
          <p className="ai-chat-eyebrow">MDV Assistant</p>
          <h1>AI Chat</h1>
          <p className="ai-chat-subtitle">Attach explicit context, keep typing at the bottom, and let the transcript scroll independently above.</p>
        </div>
        <div className="ai-chat-header-actions">
          <span className="ai-chat-status">{statusText}</span>
        </div>
      </header>

      <section ref={transcriptRef} className="ai-chat-transcript" aria-label="AI chat transcript">
        {messages.map((message) => (
          <article
            key={message.id}
            className={`chat-bubble ${message.role}`}
          >
            {message.title ? <p className="chat-bubble-title">{message.title}</p> : null}
            {message.contextAttachments?.length ? (
              <div className="chat-context-badges" aria-label="Attached context">
                {message.contextAttachments.map((attachment) => (
                  <span key={attachment.id} className="chat-context-badge" title={attachment.detail}>
                    {attachment.compactLabel}
                  </span>
                ))}
              </div>
            ) : null}
            <ChatMarkdown markdown={message.content} theme={resolvedTheme} />
          </article>
        ))}
      </section>

      <footer className="ai-chat-composer-shell">
        <div className="ai-chat-context-row">
          <span className="ai-chat-composer-label">Context</span>
          <div className="ai-chat-actions">
            <button type="button" className="ai-chat-icon-button" onClick={handleRefreshContext} title="Queue current editor context" aria-label="Queue current editor context">
              <span aria-hidden="true">◫</span>
            </button>
            <button type="button" className="ai-chat-icon-button" onClick={handleReadDocument} title="Queue whole document" aria-label="Queue whole document">
              <span aria-hidden="true">▤</span>
            </button>
            <button type="button" className="ai-chat-icon-button" onClick={handleReadSelection} title="Queue selection" aria-label="Queue selection">
              <span aria-hidden="true">✂</span>
            </button>
          </div>
        </div>
        {pendingContexts.length ? (
          <div className="chat-context-badges ai-chat-pending-contexts" aria-label="Pending context">
            {pendingContexts.map((attachment) => (
              <span key={attachment.id} className="chat-context-badge" title={attachment.detail}>
                {attachment.compactLabel}
              </span>
            ))}
          </div>
        ) : null}
        <textarea
          id="ai-chat-input"
          className="ai-chat-composer"
          placeholder="Message the assistant"
          value={composerText}
          onChange={(event) => setComposerText(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          disabled={isSending}
        />
        <div className="ai-chat-footer-row">
          <span>Enter sends. Shift+Enter inserts a newline.</span>
          <div className="ai-chat-actions">
            <button type="button" className="ai-chat-send" onClick={handleSendMessage} disabled={isSending || composerText.trim().length === 0}>
              {isSending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </footer>
    </main>
  )
}

export default ChatApp