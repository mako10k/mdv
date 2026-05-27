import { useEffect, useState } from 'react'
import { useDesktopTheme } from '../shared/useDesktopTheme'

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
  const [settings, setSettings] = useState<MdvSettings | null>(null)
  const [statusText, setStatusText] = useState('Loading fetch permissions')
  const [draft, setDraft] = useState<FetchDraft | null>(null)

  useEffect(() => {
    let active = true
    const unsubscribe = window.mdvDesktop?.settings.onSettingsChanged((nextSettings) => {
      if (!active) {
        return
      }

      setSettings(nextSettings)
      setDraft(nextSettings.ai.fetch)
      setStatusText('Fetch permissions updated')
    })

    void window.mdvDesktop?.settings.getSettings()
      .then((nextSettings) => {
        if (!active || !nextSettings) {
          return
        }

        setSettings(nextSettings)
        setDraft(nextSettings.ai.fetch)
        setStatusText('Fetch permissions ready')
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

    setStatusText('Saving fetch permissions')
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
        setStatusText('Fetch permissions saved')
      })
      .catch((error: unknown) => {
        setStatusText(error instanceof Error ? error.message : String(error))
      })
  }

  return (
    <main className="settings-shell fetch-permissions-shell">
      <header className="settings-header">
        <div>
          <p className="settings-eyebrow">MDV Fetch Guardrails</p>
          <h1>Fetch Permissions</h1>
          <p className="settings-subtitle">Configure allowlisted URL rules, explicit methods and headers, and network safety timeouts for fetch_url.</p>
        </div>
        <span className="settings-status">{statusText}</span>
      </header>

      <section className="settings-content">
        <section className="settings-card fetch-permissions-card">
          <h2>Allowlist</h2>
          <label className="settings-field settings-field-wide">
            <span>Allowed URL rules</span>
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
          <p className="settings-note">One rule per line. Reuse patterns from the existing external-link allowlist manually when you want the same host to be fetchable.</p>

          <label className="settings-field settings-field-wide">
            <span>Allowed methods</span>
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
            <span>Allowed headers</span>
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
          <h2>Timeouts And Limits</h2>
          <label className="settings-field">
            <span>Total request timeout (ms)</span>
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
            <span>Idle timeout (ms)</span>
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
            <span>Auto-dispose temp buffers (ms)</span>
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
            <span>Max response bytes</span>
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
              Save fetch permissions
            </button>
          </div>
          <p className="settings-note">Unsafe targets such as localhost, private IP space, embedded credentials, and disallowed redirects are still blocked in main process even when a rule matches.</p>
        </section>

        <section className="settings-card fetch-permissions-card">
          <h2>Current State</h2>
          <dl className="settings-facts">
            <div>
              <dt>fetch_url enabled</dt>
              <dd>{settings?.ai.toolPermissions.fetchUrl ? 'yes' : 'no'}</dd>
            </div>
            <div>
              <dt>Allowlisted URL rules</dt>
              <dd>{settings?.ai.fetch.allowedUrlRules.length ?? 0}</dd>
            </div>
            <div>
              <dt>Allowed methods</dt>
              <dd>{settings?.ai.fetch.allowedMethods.join(', ') || '(none)'}</dd>
            </div>
            <div>
              <dt>Allowed headers</dt>
              <dd className="settings-break">{settings?.ai.fetch.allowedHeaders.join(', ') || '(none)'}</dd>
            </div>
          </dl>
        </section>
      </section>
    </main>
  )
}

export default FetchPermissionsApp
