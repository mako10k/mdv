import { expect, test, type Page } from '@playwright/test'

async function computedStyle(page: Page, selector: string, property: keyof CSSStyleDeclaration) {
  return page.locator(selector).evaluate((element, styleProperty) => {
    return getComputedStyle(element)[styleProperty]
  }, property)
}

async function rect(page: Page, selector: string) {
  return page.locator(selector).evaluate((element) => {
    const currentRect = element.getBoundingClientRect()

    return {
      left: currentRect.left,
      right: currentRect.right,
      top: currentRect.top,
      bottom: currentRect.bottom,
      width: currentRect.width,
      height: currentRect.height,
    }
  })
}

async function openAiDock(page: Page) {
  await page.getByRole('button', { name: /AI Chat/ }).click()
  await expect(page.locator('.assistant-dock')).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('startup shows preview as the primary surface', async ({ page }) => {
  await expect(page.locator('.view-switch button').nth(1)).toHaveClass(/active/)
  await expect(page.locator('.outline-panel')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /(レンダリング結果をコピー|Copy rendered output)/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /(文書全体をコピー|Copy full document)/ })).toHaveCount(0)
  await expect(computedStyle(page, '.preview-panel', 'visibility')).resolves.toBe('visible')
  await expect(computedStyle(page, '.editor-panel', 'visibility')).resolves.toBe('hidden')
})

test('editor mode keeps the outline and a non-zero Toast UI surface', async ({ page }) => {
  await page.locator('.view-switch button').nth(0).click()

  await expect(page.locator('.view-switch button').nth(0)).toHaveClass(/active/)
  await expect(page.locator('.outline-panel')).toHaveCount(1)
  await expect(computedStyle(page, '.toastui-editor-md-tab-container', 'display')).resolves.toBe('none')

  const toastRect = await rect(page, '.toastui-editor-defaultUI')
  expect(toastRect.height).toBeGreaterThan(300)
})

test('preview mode with AI dock does not overlap the rendered surface', async ({ page }) => {
  await openAiDock(page)
  await expect(page.locator('.outline-panel')).toHaveCount(0)

  const previewRect = await rect(page, '.preview-panel')
  const assistantRect = await rect(page, '.assistant-dock')

  expect(previewRect.right).toBeLessThanOrEqual(assistantRect.left)
  expect(previewRect.height).toBeGreaterThan(300)
})

test('editor mode with AI dock keeps editor and dock separated', async ({ page }) => {
  await page.locator('.view-switch button').nth(0).click()
  await openAiDock(page)

  await expect(page.locator('.outline-panel')).toHaveCount(1)

  const editorRect = await rect(page, '.editor-panel')
  const assistantRect = await rect(page, '.assistant-dock')
  const toastRect = await rect(page, '.toastui-editor-defaultUI')

  expect(editorRect.right).toBeLessThanOrEqual(assistantRect.left)
  expect(toastRect.height).toBeGreaterThan(300)
})

test.describe('responsive stacked layout', () => {
  test.use({ viewport: { width: 1000, height: 900 } })

  test('narrow layout stacks the AI dock below the editor workspace', async ({ page }) => {
    await page.locator('.view-switch button').nth(0).click()
    await openAiDock(page)

    await expect(page.locator('.outline-panel')).toHaveCount(1)
    await expect(computedStyle(page, '.workspace-body', 'flexDirection')).resolves.toBe('column')

    const panelStackRect = await rect(page, '.panel-stack')
    const assistantRect = await rect(page, '.assistant-dock')

    expect(assistantRect.top).toBeGreaterThanOrEqual(panelStackRect.bottom)
  })
})