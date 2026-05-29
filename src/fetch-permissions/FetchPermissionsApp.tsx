import { useEffect, useRef, useState } from 'react'
import { useDesktopTheme } from '../shared/useDesktopTheme'
import { getTranslations, isLocale, useI18n } from '../shared/i18n'

type FetchDraft = MdvSettings['ai']['fetch']

const SAMPLE_ACL_TEXT = `*:
  rules:
    - - ALL

https://api.example.com:
  rules:
    - + GET, POST
    - + Header: Content-Type, Accept
    - = Header: X-Client: LLM-Bot
  /public:
    rules:
      - + ALL
  /readonly:
    rules:
      - - POST
      - - Header: Content-Type
  /admin:
    rules:
      - - ALL
  /users:
    rules:
      - = Header: X-Scope: User
    /profile:
      rules:
        - + PUT

https://internal.network.local:
  rules:
    - + ALL
  /secrets:
    rules:
      - - ALL
`

function countAclRuleLines(value: string): number {
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => /^[+\-?=]\s/.test(entry)).length
}

function FetchPermissionsApp() {
  useDesktopTheme()
  const { t } = useI18n()
  const i18nRef = useRef(t)
  const [settings, setSettings] = useState<MdvSettings | null>(null)
  const [statusText, setStatusText] = useState<string>(t.fetchPermissions.loading)
  const [draft, setDraft] = useState<FetchDraft | null>(null)

  useEffect(() => {
    i18nRef.current = t
  })

  useEffect(() => {
    document.title = `MDV ${t.fetchPermissions.title}`
  }, [t])

  useEffect(() => {
    let active = true
    const unsubscribe = window.mdvDesktop?.settings.onSettingsChanged((nextSettings) => {
      if (!active) {
        return
      }

      const nextTranslations = isLocale(nextSettings.general.locale)
        ? getTranslations(nextSettings.general.locale)
        : i18nRef.current

      setSettings(nextSettings)
      setDraft(nextSettings.ai.fetch)
      setStatusText(nextTranslations.fetchPermissions.updated)
    })

    void window.mdvDesktop?.settings.getSettings()
      .then((nextSettings) => {
        if (!active || !nextSettings) {
          return
        }

        setSettings(nextSettings)
        setDraft(nextSettings.ai.fetch)
        setStatusText(i18nRef.current.fetchPermissions.ready)
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

  const handleSave = () => {
    if (!draft) {
      return
    }

    setStatusText(t.fetchPermissions.saving)
    void window.mdvDesktop?.settings.updateSettings({
      ai: {
        fetch: {
          aclText: draft.aclText,
          requestTimeoutMs: draft.requestTimeoutMs,
          idleTimeoutMs: draft.idleTimeoutMs,
          autoDisposeAfterMs: draft.autoDisposeAfterMs,
          maxResponseBytes: draft.maxResponseBytes,
        },
      },
    })
      .then((updatedSettings) => {
        setSettings(updatedSettings)
        setDraft(updatedSettings.ai.fetch)
        setStatusText(t.fetchPermissions.saved)
      })
      .catch((error: unknown) => {
        setStatusText(error instanceof Error ? error.message : String(error))
      })
  }

  return (
    <main className="settings-shell fetch-permissions-shell">
      <header className="settings-header">
        <div>
          <p className="settings-eyebrow">{t.fetchPermissions.eyebrow}</p>
          <h1>{t.fetchPermissions.title}</h1>
          <p className="settings-subtitle">{t.fetchPermissions.subtitle}</p>
        </div>
        <span className="settings-status">{statusText}</span>
      </header>

      <section className="settings-content">
        <section className="settings-card fetch-permissions-card">
          <h2>{t.fetchPermissions.acl}</h2>
          <label className="settings-field settings-field-wide">
            <span>{t.fetchPermissions.aclText}</span>
            <textarea
              className="fetch-permissions-textarea"
              value={draft?.aclText ?? ''}
              placeholder={SAMPLE_ACL_TEXT}
              onChange={(event) => {
                setDraft((currentDraft) => currentDraft ? {
                  ...currentDraft,
                  aclText: event.target.value,
                } : currentDraft)
              }}
            />
          </label>
          <div className="settings-actions">
            <button
              type="button"
              className="settings-secondary-button"
              onClick={() => {
                setDraft((currentDraft) => currentDraft ? {
                  ...currentDraft,
                  aclText: SAMPLE_ACL_TEXT,
                } : currentDraft)
                setStatusText(t.fetchPermissions.sampleLoaded)
              }}
              disabled={!draft}
            >
              {t.fetchPermissions.loadSample}
            </button>
          </div>
          <p className="settings-note">{t.fetchPermissions.aclNote}</p>
          <p className="settings-note">{t.fetchPermissions.pendingNote}</p>
        </section>

        <section className="settings-card fetch-permissions-card">
          <h2>{t.fetchPermissions.timeoutsAndLimits}</h2>
          <label className="settings-field">
            <span>{t.fetchPermissions.totalRequestTimeout}</span>
            <input
              type="number"
              min={1000}
              step={1000}
              value={draft?.requestTimeoutMs ?? 15000}
              onChange={(event) => {
                const numericValue = Number(event.target.value)
                setDraft((currentDraft) => currentDraft ? {
                  ...currentDraft,
                  requestTimeoutMs: Number.isFinite(numericValue) ? numericValue : currentDraft.requestTimeoutMs,
                } : currentDraft)
              }}
            />
          </label>
          <label className="settings-field">
            <span>{t.fetchPermissions.idleTimeout}</span>
            <input
              type="number"
              min={1000}
              step={1000}
              value={draft?.idleTimeoutMs ?? 5000}
              onChange={(event) => {
                const numericValue = Number(event.target.value)
                setDraft((currentDraft) => currentDraft ? {
                  ...currentDraft,
                  idleTimeoutMs: Number.isFinite(numericValue) ? numericValue : currentDraft.idleTimeoutMs,
                } : currentDraft)
              }}
            />
          </label>
          <label className="settings-field">
            <span>{t.fetchPermissions.autoDisposeBuffers}</span>
            <input
              type="number"
              min={10000}
              step={10000}
              value={draft?.autoDisposeAfterMs ?? 900000}
              onChange={(event) => {
                const numericValue = Number(event.target.value)
                setDraft((currentDraft) => currentDraft ? {
                  ...currentDraft,
                  autoDisposeAfterMs: Number.isFinite(numericValue) ? numericValue : currentDraft.autoDisposeAfterMs,
                } : currentDraft)
              }}
            />
          </label>
          <label className="settings-field">
            <span>{t.fetchPermissions.maxResponseBytes}</span>
            <input
              type="number"
              min={16384}
              step={16384}
              value={draft?.maxResponseBytes ?? 524288}
              onChange={(event) => {
                const numericValue = Number(event.target.value)
                setDraft((currentDraft) => currentDraft ? {
                  ...currentDraft,
                  maxResponseBytes: Number.isFinite(numericValue) ? numericValue : currentDraft.maxResponseBytes,
                } : currentDraft)
              }}
            />
          </label>
          <div className="settings-actions">
            <button type="button" className="settings-primary-button" onClick={handleSave} disabled={!draft}>
              {t.fetchPermissions.save}
            </button>
          </div>
          <p className="settings-note">{t.fetchPermissions.safetyNote}</p>
        </section>

        <section className="settings-card fetch-permissions-card">
          <h2>{t.fetchPermissions.currentState}</h2>
          <dl className="settings-facts">
            <div>
              <dt>{t.fetchPermissions.fetchUrlEnabled}</dt>
              <dd>{settings?.ai.toolPermissions.fetchUrl ? t.common.yes : t.common.no}</dd>
            </div>
            <div>
              <dt>{t.fetchPermissions.aclRuleLines}</dt>
              <dd>{countAclRuleLines(settings?.ai.fetch.aclText ?? '')}</dd>
            </div>
            <div>
              <dt>{t.fetchPermissions.aclPreview}</dt>
              <dd className="settings-break">{settings?.ai.fetch.aclText.trim() || t.fetchPermissions.none}</dd>
            </div>
          </dl>
        </section>
      </section>
    </main>
  )
}

export default FetchPermissionsApp
