import { useEffect, useRef, useState } from 'react'
import { useDesktopTheme } from '../shared/useDesktopTheme'
import ChatMarkdown from './ChatMarkdown'

type Message = MdvAiChatMessage & {
  id: string
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
    content: 'AI chat window scaffold is ready. Explicit context should be attached with the buttons below, not typed manually.',
  },
  {
    id: 'assistant-placeholder',
    role: 'assistant',
    content: 'When OpenAI is enabled in settings and configured with an API key, messages sent from the bottom composer are routed through the main process. Attach explicit context with the buttons before asking for edits or analysis.',
  },
]

function toModelMessages(messages: Message[]): MdvAiChatMessage[] {
  return messages
    .filter((message) => !message.excludeFromModel && message.id !== 'assistant-welcome' && message.id !== 'assistant-placeholder')
    .map(({ role, content, title }) => ({ role, content, title }))
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

function ChatApp() {
  const { resolvedTheme } = useDesktopTheme()
  const transcriptRef = useRef<HTMLElement | null>(null)
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [composerText, setComposerText] = useState('')
  const [statusText, setStatusText] = useState('Scaffold + IPC')
  const [isSending, setIsSending] = useState(false)

  const appendMessage = (message: Message) => {
    setMessages((currentMessages) => [...currentMessages, message])
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
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [messages])

  const handleRefreshContext = () => {
    setStatusText('Refreshing context')
    void window.mdvDesktop?.getAiChatContext()
      .then((context) => {
        appendMessage({
          id: crypto.randomUUID(),
          role: 'tool',
          title: 'get_context',
          content: formatContext(context ?? null),
        })
        setStatusText('Context refreshed')
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
        appendMessage({
          id: crypto.randomUUID(),
          role: 'tool',
          title: 'read active:document',
          content: payload?.text ?? '',
        })
        setStatusText('Document loaded')
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
        appendMessage({
          id: crypto.randomUUID(),
          role: 'tool',
          title: 'read active:selection',
          content: payload?.text ?? '',
        })
        setStatusText('Selection loaded')
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
    }
    const nextMessages = [...messages, userMessage]

    setMessages(nextMessages)
    setComposerText('')
    setIsSending(true)
    setStatusText('Sending to OpenAI')

    void window.mdvDesktop?.sendAiChatMessage({
      messages: toModelMessages(nextMessages),
    })
      .then((response) => {
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
          <p className="ai-chat-subtitle">Explicit context comes from buttons. Settings are available from this window and Ctrl/Cmd+,.</p>
        </div>
        <div className="ai-chat-header-actions">
          <button type="button" className="ai-chat-secondary" onClick={() => void window.mdvDesktop?.openSettingsWindow()}>
            Settings
          </button>
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
            <ChatMarkdown markdown={message.content} theme={resolvedTheme} />
          </article>
        ))}
      </section>

      <footer className="ai-chat-composer-shell">
        <div className="ai-chat-context-row">
          <span className="ai-chat-composer-label">Context</span>
          <div className="ai-chat-actions">
            <button type="button" className="ai-chat-chip" onClick={handleRefreshContext}>
              Current Editor
            </button>
            <button type="button" className="ai-chat-chip" onClick={handleReadDocument}>
              Whole Document
            </button>
            <button type="button" className="ai-chat-chip" onClick={handleReadSelection}>
              Selection
            </button>
          </div>
        </div>
        <textarea
          id="ai-chat-input"
          className="ai-chat-composer"
          placeholder="Send a message to the assistant. Shift+Enter inserts a newline."
          value={composerText}
          onChange={(event) => setComposerText(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          disabled={isSending}
        />
        <div className="ai-chat-footer-row">
          <span>Shortcuts: Ctrl/Cmd+I opens chat, Ctrl/Cmd+, opens settings.</span>
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