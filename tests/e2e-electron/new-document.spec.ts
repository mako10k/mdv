import { expect, test } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchElectronApp as launchElectronAppBase } from './support/electron-launch'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control'
const moveEditorCursorToStartShortcut = process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home'

async function makeTempDir(prefix: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

async function launchElectronApp(options: {
  userDataDir: string
  dialogResponses?: {
    messageBox?: Array<{ response: number; checkboxChecked?: boolean }>
  }
}) {
  return launchElectronAppBase({
    repoRoot,
    args: ['.'],
    env: {
      MDV_FORCE_STATIC_RENDERER: '1',
      MDV_E2E_USER_DATA_DIR: options.userDataDir,
      MDV_E2E_DIALOG_RESPONSES: JSON.stringify(options.dialogResponses ?? {}),
    },
  })
}

async function forceCloseApp(app: import('playwright').ElectronApplication) {
  await app
    .evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.destroy()
      }
    })
    .catch(() => {})
}

async function openWritePanel(page: import('@playwright/test').Page) {
  await page.locator('.view-switch button').nth(0).click()
  await expect(page.locator('.view-switch button').nth(0)).toHaveClass(/active/)
}

async function replaceMarkdownDocument(page: import('@playwright/test').Page, markdown: string) {
  const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()

  await editor.click()
  await page.keyboard.press(`${primaryModifier}+A`)
  await page.keyboard.press('Backspace')
  await page.keyboard.insertText(markdown)
}

