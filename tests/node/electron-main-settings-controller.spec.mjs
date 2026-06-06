import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createSettingsController } = require('../../electron/lib/main/settings-controller.cjs')

function createController() {
  return createSettingsController({
    settingsPath: '/tmp/settings.json',
    secretsPath: '/tmp/secrets.json',
    defaultOpenAiModel: 'gpt-5.4-mini',
    defaultUpdateFeedUrl: 'https://updates.example.com',
    appLocale: 'ja-JP',
    createDefaultFetchAclText: () => 'allow https://example.com/*',
    migrateLegacyFetchConfig: () => 'allow https://legacy.example.com/*',
    assertSafeFetchAclText: (text) => typeof text === 'string' && text.trim().length > 0 ? text : 'allow https://example.com/*',
    DEFAULT_FETCH_REQUEST_TIMEOUT_MS: 15000,
    DEFAULT_FETCH_IDLE_TIMEOUT_MS: 5000,
    DEFAULT_FETCH_AUTO_DISPOSE_AFTER_MS: 900000,
    DEFAULT_FETCH_MAX_RESPONSE_BYTES: 524288,
    writeLog: () => {},
  })
}

test('createDefaultSettings reflects locale and defaults', () => {
  const controller = createController()
  const settings = controller.createDefaultSettings()

  assert.equal(settings.general.locale, 'ja')
  assert.equal(settings.general.themeMode, 'system')
  assert.equal(settings.ai.openai.model, 'gpt-5.4-mini')
  assert.equal(settings.updates.feedUrl, 'https://updates.example.com')
})

test('sanitizeSettings clamps and normalizes invalid values', () => {
  const controller = createController()
  const settings = controller.sanitizeSettings({
    general: {
      locale: 'fr-FR',
      themeMode: 'sepia',
      defaultStartPanel: 'other',
      openLinksBehavior: 'allow-all',
    },
    editor: {
      initialEditType: 'wysiwyg',
      previewStyle: 'side-by-side',
      fontSizePx: 100,
    },
    ai: {
      chatFontSizePx: 1,
      defaultWriteMode: 'suggest',
      tavily: {
        defaultSearchDepth: 'advanced',
        defaultMaxResults: 99,
      },
      fetch: {
        requestTimeoutMs: 999999,
        idleTimeoutMs: 50,
        autoDisposeAfterMs: 1,
        maxResponseBytes: 99_999_999,
      },
    },
    updates: {
      feedUrl: 'ftp://invalid.example.com',
    },
  })

  assert.equal(settings.general.locale, 'en')
  assert.equal(settings.general.themeMode, 'system')
  assert.equal(settings.general.defaultStartPanel, 'write')
  assert.equal(settings.general.openLinksBehavior, 'confirm-if-untrusted')
  assert.equal(settings.editor.initialEditType, 'wysiwyg')
  assert.equal(settings.editor.previewStyle, 'tab')
  assert.equal(settings.editor.fontSizePx, 18)
  assert.equal(settings.ai.chatFontSizePx, 11)
  assert.equal(settings.ai.defaultWriteMode, 'suggest')
  assert.equal(settings.ai.tavily.defaultSearchDepth, 'advanced')
  assert.equal(settings.ai.tavily.defaultMaxResults, 10)
  assert.equal(settings.ai.fetch.requestTimeoutMs, 120000)
  assert.equal(settings.ai.fetch.idleTimeoutMs, 1000)
  assert.equal(settings.ai.fetch.autoDisposeAfterMs, 10000)
  assert.equal(settings.ai.fetch.maxResponseBytes, 4 * 1024 * 1024)
  assert.equal(settings.updates.feedUrl, null)
})

test('sanitizeSecrets trims strings and clears blanks', () => {
  const controller = createController()
  const secrets = controller.sanitizeSecrets({
    openaiApiKey: '  sk-openai  ',
    tavilyApiKey: '   ',
  })

  assert.deepEqual(secrets, {
    openaiApiKey: 'sk-openai',
    tavilyApiKey: null,
  })
})
