import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import './settings.css'
import SettingsApp from './SettingsApp'
import { applyBootstrapTheme } from '../shared/useDesktopTheme'

function logToDesktop(level: string, scope: string, message: unknown) {
  window.mdvDesktop?.log(level, scope, typeof message === 'string' ? message : String(message))
}

window.addEventListener('error', (event) => {
  logToDesktop(
    'error',
    'settings-window',
    `${event.message} @ ${event.filename}:${event.lineno}:${event.colno}`,
  )
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason instanceof Error ? event.reason.stack ?? event.reason.message : String(event.reason)
  logToDesktop('error', 'settings-window', `unhandledrejection ${reason}`)
})

logToDesktop('info', 'settings-window', 'Settings renderer bootstrap start')

applyBootstrapTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsApp />
  </StrictMode>,
)

logToDesktop('info', 'settings-window', 'Settings React root rendered')