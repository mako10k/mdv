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

async function selectEditorCharactersFromStart(page: Page, startOffset: number, length: number) {
  const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()

  await editor.click()
  await page.keyboard.press(moveEditorCursorToStartShortcut)

  for (let index = 0; index < startOffset; index += 1) {
    await page.keyboard.press('ArrowRight')
  }

  await page.keyboard.down('Shift')

  for (let index = 0; index < length; index += 1) {
    await page.keyboard.press('ArrowRight')
  }

  await page.keyboard.up('Shift')
}

async function openEditorSearchDialog(page: Page) {
  await page.getByRole('button', { name: /(エディタ内を検索|Search in editor)/ }).click()
  await expect(page.getByRole('dialog', { name: /(エディタ内を検索|Search in editor)/ })).toBeVisible()
}

async function openEditorReplaceDialog(page: Page) {
  await page.evaluate((isMac) => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'h',
      code: 'KeyH',
      bubbles: true,
      cancelable: true,
      ctrlKey: !isMac,
      metaKey: isMac,
    }))
  }, process.platform === 'darwin')
  await expect(page.getByRole('dialog', { name: /(置換文字列|Replace text|エディタ内を置換|Replace in editor)/ })).toBeVisible()
}

async function closeEditorSearchDialog(page: Page) {
  await page.getByRole('button', { name: /(閉じる|Close)/ }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

async function placeEditorCursorFromStart(page: Page, offset: number) {
  const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()

  await editor.click()
  await page.keyboard.press(moveEditorCursorToStartShortcut)

  for (let index = 0; index < offset; index += 1) {
    await page.keyboard.press('ArrowRight')
  }
}

async function switchToastEditorMode(page: Page, mode: 'markdown' | 'wysiwyg') {
  const modeIndex = mode === 'markdown' ? 0 : 1
  const modeTab = page.locator('.toastui-editor-mode-switch .tab-item').nth(modeIndex)

  await modeTab.click()
  await expect(modeTab).toHaveClass(/active/)
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

test('editor mode uses denser outline and editor typography', async ({ page }) => {
  await openWritePanel(page)
  await page.evaluate(() => {
    const panel = document.querySelector('.outline-panel')

    if (!(panel instanceof HTMLElement)) {
      return
    }

    const existingEmpty = panel.querySelector('.outline-empty')
    if (existingEmpty) {
      existingEmpty.remove()
    }

    const list = document.createElement('div')
    list.className = 'outline-list'

    const probe = document.createElement('button')
    probe.type = 'button'
    probe.className = 'outline-item'
    probe.innerHTML = '<span class="outline-item-depth">H2</span><span class="outline-item-label">Synthetic outline item</span>'
    list.appendChild(probe)
    panel.appendChild(list)
  })

  await expect(page.locator('.outline-panel .outline-item')).toBeVisible()

  await expect(computedStyle(page, '.outline-panel-header', 'paddingTop')).resolves.toBe('11px')
  await expect(computedStyle(page, '.outline-list', 'paddingTop')).resolves.toBe('8px')
  await expect(computedStyle(page, '.outline-list', 'rowGap')).resolves.toBe('2px')
  await expect(computedStyle(page, '.outline-panel .outline-item', 'paddingTop')).resolves.toBe('6px')
  await expect(computedStyle(page, '.outline-panel .outline-item', 'paddingBottom')).resolves.toBe('6px')
  await expect(computedStyle(page, '.outline-panel .outline-item-label', 'fontSize')).resolves.toBe('11px')
  await expect(computedStyle(page, '.outline-panel .outline-item-label', 'lineHeight')).resolves.toBe('14.3px')
  await expect(computedStyle(page, '.compact-preview', 'fontSize')).resolves.toBe('13px')
  await expect(computedStyle(page, '.compact-preview', 'lineHeight')).resolves.toBe('21.84px')
})

test('editor mode groups topbar commands and hides the Toast UI toolbar', async ({ page }) => {
  await openWritePanel(page)

  await expect(page.getByRole('button', { name: /(エディタ内を検索|Search in editor)/ })).toBeVisible()
  await expect(page.getByRole('group', { name: /(ファイル操作|File actions)/ })).toBeVisible()
  await expect(page.getByRole('group', { name: /(挿入操作|Insert actions)/ })).toBeVisible()
  await expect(page.getByRole('group', { name: /(出力操作|Output actions)/ })).toBeVisible()
  await expect(page.getByRole('group', { name: /(ワークスペース操作|Workspace actions)/ })).toBeVisible()
  await expect(page.getByTitle(/(テーマ|Theme)/)).toHaveCount(0)
  await expect(page.getByRole('group', { name: /(ファイル操作|File actions)/ }).locator('.icon-button').nth(0)).toHaveAttribute('title', /(新規文書を作成する|Create new document)/)
  await expect(computedStyle(page, '.toastui-editor-toolbar', 'display')).resolves.toBe('none')
})

test('editor search button opens a dialog and save stays disabled until dirty', async ({ page }) => {
  await openWritePanel(page)

  await expect(page.getByRole('button', { name: /(保存|Save)/ })).toBeDisabled()
  await page.getByRole('button', { name: /(エディタ内を検索|Search in editor)/ }).click()
  await expect(page.getByRole('dialog', { name: /(エディタ内を検索|Search in editor)/ })).toBeVisible()

  await replaceMarkdownDocument(page, 'alpha beta\n')
  await expect(page.getByRole('button', { name: /(保存|Save)/ })).toBeEnabled()
})

test('new document button opens an untitled editor document', async ({ page }) => {
  await page.getByRole('group', { name: /(ファイル操作|File actions)/ }).locator('.icon-button').nth(0).click()

  await expect(page.locator('.view-switch button').nth(0)).toHaveClass(/active/)
  await expect.poll(async () => page.title()).toMatch(/(無題\.md|Untitled\.md) - MDV/i)
  await expect(page.locator('.ProseMirror .placeholder').first()).toContainText('MarkDownViewer')
  await expect(page.locator('.preview-scroll-placeholder')).toHaveCount(1)
})

test('preview mode with AI dock does not overlap the rendered surface', async ({ page }) => {
  await openAiDock(page)
  await expect(page.locator('.outline-panel')).toHaveCount(0)

  const previewRect = await rect(page, '.preview-panel')
  const assistantRect = await rect(page, '.assistant-dock')

  expect(previewRect.right).toBeLessThanOrEqual(assistantRect.left)
  expect(previewRect.height).toBeGreaterThan(300)
})

test('preview highlights and scrolls the heading nearest the editor cursor', async ({ page }) => {
  await openWritePanel(page)
  await replaceMarkdownDocument(
    page,
    '# Intro\n\nalpha\n\n## Focus Target\n\nline one\nline two\nline three\n\n## Trailing\n\nomega\n',
  )

  const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()
  await editor.click()
  await page.keyboard.press(moveEditorCursorToStartShortcut)
  for (let index = 0; index < 7; index += 1) {
    await page.keyboard.press('ArrowDown')
  }
  await page.locator('.view-switch button').nth(1).click()
  await expect(page.locator('.view-switch button').nth(1)).toHaveClass(/active/)

  const activeHeading = page.locator('.preview-panel [data-mdv-preview-active="true"]').first()
  await expect(activeHeading).toContainText('Focus Target')

  const previewScrollTop = await page.locator('.preview-scroll').evaluate((element) => element.scrollTop)
  expect(previewScrollTop).toBeGreaterThanOrEqual(0)
})

test('preview H3 and H4 headings reset inline-code chrome', async ({ page }) => {
  await openWritePanel(page)
  await replaceMarkdownDocument(
    page,
    '### Third `Heading`\n\nbody\n\n#### Fourth `Heading`\n\nmore\n',
  )

  await page.locator('.view-switch button').nth(1).click()
  await expect(page.locator('.view-switch button').nth(1)).toHaveClass(/active/)

  await expect(page.locator('.preview-panel .markdown-fragment h3')).toBeVisible()
  await expect(page.locator('.preview-panel .markdown-fragment h4')).toBeVisible()
  await expect(page.locator('.preview-panel .markdown-fragment h3 code')).toBeVisible()
  await expect(page.locator('.preview-panel .markdown-fragment h4 code')).toBeVisible()

  const headingStyles = await page.evaluate(() => {
    const pick = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector)

      if (!element) {
        return null
      }

      const styles = getComputedStyle(element)

      return {
        backgroundColor: styles.backgroundColor,
        borderTopStyle: styles.borderTopStyle,
        borderTopWidth: styles.borderTopWidth,
        paddingTop: styles.paddingTop,
        paddingRight: styles.paddingRight,
        paddingBottom: styles.paddingBottom,
        paddingLeft: styles.paddingLeft,
      }
    }

    return {
      h3: pick('.preview-panel .markdown-fragment h3'),
      h4: pick('.preview-panel .markdown-fragment h4'),
      h3Code: pick('.preview-panel .markdown-fragment h3 code'),
      h4Code: pick('.preview-panel .markdown-fragment h4 code'),
    }
  })

  expect(headingStyles.h3).not.toBeNull()
  expect(headingStyles.h4).not.toBeNull()
  expect(headingStyles.h3Code).not.toBeNull()
  expect(headingStyles.h4Code).not.toBeNull()
  expect(headingStyles.h3?.backgroundColor).toBe('rgba(0, 0, 0, 0)')
  expect(headingStyles.h4?.backgroundColor).toBe('rgba(0, 0, 0, 0)')
  expect(headingStyles.h3?.borderTopStyle).toBe('none')
  expect(headingStyles.h4?.borderTopStyle).toBe('none')
  expect(headingStyles.h3?.borderTopWidth).toBe('0px')
  expect(headingStyles.h4?.borderTopWidth).toBe('0px')
  expect(headingStyles.h3?.paddingTop).toBe('0px')
  expect(headingStyles.h3?.paddingRight).toBe('0px')
  expect(headingStyles.h3?.paddingBottom).toBe('0px')
  expect(headingStyles.h3?.paddingLeft).toBe('0px')
  expect(headingStyles.h4?.paddingTop).toBe('0px')
  expect(headingStyles.h4?.paddingRight).toBe('0px')
  expect(headingStyles.h4?.paddingBottom).toBe('0px')
  expect(headingStyles.h4?.paddingLeft).toBe('0px')
  expect(headingStyles.h3Code?.backgroundColor).toBe('rgba(0, 0, 0, 0)')
  expect(headingStyles.h4Code?.backgroundColor).toBe('rgba(0, 0, 0, 0)')
  expect(headingStyles.h3Code?.borderTopStyle).toBe('none')
  expect(headingStyles.h4Code?.borderTopStyle).toBe('none')
  expect(headingStyles.h3Code?.borderTopWidth).toBe('0px')
  expect(headingStyles.h4Code?.borderTopWidth).toBe('0px')
  expect(headingStyles.h3Code?.paddingTop).toBe('0px')
  expect(headingStyles.h3Code?.paddingRight).toBe('0px')
  expect(headingStyles.h3Code?.paddingBottom).toBe('0px')
  expect(headingStyles.h3Code?.paddingLeft).toBe('0px')
  expect(headingStyles.h4Code?.paddingTop).toBe('0px')
  expect(headingStyles.h4Code?.paddingRight).toBe('0px')
  expect(headingStyles.h4Code?.paddingBottom).toBe('0px')
  expect(headingStyles.h4Code?.paddingLeft).toBe('0px')
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

test('embedded AI chat trims header chrome and uses denser message spacing', async ({ page }) => {
  await openWritePanel(page)
  await openAiDock(page)

  await page.evaluate(() => {
    const transcript = document.querySelector('.assistant-dock .ai-chat-transcript')

    if (!(transcript instanceof HTMLElement)) {
      return
    }

    const bubble = document.createElement('article')
    bubble.className = 'chat-bubble chat-bubble-probe'
    bubble.innerHTML = '<section class="markdown-fragment"><p>Synthetic message</p></section>'
    transcript.appendChild(bubble)

    const toolEntry = document.createElement('article')
    toolEntry.className = 'chat-tool-entry'
    toolEntry.innerHTML = '<div class="chat-tool-content"><pre class="chat-tool-json">{"ok":true}</pre></div>'
    transcript.appendChild(toolEntry)
  })

  await expect(page.locator('.assistant-dock .chat-bubble-probe')).toBeVisible()
  await expect(page.locator('.assistant-dock .chat-tool-json')).toBeVisible()

  await expect(computedStyle(page, '.assistant-dock .ai-chat-eyebrow', 'display')).resolves.toBe('none')
  await expect(computedStyle(page, '.assistant-dock .ai-chat-subtitle', 'display')).resolves.toBe('none')
  await expect(computedStyle(page, '.assistant-dock .ai-chat-header h1', 'fontSize')).resolves.toBe('16.32px')
  await expect(computedStyle(page, '.assistant-dock .ai-chat-shell.embedded', 'paddingTop')).resolves.toBe('8px')
  await expect(computedStyle(page, '.assistant-dock .chat-bubble-probe', 'paddingTop')).resolves.toBe('6px')
  await expect(computedStyle(page, '.assistant-dock .chat-bubble-probe .markdown-fragment p', 'lineHeight')).resolves.toBe('16.8px')
  await expect(computedStyle(page, '.assistant-dock .chat-tool-json', 'fontSize')).resolves.toBe('10px')
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

  await openEditorSearchDialog(page)
    await page.getByPlaceholder(/(エディタ内を検索|Search in editor)/).fill('alpha')
    await page.getByRole('button', { name: /(検索を実行|Run search)/ }).click()
  await closeEditorSearchDialog(page)

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

    await openEditorReplaceDialog(page)
    await page.getByPlaceholder(/(エディタ内を検索|Search in editor)/).fill('alpha')
    await page.getByPlaceholder(/(置換文字列|Replace text)/).fill('omega')
    await page.getByRole('button', { name: /(検索を実行|Run search)/ }).click()

    await expect(page.locator('.editor-search-count')).toHaveText('1/2')

    await page.getByRole('button', { name: /(すべて.*置換|Replace all)/ }).click()
    await expect(page.locator('.editor-search-count')).toHaveText('0')
    await closeEditorSearchDialog(page)

    await page.locator('.view-switch button').nth(1).click()
    await expect(page.locator('.preview-panel')).toContainText('omega beta omega')
  })

  test('match case limits replacements to the matching case only', async ({ page }) => {
    await openWritePanel(page)
    await replaceMarkdownDocument(page, '# Match Case\n\nAlpha alpha ALPHA\n')

    await openEditorReplaceDialog(page)
    await page.getByPlaceholder(/(エディタ内を検索|Search in editor)/).fill('Alpha')
    await page.getByPlaceholder(/(置換文字列|Replace text)/).fill('omega')
    await page.getByRole('button', { name: /(大文字小文字を区別|Match case)/ }).click()
    await page.getByRole('button', { name: /(検索を実行|Run search)/ }).click()

    await expect(page.locator('.editor-search-count')).toHaveText('1/1')

    await page.getByRole('button', { name: /(すべて.*置換|Replace all)/ }).click()
    await closeEditorSearchDialog(page)
    await page.locator('.view-switch button').nth(1).click()

    await expect(page.locator('.preview-panel')).toContainText('omega alpha ALPHA')
  })

  test('replace all in selection keeps using the original selected scope', async ({ page }) => {
    await openWritePanel(page)
    await replaceMarkdownDocument(page, '# Selection Scope\n\nalpha inside one\nmid line\nalpha inside two\nmid line\nalpha outside\n')
    await selectEditorLinesFromStart(page, 5)

    await openEditorReplaceDialog(page)
    await page.getByPlaceholder(/(エディタ内を検索|Search in editor)/).fill('alpha')
    await page.getByPlaceholder(/(置換文字列|Replace text)/).fill('omega')
    await page.getByRole('button', { name: /(選択範囲内だけを検索|Search only in current selection)/ }).click()
    await page.getByRole('button', { name: /(検索を実行|Run search)/ }).click()

    await expect(page.locator('.editor-search-count')).toHaveText('1/2')

    await page.getByRole('button', { name: /(すべて.*置換|Replace all)/ }).click()
    await closeEditorSearchDialog(page)
    await page.locator('.view-switch button').nth(1).click()

    await expect(page.locator('.preview-panel')).toContainText('omega inside one')
    await expect(page.locator('.preview-panel')).toContainText('omega inside two')
    await expect(page.locator('.preview-panel')).toContainText('alpha outside')
  })

  test('changing search conditions clears stale results before replace can reuse them', async ({ page }) => {
    await openWritePanel(page)
    await replaceMarkdownDocument(page, '# Search State\n\nalpha beta alpha\n')

    await openEditorSearchDialog(page)
    await page.getByPlaceholder(/(エディタ内を検索|Search in editor)/).fill('alpha')
    await page.getByRole('button', { name: /(検索を実行|Run search)/ }).click()
    await expect(page.locator('.editor-search-count')).toHaveText('1/2')

    await page.getByPlaceholder(/(エディタ内を検索|Search in editor)/).fill('beta')

    await expect(page.locator('.editor-search-count')).toHaveText('0')
    await expect(page.locator('.editor-search-results')).toHaveCount(0)
  })
})

test.describe('AI chat streaming', () => {
  test('ignores unrelated stream events and applies tool/completed events to the active request only', async ({ page }) => {
    const aiPage = await page.context().newPage()

    await aiPage.addInitScript(() => {
      type TestChatMessage = {
        role: 'user' | 'assistant' | 'tool'
        content: string
        title?: string
      }

      type TestDispatchPayload = {
        requestId: string
        messages: TestChatMessage[]
      }

      type TestSettings = {
        general: {
          locale: 'ja' | 'en'
          themeMode: 'system' | 'light' | 'dark'
        }
        ai: {
          openai: {
            enabled: boolean
          }
          tavily: {
            enabled: boolean
          }
          fetch: {
            enabled: boolean
          }
        }
      }

      type TestStreamEvent =
        | { requestId: string; type: 'text-delta'; delta: string }
        | { requestId: string; type: 'tool-event'; phase: 'call' | 'result'; title: string; content: string }
        | { requestId: string; type: 'completed'; reply: string; model: string; responseId: string | null }

      type TestDesktopApi = {
        platform?: string
        settings?: {
          getBootstrapSettings: () => {
            hasPersistedSettings: boolean
            hasReadableSettings: boolean
            hasInitialLaunchRequest: boolean
            initialPanel: 'write' | 'preview'
            settings: TestSettings
          }
          getSettings: () => Promise<TestSettings>
          onSettingsChanged: (callback: (settings: TestSettings) => void) => () => void
          updateSettings: (patch: Partial<TestSettings>) => Promise<TestSettings>
          migrateLegacyTheme: () => Promise<void>
          getProviderStatus: () => Promise<{ openaiConfigured: boolean; tavilyConfigured: boolean }>
        }
        sendAiChatMessage: (payload: TestDispatchPayload) => Promise<{ status: 'started'; requestId: string }>
        onAiChatStreamEvent: (callback: (event: TestStreamEvent) => void) => () => void
      }

      const baseSettings: TestSettings = {
        general: {
          locale: 'ja',
          themeMode: 'system',
        },
        ai: {
          openai: { enabled: true },
          tavily: { enabled: false },
          fetch: { enabled: false },
        },
      }

      const testWindow = window as Window & { mdvDesktop?: Partial<TestDesktopApi> }
      const existingDesktop = testWindow.mdvDesktop ?? {}
      let streamCallback: ((event: TestStreamEvent) => void) | null = null

      testWindow.mdvDesktop = {
        ...existingDesktop,
        platform: existingDesktop.platform ?? 'test',
        settings: {
          getBootstrapSettings: () => ({
            hasPersistedSettings: false,
            hasReadableSettings: false,
            hasInitialLaunchRequest: false,
            initialPanel: 'preview',
            settings: baseSettings,
          }),
          getSettings: async () => baseSettings,
          onSettingsChanged: () => () => {},
          updateSettings: async () => baseSettings,
          migrateLegacyTheme: async () => {},
          getProviderStatus: async () => ({
            openaiConfigured: true,
            tavilyConfigured: false,
          }),
        },
        sendAiChatMessage: async (payload: TestDispatchPayload) => {
          window.setTimeout(() => {
            streamCallback?.({
              requestId: 'unrelated-request',
              type: 'text-delta',
              delta: 'ignore me',
            })

            streamCallback?.({
              requestId: payload.requestId,
              type: 'text-delta',
              delta: 'Working',
            })

            streamCallback?.({
              requestId: payload.requestId,
              type: 'tool-event',
              phase: 'result',
              title: 'read_selection',
              content: 'Selection loaded',
            })

            streamCallback?.({
              requestId: payload.requestId,
              type: 'completed',
              reply: 'Working reply',
              model: 'gpt-test',
              responseId: 'resp_123',
            })
          }, 0)

          return {
            status: 'started',
            requestId: payload.requestId,
          }
        },
        onAiChatStreamEvent: (callback: (event: TestStreamEvent) => void) => {
          streamCallback = callback
          return () => {
            if (streamCallback === callback) {
              streamCallback = null
            }
          }
        },
      }
    })
    await aiPage.goto('/')

    await openAiDock(aiPage)
    await aiPage.getByPlaceholder(/アシスタントにメッセージを送る|Message the assistant/).fill('Summarize this')
    await aiPage.getByPlaceholder(/アシスタントにメッセージを送る|Message the assistant/).press('Enter')

    await expect(aiPage.getByText('Working reply')).toBeVisible()
    await expect(aiPage.getByText('Selection loaded')).toBeVisible()
    await expect(aiPage.getByText('ignore me')).toHaveCount(0)

    await aiPage.close()
  })
})

test.describe('markdown insert commands', () => {
  test('heading command expands a partial selection to the whole line', async ({ page }) => {
    await openWritePanel(page)
    await replaceMarkdownDocument(page, 'partial line')
    await selectEditorCharactersFromStart(page, 8, 4)

    await page.locator('.topbar').getByRole('button', { name: /(見出しを挿入|Insert heading)/ }).click()

    await expect(page.locator('.toastui-editor-md-container .toastui-editor').first()).toContainText('## partial line')
  })

  test('heading command expands the current line when only the caret is active', async ({ page }) => {
    await openWritePanel(page)
    await replaceMarkdownDocument(page, 'caret line')
    await placeEditorCursorFromStart(page, 5)

    await page.locator('.topbar').getByRole('button', { name: /(見出しを挿入|Insert heading)/ }).click()

    await expect(page.locator('.toastui-editor-md-container .toastui-editor').first()).toContainText('## caret line')
  })

  test('quote command expands the current line when only the caret is active', async ({ page }) => {
    await openWritePanel(page)
    await replaceMarkdownDocument(page, 'quoted line')
    await placeEditorCursorFromStart(page, 6)

    await page.locator('.topbar').getByRole('button', { name: /(引用を挿入|Insert quote)/ }).click()

    await expect(page.locator('.toastui-editor-md-container .toastui-editor').first()).toContainText('> quoted line')
  })

  test('link command wraps the current selection and updates the preview', async ({ page }) => {
    await openWritePanel(page)
    await replaceMarkdownDocument(page, 'wrap me')

    const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()
    await editor.click()
    await page.keyboard.press(selectAllShortcut)
    await page.locator('.topbar').getByRole('button', { name: /(リンクを挿入|Insert link)/ }).click()

    await expect(editor).toContainText('[wrap me](https://example.com)')
    await page.locator('.view-switch button').nth(1).click()
    await expect(page.locator('.preview-panel')).toContainText('wrap me')
    await expect(page.locator('.preview-panel a')).toHaveAttribute('href', 'https://example.com')
  })

  test('image command wraps the current selection and updates the preview image', async ({ page }) => {
    await openWritePanel(page)
    await replaceMarkdownDocument(page, 'diagram alt')

    const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()
    await editor.click()
    await page.keyboard.press(selectAllShortcut)
    await page.locator('.topbar').getByRole('button', { name: /(画像を挿入|Insert image)/ }).click()

    await expect(editor).toContainText('![diagram alt](./image.png)')
    await page.locator('.view-switch button').nth(1).click()
    await expect(page.locator('.preview-panel img')).toHaveAttribute('alt', 'diagram alt')
    await expect(page.locator('.preview-panel img')).toHaveAttribute('src', /image\.png$/)
  })

  test('code block command still inserts fenced Markdown after switching to WYSIWYG mode', async ({ page }) => {
    await openWritePanel(page)
    await replaceMarkdownDocument(page, '# Insert\n\nParagraph\n')
    await switchToastEditorMode(page, 'wysiwyg')

    const wysiwygEditor = page.locator('.toastui-editor-ww-container .ProseMirror').first()
    await wysiwygEditor.click()
    await page.keyboard.press(selectAllShortcut)
    await page.locator('.topbar').getByRole('button', { name: /(コードブロックを挿入|Insert code block)/ }).click()

    await switchToastEditorMode(page, 'markdown')
    await expect(page.locator('.toastui-editor-md-container .toastui-editor').first()).toContainText('```')
  })

  test('footnote command replaces the selection with a marker and appends a definition', async ({ page }) => {
    await openWritePanel(page)
    await replaceMarkdownDocument(page, 'note me')

    const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()
    await editor.click()
    await page.keyboard.press(selectAllShortcut)
    await page.locator('.topbar').getByRole('button', { name: /(脚注を挿入|Insert footnote)/ }).click()

    await expect(editor).toContainText('[^1]')
    await expect(editor).toContainText('[^1]: note me')
  })

  test('horizontal rule command inserts a thematic break on its own block', async ({ page }) => {
    await openWritePanel(page)
    await replaceMarkdownDocument(page, 'before\n\nafter')
    await placeEditorCursorFromStart(page, 6)

    await page.locator('.topbar').getByRole('button', { name: /(水平線を挿入|Insert horizontal rule)/ }).click()

    await expect(page.locator('.toastui-editor-md-container .toastui-editor').first()).toContainText(/before[\s\S]*---[\s\S]*after/)
  })
})