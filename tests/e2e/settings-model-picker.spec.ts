import { expect, test } from '@playwright/test'

test('OpenAI model DropDownList offers GPT-5.6 candidates and migrates a legacy selection', async ({ page }) => {
  const pageErrors: Error[] = []
  page.on('pageerror', (error) => {
    pageErrors.push(error)
  })

  await page.addInitScript(() => {
    const settings: MdvSettings = {
      version: 3,
      general: {
        locale: 'en',
        themeMode: 'system',
        defaultStartPanel: 'write',
        openLinksBehavior: 'confirm-if-untrusted',
      },
      editor: {
        initialEditType: 'markdown',
        showModeSwitch: true,
        previewStyle: 'tab',
        fontSizePx: 13,
      },
      ai: {
        defaultWriteMode: 'direct',
        chatFontSizePx: 12,
        toolPermissions: {
          readActiveDocument: true,
          readActiveSelection: true,
          writeActiveDocument: true,
          writeActiveSelection: true,
          writeNewDocument: true,
          sliceSearch: true,
          workspaceGrep: true,
          tavilyWebSearch: true,
          fetchUrl: false,
        },
        openai: {
          enabled: true,
          baseUrl: null,
          model: 'gpt-5.4-mini',
        },
        tavily: {
          enabled: false,
          defaultSearchDepth: 'basic',
          defaultMaxResults: 5,
        },
        fetch: {
          aclText: '',
          requestTimeoutMs: 15_000,
          idleTimeoutMs: 5_000,
          autoDisposeAfterMs: 900_000,
          maxResponseBytes: 524_288,
        },
      },
      safety: {
        confirmBeforeFullDocumentOverwrite: true,
        confirmBeforeNewDocumentFromAi: true,
        confirmBeforeExternalUrlOpen: true,
      },
      updates: {
        enabled: true,
        autoCheckOnLaunch: true,
        feedUrl: null,
      },
    }
    const modelFacts = [
      ['gpt-5.6-sol', 'GPT-5.6 Sol', 5, 0.5, 30, false],
      ['gpt-5.6-terra', 'GPT-5.6 Terra', 2.5, 0.25, 15, true],
      ['gpt-5.6-luna', 'GPT-5.6 Luna', 1, 0.1, 6, false],
    ] as const
    const metadata: MdvAppMetadata = {
      productName: 'MarkDownViewer',
      version: '0.2.0',
      releaseTag: 'v0.2.0',
      platform: 'linux',
      aiModels: {
        defaultModelId: 'gpt-5.6-terra',
        selectedModelId: settings.ai.openai.model,
        registryVersion: '2026-07-13',
        updatedAt: '2026-07-13',
        selectedModelKnown: false,
        models: modelFacts.map(([modelId, displayName, input, cachedInput, output, recommended], index) => ({
          modelId,
          displayName,
          providerId: 'openai',
          family: 'gpt-5.6',
          contextWindowTokens: 1_050_000,
          outputTokenLimit: 128_000,
          status: 'active',
          capabilities: ['responses-api', 'streaming', 'tool-calling', 'reasoning'],
          pricing: {
            input: { per1M: input, currency: 'USD' },
            cachedInput: { per1M: cachedInput, currency: 'USD' },
            output: { per1M: output, currency: 'USD' },
            longContext: {
              aboveInputTokens: 272_000,
              inputMultiplier: 2,
              outputMultiplier: 1.5,
            },
          },
          releaseStageLabel: 'Latest',
          isDefaultCandidate: recommended,
          enabledByDefault: true,
          deprecationNote: null,
          docsUrl: `https://developers.openai.com/api/docs/models/${modelId}`,
          sortOrder: (index + 1) * 10,
          selectable: true,
          recommended,
        })),
      },
    }
    const settingsUpdates: MdvSettingsPatch[] = []

    Object.defineProperty(window, '__mdvModelPickerTest', {
      value: { settingsUpdates },
      configurable: true,
    })
    Object.defineProperty(window, 'mdvDesktop', {
      value: {
        platform: 'linux',
        log: () => {},
        getAppMetadata: async () => metadata,
        getLogPath: async () => '/tmp/mdv.log',
        settings: {
          getBootstrapSettings: () => ({
            settings,
            hasPersistedSettings: true,
            hasReadableSettings: true,
            hasInitialLaunchRequest: false,
            initialPanel: 'write',
          }),
          getSettings: async () => settings,
          getProviderStatus: async () => ({ openaiConfigured: true, tavilyConfigured: false }),
          updateSettings: async (patch: MdvSettingsPatch) => {
            settingsUpdates.push(patch)
            settings.ai.openai = { ...settings.ai.openai, ...patch.ai?.openai }
            return settings
          },
          saveOpenAiApiKey: async () => ({ openaiConfigured: true, tavilyConfigured: false }),
          clearOpenAiApiKey: async () => ({ openaiConfigured: false, tavilyConfigured: false }),
          saveTavilyApiKey: async () => ({ openaiConfigured: true, tavilyConfigured: true }),
          clearTavilyApiKey: async () => ({ openaiConfigured: true, tavilyConfigured: false }),
          onSettingsChanged: () => () => {},
        },
        updater: {
          getState: async () => ({
            supported: false,
            enabled: true,
            configured: false,
            feedUrl: null,
            status: 'unsupported',
            currentVersion: '0.2.0',
            availableVersion: null,
            downloadedVersion: null,
            checkedAt: null,
            progressPercent: null,
            error: null,
          }),
          onStateChanged: () => () => {},
        },
      },
      configurable: true,
    })
  })

  await page.goto('/settings.html')
  expect(pageErrors.map((error) => error.message)).toEqual([])
  await page.getByRole('button', { name: 'AI Providers' }).click()

  const modelSelect = page.getByLabel('OpenAI model')
  await expect(modelSelect).toHaveValue('gpt-5.4-mini')
  await expect(modelSelect.locator('option')).toHaveCount(4)
  await expect(page.getByRole('alert')).toContainText('gpt-5.4-mini')

  await modelSelect.selectOption('gpt-5.6-terra')
  await expect(page.getByRole('alert')).toHaveCount(0)
  const modelSummary = page.locator('.settings-model-summary')
  await expect(modelSummary.getByText('OpenAI', { exact: true })).toBeVisible()
  await expect(modelSummary.getByText('1,050,000 tokens')).toBeVisible()
  await expect(modelSummary.getByText('128,000 tokens')).toBeVisible()
  await expect(modelSummary.getByText('Input $2.50 / cached $0.25 / output $15.00 per 1M tokens')).toBeVisible()
  await expect(modelSummary.getByText('Active / Recommended')).toBeVisible()
  await expect(modelSummary).toContainText('For requests over 272,000 tokens of input')
  await page.getByRole('button', { name: 'Save OpenAI settings' }).click()

  await expect.poll(() => page.evaluate(() => {
    const testState = (window as Window & {
      __mdvModelPickerTest?: { settingsUpdates: MdvSettingsPatch[] }
    }).__mdvModelPickerTest
    return testState?.settingsUpdates.at(-1)?.ai?.openai?.model ?? null
  })).toBe('gpt-5.6-terra')
  expect(pageErrors.map((error) => error.message)).toEqual([])
})
