import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'katex/dist/katex.min.css'
import '../index.css'
import './chat.css'
import ChatApp from './ChatApp'
import { applyBootstrapTheme } from '../shared/useDesktopTheme'

function logToDesktop(level: string, scope: string, message: unknown) {
  window.mdvDesktop?.log(level, scope, typeof message === 'string' ? message : String(message))
}

window.addEventListener('error', (event) => {
  logToDesktop(
    'error',
    'ai-chat-window',
    `${event.message} @ ${event.filename}:${event.lineno}:${event.colno}`,
  )
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason instanceof Error ? event.reason.stack ?? event.reason.message : String(event.reason)
  logToDesktop('error', 'ai-chat-window', `unhandledrejection ${reason}`)
})

logToDesktop('info', 'ai-chat-window', 'AI chat renderer bootstrap start')

applyBootstrapTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ChatApp />
  </StrictMode>,
)

logToDesktop('info', 'ai-chat-window', 'AI chat React root rendered')