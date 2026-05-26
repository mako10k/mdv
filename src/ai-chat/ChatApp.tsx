import { useEffect, useState } from 'react'
import { useDesktopTheme } from '../shared/useDesktopTheme'
import ChatMarkdown from './ChatMarkdown'

type Message = {
  id: string
  role: 'system' | 'assistant'
  content: string
}

type ExternalAnchor = {
  href: string
  hostname: string
}

const initialMessages: Message[] = [
  {
    id: 'system-welcome',
    role: 'system',
    content: 'AI chat window is ready. Context lookup, document read, selection read, and AI write actions are wired in this scaffold.',
  },
  {
    id: 'assistant-placeholder',
    role: 'assistant',
    content: 'Planned next tools: new editor output, grep, Tavily web search, and OpenAI orchestration.',
  },
]

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

function getWriteSelectionPermission(): boolean {
  const bootstrap = window.mdvDesktop?.settings.getBootstrapSettings()
  return bootstrap?.settings.ai.toolPermissions.writeActiveSelection !== false
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

function ChatApp() {
  const { resolvedTheme } = useDesktopTheme()
  const [contextText, setContextText] = useState('Loading editor context...')
  const [documentPreview, setDocumentPreview] = useState('')
  const [selectionPreview, setSelectionPreview] = useState('')
  const [selectionWriteResult, setSelectionWriteResult] = useState('')
  const [composerText, setComposerText] = useState('# Rewritten by AI bridge\n\nReplace this text from the AI chat window.')
  const [statusText, setStatusText] = useState('Scaffold + IPC')
  const [canWriteSelection, setCanWriteSelection] = useState(() => getWriteSelectionPermission())

  useEffect(() => {
    void window.mdvDesktop?.getAiChatContext()
      .then((context) => {
        setContextText(formatContext(context ?? null))
      })
      .catch((error: unknown) => {
        setContextText(error instanceof Error ? error.message : String(error))
      })
  }, [])

  useEffect(() => {
    const settingsApi = window.mdvDesktop?.settings
    const unsubscribe = settingsApi?.onSettingsChanged((settings) => {
      setCanWriteSelection(settings.ai.toolPermissions.writeActiveSelection)
    })

    void settingsApi?.getSettings()
      .then((settings) => {
        setCanWriteSelection(settings.ai.toolPermissions.writeActiveSelection)
      })
      .catch(() => {
        setCanWriteSelection(getWriteSelectionPermission())
      })

    return () => {
      unsubscribe?.()
    }
  }, [])

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

  const handleReadSelection = () => {
    setStatusText('Reading selection')
    void window.mdvDesktop?.readAiActiveSelection()
      .then((payload) => {
        setSelectionPreview(payload?.text ?? '')
        setStatusText('Selection loaded')
      })
      .catch((error: unknown) => {
        setSelectionPreview(error instanceof Error ? error.message : String(error))
        setStatusText('Selection failed')
      })
  }

  const handleWriteDocument = () => {
    setStatusText('Writing active document')
    void window.mdvDesktop?.writeAiActiveDocument({ content: composerText })
      .then((payload) => {
        setDocumentPreview(payload?.text ?? composerText)
        setStatusText('Document updated')
      })
      .catch((error: unknown) => {
        setStatusText('Write failed')
        setDocumentPreview(error instanceof Error ? error.message : String(error))
      })
  }

  const handleWriteSelection = () => {
    if (!canWriteSelection) {
      setStatusText('Selection write disabled in settings')
      return
    }

    setStatusText('Writing active selection')
    void window.mdvDesktop?.writeAiActiveSelection({ content: composerText })
      .then((payload) => {
        setSelectionWriteResult(payload?.text ?? composerText)
        setStatusText('Selection updated')
      })
      .catch((error: unknown) => {
        setStatusText('Selection write failed')
        setSelectionWriteResult(error instanceof Error ? error.message : String(error))
      })
  }

  return (
    <main className="ai-chat-shell">
      <header className="ai-chat-header">
        <div>
          <p className="ai-chat-eyebrow">MDV Assistant</p>
          <h1>AI Chat</h1>
        </div>
        <div className="ai-chat-header-actions">
          <button type="button" className="ai-chat-secondary" onClick={() => void window.mdvDesktop?.openSettingsWindow()}>
            Settings
          </button>
          <span className="ai-chat-status">{statusText}</span>
        </div>
      </header>

      <section className="ai-chat-transcript" aria-label="AI chat transcript">
        {initialMessages.map((message) => (
          <article
            key={message.id}
            className={message.role === 'assistant' ? 'chat-bubble assistant' : 'chat-bubble system'}
          >
            <ChatMarkdown markdown={message.content} theme={resolvedTheme} />
          </article>
        ))}

        <article className="chat-bubble system">
          <p className="chat-bubble-title">get_context</p>
          <pre className="chat-bubble-pre">{contextText}</pre>
        </article>

        {documentPreview ? (
          <article className="chat-bubble assistant">
            <p className="chat-bubble-title">read active:document</p>
            <ChatMarkdown markdown={documentPreview} theme={resolvedTheme} />
          </article>
        ) : null}

        {selectionPreview ? (
          <article className="chat-bubble assistant">
            <p className="chat-bubble-title">read active:selection</p>
            <ChatMarkdown markdown={selectionPreview} theme={resolvedTheme} />
          </article>
        ) : null}

        {selectionWriteResult ? (
          <article className="chat-bubble assistant">
            <p className="chat-bubble-title">write active:selection</p>
            <ChatMarkdown markdown={selectionWriteResult} theme={resolvedTheme} />
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
          placeholder="Type replacement markdown for write active:document or write active:selection."
          value={composerText}
          onChange={(event) => setComposerText(event.target.value)}
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
            <button type="button" className="ai-chat-send" onClick={handleReadSelection}>
              Read Selection
            </button>
            <button type="button" className="ai-chat-send" onClick={handleWriteDocument}>
              Write Document
            </button>
            <button type="button" className="ai-chat-send" onClick={handleWriteSelection} disabled={!canWriteSelection}>
              Write Selection
            </button>
          </div>
        </div>
      </footer>
    </main>
  )
}

export default ChatApp