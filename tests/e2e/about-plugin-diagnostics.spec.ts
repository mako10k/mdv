import { expect, test } from '@playwright/test'

test('About shows bounded Plugin diagnostics and labels all declarations non-executable', async ({ page }) => {
  const pageErrors: Error[] = []
  page.on('pageerror', (error) => pageErrors.push(error))

  await page.addInitScript(() => {
    const settings = {
      general: {
        locale: 'en',
        themeMode: 'light',
      },
    }

    Object.defineProperty(window, 'mdvDesktop', {
      configurable: true,
      value: {
        platform: 'linux',
        log: () => {},
        getAppMetadata: async () => ({
          productName: 'MarkDownViewer',
          version: '0.2.3',
          releaseTag: 'v0.2.3',
          platform: 'linux',
          aiModels: {
            defaultModelId: 'gpt-5.6-terra',
            selectedModelId: 'gpt-5.6-terra',
            registryVersion: 'fixture',
            updatedAt: '2026-08-25',
            selectedModelKnown: true,
            models: [],
          },
        }),
        getLogPath: async () => '/tmp/mdv.log',
        updater: {
          getState: async () => ({
            supported: false,
            enabled: false,
            configured: false,
            feedUrl: null,
            status: 'unsupported',
            currentVersion: '0.2.3',
            availableVersion: null,
            downloadedVersion: null,
            checkedAt: null,
            progressPercent: null,
            error: null,
          }),
          onStateChanged: () => () => {},
        },
        plugins: {
          getDiagnostics: async () => ({
            contractVersion: 1,
            hostVersion: '0.2.3',
            packages: [{
              catalogId: 'sample',
              packageId: 'dev.mdv.sample',
              displayName: 'Sample Plugin Metadata',
              version: '0.1.0',
              origin: 'bundled',
              status: 'ready',
              packageDigestSha256: 'a'.repeat(64),
              capabilities: [{
                id: 'dev.mdv.sample.codeblock',
                family: 'codeblock',
                version: 1,
                availability: 'declared',
                executable: false,
                loaded: false,
              }],
              skills: [{
                id: 'dev.mdv.sample.workflow',
                family: 'skill',
                version: '0.1.0',
                availability: 'declared',
                executable: false,
                loaded: false,
              }],
              diagnostics: [],
            }],
          }),
        },
        settings: {
          getBootstrapSettings: () => ({
            settings,
            hasPersistedSettings: true,
            hasReadableSettings: true,
            hasInitialLaunchRequest: false,
            initialPanel: 'write',
          }),
          onSettingsChanged: () => () => {},
        },
      },
    })
  })

  await page.goto('/about.html')

  await expect(page.getByRole('heading', { name: 'Plugin metadata inspection' })).toBeVisible()
  await expect(page.getByText('No Plugin capability or Skill is installed, loaded, or executable.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Sample Plugin Metadata' })).toBeVisible()
  await expect(page.getByText('metadata OK (not loaded)')).toBeVisible()

  await page.getByText('Developer details').click()

  await expect(page.getByText('metadata only, not executable')).toBeVisible()
  await expect(page.getByText('metadata only, not loaded or executable')).toBeVisible()
  await expect(page.getByText('/tmp/mdv.log')).toBeVisible()
  await expect(page.locator('.about-plugin-diagnostics')).not.toContainText('/private/')
  expect(pageErrors.map((error) => error.message)).toEqual([])
})
