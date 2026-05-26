import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyBootstrapTheme } from './shared/useDesktopTheme'

function logToDesktop(level: string, scope: string, message: unknown) {
  window.mdvDesktop?.log(level, scope, typeof message === 'string' ? message : String(message))
}

window.addEventListener('error', (event) => {
  logToDesktop(
    'error',
    'renderer-window',
    `${event.message} @ ${event.filename}:${event.lineno}:${event.colno}`,
  )
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason instanceof Error ? event.reason.stack ?? event.reason.message : String(event.reason)
  logToDesktop('error', 'renderer-window', `unhandledrejection ${reason}`)
})

logToDesktop('info', 'renderer', 'Renderer bootstrap start')

applyBootstrapTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

logToDesktop('info', 'renderer', 'React root rendered')
