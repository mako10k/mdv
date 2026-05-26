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

function ChatApp() {
  return (
    <main className="ai-chat-shell">
      <header className="ai-chat-header">
        <div>
          <p className="ai-chat-eyebrow">MDV Assistant</p>
          <h1>AI Chat</h1>
        </div>
        <span className="ai-chat-status">Scaffold only</span>
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
          <button type="button" className="ai-chat-send" disabled>
            Send
          </button>
        </div>
      </footer>
    </main>
  )
}

export default ChatApp