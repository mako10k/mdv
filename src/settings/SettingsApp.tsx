import { useEffect, useRef, useState } from 'react'
import { isThemeMode, useDesktopTheme, type ThemeMode } from '../shared/useDesktopTheme'
import { getTranslations, isLocale, useI18n } from '../shared/i18n'

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

type UpdateDraft = {
  enabled: boolean
  autoCheckOnLaunch: boolean
  feedUrl: string
}

function updateSettingsWithStatus(
  patch: MdvSettingsPatch,
  statusMessage: string,
  successMessage: string,
  setStatusText: (value: string) => void,
  setSettings: (value: MdvSettings) => void,
) {
  setStatusText(statusMessage)

  void window.mdvDesktop?.settings.updateSettings(patch)
    .then((updatedSettings) => {
      setSettings(updatedSettings)
      setStatusText(successMessage)
    })
    .catch((error: unknown) => {
      setStatusText(error instanceof Error ? error.message : String(error))
    })
}

function SettingsApp() {
  const { themeMode, setThemeMode } = useDesktopTheme()
  const { t } = useI18n()
  const i18nRef = useRef(t)
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
  const [isSavingUpdates, setIsSavingUpdates] = useState(false)
  const [appMetadata, setAppMetadata] = useState<MdvAppMetadata | null>(null)
  const [updaterState, setUpdaterState] = useState<MdvUpdaterState | null>(null)
  const [updateDraft, setUpdateDraft] = useState<UpdateDraft>({
    enabled: true,
    autoCheckOnLaunch: true,
    feedUrl: '',
  })
  const [logPath, setLogPath] = useState<string>(t.settings.loadingLogPath)
  const [statusText, setStatusText] = useState<string>(t.settings.loadingSettings)
  const isUpdaterConfigEditable = updaterState?.supported === true

  useEffect(() => {
    i18nRef.current = t
  })

  useEffect(() => {
    document.title = `MDV ${t.settings.title}`
  }, [t])

  const getUpdaterStatusLabel = (state: MdvUpdaterState | null) => {
    if (!state) {
      return t.about.updaterIdle
    }

    if (!state.supported) {
      return t.about.updaterUnsupported
    }

    if (!state.enabled) {
      return t.about.updaterDisabled
    }

    if (!state.configured) {
      return t.about.updaterUnconfigured
    }

    switch (state.status) {
      case 'checking':
        return t.about.updaterChecking
      case 'update-available':
        return t.about.updaterAvailable
      case 'downloading':
        return t.about.updaterDownloading
      case 'downloaded':
        return t.about.updaterDownloaded
      case 'up-to-date':
        return t.about.updaterUpToDate
      case 'error':
        return state.error ? `${t.about.updaterError}: ${state.error}` : t.about.updaterError
      default:
        return t.about.updaterIdle
    }
  }

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

  const syncUpdateDraft = (nextSettings: MdvSettings) => {
    setUpdateDraft({
      enabled: nextSettings.updates.enabled,
      autoCheckOnLaunch: nextSettings.updates.autoCheckOnLaunch,
      feedUrl: nextSettings.updates.feedUrl ?? '',
    })
  }

  useEffect(() => {
    let active = true
    const unsubscribe = window.mdvDesktop?.settings.onSettingsChanged((nextSettings) => {
      setSettings(nextSettings)
      syncOpenAiDraft(nextSettings)
      syncTavilyDraft(nextSettings)
      syncUpdateDraft(nextSettings)
      const nextTranslations = getTranslations(nextSettings.general.locale)
      setStatusText(nextTranslations.settings.settingsUpdated)
    })
    const unsubscribeUpdater = window.mdvDesktop?.updater.onStateChanged((nextUpdaterState) => {
      setUpdaterState(nextUpdaterState)
    })

    void Promise.all([
      window.mdvDesktop?.settings.getSettings(),
      window.mdvDesktop?.settings.getProviderStatus(),
      window.mdvDesktop?.getAppMetadata(),
      window.mdvDesktop?.updater.getState(),
      window.mdvDesktop?.getLogPath(),
    ])
      .then(([nextSettings, nextProviderStatus, nextAppMetadata, nextUpdaterState, nextLogPath]) => {
        if (!active) {
          return
        }

        setSettings(nextSettings ?? null)
        if (nextSettings) {
          syncOpenAiDraft(nextSettings)
          syncTavilyDraft(nextSettings)
          syncUpdateDraft(nextSettings)
        }
        setProviderStatus(nextProviderStatus ?? null)
        setAppMetadata(nextAppMetadata ?? null)
        setUpdaterState(nextUpdaterState ?? null)
        setLogPath(nextLogPath ?? i18nRef.current.common.unavailable)
        setStatusText(i18nRef.current.settings.settingsReady)
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
      unsubscribeUpdater?.()
    }
  }, [])

  const handleThemeChange = (nextThemeMode: ThemeMode) => {
    setStatusText(t.settings.savingTheme)

    void setThemeMode(nextThemeMode)
      .then(() => {
        setStatusText(t.settings.themeSaved)
      })
      .catch((error: unknown) => {
        setStatusText(error instanceof Error ? error.message : String(error))
      })
  }

  const handleLocaleChange = (nextLocale: MdvLocale) => {
    setStatusText(getTranslations(nextLocale).settings.savingLocale)

    void window.mdvDesktop?.settings.updateSettings({
      general: {
        locale: nextLocale,
      },
    })
      .then((updatedSettings) => {
        setSettings(updatedSettings)
        setStatusText(getTranslations(updatedSettings.general.locale).settings.localeSaved)
      })
      .catch((error: unknown) => {
        setStatusText(error instanceof Error ? error.message : String(error))
      })
  }

  const handleOpenAiSave = () => {
    setIsSavingOpenAi(true)
    setStatusText(t.settings.status.savingOpenAiSettings)

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
        setStatusText(t.settings.status.openAiSettingsSaved)
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
      setStatusText(t.settings.status.openAiApiKeyEmpty)
      return
    }

    setIsSavingOpenAiApiKey(true)
    setStatusText(t.settings.status.savingOpenAiApiKey)

    void window.mdvDesktop?.settings.saveOpenAiApiKey(trimmedApiKey)
      .then((nextProviderStatus) => {
        setProviderStatus(nextProviderStatus)
        setOpenAiApiKeyDraft('')
        setStatusText(t.settings.status.openAiApiKeySaved)
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
    setStatusText(t.settings.status.clearingOpenAiApiKey)

    void window.mdvDesktop?.settings.clearOpenAiApiKey()
      .then((nextProviderStatus) => {
        setProviderStatus(nextProviderStatus)
        setOpenAiApiKeyDraft('')
        setStatusText(t.settings.status.openAiApiKeyCleared)
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
    setStatusText(t.settings.status.savingTavilySettings)

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
        setStatusText(t.settings.status.tavilySettingsSaved)
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
      setStatusText(t.settings.status.tavilyApiKeyEmpty)
      return
    }

    setIsSavingTavilyApiKey(true)
    setStatusText(t.settings.status.savingTavilyApiKey)

    void window.mdvDesktop?.settings.saveTavilyApiKey(trimmedApiKey)
      .then((nextProviderStatus) => {
        setProviderStatus(nextProviderStatus)
        setTavilyApiKeyDraft('')
        setStatusText(t.settings.status.tavilyApiKeySaved)
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
    setStatusText(t.settings.status.clearingTavilyApiKey)

    void window.mdvDesktop?.settings.clearTavilyApiKey()
      .then((nextProviderStatus) => {
        setProviderStatus(nextProviderStatus)
        setTavilyApiKeyDraft('')
        setStatusText(t.settings.status.tavilyApiKeyCleared)
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
    }, t.settings.status.savingAiPermission, t.settings.settingsSaved, setStatusText, setSettings)
  }

  const handleSafetyChange = (key: keyof MdvSettings['safety'], value: boolean) => {
    updateSettingsWithStatus({
      safety: {
        [key]: value,
      },
    }, t.settings.status.savingSafetySetting, t.settings.settingsSaved, setStatusText, setSettings)
  }

  const handleUpdateSettingsSave = () => {
    setIsSavingUpdates(true)
    setStatusText(t.settings.status.savingUpdateSettings)

    void window.mdvDesktop?.settings.updateSettings({
      updates: {
        enabled: updateDraft.enabled,
        autoCheckOnLaunch: updateDraft.autoCheckOnLaunch,
        feedUrl: updateDraft.feedUrl,
      },
    })
      .then((updatedSettings) => {
        setSettings(updatedSettings)
        syncUpdateDraft(updatedSettings)
        setStatusText(t.settings.status.updateSettingsSaved)
      })
      .catch((error: unknown) => {
        setStatusText(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        setIsSavingUpdates(false)
      })
  }

  const handleOpenFetchPermissionsWindow = () => {
    setStatusText(t.settings.status.openingFetchPermissions)

    void window.mdvDesktop?.openFetchPermissionsWindow()
      .then(() => {
        setStatusText(t.settings.status.fetchPermissionsOpened)
      })
      .catch((error: unknown) => {
        setStatusText(error instanceof Error ? error.message : String(error))
      })
  }

  return (
    <main className="settings-shell">
      <header className="settings-header">
        <div>
          <p className="settings-eyebrow">{t.settings.eyebrow}</p>
          <h1>{t.settings.title}</h1>
          <p className="settings-subtitle">{t.settings.subtitle}</p>
        </div>
        <span className="settings-status">{statusText}</span>
      </header>

      <section className="settings-layout">
        <nav className="settings-sidebar" aria-label={t.settings.sectionsAriaLabel}>
          {sections.map((section) => (
            <button
              key={section}
              type="button"
              className={`settings-nav-item${activeSection === section ? ' active' : ''}`}
              onClick={() => setActiveSection(section)}
            >
              {section === 'General'
                ? t.settings.sections.general
                : section === 'AI Providers'
                  ? t.settings.sections.aiProviders
                  : section === 'Safety'
                    ? t.settings.sections.safety
                    : t.settings.sections.advanced}
            </button>
          ))}
        </nav>

        <div className="settings-content">
          {activeSection === 'General' ? (
            <section className="settings-card">
              <h2>{t.settings.sections.general}</h2>
              <label className="settings-field">
                <span>{t.settings.general.language}</span>
                <select
                  value={settings?.general.locale ?? 'en'}
                  onChange={(event) => {
                    const nextLocale = event.currentTarget.value

                    if (!isLocale(nextLocale)) {
                      return
                    }

                    handleLocaleChange(nextLocale)
                  }}
                >
                  <option value="ja">{t.common.japanese}</option>
                  <option value="en">{t.common.english}</option>
                </select>
              </label>
              <label className="settings-field">
                <span>{t.settings.general.themeMode}</span>
                <select
                  value={themeMode}
                  onChange={(event) => {
                    const nextThemeMode = event.currentTarget.value

                    if (!isThemeMode(nextThemeMode)) {
                      setStatusText(t.common.invalidThemeMode)
                      return
                    }

                    handleThemeChange(nextThemeMode)
                  }}
                >
                  <option value="system">{t.common.system}</option>
                  <option value="light">{t.common.light}</option>
                  <option value="dark">{t.common.dark}</option>
                </select>
              </label>
              <dl className="settings-facts">
                <div>
                  <dt>{t.settings.general.openLinksBehavior}</dt>
                  <dd>{settings?.general.openLinksBehavior ?? 'confirm-if-untrusted'}</dd>
                </div>
              </dl>
              <p className="settings-note">{t.settings.general.note}</p>
            </section>
          ) : null}

          {activeSection === 'AI Providers' ? (
            <section className="settings-card">
              <h2>{t.settings.aiProviders.title}</h2>
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
                <span>{t.settings.aiProviders.enableOpenAiChat}</span>
              </label>
              <label className="settings-field">
                <span>{t.settings.aiProviders.openAiModel}</span>
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
                <span>{t.settings.aiProviders.openAiBaseUrl}</span>
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
                <span>{t.settings.aiProviders.openAiApiKey}</span>
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
                  {isSavingOpenAi ? t.common.saving : t.settings.aiProviders.saveOpenAiSettings}
                </button>
                <button type="button" className="settings-secondary-button" onClick={handleOpenAiApiKeySave} disabled={isSavingOpenAiApiKey}>
                  {isSavingOpenAiApiKey ? t.common.saving : t.settings.aiProviders.saveApiKey}
                </button>
                <button type="button" className="settings-secondary-button" onClick={handleOpenAiApiKeyClear} disabled={isSavingOpenAiApiKey}>
                  {t.settings.aiProviders.clearStoredKey}
                </button>
              </div>
              <dl className="settings-facts">
                <div>
                  <dt>{t.settings.aiProviders.openAiEnabled}</dt>
                  <dd>{settings?.ai.openai.enabled ? t.common.yes : t.common.no}</dd>
                </div>
                <div>
                  <dt>{t.settings.aiProviders.openAiConfigured}</dt>
                  <dd>{providerStatus?.openaiConfigured ? t.common.yes : t.common.no}</dd>
                </div>
                <div>
                  <dt>{t.settings.aiProviders.openAiModel}</dt>
                  <dd>{settings?.ai.openai.model ?? 'gpt-5.4-mini'}</dd>
                </div>
                <div>
                  <dt>{t.settings.aiProviders.openAiBaseUrl}</dt>
                  <dd className="settings-break">{settings?.ai.openai.baseUrl ?? t.settings.aiProviders.openAiBaseUrlFallback}</dd>
                </div>
                <div>
                  <dt>{t.settings.aiProviders.tavilyEnabled}</dt>
                  <dd>{settings?.ai.tavily.enabled ? t.common.yes : t.common.no}</dd>
                </div>
                <div>
                  <dt>{t.settings.aiProviders.tavilyConfigured}</dt>
                  <dd>{providerStatus?.tavilyConfigured ? t.common.yes : t.common.no}</dd>
                </div>
              </dl>
              <p className="settings-note">{t.settings.aiProviders.openAiNote}</p>

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
                <span>{t.settings.aiProviders.enableTavily}</span>
              </label>
              <label className="settings-field">
                <span>{t.settings.aiProviders.tavilySearchDepth}</span>
                <select
                  value={tavilyDraft.defaultSearchDepth}
                  onChange={(event) => {
                    setTavilyDraft((currentDraft) => ({
                      ...currentDraft,
                      defaultSearchDepth: event.target.value === 'advanced' ? 'advanced' : 'basic',
                    }))
                  }}
                >
                  <option value="basic">{t.settings.aiProviders.basic}</option>
                  <option value="advanced">{t.settings.aiProviders.advanced}</option>
                </select>
              </label>
              <label className="settings-field">
                <span>{t.settings.aiProviders.tavilyMaxResults}</span>
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
                <span>{t.settings.aiProviders.tavilyApiKey}</span>
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
                  {isSavingTavily ? t.common.saving : t.settings.aiProviders.saveTavilySettings}
                </button>
                <button type="button" className="settings-secondary-button" onClick={handleTavilyApiKeySave} disabled={isSavingTavilyApiKey}>
                  {isSavingTavilyApiKey ? t.common.saving : t.settings.aiProviders.saveTavilyKey}
                </button>
                <button type="button" className="settings-secondary-button" onClick={handleTavilyApiKeyClear} disabled={isSavingTavilyApiKey}>
                  {t.settings.aiProviders.clearTavilyKey}
                </button>
              </div>
              <p className="settings-note">{t.settings.aiProviders.tavilyNote}</p>
            </section>
          ) : null}

          {activeSection === 'Safety' ? (
            <section className="settings-card">
              <h2>{t.settings.safety.title}</h2>
              <div className="settings-subsection">
                <h3>{t.settings.safety.aiToolPermissions}</h3>
                <label className="settings-toggle">
                  <input type="checkbox" checked={settings?.ai.toolPermissions.readActiveDocument ?? true} onChange={(event) => handleToolPermissionChange('readActiveDocument', event.target.checked)} />
                  <span>{t.settings.safety.readActiveDocument}</span>
                </label>
                <label className="settings-toggle">
                  <input type="checkbox" checked={settings?.ai.toolPermissions.readActiveSelection ?? true} onChange={(event) => handleToolPermissionChange('readActiveSelection', event.target.checked)} />
                  <span>{t.settings.safety.readActiveSelection}</span>
                </label>
                <label className="settings-toggle">
                  <input type="checkbox" checked={settings?.ai.toolPermissions.writeActiveDocument ?? true} onChange={(event) => handleToolPermissionChange('writeActiveDocument', event.target.checked)} />
                  <span>{t.settings.safety.writeActiveDocument}</span>
                </label>
                <label className="settings-toggle">
                  <input type="checkbox" checked={settings?.ai.toolPermissions.writeActiveSelection ?? true} onChange={(event) => handleToolPermissionChange('writeActiveSelection', event.target.checked)} />
                  <span>{t.settings.safety.writeActiveSelection}</span>
                </label>
                <label className="settings-toggle">
                  <input type="checkbox" checked={settings?.ai.toolPermissions.writeNewDocument ?? true} onChange={(event) => handleToolPermissionChange('writeNewDocument', event.target.checked)} />
                  <span>{t.settings.safety.createNewDocument}</span>
                </label>
                <label className="settings-toggle">
                  <input type="checkbox" checked={settings?.ai.toolPermissions.sliceSearch ?? true} onChange={(event) => handleToolPermissionChange('sliceSearch', event.target.checked)} />
                  <span>{t.settings.safety.sliceTools}</span>
                </label>
                <label className="settings-toggle">
                  <input type="checkbox" checked={settings?.ai.toolPermissions.workspaceGrep ?? true} onChange={(event) => handleToolPermissionChange('workspaceGrep', event.target.checked)} />
                  <span>{t.settings.safety.workspaceGrep}</span>
                </label>
                <label className="settings-toggle">
                  <input type="checkbox" checked={settings?.ai.toolPermissions.tavilyWebSearch ?? true} onChange={(event) => handleToolPermissionChange('tavilyWebSearch', event.target.checked)} />
                  <span>{t.settings.safety.tavilyWebSearch}</span>
                </label>
                <label className="settings-toggle">
                  <input type="checkbox" checked={settings?.ai.toolPermissions.fetchUrl ?? true} onChange={(event) => handleToolPermissionChange('fetchUrl', event.target.checked)} />
                  <span>{t.settings.safety.allowFetchUrl}</span>
                </label>
                <div className="settings-actions">
                  <button type="button" className="settings-secondary-button" onClick={handleOpenFetchPermissionsWindow}>
                    {t.settings.safety.openFetchPermissionsWindow}
                  </button>
                </div>
              </div>
              <div className="settings-subsection">
                <h3>{t.settings.safety.confirmations}</h3>
                <label className="settings-toggle">
                  <input type="checkbox" checked={settings?.safety.confirmBeforeFullDocumentOverwrite ?? true} onChange={(event) => handleSafetyChange('confirmBeforeFullDocumentOverwrite', event.target.checked)} />
                  <span>{t.settings.safety.confirmFullOverwrite}</span>
                </label>
                <label className="settings-toggle">
                  <input type="checkbox" checked={settings?.safety.confirmBeforeNewDocumentFromAi ?? true} onChange={(event) => handleSafetyChange('confirmBeforeNewDocumentFromAi', event.target.checked)} />
                  <span>{t.settings.safety.confirmNewAiDocument}</span>
                </label>
                <label className="settings-toggle">
                  <input type="checkbox" checked={settings?.safety.confirmBeforeExternalUrlOpen ?? true} onChange={(event) => handleSafetyChange('confirmBeforeExternalUrlOpen', event.target.checked)} />
                  <span>{t.settings.safety.confirmExternalUrlOpen}</span>
                </label>
              </div>
              <dl className="settings-facts">
                <div>
                  <dt>{t.settings.safety.externalUrlConfirm}</dt>
                  <dd>{settings?.safety.confirmBeforeExternalUrlOpen ? t.common.enabled : t.common.disabled}</dd>
                </div>
              </dl>
              <p className="settings-note">{t.settings.safety.note}</p>
            </section>
          ) : null}

          {activeSection === 'Advanced' ? (
            <section className="settings-card">
              <h2>{t.settings.advancedSection.title}</h2>
              <dl className="settings-facts">
                <div>
                  <dt>{t.settings.advancedSection.appVersion}</dt>
                  <dd>{appMetadata?.version ?? 'unknown'}</dd>
                </div>
                <div>
                  <dt>{t.settings.advancedSection.releaseTag}</dt>
                  <dd>{appMetadata?.releaseTag ?? 'unknown'}</dd>
                </div>
                <div>
                  <dt>{t.settings.advancedSection.platform}</dt>
                  <dd>{appMetadata?.platform ?? window.mdvDesktop?.platform ?? 'unknown'}</dd>
                </div>
                <div>
                  <dt>{t.settings.advancedSection.schemaVersion}</dt>
                  <dd>{settings?.version ?? 1}</dd>
                </div>
                <div>
                  <dt>{t.settings.advancedSection.logPath}</dt>
                  <dd className="settings-break">{logPath}</dd>
                </div>
              </dl>
              <div className="settings-subsection">
                <h3>{t.settings.advancedSection.updatesTitle}</h3>
                {!isUpdaterConfigEditable ? <p className="settings-note">{t.settings.advancedSection.updatesReadOnly}</p> : null}
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={updateDraft.enabled}
                    disabled={!isUpdaterConfigEditable}
                    onChange={(event) => {
                      setUpdateDraft((currentDraft) => ({
                        ...currentDraft,
                        enabled: event.target.checked,
                      }))
                    }}
                  />
                  <span>{t.settings.advancedSection.updateEnabled}</span>
                </label>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={updateDraft.autoCheckOnLaunch}
                    disabled={!isUpdaterConfigEditable}
                    onChange={(event) => {
                      setUpdateDraft((currentDraft) => ({
                        ...currentDraft,
                        autoCheckOnLaunch: event.target.checked,
                      }))
                    }}
                  />
                  <span>{t.settings.advancedSection.autoCheckOnLaunch}</span>
                </label>
                <label className="settings-field settings-field-wide">
                  <span>{t.settings.advancedSection.feedUrl}</span>
                  <input
                    type="url"
                    value={updateDraft.feedUrl}
                    placeholder="https://github.com/owner/repo/releases/latest/download"
                    disabled={!isUpdaterConfigEditable}
                    onChange={(event) => {
                      setUpdateDraft((currentDraft) => ({
                        ...currentDraft,
                        feedUrl: event.target.value,
                      }))
                    }}
                  />
                </label>
                <div className="settings-actions">
                  <button type="button" className="settings-primary-button" onClick={handleUpdateSettingsSave} disabled={isSavingUpdates || !isUpdaterConfigEditable}>
                    {isSavingUpdates ? t.common.saving : t.settings.advancedSection.saveUpdateSettings}
                  </button>
                </div>
                <p className="settings-note">{t.settings.advancedSection.updatesNote}</p>
                <dl className="settings-facts">
                  <div>
                    <dt>{t.settings.advancedSection.updaterStatus}</dt>
                    <dd>{getUpdaterStatusLabel(updaterState)}</dd>
                  </div>
                  <div>
                    <dt>{t.settings.advancedSection.availableVersion}</dt>
                    <dd>{updaterState?.availableVersion ?? t.common.unavailable}</dd>
                  </div>
                  <div>
                    <dt>{t.settings.advancedSection.downloadedVersion}</dt>
                    <dd>{updaterState?.downloadedVersion ?? t.common.unavailable}</dd>
                  </div>
                  <div>
                    <dt>{t.settings.advancedSection.progress}</dt>
                    <dd>{typeof updaterState?.progressPercent === 'number' ? `${Math.round(updaterState.progressPercent)}%` : t.common.unavailable}</dd>
                  </div>
                </dl>
              </div>
              <p className="settings-note">{t.settings.advancedSection.note}</p>
            </section>
          ) : null}
        </div>
      </section>
    </main>
  )
}

export default SettingsApp