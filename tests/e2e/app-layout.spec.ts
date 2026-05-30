import { expect, test, type Page } from '@playwright/test'

const selectAllShortcut = process.platform === 'darwin' ? 'Meta+A' : 'Control+A'
const moveEditorCursorToStartShortcut = process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home'

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

async function openWritePanel(page: Page) {
  await page.locator('.view-switch button').nth(0).click()
  await expect(page.locator('.view-switch button').nth(0)).toHaveClass(/active/)
}

async function replaceMarkdownDocument(page: Page, markdown: string) {
  const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()
  const normalizedEditorText = markdown.replace(/\n+/g, '')

  await editor.click()
  await page.keyboard.press(selectAllShortcut)
  await page.keyboard.press('Backspace')
  await page.keyboard.insertText(markdown)
  await expect(editor).toContainText(normalizedEditorText)
}

async function selectEditorLinesFromStart(page: Page, lineCount: number) {
  const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()

  await editor.click()
  await page.keyboard.press(moveEditorCursorToStartShortcut)
  await page.keyboard.down('Shift')

  for (let index = 0; index < lineCount; index += 1) {
    await page.keyboard.press('ArrowDown')
  }

  await page.keyboard.up('Shift')
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
  await openWritePanel(page)
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
  await openWritePanel(page)
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
    await openWritePanel(page)
    await openAiDock(page)

    await expect(page.locator('.outline-panel')).toHaveCount(1)
    await expect(computedStyle(page, '.workspace-body', 'flexDirection')).resolves.toBe('column')

    const panelStackRect = await rect(page, '.panel-stack')
    const assistantRect = await rect(page, '.assistant-dock')

    expect(assistantRect.top).toBeGreaterThanOrEqual(panelStackRect.bottom)
  })
})

test.describe('find and replace', () => {
  test('clicking a later search result jumps that match into the editor viewport', async ({ page }) => {
    await openWritePanel(page)

    const lines = Array.from({ length: 80 }, (_, index) => `line ${index + 1}`)
    lines[2] = 'target alpha near top'
    lines[70] = 'target alpha near bottom'

    await replaceMarkdownDocument(page, `# Jump Check\n\n${lines.join('\n')}\n`)

    await page.getByPlaceholder(/(エディタ内を検索|Search in editor)/).fill('alpha')
    await page.getByRole('button', { name: /(検索を実行|Run search)/ }).click()

    const bottomTarget = page.locator('.toastui-editor-md-container').getByText('target alpha near bottom', { exact: true }).first()
    const editorPanel = page.locator('.editor-panel').first()
    const targetRectBefore = await bottomTarget.boundingBox()
    const panelRect = await editorPanel.boundingBox()

    expect(targetRectBefore).not.toBeNull()
    expect(panelRect).not.toBeNull()

    await page.locator('.editor-search-result').nth(1).click()

    const targetRectAfter = await bottomTarget.boundingBox()

    expect(targetRectAfter).not.toBeNull()
    expect(targetRectBefore!.y).toBeGreaterThan(panelRect!.y + panelRect!.height)
    expect(targetRectAfter!.y).toBeGreaterThanOrEqual(panelRect!.y)
    expect(targetRectAfter!.y + targetRectAfter!.height).toBeLessThanOrEqual(panelRect!.y + panelRect!.height)
  })

  test('replace all updates the document and rendered preview', async ({ page }) => {
    await openWritePanel(page)
    await replaceMarkdownDocument(page, '# Find Replace\n\nalpha beta alpha\n')

    await page.getByPlaceholder(/(エディタ内を検索|Search in editor)/).fill('alpha')
    await page.getByPlaceholder(/(置換文字列|Replace text)/).fill('omega')
    await page.getByRole('button', { name: /(検索を実行|Run search)/ }).click()

    await expect(page.locator('.editor-search-count')).toHaveText('1/2')

    await page.getByRole('button', { name: /(すべての結果を置換|Replace all results)/ }).click()
    await expect(page.locator('.editor-search-count')).toHaveText('0')

    await page.locator('.view-switch button').nth(1).click()
    await expect(page.locator('.preview-panel')).toContainText('omega beta omega')
  })

  test('match case limits replacements to the matching case only', async ({ page }) => {
    await openWritePanel(page)
    await replaceMarkdownDocument(page, '# Match Case\n\nAlpha alpha ALPHA\n')

    await page.getByPlaceholder(/(エディタ内を検索|Search in editor)/).fill('Alpha')
    await page.getByPlaceholder(/(置換文字列|Replace text)/).fill('omega')
    await page.getByRole('button', { name: /(大文字小文字を区別|Match case)/ }).click()
    await page.getByRole('button', { name: /(検索を実行|Run search)/ }).click()

    await expect(page.locator('.editor-search-count')).toHaveText('1/1')

    await page.getByRole('button', { name: /(すべての結果を置換|Replace all results)/ }).click()
    await page.locator('.view-switch button').nth(1).click()

    await expect(page.locator('.preview-panel')).toContainText('omega alpha ALPHA')
  })

  test('replace all in selection keeps using the original selected scope', async ({ page }) => {
    await openWritePanel(page)
    await replaceMarkdownDocument(page, '# Selection Scope\n\nalpha inside one\nmid line\nalpha inside two\nmid line\nalpha outside\n')
    await selectEditorLinesFromStart(page, 5)

    await page.getByPlaceholder(/(エディタ内を検索|Search in editor)/).fill('alpha')
    await page.getByPlaceholder(/(置換文字列|Replace text)/).fill('omega')
    await page.getByRole('button', { name: /(選択範囲内だけを検索|Search only in current selection)/ }).click()
    await page.getByRole('button', { name: /(検索を実行|Run search)/ }).click()

    await expect(page.locator('.editor-search-count')).toHaveText('1/2')

    await page.getByRole('button', { name: /(すべての結果を置換|Replace all results)/ }).click()
    await page.locator('.view-switch button').nth(1).click()

    await expect(page.locator('.preview-panel')).toContainText('omega inside one')
    await expect(page.locator('.preview-panel')).toContainText('omega inside two')
    await expect(page.locator('.preview-panel')).toContainText('alpha outside')
  })

  test('changing search conditions clears stale results before replace can reuse them', async ({ page }) => {
    await openWritePanel(page)
    await replaceMarkdownDocument(page, '# Search State\n\nalpha beta alpha\n')

    await page.getByPlaceholder(/(エディタ内を検索|Search in editor)/).fill('alpha')
    await page.getByRole('button', { name: /(検索を実行|Run search)/ }).click()
    await expect(page.locator('.editor-search-count')).toHaveText('1/2')

    await page.getByPlaceholder(/(エディタ内を検索|Search in editor)/).fill('beta')

    await expect(page.locator('.editor-search-count')).toHaveText('0')
    await expect(page.locator('.editor-search-results')).toHaveCount(0)
  })
})