import { useEffect, useState } from 'react'
import { useI18n } from '../shared/i18n'

function AboutApp() {
  const { t } = useI18n()
  const [appMetadata, setAppMetadata] = useState<MdvAppMetadata | null>(null)
  const [updaterState, setUpdaterState] = useState<MdvUpdaterState | null>(null)
  const [logPath, setLogPath] = useState<string>(t.common.unavailable)
  const [actionText, setActionText] = useState<string>('')

  const getUpdaterStatusLabel = (state: MdvUpdaterState | null) => {
    if (!state) {
      return t.about.updaterIdle
    }

    if (state.status === 'error') {
      return state.error ? `${t.about.updaterError}: ${state.error}` : t.about.updaterError
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
      default:
        return t.about.updaterIdle
    }
  }

  useEffect(() => {
    document.title = t.about.title
  }, [t])

  useEffect(() => {
    void Promise.all([
      window.mdvDesktop?.getAppMetadata(),
      window.mdvDesktop?.updater.getState(),
      window.mdvDesktop?.getLogPath(),
    ]).then(([nextAppMetadata, nextUpdaterState, nextLogPath]) => {
      setAppMetadata(nextAppMetadata ?? null)
      setUpdaterState(nextUpdaterState ?? null)
      setLogPath(nextLogPath ?? t.common.unavailable)
    })

    const unsubscribe = window.mdvDesktop?.updater.onStateChanged((nextUpdaterState) => {
      setUpdaterState(nextUpdaterState)
    })

    return () => {
      unsubscribe?.()
    }
  }, [t.common.unavailable])

  const handleCheckForUpdates = () => {
    setActionText(t.settings.status.checkingForUpdates)

    void window.mdvDesktop?.updater.checkForUpdates()
      .then(() => {
        setActionText('')
      })
      .catch((error: unknown) => {
        setActionText(error instanceof Error ? error.message : String(error))
      })
  }

  const handleDownloadUpdate = () => {
    setActionText(t.settings.status.downloadingUpdate)

    void window.mdvDesktop?.updater.downloadUpdate()
      .then(() => {
        setActionText('')
      })
      .catch((error: unknown) => {
        setActionText(error instanceof Error ? error.message : String(error))
      })
  }

  const handleInstallUpdate = () => {
    setActionText(t.settings.status.installUpdateStarted)

    void window.mdvDesktop?.updater.installUpdate()
      .then((result) => {
        if (!result.started) {
          setActionText(t.about.updaterIdle)
        }
      })
      .catch((error: unknown) => {
        setActionText(error instanceof Error ? error.message : String(error))
      })
  }

  return (
    <main className="settings-shell about-shell">
      <header className="settings-header">
        <div>
          <p className="settings-eyebrow">{t.about.eyebrow}</p>
          <h1>{t.about.title}</h1>
          <p className="settings-subtitle">{t.about.subtitle}</p>
        </div>
        <div className="settings-status">{actionText || appMetadata?.releaseTag || 'v?'}</div>
      </header>

      <section className="settings-card">
        <dl className="settings-facts">
          <div>
            <dt>{t.about.appVersion}</dt>
            <dd>{appMetadata?.version ?? t.common.unavailable}</dd>
          </div>
          <div>
            <dt>{t.about.releaseTag}</dt>
            <dd>{appMetadata?.releaseTag ?? t.common.unavailable}</dd>
          </div>
          <div>
            <dt>{t.about.platform}</dt>
            <dd>{appMetadata?.platform ?? window.mdvDesktop?.platform ?? t.common.unavailable}</dd>
          </div>
          <div>
            <dt>{t.about.versionSource}</dt>
            <dd>{t.about.versionSourceValue}</dd>
          </div>
          <div>
            <dt>{t.about.updateChannel}</dt>
            <dd>{t.about.updateChannelValue}</dd>
          </div>
          <div>
            <dt>{t.about.updateStatus}</dt>
            <dd>{getUpdaterStatusLabel(updaterState)}</dd>
          </div>
          <div>
            <dt>{t.about.updateFeedUrl}</dt>
            <dd className="settings-break">{updaterState?.feedUrl ?? t.common.unavailable}</dd>
          </div>
          <div>
            <dt>{t.about.availableVersion}</dt>
            <dd>{updaterState?.availableVersion ?? t.common.unavailable}</dd>
          </div>
          <div>
            <dt>{t.about.downloadedVersion}</dt>
            <dd>{updaterState?.downloadedVersion ?? t.common.unavailable}</dd>
          </div>
          <div>
            <dt>{t.about.progress}</dt>
            <dd>{typeof updaterState?.progressPercent === 'number' ? `${Math.round(updaterState.progressPercent)}%` : t.common.unavailable}</dd>
          </div>
          <div>
            <dt>{t.about.logPath}</dt>
            <dd className="settings-break">{logPath}</dd>
          </div>
        </dl>

        {updaterState && (!updaterState.supported || updaterState.status === 'error') ? <p className="settings-note">{t.about.disabledActionsNote}</p> : null}
        {updaterState && updaterState.supported && (!updaterState.enabled || !updaterState.configured) ? (
          <p className="settings-note">{getUpdaterStatusLabel(updaterState)}</p>
        ) : null}

        <div className="settings-actions">
          <button type="button" className="settings-primary-button" onClick={handleCheckForUpdates} disabled={!updaterState?.supported || updaterState?.status === 'error' || !updaterState?.enabled || !updaterState?.configured}>
            {t.about.checkForUpdates}
          </button>
          <button type="button" className="settings-secondary-button" onClick={handleDownloadUpdate} disabled={updaterState?.status !== 'update-available'}>
            {t.about.downloadUpdate}
          </button>
          <button type="button" className="settings-secondary-button" onClick={handleInstallUpdate} disabled={updaterState?.status !== 'downloaded'}>
            {t.about.installUpdate}
          </button>
        </div>

        <div className="about-shortcuts">
          <h2>{t.about.shortcutsTitle}</h2>
          <p>{t.about.shortcutsValue}</p>
        </div>

        <p className="settings-note">{t.about.note}</p>
      </section>
    </main>
  )
}

export default AboutApp
