import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import '../settings/settings.css'
import './fetch-permissions.css'
import FetchPermissionsApp from './FetchPermissionsApp'
import { applyBootstrapTheme } from '../shared/useDesktopTheme'

function logToDesktop(level: string, scope: string, message: unknown) {
  window.mdvDesktop?.log(level, scope, typeof message === 'string' ? message : String(message))
}

window.addEventListener('error', (event) => {
  logToDesktop(
    'error',
    'fetch-permissions-window',
    `${event.message} @ ${event.filename}:${event.lineno}:${event.colno}`,
  )
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason instanceof Error ? event.reason.stack ?? event.reason.message : String(event.reason)
  logToDesktop('error', 'fetch-permissions-window', `unhandledrejection ${reason}`)
})

logToDesktop('info', 'fetch-permissions-window', 'Fetch permissions renderer bootstrap start')

applyBootstrapTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FetchPermissionsApp />
  </StrictMode>,
)

logToDesktop('info', 'fetch-permissions-window', 'Fetch permissions React root rendered')
