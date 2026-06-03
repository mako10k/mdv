import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import '../settings/settings.css'
import './about.css'
import AboutApp from './AboutApp'
import { applyBootstrapTheme } from '../shared/useDesktopTheme'

function logToDesktop(level: string, scope: string, message: unknown) {
  window.mdvDesktop?.log(level, scope, typeof message === 'string' ? message : String(message))
}

window.addEventListener('error', (event) => {
  logToDesktop(
    'error',
    'about-window',
    `${event.message} @ ${event.filename}:${event.lineno}:${event.colno}`,
  )
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason instanceof Error ? event.reason.stack ?? event.reason.message : String(event.reason)
  logToDesktop('error', 'about-window', `unhandledrejection ${reason}`)
})

logToDesktop('info', 'about-window', 'About renderer bootstrap start')

applyBootstrapTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AboutApp />
  </StrictMode>,
)

logToDesktop('info', 'about-window', 'About React root rendered')
