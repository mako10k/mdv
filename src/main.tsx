import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import MermaidViewerApp from './mermaid-viewer/MermaidViewerApp'
import './mermaid-viewer/mermaid-viewer.css'
import { applyBootstrapTypography } from './shared/desktopTypography'
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
applyBootstrapTypography()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.location.pathname.endsWith('/mermaid-viewer.html') ? <MermaidViewerApp /> : <App />}
  </StrictMode>,
)

logToDesktop('info', 'renderer', 'React root rendered')
