import { useEffect, useState } from 'react'
import { useDesktopTheme, type ThemeMode } from '../shared/useDesktopTheme'

const sections = ['General', 'AI Providers', 'Safety', 'Advanced'] as const

type SectionName = (typeof sections)[number]

type OpenAiDraft = {
  enabled: boolean
  model: string
  baseUrl: string
}

type TavilyDraft = {
  enabled: boolean
  defaultSearchDepth: 'basic' | 'advanced'
  defaultMaxResults: number
}

function updateSettingsWithStatus(
  patch: MdvSettingsPatch,
  statusMessage: string,
  setStatusText: (value: string) => void,
  setSettings: (value: MdvSettings) => void,
) {
  setStatusText(statusMessage)

  void window.mdvDesktop?.settings.updateSettings(patch)
    .then((updatedSettings) => {
      setSettings(updatedSettings)
      setStatusText('Settings saved')
    })
    .catch((error: unknown) => {
      setStatusText(error instanceof Error ? error.message : String(error))
    })
}

function SettingsApp() {
  const { themeMode, setThemeMode } = useDesktopTheme()
  const [activeSection, setActiveSection] = useState<SectionName>('General')
  const [settings, setSettings] = useState<MdvSettings | null>(null)
  const [providerStatus, setProviderStatus] = useState<MdvProviderStatus | null>(null)
  const [openAiDraft, setOpenAiDraft] = useState<OpenAiDraft>({
    enabled: true,
    model: 'gpt-5.4-mini',
    baseUrl: '',
  })
  const [openAiApiKeyDraft, setOpenAiApiKeyDraft] = useState('')
  const [tavilyDraft, setTavilyDraft] = useState<TavilyDraft>({
    enabled: false,
    defaultSearchDepth: 'basic',
    defaultMaxResults: 5,
  })
  const [tavilyApiKeyDraft, setTavilyApiKeyDraft] = useState('')
  const [isSavingOpenAi, setIsSavingOpenAi] = useState(false)
  const [isSavingOpenAiApiKey, setIsSavingOpenAiApiKey] = useState(false)
  const [isSavingTavily, setIsSavingTavily] = useState(false)
  const [isSavingTavilyApiKey, setIsSavingTavilyApiKey] = useState(false)
  const [logPath, setLogPath] = useState('Loading log path...')
  const [statusText, setStatusText] = useState('Loading settings')

  const syncOpenAiDraft = (nextSettings: MdvSettings) => {
    setOpenAiDraft({
      enabled: nextSettings.ai.openai.enabled,
      model: nextSettings.ai.openai.model,
      baseUrl: nextSettings.ai.openai.baseUrl ?? '',
    })
  }

  const syncTavilyDraft = (nextSettings: MdvSettings) => {
    setTavilyDraft({
      enabled: nextSettings.ai.tavily.enabled,
      defaultSearchDepth: nextSettings.ai.tavily.defaultSearchDepth,
      defaultMaxResults: nextSettings.ai.tavily.defaultMaxResults,
    })
  }

  useEffect(() => {
    let active = true
    const unsubscribe = window.mdvDesktop?.settings.onSettingsChanged((nextSettings) => {
      setSettings(nextSettings)
      syncOpenAiDraft(nextSettings)
      syncTavilyDraft(nextSettings)
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
        if (nextSettings) {
          syncOpenAiDraft(nextSettings)
          syncTavilyDraft(nextSettings)
        }
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

  const handleOpenAiSave = () => {
    setIsSavingOpenAi(true)
    setStatusText('Saving OpenAI settings')

    void window.mdvDesktop?.settings.updateSettings({
      ai: {
        openai: {
          enabled: openAiDraft.enabled,
          model: openAiDraft.model,
          baseUrl: openAiDraft.baseUrl,
        },
      },
    })
      .then((updatedSettings) => {
        setSettings(updatedSettings)
        syncOpenAiDraft(updatedSettings)
        setStatusText('OpenAI settings saved')
      })
      .catch((error: unknown) => {
        setStatusText(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        setIsSavingOpenAi(false)
      })
  }

  const handleOpenAiApiKeySave = () => {
    const trimmedApiKey = openAiApiKeyDraft.trim()

    if (!trimmedApiKey) {
      setStatusText('OpenAI API key cannot be empty')
      return
    }

    setIsSavingOpenAiApiKey(true)
    setStatusText('Saving OpenAI API key')

    void window.mdvDesktop?.settings.saveOpenAiApiKey(trimmedApiKey)
      .then((nextProviderStatus) => {
        setProviderStatus(nextProviderStatus)
        setOpenAiApiKeyDraft('')
        setStatusText('OpenAI API key saved')
      })
      .catch((error: unknown) => {
        setStatusText(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        setIsSavingOpenAiApiKey(false)
      })
  }

  const handleOpenAiApiKeyClear = () => {
    setIsSavingOpenAiApiKey(true)
    setStatusText('Clearing OpenAI API key')

    void window.mdvDesktop?.settings.clearOpenAiApiKey()
      .then((nextProviderStatus) => {
        setProviderStatus(nextProviderStatus)
        setOpenAiApiKeyDraft('')
        setStatusText('OpenAI API key cleared')
      })
      .catch((error: unknown) => {
        setStatusText(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        setIsSavingOpenAiApiKey(false)
      })
  }

  const handleTavilySave = () => {
    setIsSavingTavily(true)
    setStatusText('Saving Tavily settings')

    void window.mdvDesktop?.settings.updateSettings({
      ai: {
        tavily: {
          enabled: tavilyDraft.enabled,
          defaultSearchDepth: tavilyDraft.defaultSearchDepth,
          defaultMaxResults: tavilyDraft.defaultMaxResults,
        },
      },
    })
      .then((updatedSettings) => {
        setSettings(updatedSettings)
        syncTavilyDraft(updatedSettings)
        setStatusText('Tavily settings saved')
      })
      .catch((error: unknown) => {
        setStatusText(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        setIsSavingTavily(false)
      })
  }

  const handleTavilyApiKeySave = () => {
    const trimmedApiKey = tavilyApiKeyDraft.trim()

    if (!trimmedApiKey) {
      setStatusText('Tavily API key cannot be empty')
      return
    }

    setIsSavingTavilyApiKey(true)
    setStatusText('Saving Tavily API key')

    void window.mdvDesktop?.settings.saveTavilyApiKey(trimmedApiKey)
      .then((nextProviderStatus) => {
        setProviderStatus(nextProviderStatus)
        setTavilyApiKeyDraft('')
        setStatusText('Tavily API key saved')
      })
      .catch((error: unknown) => {
        setStatusText(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        setIsSavingTavilyApiKey(false)
      })
  }

  const handleTavilyApiKeyClear = () => {
    setIsSavingTavilyApiKey(true)
    setStatusText('Clearing Tavily API key')

    void window.mdvDesktop?.settings.clearTavilyApiKey()
      .then((nextProviderStatus) => {
        setProviderStatus(nextProviderStatus)
        setTavilyApiKeyDraft('')
        setStatusText('Tavily API key cleared')
      })
      .catch((error: unknown) => {
        setStatusText(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        setIsSavingTavilyApiKey(false)
      })
  }

  const handleToolPermissionChange = (key: keyof MdvSettings['ai']['toolPermissions'], value: boolean) => {
    updateSettingsWithStatus({
      ai: {
        toolPermissions: {
          [key]: value,
        },
      },
    }, 'Saving AI permission', setStatusText, setSettings)
  }

  const handleSafetyChange = (key: keyof MdvSettings['safety'], value: boolean) => {
    updateSettingsWithStatus({
      safety: {
        [key]: value,
      },
    }, 'Saving safety setting', setStatusText, setSettings)
  }

  const handleOpenFetchPermissionsWindow = () => {
    setStatusText('Opening fetch permissions')

    void window.mdvDesktop?.openFetchPermissionsWindow()
      .then(() => {
        setStatusText('Fetch permissions opened')
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
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={openAiDraft.enabled}
                  onChange={(event) => {
                    setOpenAiDraft((currentDraft) => ({
                      ...currentDraft,
                      enabled: event.target.checked,
                    }))
                  }}
                />
                <span>Enable OpenAI chat</span>
              </label>
              <label className="settings-field">
                <span>OpenAI model</span>
                <input
                  type="text"
                  value={openAiDraft.model}
                  placeholder="gpt-5.4-mini"
                  onChange={(event) => {
                    setOpenAiDraft((currentDraft) => ({
                      ...currentDraft,
                      model: event.target.value,
                    }))
                  }}
                />
              </label>
              <label className="settings-field settings-field-wide">
                <span>OpenAI base URL</span>
                <input
                  type="url"
                  value={openAiDraft.baseUrl}
                  placeholder="https://api.openai.com/v1"
                  onChange={(event) => {
                    setOpenAiDraft((currentDraft) => ({
                      ...currentDraft,
                      baseUrl: event.target.value,
                    }))
                  }}
                />
              </label>
              <label className="settings-field settings-field-wide">
                <span>OpenAI API key</span>
                <input
                  type="password"
                  value={openAiApiKeyDraft}
                  placeholder="sk-..."
                  autoComplete="off"
                  onChange={(event) => {
                    setOpenAiApiKeyDraft(event.target.value)
                  }}
                />
              </label>
              <div className="settings-actions">
                <button type="button" className="settings-primary-button" onClick={handleOpenAiSave} disabled={isSavingOpenAi}>
                  {isSavingOpenAi ? 'Saving…' : 'Save OpenAI settings'}
                </button>
                <button type="button" className="settings-secondary-button" onClick={handleOpenAiApiKeySave} disabled={isSavingOpenAiApiKey}>
                  {isSavingOpenAiApiKey ? 'Saving key…' : 'Save API key'}
                </button>
                <button type="button" className="settings-secondary-button" onClick={handleOpenAiApiKeyClear} disabled={isSavingOpenAiApiKey}>
                  Clear stored key
                </button>
              </div>
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
                  <dd>{settings?.ai.openai.model ?? 'gpt-5.4-mini'}</dd>
                </div>
                <div>
                  <dt>OpenAI base URL</dt>
                  <dd className="settings-break">{settings?.ai.openai.baseUrl ?? 'https://api.openai.com/v1 (fallback)'}</dd>
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
              <p className="settings-note">Secrets stay in main process. API key values are sent one-way for storage and are never read back into the renderer. If no stored key exists, OPENAI_API_KEY remains a fallback.</p>

              <hr className="settings-divider" />

              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={tavilyDraft.enabled}
                  onChange={(event) => {
                    setTavilyDraft((currentDraft) => ({
                      ...currentDraft,
                      enabled: event.target.checked,
                    }))
                  }}
                />
                <span>Enable Tavily web search</span>
              </label>
              <label className="settings-field">
                <span>Tavily search depth</span>
                <select
                  value={tavilyDraft.defaultSearchDepth}
                  onChange={(event) => {
                    setTavilyDraft((currentDraft) => ({
                      ...currentDraft,
                      defaultSearchDepth: event.target.value === 'advanced' ? 'advanced' : 'basic',
                    }))
                  }}
                >
                  <option value="basic">Basic</option>
                  <option value="advanced">Advanced</option>
                </select>
              </label>
              <label className="settings-field">
                <span>Tavily max results</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={tavilyDraft.defaultMaxResults}
                  onChange={(event) => {
                    const numericValue = Number(event.target.value)
                    setTavilyDraft((currentDraft) => ({
                      ...currentDraft,
                      defaultMaxResults: Number.isFinite(numericValue) ? numericValue : currentDraft.defaultMaxResults,
                    }))
                  }}
                />
              </label>
              <label className="settings-field settings-field-wide">
                <span>Tavily API key</span>
                <input
                  type="password"
                  value={tavilyApiKeyDraft}
                  placeholder="tvly-..."
                  autoComplete="off"
                  onChange={(event) => {
                    setTavilyApiKeyDraft(event.target.value)
                  }}
                />
              </label>
              <div className="settings-actions">
                <button type="button" className="settings-primary-button" onClick={handleTavilySave} disabled={isSavingTavily}>
                  {isSavingTavily ? 'Saving…' : 'Save Tavily settings'}
                </button>
                <button type="button" className="settings-secondary-button" onClick={handleTavilyApiKeySave} disabled={isSavingTavilyApiKey}>
                  {isSavingTavilyApiKey ? 'Saving key…' : 'Save Tavily key'}
                </button>
                <button type="button" className="settings-secondary-button" onClick={handleTavilyApiKeyClear} disabled={isSavingTavilyApiKey}>
                  Clear Tavily key
                </button>
              </div>
              <p className="settings-note">Tavily search uses the same main-process secret boundary as OpenAI. Fetch URL permissions are edited in a dedicated window because the allowlist may grow large.</p>
            </section>
          ) : null}

          {activeSection === 'Safety' ? (
            <section className="settings-card">
              <h2>Safety</h2>
              <div className="settings-subsection">
                <h3>AI Tool Permissions</h3>
                <label className="settings-toggle">
                  <input type="checkbox" checked={settings?.ai.toolPermissions.readActiveDocument ?? true} onChange={(event) => handleToolPermissionChange('readActiveDocument', event.target.checked)} />
                  <span>Read active document</span>
                </label>
                <label className="settings-toggle">
                  <input type="checkbox" checked={settings?.ai.toolPermissions.readActiveSelection ?? true} onChange={(event) => handleToolPermissionChange('readActiveSelection', event.target.checked)} />
                  <span>Read active selection</span>
                </label>
                <label className="settings-toggle">
                  <input type="checkbox" checked={settings?.ai.toolPermissions.writeActiveDocument ?? true} onChange={(event) => handleToolPermissionChange('writeActiveDocument', event.target.checked)} />
                  <span>Write active document</span>
                </label>
                <label className="settings-toggle">
                  <input type="checkbox" checked={settings?.ai.toolPermissions.writeActiveSelection ?? true} onChange={(event) => handleToolPermissionChange('writeActiveSelection', event.target.checked)} />
                  <span>Write active selection</span>
                </label>
                <label className="settings-toggle">
                  <input type="checkbox" checked={settings?.ai.toolPermissions.writeNewDocument ?? true} onChange={(event) => handleToolPermissionChange('writeNewDocument', event.target.checked)} />
                  <span>Create new document</span>
                </label>
                <label className="settings-toggle">
                  <input type="checkbox" checked={settings?.ai.toolPermissions.sliceSearch ?? true} onChange={(event) => handleToolPermissionChange('sliceSearch', event.target.checked)} />
                  <span>AI exact / semantic / stats slice tools</span>
                </label>
                <label className="settings-toggle">
                  <input type="checkbox" checked={settings?.ai.toolPermissions.workspaceGrep ?? true} onChange={(event) => handleToolPermissionChange('workspaceGrep', event.target.checked)} />
                  <span>AI workspace grep</span>
                </label>
                <label className="settings-toggle">
                  <input type="checkbox" checked={settings?.ai.toolPermissions.tavilyWebSearch ?? true} onChange={(event) => handleToolPermissionChange('tavilyWebSearch', event.target.checked)} />
                  <span>Tavily web search</span>
                </label>
                <label className="settings-toggle">
                  <input type="checkbox" checked={settings?.ai.toolPermissions.fetchUrl ?? true} onChange={(event) => handleToolPermissionChange('fetchUrl', event.target.checked)} />
                  <span>Allow guarded fetch_url</span>
                </label>
                <div className="settings-actions">
                  <button type="button" className="settings-secondary-button" onClick={handleOpenFetchPermissionsWindow}>
                    Open fetch permissions window
                  </button>
                </div>
              </div>
              <div className="settings-subsection">
                <h3>Confirmations</h3>
                <label className="settings-toggle">
                  <input type="checkbox" checked={settings?.safety.confirmBeforeFullDocumentOverwrite ?? true} onChange={(event) => handleSafetyChange('confirmBeforeFullDocumentOverwrite', event.target.checked)} />
                  <span>Confirm full document overwrite</span>
                </label>
                <label className="settings-toggle">
                  <input type="checkbox" checked={settings?.safety.confirmBeforeNewDocumentFromAi ?? true} onChange={(event) => handleSafetyChange('confirmBeforeNewDocumentFromAi', event.target.checked)} />
                  <span>Confirm new AI document creation</span>
                </label>
                <label className="settings-toggle">
                  <input type="checkbox" checked={settings?.safety.confirmBeforeExternalUrlOpen ?? true} onChange={(event) => handleSafetyChange('confirmBeforeExternalUrlOpen', event.target.checked)} />
                  <span>Confirm external URL open</span>
                </label>
              </div>
              <dl className="settings-facts">
                <div>
                  <dt>External URL confirm</dt>
                  <dd>{settings?.safety.confirmBeforeExternalUrlOpen ? 'enabled' : 'disabled'}</dd>
                </div>
              </dl>
              <p className="settings-note">AI exact / semantic slice search is enforced independently from future workspace grep. AI full-document overwrite and new-document creation confirmations are enforced from the main process.</p>
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