import { useEffect, useState } from 'react'

type Message = {
  id: string
  role: 'system' | 'assistant'
  content: string
}

const initialMessages: Message[] = [
  {
    id: 'system-welcome',
    role: 'system',
    content: 'AI chat window is ready. OpenAI integration and editor tools will be connected in the next slice.',
  },
  {
    id: 'assistant-placeholder',
    role: 'assistant',
    content: 'Planned tools: read selection, write selection, new editor output, grep, Tavily web search.',
  },
]

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

function ChatApp() {
  const [contextText, setContextText] = useState('Loading editor context...')
  const [documentPreview, setDocumentPreview] = useState('')
  const [statusText, setStatusText] = useState('Scaffold + IPC')

  useEffect(() => {
    void window.mdvDesktop?.getAiChatContext()
      .then((context) => {
        setContextText(formatContext(context ?? null))
      })
      .catch((error: unknown) => {
        setContextText(error instanceof Error ? error.message : String(error))
      })
  }, [])

  const handleRefreshContext = () => {
    setStatusText('Refreshing context')
    void window.mdvDesktop?.getAiChatContext()
      .then((context) => {
        setContextText(formatContext(context ?? null))
        setStatusText('Context refreshed')
      })
      .catch((error: unknown) => {
        setStatusText('Context failed')
        setContextText(error instanceof Error ? error.message : String(error))
      })
  }

  const handleReadDocument = () => {
    setStatusText('Reading active document')
    void window.mdvDesktop?.readAiActiveDocument()
      .then((payload) => {
        setDocumentPreview(payload?.text ?? '')
        setStatusText('Document loaded')
      })
      .catch((error: unknown) => {
        setDocumentPreview(error instanceof Error ? error.message : String(error))
        setStatusText('Read failed')
      })
  }

  return (
    <main className="ai-chat-shell">
      <header className="ai-chat-header">
        <div>
          <p className="ai-chat-eyebrow">MDV Assistant</p>
          <h1>AI Chat</h1>
        </div>
        <span className="ai-chat-status">{statusText}</span>
      </header>

      <section className="ai-chat-transcript" aria-label="AI chat transcript">
        {initialMessages.map((message) => (
          <article
            key={message.id}
            className={message.role === 'assistant' ? 'chat-bubble assistant' : 'chat-bubble system'}
          >
            <p>{message.content}</p>
          </article>
        ))}

        <article className="chat-bubble system">
          <p className="chat-bubble-title">get_context</p>
          <pre className="chat-bubble-pre">{contextText}</pre>
        </article>

        {documentPreview ? (
          <article className="chat-bubble assistant">
            <p className="chat-bubble-title">read active:document</p>
            <pre className="chat-bubble-pre">{documentPreview}</pre>
          </article>
        ) : null}
      </section>

      <footer className="ai-chat-composer-shell">
        <label className="ai-chat-composer-label" htmlFor="ai-chat-input">
          Composer
        </label>
        <textarea
          id="ai-chat-input"
          className="ai-chat-composer"
          placeholder="OpenAI integration will be connected in the next slice."
          disabled
        />
        <div className="ai-chat-footer-row">
          <span>Shortcut: Ctrl/Cmd+I opens this window.</span>
          <div className="ai-chat-actions">
            <button type="button" className="ai-chat-send" onClick={handleRefreshContext}>
              Refresh Context
            </button>
            <button type="button" className="ai-chat-send" onClick={handleReadDocument}>
              Read Document
            </button>
          </div>
        </div>
      </footer>
    </main>
  )
}

export default ChatApp