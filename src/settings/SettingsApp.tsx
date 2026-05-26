import { useEffect, useState } from 'react'
import { useDesktopTheme, type ThemeMode } from '../shared/useDesktopTheme'

const sections = ['General', 'AI Providers', 'Safety', 'Advanced'] as const

type SectionName = (typeof sections)[number]

function SettingsApp() {
  const { themeMode, setThemeMode } = useDesktopTheme()
  const [activeSection, setActiveSection] = useState<SectionName>('General')
  const [settings, setSettings] = useState<MdvSettings | null>(null)
  const [providerStatus, setProviderStatus] = useState<MdvProviderStatus | null>(null)
  const [logPath, setLogPath] = useState('Loading log path...')
  const [statusText, setStatusText] = useState('Loading settings')

  useEffect(() => {
    let active = true
    const unsubscribe = window.mdvDesktop?.settings.onSettingsChanged((nextSettings) => {
      setSettings(nextSettings)
      setStatusText('Settings updated')
    })

    void Promise.all([
      window.mdvDesktop?.settings.getSettings(),
      window.mdvDesktop?.settings.getProviderStatus(),
      window.mdvDesktop?.getLogPath(),
    ])
      .then(([nextSettings, nextProviderStatus, nextLogPath]) => {
        if (!active) {
          return
        }

        setSettings(nextSettings ?? null)
        setProviderStatus(nextProviderStatus ?? null)
        setLogPath(nextLogPath ?? 'Unavailable')
        setStatusText('Settings ready')
      })
      .catch((error: unknown) => {
        if (!active) {
          return
        }

        setStatusText(error instanceof Error ? error.message : String(error))
      })

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [])

  const handleThemeChange = (nextThemeMode: ThemeMode) => {
    setStatusText('Saving theme')

    void setThemeMode(nextThemeMode)
      .then(() => {
        setStatusText('Theme saved')
      })
      .catch((error: unknown) => {
        setStatusText(error instanceof Error ? error.message : String(error))
      })
  }

  return (
    <main className="settings-shell">
      <header className="settings-header">
        <div>
          <p className="settings-eyebrow">MDV Configuration</p>
          <h1>Settings</h1>
          <p className="settings-subtitle">Main-process settings store scaffold with synchronized theme and provider status.</p>
        </div>
        <span className="settings-status">{statusText}</span>
      </header>

      <section className="settings-layout">
        <nav className="settings-sidebar" aria-label="Settings sections">
          {sections.map((section) => (
            <button
              key={section}
              type="button"
              className={`settings-nav-item${activeSection === section ? ' active' : ''}`}
              onClick={() => setActiveSection(section)}
            >
              {section}
            </button>
          ))}
        </nav>

        <div className="settings-content">
          {activeSection === 'General' ? (
            <section className="settings-card">
              <h2>General</h2>
              <label className="settings-field">
                <span>Theme mode</span>
                <select value={themeMode} onChange={(event) => handleThemeChange(event.target.value as ThemeMode)}>
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>
              <dl className="settings-facts">
                <div>
                  <dt>Open links behavior</dt>
                  <dd>{settings?.general.openLinksBehavior ?? 'confirm-if-untrusted'}</dd>
                </div>
              </dl>
              <p className="settings-note">Theme is wired live. Open links behavior is enforced in main process. Additional General defaults will surface here after their editor boot wiring lands.</p>
            </section>
          ) : null}

          {activeSection === 'AI Providers' ? (
            <section className="settings-card">
              <h2>AI Providers</h2>
              <dl className="settings-facts">
                <div>
                  <dt>OpenAI enabled</dt>
                  <dd>{settings?.ai.openai.enabled ? 'yes' : 'no'}</dd>
                </div>
                <div>
                  <dt>OpenAI configured</dt>
                  <dd>{providerStatus?.openaiConfigured ? 'yes' : 'no'}</dd>
                </div>
                <div>
                  <dt>OpenAI model</dt>
                  <dd>{settings?.ai.openai.model ?? 'gpt-5.4'}</dd>
                </div>
                <div>
                  <dt>Tavily enabled</dt>
                  <dd>{settings?.ai.tavily.enabled ? 'yes' : 'no'}</dd>
                </div>
                <div>
                  <dt>Tavily configured</dt>
                  <dd>{providerStatus?.tavilyConfigured ? 'yes' : 'no'}</dd>
                </div>
              </dl>
              <p className="settings-note">Secrets stay in main process. This scaffold only exposes configured state.</p>
            </section>
          ) : null}

          {activeSection === 'Safety' ? (
            <section className="settings-card">
              <h2>Safety</h2>
              <dl className="settings-facts">
                <div>
                  <dt>External URL confirm</dt>
                  <dd>{settings?.safety.confirmBeforeExternalUrlOpen ? 'enabled' : 'disabled'}</dd>
                </div>
              </dl>
              <p className="settings-note">External link allow rules remain read-only in the existing file for now. AI write confirmations stay scaffold-only until the write flow is wired to these settings.</p>
            </section>
          ) : null}

          {activeSection === 'Advanced' ? (
            <section className="settings-card">
              <h2>Advanced</h2>
              <dl className="settings-facts">
                <div>
                  <dt>Schema version</dt>
                  <dd>{settings?.version ?? 1}</dd>
                </div>
                <div>
                  <dt>Log path</dt>
                  <dd className="settings-break">{logPath}</dd>
                </div>
              </dl>
              <p className="settings-note">This window is auxiliary and excluded from editor routing and managed snapshot ownership.</p>
            </section>
          ) : null}
        </div>
      </section>
    </main>
  )
}

export default SettingsApp