import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createSettingsController } = require('../../electron/lib/main/settings-controller.cjs')

function createController() {
  return createSettingsController({
    settingsPath: '/tmp/settings.json',
    secretsPath: '/tmp/secrets.json',
    defaultOpenAiModel: 'gpt-5.6-terra',
    isSelectableOpenAiModel: (modelId) => ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'].includes(modelId),
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
  assert.equal(settings.ai.openai.model, 'gpt-5.6-terra')
  assert.equal(settings.updates.feedUrl, 'https://updates.example.com')
})

test('settings keep a legacy model on load but reject it as a new update', () => {
  const controller = createController()
  const legacySettings = controller.sanitizeSettings({
    ai: {
      openai: {
        enabled: true,
        model: 'gpt-5.4-mini',
      },
    },
  })

  assert.equal(legacySettings.ai.openai.model, 'gpt-5.4-mini')
  assert.doesNotThrow(() => controller.assertValidSettingsUpdate({
    ai: { openai: { model: 'gpt-5.6-sol' } },
  }))
  assert.throws(() => controller.assertValidSettingsUpdate({
    ai: { openai: { model: 'gpt-5.4-mini' } },
  }), /model registry/)
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

test('typography adjustment applies typed delta and reset operations', () => {
  const controller = createController()
  const settings = controller.createDefaultSettings()
  const editorResult = controller.adjustTypographySettings(settings, {
    target: 'editor',
    kind: 'delta',
    steps: 2,
  })
  const chatSettings = controller.sanitizeSettings({
    ...editorResult.settings,
    ai: {
      ...editorResult.settings.ai,
      chatFontSizePx: 16,
    },
  })
  const chatResult = controller.adjustTypographySettings(chatSettings, {
    target: 'chat',
    kind: 'reset',
  })

  assert.equal(editorResult.changed, true)
  assert.equal(editorResult.target, 'editor')
  assert.equal(editorResult.valuePx, 15)
  assert.equal(editorResult.settings.editor.fontSizePx, 15)
  assert.equal(chatResult.changed, true)
  assert.equal(chatResult.valuePx, 12)
  assert.equal(chatResult.settings.ai.chatFontSizePx, 12)
})

test('typography adjustment reports bounds as a no-op', () => {
  const controller = createController()
  const settings = controller.sanitizeSettings({ editor: { fontSizePx: 18 } })
  const result = controller.adjustTypographySettings(settings, {
    target: 'editor',
    kind: 'delta',
    steps: 1,
  })

  assert.equal(result.changed, false)
  assert.equal(result.valuePx, 18)
  assert.equal(result.settings, settings)
})

test('typography adjustment rejects mixed or invalid payloads', () => {
  const controller = createController()
  const settings = controller.createDefaultSettings()

  assert.throws(() => controller.adjustTypographySettings(settings, {
    target: 'editor',
    kind: 'reset',
    steps: 1,
  }), /must not include steps/)
  assert.throws(() => controller.adjustTypographySettings(settings, {
    target: 'chat',
    kind: 'delta',
    steps: 0,
  }), /non-zero integer/)
  assert.throws(() => controller.adjustTypographySettings(settings, {
    target: 'outline',
    kind: 'delta',
    steps: 1,
  }), /target/)
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

test('getProviderStatus treats environment fallback keys as configured', () => {
  const previousOpenAiApiKey = process.env.OPENAI_API_KEY
  const previousTavilyApiKey = process.env.TAVILY_API_KEY

  process.env.OPENAI_API_KEY = 'env-openai-key'
  process.env.TAVILY_API_KEY = 'env-tavily-key'

  try {
    const controller = createController()

    assert.deepEqual(controller.getProviderStatus(), {
      openaiConfigured: true,
      tavilyConfigured: true,
    })
  } finally {
    if (typeof previousOpenAiApiKey === 'string') {
      process.env.OPENAI_API_KEY = previousOpenAiApiKey
    } else {
      delete process.env.OPENAI_API_KEY
    }

    if (typeof previousTavilyApiKey === 'string') {
      process.env.TAVILY_API_KEY = previousTavilyApiKey
    } else {
      delete process.env.TAVILY_API_KEY
    }
  }
})
