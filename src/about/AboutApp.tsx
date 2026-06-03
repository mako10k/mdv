import { useEffect, useState } from 'react'
import { useI18n } from '../shared/i18n'

function AboutApp() {
  const { t } = useI18n()
  const [appMetadata, setAppMetadata] = useState<MdvAppMetadata | null>(null)
  const [logPath, setLogPath] = useState<string>(t.common.unavailable)

  useEffect(() => {
    document.title = t.about.title
  }, [t])

  useEffect(() => {
    void Promise.all([
      window.mdvDesktop?.getAppMetadata(),
      window.mdvDesktop?.getLogPath(),
    ]).then(([nextAppMetadata, nextLogPath]) => {
      setAppMetadata(nextAppMetadata ?? null)
      setLogPath(nextLogPath ?? t.common.unavailable)
    })
  }, [t.common.unavailable])

  return (
    <main className="settings-shell about-shell">
      <header className="settings-header">
        <div>
          <p className="settings-eyebrow">{t.about.eyebrow}</p>
          <h1>{t.about.title}</h1>
          <p className="settings-subtitle">{t.about.subtitle}</p>
        </div>
        <div className="settings-status">{appMetadata?.releaseTag ?? 'v?'}</div>
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
            <dt>{t.about.logPath}</dt>
            <dd className="settings-break">{logPath}</dd>
          </div>
        </dl>

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
