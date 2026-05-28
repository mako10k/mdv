import { useEffect, useRef, useState } from 'react'
import { useDesktopTheme } from '../shared/useDesktopTheme'
import { getTranslations, isLocale, useI18n } from '../shared/i18n'

type FetchDraft = MdvSettings['ai']['fetch']

function toMultilineText(values: string[]): string {
  return values.join('\n')
}

function parseMultilineText(value: string): string[] {
  return Array.from(new Set(value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)))
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
          allowedUrlRules: draft.allowedUrlRules,
          allowedMethods: draft.allowedMethods,
          allowedHeaders: draft.allowedHeaders,
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
          <h2>{t.fetchPermissions.allowlist}</h2>
          <label className="settings-field settings-field-wide">
            <span>{t.fetchPermissions.allowedUrlRules}</span>
            <textarea
              className="fetch-permissions-textarea"
              value={toMultilineText(draft?.allowedUrlRules ?? [])}
              placeholder={'https://example.com/*\nhttps://docs.example.com/api/*'}
              onChange={(event) => {
                setDraft((currentDraft) => currentDraft ? {
                  ...currentDraft,
                  allowedUrlRules: parseMultilineText(event.target.value),
                } : currentDraft)
              }}
            />
          </label>
          <p className="settings-note">{t.fetchPermissions.allowlistNote}</p>

          <label className="settings-field settings-field-wide">
            <span>{t.fetchPermissions.allowedMethods}</span>
            <textarea
              className="fetch-permissions-textarea fetch-permissions-textarea-compact"
              value={toMultilineText(draft?.allowedMethods ?? [])}
              placeholder={'GET\nPOST'}
              onChange={(event) => {
                setDraft((currentDraft) => currentDraft ? {
                  ...currentDraft,
                  allowedMethods: parseMultilineText(event.target.value).map((entry) => entry.toUpperCase()),
                } : currentDraft)
              }}
            />
          </label>

          <label className="settings-field settings-field-wide">
            <span>{t.fetchPermissions.allowedHeaders}</span>
            <textarea
              className="fetch-permissions-textarea fetch-permissions-textarea-compact"
              value={toMultilineText(draft?.allowedHeaders ?? [])}
              placeholder={'accept\nauthorization\ncontent-type'}
              onChange={(event) => {
                setDraft((currentDraft) => currentDraft ? {
                  ...currentDraft,
                  allowedHeaders: parseMultilineText(event.target.value).map((entry) => entry.toLowerCase()),
                } : currentDraft)
              }}
            />
          </label>
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
              <dt>{t.fetchPermissions.allowlistedUrlRules}</dt>
              <dd>{settings?.ai.fetch.allowedUrlRules.length ?? 0}</dd>
            </div>
            <div>
              <dt>{t.fetchPermissions.allowedMethods}</dt>
              <dd>{settings?.ai.fetch.allowedMethods.join(', ') || t.fetchPermissions.none}</dd>
            </div>
            <div>
              <dt>{t.fetchPermissions.allowedHeaders}</dt>
              <dd className="settings-break">{settings?.ai.fetch.allowedHeaders.join(', ') || t.fetchPermissions.none}</dd>
            </div>
          </dl>
        </section>
      </section>
    </main>
  )
}

export default FetchPermissionsApp