async function selectEditorCharactersFromStart(page: import('@playwright/test').Page, startOffset: number, length: number) {
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

async function switchToastEditorMode(page: import('@playwright/test').Page, mode: 'markdown' | 'wysiwyg') {
  const modeIndex = mode === 'markdown' ? 0 : 1
  const modeTab = page.locator('.toastui-editor-mode-switch .tab-item').nth(modeIndex)

  await modeTab.click()
  await expect(modeTab).toHaveClass(/active/)
}

async function triggerPrimaryShortcut(page: import('@playwright/test').Page, key: string) {
  await page.evaluate(({ shortcutKey, isMac }) => {
    const event = new KeyboardEvent('keydown', {
      key: shortcutKey,
      bubbles: true,
      cancelable: true,
      ctrlKey: !isMac,
      metaKey: isMac,
    })

    window.dispatchEvent(event)
  }, { shortcutKey: key, isMac: process.platform === 'darwin' })
}

async function expectFreshUntitledDocument(page: import('@playwright/test').Page) {
  await expect(page.locator('.view-switch button').nth(0)).toHaveClass(/active/)
  await expect.poll(async () => page.title()).toMatch(/(無題\.md|Untitled\.md) - MDV/i)
  await expect(page.locator('.toastui-editor-md-container .toastui-editor').first()).not.toContainText('text to replace')
  await expect(page.locator('.editor-sample-placeholder')).toHaveCount(0)
  await expect(page.locator('.preview-scroll-placeholder')).toHaveCount(0)
  await expect(page.locator('.outline-item[disabled]')).toHaveCount(0)
  await expect(page.locator('.outline-empty')).toHaveCount(1)
}

test('Ctrl/Cmd+N opens a fresh untitled editor window', async () => {
  const tempRoot = await makeTempDir('mdv-electron-new-document-')
  const userDataDir = path.join(tempRoot, 'user-data')

  await fs.mkdir(userDataDir, { recursive: true })

  const app = await launchElectronApp({
    userDataDir,
    dialogResponses: {
      messageBox: [{ response: 2 }],
    },
  })

  try {
    const page = await app.firstWindow()

    await openWritePanel(page)
    await replaceMarkdownDocument(page, '# Existing\n\ntext to replace\n')

    const nextWindowPromise = app.waitForEvent('window')
    await triggerPrimaryShortcut(page, 'n')
    const nextPage = await nextWindowPromise

    await expect(page.locator('.toastui-editor-md-container .toastui-editor').first()).toContainText('text to replace')
    await expectFreshUntitledDocument(nextPage)
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }
})

test('File menu click opens a fresh untitled editor window', async () => {
  const tempRoot = await makeTempDir('mdv-electron-new-document-')
  const userDataDir = path.join(tempRoot, 'user-data')

  await fs.mkdir(userDataDir, { recursive: true })

  const app = await launchElectronApp({
    userDataDir,
    dialogResponses: {
      messageBox: [{ response: 2 }],
    },
  })

  try {
    const page = await app.firstWindow()

    await openWritePanel(page)
    await replaceMarkdownDocument(page, '# Existing\n\ntext to replace\n')

    const nextWindowPromise = app.waitForEvent('window')
    await app.evaluate(({ BrowserWindow, Menu }) => {
      const targetWindow = BrowserWindow.getAllWindows()[0]
      const fileMenuIndex = process.platform === 'darwin' ? 1 : 0
      const menuItem = Menu.getApplicationMenu()?.items[fileMenuIndex]?.submenu?.items[0]

      menuItem?.click?.(menuItem, targetWindow, undefined)
    })
    const nextPage = await nextWindowPromise

    await expect(page.locator('.toastui-editor-md-container .toastui-editor').first()).toContainText('text to replace')
    await expectFreshUntitledDocument(nextPage)
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }
})

test('typing into a fresh untitled document clears placeholder-only outline state immediately', async () => {
  const tempRoot = await makeTempDir('mdv-electron-new-document-')
  const userDataDir = path.join(tempRoot, 'user-data')

  await fs.mkdir(userDataDir, { recursive: true })

  const app = await launchElectronApp({
    userDataDir,
  })

  try {
    const page = await app.firstWindow()

    await openWritePanel(page)
    await expectFreshUntitledDocument(page)

    const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()
    await editor.click()
    await page.keyboard.insertText('# Real heading\n')

    await expect(editor).toContainText('Real heading')
    await expect.poll(async () => page.title()).toMatch(/(無題\.md\*|Untitled\.md\*) - MDV/i)
    await expect(page.locator('.preview-scroll-placeholder')).toHaveCount(0)
    await expect.poll(async () => page.locator('.outline-item[disabled]').count()).toBe(0)
    await expect.poll(async () => page.locator('.outline-item').count()).toBeGreaterThan(0)
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }
})

test('typing into a fresh untitled document in WYSIWYG mode does not crash the renderer', async () => {
  const tempRoot = await makeTempDir('mdv-electron-new-document-')
  const userDataDir = path.join(tempRoot, 'user-data')

  await fs.mkdir(userDataDir, { recursive: true })

  const app = await launchElectronApp({
    userDataDir,
  })

  try {
    const page = await app.firstWindow()
    const pageErrors: string[] = []

    page.on('pageerror', (error) => {
      pageErrors.push(error.message)
    })

    await openWritePanel(page)
    await expectFreshUntitledDocument(page)
    await switchToastEditorMode(page, 'wysiwyg')

    const wysiwygEditor = page.locator('.toastui-editor-ww-container .ProseMirror').first()
    await wysiwygEditor.click()
    await page.keyboard.insertText('fresh wysiwyg text')

    await expect.poll(() => pageErrors, {
      message: 'renderer should not emit pageerror while editing a fresh untitled WYSIWYG document',
    }).toEqual([])
    await expect(wysiwygEditor).toContainText('fresh wysiwyg text')
    await expect.poll(async () => page.title()).toMatch(/(無題\.md\*|Untitled\.md\*) - MDV/i)
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }
})

test('AI write_target with :new creates a populated new document window', async () => {
  const tempRoot = await makeTempDir('mdv-electron-new-document-')
  const userDataDir = path.join(tempRoot, 'user-data')

  await fs.mkdir(userDataDir, { recursive: true })

  const app = await launchElectronApp({
    userDataDir,
    dialogResponses: {
      messageBox: [{ response: 0 }],
    },
  })

  try {
    const page = await app.firstWindow()
    const nextWindowPromise = app.waitForEvent('window')

    const writeResult = await page.evaluate(async () => {
      return window.mdvDesktop?.writeAiTarget({
        destination: {
          editorId: ':new',
          span: { kind: 'document' },
        },
        sources: [
          {
            type: 'literal',
            text: '# Draft\n\nCreated by AI.\n',
          },
        ],
        mode: 'replace',
        title: 'Draft.md',
      })
    })

    const nextPage = await nextWindowPromise

    expect(writeResult).toMatchObject({
      created: true,
      mode: 'replace',
      text: '# Draft\n\nCreated by AI.\n',
    })

    await openWritePanel(nextPage)
    await expect.poll(async () => nextPage.title()).toMatch(/Draft\.md\*? - MDV/i)
    await expect(nextPage.locator('.toastui-editor-md-container .toastui-editor').first()).toContainText('Created by AI.')
    await expect(nextPage.locator('.editor-sample-placeholder')).toHaveCount(0)
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }
})

test('AI write_target dryRun previews without mutating the active document', async () => {
  const tempRoot = await makeTempDir('mdv-electron-new-document-')
  const userDataDir = path.join(tempRoot, 'user-data')

  await fs.mkdir(userDataDir, { recursive: true })

  const app = await launchElectronApp({ userDataDir })

  try {
    const page = await app.firstWindow()

    await openWritePanel(page)
    await replaceMarkdownDocument(page, '# Existing\n\nKeep this line.\n')

    const writeResult = await page.evaluate(async () => {
      return window.mdvDesktop?.writeAiTarget({
        destination: {
          editorId: 'editor:active',
          span: { kind: 'document' },
        },
        sources: [
          {
            type: 'literal',
            text: '# Preview\n\nNot yet applied.\n',
          },
        ],
        mode: 'replace',
        dryRun: true,
      })
    })

    expect(writeResult).toMatchObject({
      dryRun: true,
      bytesWritten: 0,
      wouldWriteBytes: 28,
      mode: 'replace',
      span: {
        start: { line: 1, column: 1 },
        end: { line: 4, column: 1 },
        isEmpty: false,
      },
      replacedSpan: {
        start: { line: 1, column: 1 },
        end: { line: 4, column: 1 },
        isEmpty: false,
      },
      markdownPreview: '# Preview\n\nNot yet applied.\n',
      markdownPreviewTruncated: false,
      markdownPreviewAbbreviated: false,
    })
    expect(writeResult?.text).toBeUndefined()
    expect(writeResult?.target).toBeUndefined()
    await expect(page.locator('.toastui-editor-md-container .toastui-editor').first()).toContainText('Keep this line.')
    await expect(page.locator('.toastui-editor-md-container .toastui-editor').first()).not.toContainText('Not yet applied.')
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }
})

test('AI write_target dryRun reports insert and append spans without mutating the active document', async () => {
  const tempRoot = await makeTempDir('mdv-electron-new-document-')
  const userDataDir = path.join(tempRoot, 'user-data')

  await fs.mkdir(userDataDir, { recursive: true })

  const app = await launchElectronApp({ userDataDir })

  try {
    const page = await app.firstWindow()

    await openWritePanel(page)
    await replaceMarkdownDocument(page, '# Doc\n\nalpha\nomega\n')

    const insertResult = await page.evaluate(async () => {
      return window.mdvDesktop?.writeAiTarget({
        destination: {
          editorId: 'editor:active',
          span: { kind: 'point', at: { line: 3, column: 6 } },
        },
        sources: [
          {
            type: 'literal',
            text: ' + beta',
          },
        ],
        mode: 'insert',
        dryRun: true,
      })
    })

    expect(insertResult).toMatchObject({
      dryRun: true,
      bytesWritten: 0,
      wouldWriteBytes: 7,
      mode: 'insert',
      span: {
        start: { line: 3, column: 6 },
        end: { line: 3, column: 13 },
        isEmpty: false,
      },
      replacedSpan: {
        start: { line: 3, column: 6 },
        end: { line: 3, column: 6 },
        isEmpty: true,
      },
      markdownPreview: '# Doc\n\nalpha + beta\nomega\n',
      replacedTextPreview: '',
    })

    const appendResult = await page.evaluate(async () => {
      return window.mdvDesktop?.writeAiTarget({
        destination: {
          editorId: 'editor:active',
          span: { kind: 'document' },
        },
        sources: [
          {
            type: 'literal',
            text: '\nEOF',
          },
        ],
        mode: 'append',
        dryRun: true,
      })
    })

    expect(appendResult).toMatchObject({
      dryRun: true,
      bytesWritten: 0,
      wouldWriteBytes: 4,
      mode: 'append',
      span: {
        start: { line: 5, column: 1 },
        end: { line: 6, column: 4 },
        isEmpty: false,
      },
      replacedSpan: {
        start: { line: 5, column: 1 },
        end: { line: 5, column: 1 },
        isEmpty: true,
      },
      markdownPreview: '# Doc\n\nalpha\nomega\n\nEOF',
      replacedTextPreview: '',
    })

    const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()
    await expect(editor).toContainText('alpha')
    await expect(editor).toContainText('omega')
    await expect(editor).not.toContainText('+ beta')
    await expect(editor).not.toContainText('EOF')
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }
})

test('AI write_target dryRun previews live selection without mutating the active document', async () => {
  const tempRoot = await makeTempDir('mdv-electron-new-document-')
  const userDataDir = path.join(tempRoot, 'user-data')

  await fs.mkdir(userDataDir, { recursive: true })

  const app = await launchElectronApp({ userDataDir })

  try {
    const page = await app.firstWindow()

    await openWritePanel(page)
    await replaceMarkdownDocument(page, 'Start\nMiddle\nEnd\n')
    await selectEditorCharactersFromStart(page, 6, 6)

    const writeResult = await page.evaluate(async () => {
      return window.mdvDesktop?.writeAiTarget({
        destination: {
          editorId: 'editor:active',
          span: { kind: 'selection' },
        },
        sources: [
          {
            type: 'literal',
            text: 'Center',
          },
        ],
        mode: 'replace',
        dryRun: true,
      })
    })

    expect(writeResult).toMatchObject({
      dryRun: true,
      bytesWritten: 0,
      wouldWriteBytes: 6,
      mode: 'replace',
      span: {
        start: { line: 2, column: 1 },
        end: { line: 2, column: 7 },
        isEmpty: false,
      },
      replacedSpan: {
        start: { line: 2, column: 1 },
        end: { line: 2, column: 7 },
        isEmpty: false,
      },
      markdownPreview: 'Start\nCenter\nEnd\n',
      replacedTextPreview: 'Middle',
    })
    expect(writeResult?.target).toBeUndefined()
    expect(writeResult?.text).toBeUndefined()
    await expect(page.locator('.toastui-editor-md-container .toastui-editor').first()).toContainText('Middle')
    await expect(page.locator('.toastui-editor-md-container .toastui-editor').first()).not.toContainText('Center')
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }
})

test('AI write_target dryRun checks destination write permission before source reads', async () => {
  const tempRoot = await makeTempDir('mdv-electron-new-document-')
  const userDataDir = path.join(tempRoot, 'user-data')

  await fs.mkdir(userDataDir, { recursive: true })

  const app = await launchElectronApp({ userDataDir })

  try {
    const page = await app.firstWindow()

    await openWritePanel(page)
    await replaceMarkdownDocument(page, '# Source\n\nread should not run first\n')

    const errorMessage = await page.evaluate(async () => {
      await window.mdvDesktop?.settings.updateSettings({
        ai: {
          toolPermissions: {
            readActiveDocument: false,
            writeActiveDocument: false,
          },
        },
      })

      try {
        await window.mdvDesktop?.writeAiTarget({
          destination: {
            editorId: 'editor:active',
            span: { kind: 'document' },
          },
          sources: [
            {
              type: 'slice-ref',
              target: {
                editorId: 'editor:active',
                span: { kind: 'document' },
              },
            },
          ],
          mode: 'replace',
          dryRun: true,
        })
        return null
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    })

    expect(errorMessage).toContain('Active document write is disabled in settings')
    expect(errorMessage).not.toContain('Active document read is disabled in settings')
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }
})

test('AI read active selection public display does not require active document read permission', async () => {
  const tempRoot = await makeTempDir('mdv-electron-new-document-')
  const userDataDir = path.join(tempRoot, 'user-data')

  await fs.mkdir(userDataDir, { recursive: true })

  const app = await launchElectronApp({ userDataDir })

  try {
    const page = await app.firstWindow()

    await openWritePanel(page)
    await replaceMarkdownDocument(page, 'Start\nMiddle\nEnd\n')
    await selectEditorCharactersFromStart(page, 6, 6)

    const selectionRead = await page.evaluate(async () => {
      await window.mdvDesktop?.settings.updateSettings({
        ai: {
          toolPermissions: {
            readActiveDocument: false,
            readActiveSelection: true,
          },
        },
      })

      return window.mdvDesktop?.readAiActiveSelection()
    })

    expect(selectionRead?.text).toBe('Middle')
    expect(selectionRead?.target?.span).toMatchObject({ kind: 'selection' })
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }
})

test('AI read_target public display redacts active editor data image continuation pages', async () => {
  const tempRoot = await makeTempDir('mdv-electron-new-document-')
  const userDataDir = path.join(tempRoot, 'user-data')

  await fs.mkdir(userDataDir, { recursive: true })

  const app = await launchElectronApp({ userDataDir })

  try {
    const page = await app.firstWindow()
    const rawBase64 = 'A'.repeat(4096)
    const dataUrl = `data:image/png;base64,${rawBase64}`
    const markdown = `# Inline\n\n![pixel](${dataUrl})\n`

    await openWritePanel(page)
    await replaceMarkdownDocument(page, markdown)

    const firstPage = await page.evaluate(async () => {
      return window.mdvDesktop?.readAiTarget({
        target: {
          editorId: 'editor:active',
          span: { kind: 'document' },
        },
        maxTokens: 16,
      })
    })

    expect(firstPage?.text).toContain('omitted')
    expect(firstPage?.text).not.toContain(dataUrl)
    expect(firstPage?.text).not.toContain(rawBase64.slice(0, 128))
    expect(firstPage?.nextCursor).not.toBeNull()

    if (!firstPage?.target || !firstPage.nextCursor) {
      throw new Error('Expected first public read page to include target and nextCursor')
    }

    const nextPage = await page.evaluate(async ({ target, cursor }) => {
      return window.mdvDesktop?.readAiTarget({
        target,
        cursor,
        maxTokens: 16,
      })
    }, {
      target: firstPage.target,
      cursor: firstPage.nextCursor,
    })

    expect(nextPage?.text).toContain('continued data image omitted')
    expect(nextPage?.text).not.toContain(rawBase64.slice(128, 256))
    expect(JSON.stringify(nextPage ?? {})).not.toContain(rawBase64.slice(128, 256))
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }
})

test('AI write_target dryRun exposes large previews through a temp buffer', async () => {
  const tempRoot = await makeTempDir('mdv-electron-new-document-')
  const userDataDir = path.join(tempRoot, 'user-data')

  await fs.mkdir(userDataDir, { recursive: true })

  const app = await launchElectronApp({ userDataDir })

  try {
    const page = await app.firstWindow()
    const largeText = `# Large Preview\n\n${'A'.repeat(30_000)}\n`

    const writeResult = await page.evaluate(async (content) => {
      return window.mdvDesktop?.writeAiTarget({
        destination: {
          editorId: 'editor:active',
          span: { kind: 'document' },
        },
        sources: [
          {
            type: 'literal',
            text: content,
          },
        ],
        dryRun: true,
      })
    }, largeText)

    expect(writeResult?.dryRun).toBe(true)
    expect(writeResult?.bytesWritten).toBe(0)
    expect(writeResult?.wouldWriteBytes).toBe(largeText.length)
    expect(writeResult?.markdownPreviewTruncated).toBe(true)
    expect(writeResult?.markdownPreview?.length ?? 0).toBeLessThan(largeText.length)
    expect(writeResult?.previewTarget?.editorId).toMatch(/^buffer:/)
    expect(writeResult?.text).toBeUndefined()
    expect(writeResult?.target).toBeUndefined()
    expect(JSON.stringify(writeResult ?? {})).not.toContain(largeText)

    const previewTarget = writeResult?.previewTarget
    if (!previewTarget) {
      throw new Error('Expected dryRun previewTarget')
    }

    const previewPage = await page.evaluate(async (target) => {
      return window.mdvDesktop?.readAiTarget({
        target,
        maxTokens: 16,
      })
    }, previewTarget)

    expect(previewPage?.text).toContain('# Large Preview')

    const sourceReuseError = await page.evaluate(async (target) => {
      try {
        await window.mdvDesktop?.writeAiTarget({
          destination: {
            editorId: 'editor:active',
            span: { kind: 'document' },
          },
          sources: [
            {
              type: 'slice-ref',
              target,
            },
          ],
          dryRun: true,
        })
        return null
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    }, previewTarget)

    expect(sourceReuseError).toContain('exceeded bounded read budget')
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }
})

test('AI write_target dryRun previews temp buffer writes without mutating the buffer', async () => {
  const tempRoot = await makeTempDir('mdv-electron-new-document-')
  const userDataDir = path.join(tempRoot, 'user-data')

  await fs.mkdir(userDataDir, { recursive: true })

  const app = await launchElectronApp({ userDataDir })

  try {
    const page = await app.firstWindow()

    await openWritePanel(page)
    await replaceMarkdownDocument(page, '# Scratch\n\nalpha\nbeta\n')

    const grepResult = await page.evaluate(async () => {
      return window.mdvDesktop?.grepAiSlice({
        target: {
          editorId: 'editor:active',
          span: { kind: 'document' },
        },
        query: 'alpha',
        maxResults: 1,
      })
    })

    const bufferId = grepResult?.bufferId
    expect(bufferId).toMatch(/^buffer:/)
    if (!bufferId) {
      throw new Error('Expected grep bufferId')
    }

    const beforeRead = await page.evaluate(async (editorId) => {
      return window.mdvDesktop?.readAiTarget({
        target: {
          editorId,
          span: { kind: 'document' },
        },
        maxTokens: 64,
      })
    }, bufferId)

    const writeResult = await page.evaluate(async (editorId) => {
      return window.mdvDesktop?.writeAiTarget({
        destination: {
          editorId,
          span: { kind: 'document' },
        },
        sources: [
          {
            type: 'literal',
            text: 'replacement buffer text',
          },
        ],
        dryRun: true,
      })
    }, bufferId)

    const afterRead = await page.evaluate(async (editorId) => {
      return window.mdvDesktop?.readAiTarget({
        target: {
          editorId,
          span: { kind: 'document' },
        },
        maxTokens: 64,
      })
    }, bufferId)

    expect(writeResult).toMatchObject({
      dryRun: true,
      bytesWritten: 0,
      mode: 'replace',
      markdownPreview: 'replacement buffer text',
    })
    expect(writeResult?.text).toBeUndefined()
    expect(writeResult?.target).toBeUndefined()
    expect(afterRead?.text).toBe(beforeRead?.text)
    expect(afterRead?.text).toContain('alpha')
    expect(afterRead?.text).not.toContain('replacement buffer text')
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }
})

test('AI write_target dryRun stores full inline data image preview behind previewTarget', async () => {
  const tempRoot = await makeTempDir('mdv-electron-new-document-')
  const userDataDir = path.join(tempRoot, 'user-data')

  await fs.mkdir(userDataDir, { recursive: true })

  const app = await launchElectronApp({ userDataDir })

  try {
    const page = await app.firstWindow()
    const rawBase64 = 'A'.repeat(4096)
    const dataUrl = `data:image/png;base64,${rawBase64}`
    const markdown = `# Inline\n\n![pixel](${dataUrl})\n`

    await openWritePanel(page)

    const writeResult = await page.evaluate(async (content) => {
      return window.mdvDesktop?.writeAiTarget({
        destination: {
          editorId: 'editor:active',
          span: { kind: 'document' },
        },
        sources: [
          {
            type: 'literal',
            text: content,
          },
        ],
        dryRun: true,
      })
    }, markdown)

    expect(writeResult?.dryRun).toBe(true)
    expect(writeResult?.bytesWritten).toBe(0)
    expect(writeResult?.wouldWriteBytes).toBe(Buffer.byteLength(markdown, 'utf8'))
    expect(writeResult?.markdownPreviewAbbreviated).toBe(true)
    expect(writeResult?.markdownPreview).toContain('omitted')
    expect(writeResult?.markdownPreview).not.toContain(dataUrl)
    expect(writeResult?.markdownPreview).not.toContain(rawBase64.slice(0, 128))
    expect(writeResult?.preview ?? '').not.toContain(dataUrl)
    expect(writeResult?.previewTarget?.editorId).toMatch(/^buffer:/)
    expect(writeResult?.text).toBeUndefined()
    expect(writeResult?.target).toBeUndefined()
    expect(JSON.stringify(writeResult ?? {})).not.toContain(dataUrl)

    const previewTarget = writeResult?.previewTarget
    if (!previewTarget) {
      throw new Error('Expected dryRun previewTarget for inline data image')
    }

    const previewRead = await page.evaluate(async (target) => {
      return window.mdvDesktop?.readAiTarget({
        target,
        maxTokens: 16,
      })
    }, previewTarget)

    expect(previewRead?.text).toContain('omitted')
    expect(previewRead?.text).not.toContain(dataUrl)
    expect(previewRead?.text).not.toContain(rawBase64.slice(0, 128))
    expect(previewRead?.nextCursor).not.toBeNull()

    const previewNextPage = await page.evaluate(async ({ target, cursor }) => {
      return window.mdvDesktop?.readAiTarget({
        target,
        cursor,
        maxTokens: 16,
      })
    }, {
      target: previewRead?.target ?? previewTarget,
      cursor: previewRead?.nextCursor,
    })

    expect(previewNextPage?.text).toContain('continued data image omitted')
    expect(previewNextPage?.text).not.toContain(rawBase64.slice(128, 256))
    expect(JSON.stringify(previewNextPage ?? {})).not.toContain(rawBase64.slice(128, 256))

    const reuseResult = await page.evaluate(async (target) => {
      return window.mdvDesktop?.writeAiTarget({
        destination: {
          editorId: 'editor:active',
          span: { kind: 'document' },
        },
        sources: [
          {
            type: 'slice-ref',
            target,
          },
        ],
        dryRun: true,
      })
    }, previewTarget)

    expect(reuseResult?.dryRun).toBe(true)
    expect(reuseResult?.bytesWritten).toBe(0)
    expect(reuseResult?.wouldWriteBytes).toBe(Buffer.byteLength(markdown, 'utf8'))
    expect(reuseResult?.text).toBeUndefined()
    await expect(page.locator('.toastui-editor-md-container .toastui-editor').first()).not.toContainText('pixel')
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }
})

test('AI write_target dryRun redacts replaced text preview inside inline data images', async () => {
  const tempRoot = await makeTempDir('mdv-electron-new-document-')
  const userDataDir = path.join(tempRoot, 'user-data')

  await fs.mkdir(userDataDir, { recursive: true })

  const app = await launchElectronApp({ userDataDir })

  try {
    const page = await app.firstWindow()
    const rawBase64 = 'A'.repeat(4096)
    const dataUrl = `data:image/png;base64,${rawBase64}`
    const markdown = `# Inline\n\n![pixel](${dataUrl})\n`
    const rangeStartColumn = markdown.indexOf(rawBase64) + 1

    await openWritePanel(page)
    await replaceMarkdownDocument(page, markdown)

    const writeResult = await page.evaluate(async ({ startColumn }) => {
      return window.mdvDesktop?.writeAiTarget({
        destination: {
          editorId: 'editor:active',
          span: {
            kind: 'range',
            start: { line: 3, column: startColumn },
            end: { line: 3, column: startColumn + 128 },
          },
        },
        sources: [
          {
            type: 'literal',
            text: 'BBBB',
          },
        ],
        dryRun: true,
      })
    }, { startColumn: rangeStartColumn })

    expect(writeResult?.dryRun).toBe(true)
    expect(writeResult?.replacedTextPreview).toContain('continued data image omitted')
    expect(writeResult?.replacedTextPreview).not.toContain(rawBase64.slice(0, 128))
    expect(JSON.stringify(writeResult ?? {})).not.toContain(rawBase64.slice(0, 128))
    await expect(page.locator('.toastui-editor-md-container .toastui-editor').first()).toContainText('pixel')
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }
})

test('AI write_target dryRun for :new reports wouldCreate without opening a window', async () => {
  const tempRoot = await makeTempDir('mdv-electron-new-document-')
  const userDataDir = path.join(tempRoot, 'user-data')

  await fs.mkdir(userDataDir, { recursive: true })

  const app = await launchElectronApp({ userDataDir })

  try {
    const page = await app.firstWindow()
    const windowCountBefore = app.windows().length

    const writeResult = await page.evaluate(async () => {
      return window.mdvDesktop?.writeAiTarget({
        destination: {
          editorId: ':new',
          span: { kind: 'document' },
        },
        sources: [
          {
            type: 'literal',
            text: '# Draft\n\nPreview only.\n',
          },
        ],
        title: 'Draft.md',
        dryRun: true,
      })
    })

    expect(writeResult).toMatchObject({
      dryRun: true,
      wouldCreate: true,
      bytesWritten: 0,
      markdownPreview: '# Draft\n\nPreview only.\n',
      title: 'Draft.md',
    })
    expect(writeResult?.created).toBeUndefined()
    expect(writeResult?.text).toBeUndefined()
    expect(writeResult?.target).toBeUndefined()
    expect(app.windows()).toHaveLength(windowCountBefore)
  } finally {
    await forceCloseApp(app)
    await app.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }
})
