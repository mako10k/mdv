import { expect, test, type Page } from '@playwright/test'

const selectAllShortcut = process.platform === 'darwin' ? 'Meta+A' : 'Control+A'
const moveEditorCursorToStartShortcut = process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home'
const saveButtonName = /^(保存|Save) \(Ctrl\/Cmd\+S\)$/

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

async function clickTableAction(page: Page, actionName: RegExp) {
  const topbar = page.locator('.topbar')

  await topbar.getByRole('button', { name: /(表操作|Table actions)/ }).click()
  await expect(topbar.getByRole('menu', { name: /(表操作|Table actions)/ })).toBeVisible()
  await topbar.getByRole('menuitem', { name: actionName }).click()
}

async function replaceMarkdownDocument(page: Page, markdown: string, expectedEditorText: string | null = markdown.replace(/\n+/g, '')) {
  const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()

  await editor.click()
  await page.keyboard.press(selectAllShortcut)
  await page.keyboard.press('Backspace')
  await page.keyboard.insertText(markdown)

  if (expectedEditorText !== null) {
    await expect(editor).toContainText(expectedEditorText)
  }
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

async function triggerPrimaryShortcut(page: Page, key: string) {
  await page.evaluate(({ shortcutKey, isMac }) => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: shortcutKey,
      bubbles: true,
      cancelable: true,
      ctrlKey: !isMac,
      metaKey: isMac,
    }))
  }, { shortcutKey: key, isMac: process.platform === 'darwin' })
}

async function installDesktopImageResolutionStub(page: Page, options: {
  openFilePayload?: {
    path: string
    content: string
    snapshot: {
      path: string
      contentHash: string
      size: number
      mtimeMs: number | null
    }
  } | null
  draftWorkspace?: {
    workspaceId: string
    rootDir: string
    markdownFilePath: string
    assetDir: string
    manifestPath: string
  } | null
  dataUrlMap: Record<string, string>
  changeProposal?: boolean
  changeProposalDetailDelayMs?: number
  changeProposalDetailError?: string
  changeProposalCancelFailures?: number
  changeProposalReviseFailures?: number
  changeProposalReviseAckLosses?: number
} = { dataUrlMap: {} }) {
  await page.addInitScript((config) => {
    const baseSettings: MdvSettings = {
      version: 3,
      general: {
        locale: 'ja',
        themeMode: 'system',
        defaultStartPanel: 'preview',
        openLinksBehavior: 'confirm-if-untrusted',
      },
      editor: {
        initialEditType: 'markdown',
        showModeSwitch: true,
        previewStyle: 'vertical',
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
          tavilyWebSearch: false,
          fetchUrl: false,
        },
        openai: {
          enabled: true,
          baseUrl: null,
          model: 'gpt-5.4',
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
          autoDisposeAfterMs: 60_000,
          maxResponseBytes: 1_000_000,
        },
      },
      safety: {
        confirmBeforeFullDocumentOverwrite: true,
        confirmBeforeNewDocumentFromAi: true,
        confirmBeforeExternalUrlOpen: true,
      },
      updates: {
        enabled: false,
        autoCheckOnLaunch: false,
        feedUrl: null,
      },
    }

    type DesktopApi = NonNullable<Window['mdvDesktop']>

    const testWindow = window as Window
    const existingDesktop = testWindow.mdvDesktop as Partial<DesktopApi> | undefined
    let aiEditorRequestCallback: ((request: MdvAiEditorRequest) => void | Promise<void>) | null = null
    let changeProposalOpenCallback: ((proposal: MdvAiChangeProposalSummary) => void) | null = null
    let changeProposalResolvedCallback: ((resolution: MdvAiChangeProposalResolution) => void) | null = null
    let menuActionCallback: ((action: MdvMenuAction) => void) | null = null
    let pendingAiEditorResponse: {
      resolve: (payload: MdvAiChangeProposalCapturePayload | MdvAiChangeProposalApplyPayload | null) => void
      reject: (error: Error) => void
    } | null = null
    let capturedProposal: MdvAiChangeProposalCapturePayload | null = null
    let lastApplyPayload: {
      proposalId: string
      expectedRevision: number
      expectedProposalFingerprint: string
      selectedHunkIds: string[]
    } | null = null
    let lastRevisePayload: Parameters<DesktopApi['reviseAiChangeProposalHunk']>[0] | null = null
    let forceStaleApply = false
    let cancelProposalCount = 0
    let remainingCancelFailures = config.changeProposalCancelFailures ?? 0
    let remainingReviseFailures = config.changeProposalReviseFailures ?? 0
    let remainingReviseAckLosses = config.changeProposalReviseAckLosses ?? 0
    const proposalId = 'proposal:e2e'
    let proposalRevision = 1
    let proposalFingerprint = 'candidate:e2e:1'
    let proposalHunks: MdvAiChangeProposalHunk[] = [
      {
        hunkId: `${proposalId}:hunk:1`,
        oldStart: 1,
        oldLines: 5,
        newStart: 1,
        newLines: 5,
        lines: [' # Proposal', ' ', '-alpha', '+ALPHA', ' one', ' two'],
        edit: { kind: 'replace-hunk-body', markdown: 'ALPHA\n' },
      },
      {
        hunkId: `${proposalId}:hunk:2`,
        oldStart: 9,
        oldLines: 4,
        newStart: 9,
        newLines: 4,
        lines: [' eight', ' nine', '-lambda', '+LAMBDA', ' omega'],
        edit: { kind: 'replace-hunk-body', markdown: 'LAMBDA\n' },
      },
    ]

    const requestAiEditor = (request: MdvAiEditorRequest) => new Promise<MdvAiChangeProposalCapturePayload | MdvAiChangeProposalApplyPayload | null>((resolve, reject) => {
      if (!aiEditorRequestCallback) {
        reject(new Error('AI editor request callback is unavailable'))
        return
      }

      pendingAiEditorResponse = { resolve, reject }
      void aiEditorRequestCallback(request)
    })

    const buildProposalSummary = (capture: MdvAiChangeProposalCapturePayload): MdvAiChangeProposalSummary => ({
      proposalId,
      originRequestId: 'request:e2e',
      editorId: capture.editorId,
      title: 'Two line updates',
      mode: 'replace',
      hunkCount: proposalHunks.length,
      wouldWriteBytes: capture.wouldWriteBytes,
      span: capture.span,
      replacedSpan: capture.replacedSpan,
      baselineFingerprint: 'baseline:e2e',
      proposalFingerprint,
      revision: proposalRevision,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    })

    const buildProposalDetail = (): MdvAiChangeProposalDetail => {
      if (!capturedProposal) {
        throw new Error('Proposal has not been captured')
      }

      return {
        ...buildProposalSummary(capturedProposal),
        hunks: proposalHunks,
      }
    }

    const emitProposalResolution = (resolution: MdvAiChangeProposalResolution) => {
      changeProposalResolvedCallback?.(resolution)
      return resolution
    }

    if (config.changeProposal) {
      const proposalTestWindow = testWindow as Window & {
        __mdvChangeProposalTest?: {
          open: () => Promise<void>
          getLastApplyPayload: () => {
            proposalId: string
            expectedRevision: number
            expectedProposalFingerprint: string
            selectedHunkIds: string[]
          } | null
          getLastRevisePayload: () => Parameters<DesktopApi['reviseAiChangeProposalHunk']>[0] | null
          forceStaleApply: () => void
          dispatchMenuAction: (action: MdvMenuAction) => void
          getCancelCount: () => number
        }
      }
      proposalTestWindow.__mdvChangeProposalTest = {
        open: async () => {
          const proposedMarkdown = '# Proposal\n\nALPHA\none\ntwo\nthree\nfour\nfive\neight\nnine\nLAMBDA\nomega\n'
          const response = await requestAiEditor({
            requestId: 'capture:e2e',
            type: 'capture-change-proposal',
            proposalId,
            destination: { editorId: 'editor:e2e', span: { kind: 'document' } },
            content: proposedMarkdown,
            mode: 'replace',
          })

          if (!response || !('baselineMarkdown' in response)) {
            throw new Error('Expected capture response')
          }
          capturedProposal = response
          changeProposalOpenCallback?.(buildProposalSummary(response))
        },
        getLastApplyPayload: () => lastApplyPayload,
        getLastRevisePayload: () => lastRevisePayload,
        forceStaleApply: () => {
          forceStaleApply = true
        },
        dispatchMenuAction: (action) => menuActionCallback?.(action),
        getCancelCount: () => cancelProposalCount,
      }
    }

    const nextDesktop = {
      ...existingDesktop,
      platform: existingDesktop?.platform ?? 'test',
      e2e: {
        recoveryPromptMode: 'interactive',
        startupRecoveryDelayMs: 0,
      },
      debug: {
        notify: () => {},
      },
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
        migrateLegacyTheme: async () => baseSettings,
        saveOpenAiApiKey: async () => ({ openaiConfigured: true, tavilyConfigured: false }),
        clearOpenAiApiKey: async () => ({ openaiConfigured: true, tavilyConfigured: false }),
        saveTavilyApiKey: async () => ({ openaiConfigured: true, tavilyConfigured: false }),
        clearTavilyApiKey: async () => ({ openaiConfigured: true, tavilyConfigured: false }),
        getProviderStatus: async () => ({ openaiConfigured: true, tavilyConfigured: false }),
      },
      openFile: async () => config.openFilePayload ?? null,
      readFile: async (filePath: string) => {
        return config.openFilePayload?.path === filePath ? config.openFilePayload : null
      },
      readRelativeAssetAsDataUrl: async (payload: { baseFilePath: string; source: string }) => {
        const key = `${payload.baseFilePath}\u0000${payload.source}`
        const dataUrl = config.dataUrlMap[key]

        return dataUrl
          ? { path: key, dataUrl }
          : null
      },
      trackCurrentFile: async () => {},
      onCurrentFileChanged: () => () => {},
      ensureDraftWorkspace: async () => config.draftWorkspace ?? null,
      cleanupDraftWorkspace: async () => {},
      cleanupImportedAssets: async () => {},
      getLatestAutosaveRecovery: async () => null,
      getAutosaveRecoveryForFile: async () => null,
      clearAutosaveRecovery: async () => {},
      autosaveRecoveryUpsert: async () => null,
      confirmUnsavedChanges: async () => ({ action: 'discard' }),
      extractMdastHeadingOutline: async () => [],
      exportHtml: async () => null,
      openSettingsWindow: async () => null,
      onWindowCloseApproved: () => () => {},
      onServerCommand: () => () => {},
      sendServerCommandResult: () => {},
      onOpenFileRequested: () => () => {},
      notifyInitialLaunchOpenHandled: () => {},
      onMenuAction: (callback: (action: MdvMenuAction) => void) => {
        menuActionCallback = callback
        return () => {
          if (menuActionCallback === callback) {
            menuActionCallback = null
          }
        }
      },
      sendAiChatMessage: async () => ({ status: 'started', requestId: 'test-request' }),
      onAiChatStreamEvent: () => () => {},
      getAiChatContext: async () => null,
      readAiActiveDocument: async () => null,
      readAiActiveSelection: async () => null,
      readAiTarget: async () => null,
      grepAiSlice: async () => null,
      statsAiSlice: async () => null,
      semanticSearchAiSlice: async () => null,
      writeAiActiveDocument: async () => null,
      writeAiActiveSelection: async () => null,
      writeAiTarget: async () => null,
      listAiBuffers: async () => null,
      getAiChangeProposal: async () => {
        if (config.changeProposalDetailDelayMs) {
          await new Promise((resolve) => window.setTimeout(resolve, config.changeProposalDetailDelayMs))
        }
        if (config.changeProposalDetailError) {
          throw new Error(config.changeProposalDetailError)
        }
        return buildProposalDetail()
      },
      reviseAiChangeProposalHunk: async (payload: Parameters<DesktopApi['reviseAiChangeProposalHunk']>[0]) => {
        lastRevisePayload = {
          ...payload,
          edit: { ...payload.edit },
        }
        if (remainingReviseFailures > 0) {
          remainingReviseFailures -= 1
          throw new Error('revision unavailable')
        }
        if (payload.expectedRevision !== proposalRevision || payload.expectedProposalFingerprint !== proposalFingerprint) {
          throw new Error('proposal revision is stale')
        }
        const hunkIndex = proposalHunks.findIndex((hunk) => hunk.hunkId === payload.hunkId)
        if (hunkIndex < 0) {
          throw new Error('unknown hunk')
        }
        const baselineLine = hunkIndex === 0 ? 'alpha' : 'lambda'
        const canonicalMarkdown = payload.edit.markdown.length > 0 && !payload.edit.markdown.endsWith('\n')
          ? `${payload.edit.markdown}\n`
          : payload.edit.markdown
        const editedLines = canonicalMarkdown.length === 0
          ? []
          : canonicalMarkdown.endsWith('\n')
          ? canonicalMarkdown.slice(0, -1).split('\n')
          : canonicalMarkdown.split('\n')
        proposalRevision += 1
        proposalFingerprint = `candidate:e2e:${proposalRevision}`
        proposalHunks = proposalHunks.map((hunk, index) => index === hunkIndex
          ? {
              ...hunk,
              newLines: hunk.oldLines - 1 + editedLines.length,
              lines: [
                ...hunk.lines.filter((line) => line.startsWith(' ')).slice(0, hunkIndex === 0 ? 2 : 2),
                `-${baselineLine}`,
                ...editedLines.map((line) => `+${line}`),
                ...hunk.lines.filter((line) => line.startsWith(' ')).slice(hunkIndex === 0 ? 2 : 2),
              ],
              edit: { kind: 'replace-hunk-body', markdown: canonicalMarkdown },
            }
          : hunk)
        if (remainingReviseAckLosses > 0) {
          remainingReviseAckLosses -= 1
          throw new Error('revision acknowledgement lost')
        }
        return buildProposalDetail()
      },
      applyAiChangeProposal: async (payload: Parameters<DesktopApi['applyAiChangeProposal']>[0]) => {
        if (!capturedProposal) {
          throw new Error('Proposal has not been captured')
        }
        if (payload.expectedRevision !== proposalRevision || payload.expectedProposalFingerprint !== proposalFingerprint) {
          throw new Error('proposal revision is stale')
        }

        lastApplyPayload = {
          proposalId: payload.proposalId,
          expectedRevision: payload.expectedRevision,
          expectedProposalFingerprint: payload.expectedProposalFingerprint,
          selectedHunkIds: [...payload.selectedHunkIds],
        }
        let nextMarkdown = capturedProposal.baselineMarkdown
        if (payload.selectedHunkIds.includes(proposalHunks[0].hunkId)) {
          nextMarkdown = nextMarkdown.replace('\nalpha\n', `\n${proposalHunks[0].edit.markdown}`)
        }
        if (payload.selectedHunkIds.includes(proposalHunks[1].hunkId)) {
          nextMarkdown = nextMarkdown.replace('\nlambda\n', `\n${proposalHunks[1].edit.markdown}`)
        }

        const response = await requestAiEditor({
          requestId: 'apply:e2e',
          type: 'apply-change-proposal',
          proposalId,
          editorId: capturedProposal.editorId,
          expectedDocumentIdentity: capturedProposal.documentIdentity,
          expectedBaselineMarkdown: forceStaleApply
            ? `${capturedProposal.baselineMarkdown}\nexternal edit`
            : capturedProposal.baselineMarkdown,
          nextMarkdown,
        })
        const status = response && 'status' in response ? response.status : 'stale'

        return emitProposalResolution({
          proposalId,
          originRequestId: 'request:e2e',
          editorId: capturedProposal.editorId,
          title: 'Two line updates',
          status,
          revision: proposalRevision,
          proposalFingerprint,
          ...(status === 'stale' && response && 'reason' in response ? { reason: response.reason } : {}),
          selectedHunkIds: [...payload.selectedHunkIds],
          appliedHunkCount: status === 'applied' ? payload.selectedHunkIds.length : undefined,
          baselineFingerprint: 'baseline:e2e',
          resultFingerprint: status === 'applied' ? 'result:e2e' : undefined,
          resolvedAt: new Date().toISOString(),
        })
      },
      cancelAiChangeProposal: async () => {
        cancelProposalCount += 1
        if (remainingCancelFailures > 0) {
          remainingCancelFailures -= 1
          throw new Error('cancel unavailable')
        }
        const detail = buildProposalDetail()
        return emitProposalResolution({
          proposalId,
          originRequestId: 'request:e2e',
          editorId: detail.editorId,
          title: detail.title,
          status: 'cancelled',
          revision: detail.revision,
          proposalFingerprint: detail.proposalFingerprint,
          baselineFingerprint: detail.baselineFingerprint,
          resolvedAt: new Date().toISOString(),
        })
      },
      onAiChangeProposalOpen: (callback: (proposal: MdvAiChangeProposalSummary) => void) => {
        changeProposalOpenCallback = callback
        return () => {
          if (changeProposalOpenCallback === callback) {
            changeProposalOpenCallback = null
          }
        }
      },
      onAiChangeProposalResolved: (callback: (resolution: MdvAiChangeProposalResolution) => void) => {
        changeProposalResolvedCallback = callback
        return () => {
          if (changeProposalResolvedCallback === callback) {
            changeProposalResolvedCallback = null
          }
        }
      },
      onAiEditorRequest: (callback: (request: MdvAiEditorRequest) => void | Promise<void>) => {
        aiEditorRequestCallback = callback
        return () => {
          if (aiEditorRequestCallback === callback) {
            aiEditorRequestCallback = null
          }
        }
      },
      sendAiEditorResponse: (response: Parameters<DesktopApi['sendAiEditorResponse']>[0]) => {
        const pending = pendingAiEditorResponse
        pendingAiEditorResponse = null
        if (!pending) {
          return
        }
        if (response.ok === false) {
          pending.reject(new Error(response.error ?? 'AI editor request failed'))
          return
        }
        const responsePayload = response.payload
        if (
          responsePayload
          && (('baselineMarkdown' in responsePayload) || ('status' in responsePayload))
        ) {
          pending.resolve(responsePayload)
          return
        }
        pending.resolve(null)
      },
      openExternalLink: async () => ({ status: 'opened' }),
      openDocumentLink: async (href: string) => ({
        status: 'opened',
        target: /^https?:/i.test(href) ? 'external' : 'local',
        displayName: href,
      }),
      log: () => {},
      getLogPath: async () => '',
    } satisfies Partial<DesktopApi>

    testWindow.mdvDesktop = nextDesktop as DesktopApi
  }, options)
}

const CHANGE_PROPOSAL_BASELINE = '# Proposal\n\nalpha\none\ntwo\nthree\nfour\nfive\neight\nnine\nlambda\nomega\n'

async function setupChangeProposalPage(page: Page) {
  await installDesktopImageResolutionStub(page, {
    dataUrlMap: {},
    changeProposal: true,
    changeProposalDetailDelayMs: 500,
  })
  await page.goto('/')
  await openWritePanel(page)
  await replaceMarkdownDocument(page, CHANGE_PROPOSAL_BASELINE)
  await page.evaluate(async () => {
    const proposalTest = (window as Window & {
      __mdvChangeProposalTest?: { open: () => Promise<void> }
    }).__mdvChangeProposalTest
    await proposalTest?.open()
  })
  const dialog = page.getByRole('dialog', { name: /(AI の変更提案を確認|Review AI change proposal)/ })
  await expect(dialog).toBeVisible()
  await expect(page.locator('.change-preview-toggle input')).toHaveCount(2)
  await expect(dialog.getByText(/期限.*選択内容は破棄|Expires at.*selection will be discarded/i)).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await installDesktopImageResolutionStub(page)
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

test.describe('AI change proposal review', () => {
  test('cancels the main proposal if detail loading fails', async ({ page }) => {
    const proposalPage = await page.context().newPage()
    await installDesktopImageResolutionStub(proposalPage, {
      dataUrlMap: {},
      changeProposal: true,
      changeProposalDetailDelayMs: 500,
      changeProposalDetailError: 'detail unavailable',
    })
    await proposalPage.goto('/')
    await openWritePanel(proposalPage)
    await replaceMarkdownDocument(proposalPage, CHANGE_PROPOSAL_BASELINE)
    await proposalPage.evaluate(async () => {
      await (window as Window & {
        __mdvChangeProposalTest?: { open: () => Promise<void> }
      }).__mdvChangeProposalTest?.open()
    })

    const dialog = proposalPage.getByRole('dialog', { name: /(AI の変更提案を確認|Review AI change proposal)/ })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('status')).toBeVisible()
    await expect(dialog).toHaveCount(0)
    await expect.poll(() => proposalPage.evaluate(() => {
      return (window as Window & {
        __mdvChangeProposalTest?: { getCancelCount: () => number }
      }).__mdvChangeProposalTest?.getCancelCount() ?? 0
    })).toBe(1)
    await expect(proposalPage.locator('.statusbar-status')).toContainText('detail unavailable')

    await proposalPage.close()
  })

  test('keeps the modal active and allows Cancel retry when detail fallback cancellation fails', async ({ page }) => {
    const proposalPage = await page.context().newPage()
    await installDesktopImageResolutionStub(proposalPage, {
      dataUrlMap: {},
      changeProposal: true,
      changeProposalDetailDelayMs: 500,
      changeProposalDetailError: 'detail unavailable',
      changeProposalCancelFailures: 1,
    })
    await proposalPage.goto('/')
    await openWritePanel(proposalPage)
    await replaceMarkdownDocument(proposalPage, CHANGE_PROPOSAL_BASELINE)
    await proposalPage.evaluate(async () => {
      await (window as Window & {
        __mdvChangeProposalTest?: { open: () => Promise<void> }
      }).__mdvChangeProposalTest?.open()
    })

    const dialog = proposalPage.getByRole('dialog', { name: /(AI の変更提案を確認|Review AI change proposal)/ })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('alert')).toContainText('detail unavailable')
    await expect(dialog.getByRole('alert')).toContainText('cancel unavailable')
    await expect.poll(() => proposalPage.evaluate(() => {
      return (window as Window & {
        __mdvChangeProposalTest?: { getCancelCount: () => number }
      }).__mdvChangeProposalTest?.getCancelCount() ?? 0
    })).toBe(1)

    await dialog.getByRole('button', { name: /^(キャンセル|Cancel)$/ }).click()

    await expect(dialog).toHaveCount(0)
    await expect.poll(() => proposalPage.evaluate(() => {
      return (window as Window & {
        __mdvChangeProposalTest?: { getCancelCount: () => number }
      }).__mdvChangeProposalTest?.getCancelCount() ?? 0
    })).toBe(2)
    await expect(proposalPage.locator('.toastui-editor-md-container .toastui-editor').first()).toContainText('alpha')

    await proposalPage.close()
  })

  test('traps keyboard focus, makes the workspace inert, and cancels with Escape', async ({ page }) => {
    const proposalPage = await page.context().newPage()
    await setupChangeProposalPage(proposalPage)

    await expect.poll(() => proposalPage.evaluate(() => {
      const dialog = document.querySelector('.change-preview-dialog')
      return dialog?.contains(document.activeElement) ?? false
    })).toBe(true)

    expect(await proposalPage.evaluate(() => {
      const backdrop = document.querySelector('.change-preview-backdrop')
      return backdrop?.parentElement
        ? Array.from(backdrop.parentElement.children)
            .filter((element) => element !== backdrop)
            .every((element) => element instanceof HTMLElement && element.inert)
        : false
    })).toBe(true)

    const activePanelBeforeShortcut = await proposalPage.locator('.view-switch button.active').getAttribute('aria-label')
    await proposalPage.keyboard.press('Control+2')
    await proposalPage.keyboard.press('F5')
    await proposalPage.evaluate(() => {
      const proposalTest = (window as Window & {
        __mdvChangeProposalTest?: { dispatchMenuAction: (action: MdvMenuAction) => void }
      }).__mdvChangeProposalTest
      proposalTest?.dispatchMenuAction('show-preview')
    })
    await expect(proposalPage.getByRole('dialog')).toBeVisible()
    await expect(proposalPage.locator('.view-switch button.active')).toHaveAttribute('aria-label', activePanelBeforeShortcut ?? '')

    await proposalPage.locator('.change-preview-dialog').focus()
    await proposalPage.keyboard.press('Shift+Tab')
    expect(await proposalPage.evaluate(() => {
      return document.querySelector('.change-preview-dialog')?.contains(document.activeElement) ?? false
    })).toBe(true)

    for (let index = 0; index < 8; index += 1) {
      await proposalPage.keyboard.press(index % 2 === 0 ? 'Tab' : 'Shift+Tab')
      expect(await proposalPage.evaluate(() => {
        return document.querySelector('.change-preview-dialog')?.contains(document.activeElement) ?? false
      })).toBe(true)
    }

    const firstEditButton = proposalPage.getByRole('button', { name: /(変更 1\/2 を編集|Edit change 1 of 2)/ })
    await firstEditButton.click()
    const editTextarea = proposalPage.getByRole('textbox', { name: /(この変更の Markdown|Markdown for this change)/ })
    await expect(editTextarea).toBeFocused()
    await proposalPage.keyboard.press('Tab')
    expect(await proposalPage.evaluate(() => {
      return document.querySelector('.change-preview-dialog')?.contains(document.activeElement) ?? false
    })).toBe(true)

    await proposalPage.keyboard.press('Escape')
    await expect(editTextarea).toHaveCount(0)
    await expect(proposalPage.getByRole('dialog')).toBeVisible()
    await expect(firstEditButton).toBeFocused()
    await proposalPage.keyboard.press('Escape')
    await expect(proposalPage.getByRole('dialog')).toHaveCount(0)
    await expect(proposalPage.locator('.toastui-editor-md-container .toastui-editor').first()).toContainText('alpha')

    await proposalPage.close()
  })

  test('revalidates a manual hunk edit before Apply and sends no replacement text in the final Apply', async ({ page }) => {
    const proposalPage = await page.context().newPage()
    await setupChangeProposalPage(proposalPage)

    const editor = proposalPage.locator('.toastui-editor-md-container .toastui-editor').first()
    await expect(editor).toContainText('alpha')
    await expect(editor).toContainText('lambda')
    await expect(editor).not.toContainText('ALPHA')
    await expect(editor).not.toContainText('LAMBDA')

    const dialog = proposalPage.getByRole('dialog', { name: /(AI の変更提案を確認|Review AI change proposal)/ })
    const hunkToggles = proposalPage.locator('.change-preview-toggle input')
    await expect(hunkToggles).toHaveCount(2)
    await hunkToggles.nth(0).click()
    await hunkToggles.nth(1).click()

    const applyButton = proposalPage.getByRole('button', { name: /(選択した.*適用|Apply .* selected)/ })
    await expect(applyButton).toBeDisabled()

    await hunkToggles.nth(0).click()
    await hunkToggles.nth(1).click()
    await dialog.getByRole('button', { name: /(変更 2\/2 を編集|Edit change 2 of 2)/ }).click()
    const editTextarea = dialog.getByRole('textbox', { name: /(この変更の Markdown|Markdown for this change)/ })
    await editTextarea.fill('MANUAL REVIEW')
    await expect(applyButton).toBeDisabled()
    await expect(editor).toContainText('lambda')
    await expect(editor).not.toContainText('MANUAL REVIEW')
    await dialog.getByRole('button', { name: /^(編集を保存|Save edit)$/ }).click()
    await expect(editTextarea).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: /(変更 2\/2 を編集|Edit change 2 of 2)/ })).toBeFocused()
    await expect(dialog.locator('.change-preview-line.added').filter({ hasText: 'MANUAL REVIEW' })).toHaveCount(1)

    await hunkToggles.nth(0).click()
    await expect(dialog.getByText(/未選択の 1 件を破棄|discards 1 unselected change/i)).toBeVisible()
    await applyButton.click()

    await expect(proposalPage.getByRole('dialog')).toHaveCount(0)
    await expect(editor).toContainText('alpha')
    await expect(editor).not.toContainText('ALPHA')
    await expect(editor).toContainText('MANUAL REVIEW')
    await expect(editor).not.toContainText('LAMBDA')
    const applyPayload = await proposalPage.evaluate(() => {
      return (window as Window & {
        __mdvChangeProposalTest?: {
          getLastApplyPayload: () => {
            proposalId: string
            expectedRevision: number
            expectedProposalFingerprint: string
            selectedHunkIds: string[]
          } | null
        }
      }).__mdvChangeProposalTest?.getLastApplyPayload() ?? null
    })
    expect(applyPayload).toEqual({
      proposalId: 'proposal:e2e',
      expectedRevision: 2,
      expectedProposalFingerprint: 'candidate:e2e:2',
      selectedHunkIds: ['proposal:e2e:hunk:2'],
    })
    expect(JSON.stringify(applyPayload)).not.toContain('MANUAL REVIEW')

    await proposalPage.close()
  })

  test('keeps a rejected manual edit local and retryable without interpreting HTML-like Markdown', async ({ page }) => {
    const proposalPage = await page.context().newPage()
    await installDesktopImageResolutionStub(proposalPage, {
      dataUrlMap: {},
      changeProposal: true,
      changeProposalDetailDelayMs: 50,
      changeProposalReviseFailures: 1,
    })
    await proposalPage.goto('/')
    await openWritePanel(proposalPage)
    await replaceMarkdownDocument(proposalPage, CHANGE_PROPOSAL_BASELINE)
    await proposalPage.evaluate(async () => {
      await (window as Window & {
        __mdvChangeProposalTest?: { open: () => Promise<void> }
      }).__mdvChangeProposalTest?.open()
    })

    const dialog = proposalPage.getByRole('dialog', { name: /(AI の変更提案を確認|Review AI change proposal)/ })
    await expect(dialog.locator('.change-preview-hunk')).toHaveCount(2)
    await dialog.getByRole('button', { name: /(変更 1\/2 を編集|Edit change 1 of 2)/ }).click()
    const editTextarea = dialog.getByRole('textbox', { name: /(この変更の Markdown|Markdown for this change)/ })
    const literalMarkdown = '<script data-proposal-test>literal</script>'
    await editTextarea.fill(literalMarkdown)
    await dialog.getByRole('button', { name: /^(編集を保存|Save edit)$/ }).click()

    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('alert')).toContainText('revision unavailable')
    await expect(editTextarea).toHaveValue(literalMarkdown)
    await expect(proposalPage.locator('script[data-proposal-test]')).toHaveCount(0)
    await expect(proposalPage.locator('.toastui-editor-md-container .toastui-editor').first()).toContainText('alpha')
    await expect(proposalPage.getByRole('button', { name: /(選択した.*適用|Apply .* selected)/ })).toBeDisabled()

    await dialog.getByRole('button', { name: /^(編集を保存|Save edit)$/ }).click()
    await expect(editTextarea).toHaveCount(0)
    await expect(dialog.locator('.change-preview-line.added').filter({ hasText: '<script data-proposal-test>literal</script>' })).toHaveCount(1)
    await expect(proposalPage.locator('script[data-proposal-test]')).toHaveCount(0)
    await dialog.getByRole('button', { name: /^(キャンセル|Cancel)$/ }).click()
    await expect(dialog).toHaveCount(0)

    await proposalPage.close()
  })

  test('recovers authoritative detail after a saved edit acknowledgement is lost', async ({ page }) => {
    const proposalPage = await page.context().newPage()
    await installDesktopImageResolutionStub(proposalPage, {
      dataUrlMap: {},
      changeProposal: true,
      changeProposalDetailDelayMs: 50,
      changeProposalReviseAckLosses: 1,
    })
    await proposalPage.goto('/')
    await openWritePanel(proposalPage)
    await replaceMarkdownDocument(proposalPage, CHANGE_PROPOSAL_BASELINE)
    await proposalPage.evaluate(async () => {
      await (window as Window & {
        __mdvChangeProposalTest?: { open: () => Promise<void> }
      }).__mdvChangeProposalTest?.open()
    })

    const dialog = proposalPage.getByRole('dialog', { name: /(AI の変更提案を確認|Review AI change proposal)/ })
    await expect(dialog.locator('.change-preview-hunk')).toHaveCount(2)
    const secondEditButton = dialog.getByRole('button', { name: /(変更 2\/2 を編集|Edit change 2 of 2)/ })
    await secondEditButton.click()
    const editTextarea = dialog.getByRole('textbox', { name: /(この変更の Markdown|Markdown for this change)/ })
    await expect(editTextarea).toBeFocused()
    await editTextarea.fill('ACK RECOVERED')
    await dialog.getByRole('button', { name: /^(編集を保存|Save edit)$/ }).click()

    await expect(editTextarea).toHaveCount(0)
    await expect(secondEditButton).toBeFocused()
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await expect(dialog.locator('.change-preview-line.added').filter({ hasText: 'ACK RECOVERED' })).toHaveCount(1)

    await proposalPage.locator('.change-preview-toggle input').nth(0).click()
    await dialog.getByRole('button', { name: /(選択した.*適用|Apply .* selected)/ }).click()
    const editor = proposalPage.locator('.toastui-editor-md-container .toastui-editor').first()
    await expect(dialog).toHaveCount(0)
    await expect(editor).toContainText('ACK RECOVERED')
    await expect(editor).not.toContainText('LAMBDA')

    await proposalPage.close()
  })

  test('fails stale Apply closed without changing the editor', async ({ page }) => {
    const proposalPage = await page.context().newPage()
    await setupChangeProposalPage(proposalPage)
    await proposalPage.evaluate(() => {
      const proposalTest = (window as Window & {
        __mdvChangeProposalTest?: { forceStaleApply: () => void }
      }).__mdvChangeProposalTest
      proposalTest?.forceStaleApply()
    })

    await proposalPage.getByRole('button', { name: /(選択した.*適用|Apply .* selected)/ }).click()

    const editor = proposalPage.locator('.toastui-editor-md-container .toastui-editor').first()
    await expect(proposalPage.getByRole('dialog')).toHaveCount(0)
    await expect(editor).toContainText('alpha')
    await expect(editor).toContainText('lambda')
    await expect(editor).not.toContainText('ALPHA')
    await expect(editor).not.toContainText('LAMBDA')
    await expect(proposalPage.locator('.statusbar-status')).toContainText(/(文書が変更されたため|document changed)/i)

    await proposalPage.close()
  })

  test('Cancel closes the proposal without changing the editor', async ({ page }) => {
    const proposalPage = await page.context().newPage()
    await setupChangeProposalPage(proposalPage)

    await proposalPage.getByRole('button', { name: /^(キャンセル|Cancel)$/ }).click()

    const editor = proposalPage.locator('.toastui-editor-md-container .toastui-editor').first()
    await expect(proposalPage.getByRole('dialog')).toHaveCount(0)
    await expect(editor).toContainText('alpha')
    await expect(editor).toContainText('lambda')
    await expect(editor).not.toContainText('ALPHA')
    await expect(editor).not.toContainText('LAMBDA')

    await proposalPage.close()
  })
})

test('editor mode keeps the outline and a non-zero Toast UI surface', async ({ page }) => {
  await openWritePanel(page)
  await expect(page.locator('.outline-panel')).toHaveCount(1)
  await expect(computedStyle(page, '.toastui-editor-md-tab-container', 'display')).resolves.toBe('none')
  await expect(page.locator('.toastui-editor-md-container .toastui-editor').first()).toHaveAttribute('spellcheck', 'false')

  const toastRect = await rect(page, '.toastui-editor-defaultUI')
  expect(toastRect.height).toBeGreaterThan(300)
})

test('editor disables browser spellcheck in Markdown and WYSIWYG modes', async ({ page }) => {
  await openWritePanel(page)
  await expect(page.locator('.toastui-editor-md-container .toastui-editor').first()).toHaveAttribute('spellcheck', 'false')

  await switchToastEditorMode(page, 'wysiwyg')
  await expect(page.locator('.toastui-editor-ww-container .ProseMirror').first()).toHaveAttribute('spellcheck', 'false')
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
  await expect(page.getByRole('group', { name: /(挿入操作|Insert actions)/ }).getByRole('button', { name: /(表操作|Table actions)/ })).toBeVisible()
  await expect(page.locator('.topbar').getByRole('button', { name: /(表を整形|Format table)/ })).toHaveCount(0)
  await page.getByRole('group', { name: /(挿入操作|Insert actions)/ }).getByRole('button', { name: /(表操作|Table actions)/ }).click()
  await expect(page.locator('.topbar').getByRole('menu', { name: /(表操作|Table actions)/ }).getByRole('menuitem', { name: /(表の列を中央揃え|Align table column center)/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.topbar').getByRole('menu', { name: /(表操作|Table actions)/ })).toHaveCount(0)
  await expect(page.getByTitle(/(テーマ|Theme)/)).toHaveCount(0)
  await expect(page.getByRole('group', { name: /(ファイル操作|File actions)/ }).locator('.icon-button').nth(0)).toHaveAttribute('title', /(新規文書を作成する|Create new document)/)
  await expect(computedStyle(page, '.toastui-editor-toolbar', 'display')).resolves.toBe('none')
})

test('narrow editor topbar keeps table actions reachable from the menu', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 720 })
  await openWritePanel(page)

  const markdown = [
    '| Name | Score |',
    '| --- | --- |',
    '| Alpha | 10 |',
  ].join('\n')
  const topbar = page.locator('.topbar')

  await replaceMarkdownDocument(page, markdown, null)
  await placeEditorCursorFromStart(page, markdown.indexOf('10'))
  await expect(topbar.getByRole('button', { name: /(表操作|Table actions)/ })).toBeVisible()
  await topbar.getByRole('button', { name: /(表操作|Table actions)/ }).click()
  await topbar.getByRole('menuitem', { name: /(表の列を右揃え|Align table column right)/ }).click()
  await expect(topbar.getByRole('menu', { name: /(表操作|Table actions)/ })).toHaveCount(0)
  await expect(page.locator('.toastui-editor-md-container .toastui-editor').first()).toContainText('| ----- | ----: |')
})

test('editor search button opens a dialog and save stays disabled until dirty', async ({ page }) => {
  await openWritePanel(page)

  await expect(page.getByRole('button', { name: saveButtonName })).toBeDisabled()
  await page.getByRole('button', { name: /(エディタ内を検索|Search in editor)/ }).click()
  await expect(page.getByRole('dialog', { name: /(エディタ内を検索|Search in editor)/ })).toBeVisible()
  await expect(computedStyle(page, '.topbar', 'zIndex')).resolves.toBe('50')
  await expect(computedStyle(page, '.search-dialog-backdrop', 'zIndex')).resolves.toBe('100')
  await closeEditorSearchDialog(page)

  await replaceMarkdownDocument(page, 'alpha beta\n')
  await expect(page.getByRole('button', { name: saveButtonName })).toBeEnabled()
})

test('new document button opens an untitled editor document', async ({ page }) => {
  await page.getByRole('group', { name: /(ファイル操作|File actions)/ }).locator('.icon-button').nth(0).click()

  await expect(page.locator('.view-switch button').nth(0)).toHaveClass(/active/)
  await expect.poll(async () => page.title()).toMatch(/(無題\.md|Untitled\.md) - MDV/i)
  await expect(page.locator('.editor-sample-placeholder')).toHaveCount(0)
  await expect(page.locator('.preview-scroll-placeholder')).toHaveCount(0)
  await expect(page.locator('.outline-empty')).toHaveCount(1)
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

test('preview H3 and H4 headings keep reset chrome while the active heading is highlighted', async ({ page }) => {
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
        active: element.getAttribute('data-mdv-preview-active'),
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
  expect(headingStyles.h4?.active).toBe('true')
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

test('preview and WYSIWYG body inline code stay scoped to editor typography', async ({ page }) => {
  await openWritePanel(page)
  await replaceMarkdownDocument(
    page,
    'Paragraph with `inline code` text.\n\n```txt\nblock code\n```\n',
  )

  await page.locator('.view-switch button').nth(1).click()
  await expect(page.locator('.view-switch button').nth(1)).toHaveClass(/active/)
  await expect(page.locator('.preview-panel .markdown-fragment p code')).toBeVisible()

  const previewInlineCode = await page.evaluate(() => {
    const paragraph = document.querySelector<HTMLElement>('.preview-panel .markdown-fragment p')
    const code = document.querySelector<HTMLElement>('.preview-panel .markdown-fragment p code')

    if (!paragraph || !code) {
      return null
    }

    const paragraphStyles = getComputedStyle(paragraph)
    const codeStyles = getComputedStyle(code)

    const codeBlock = document.querySelector<HTMLElement>('.preview-panel .code-block-shell pre code')
    const codeBlockStyles = codeBlock ? getComputedStyle(codeBlock) : null

    return {
      paragraphFontSize: paragraphStyles.fontSize,
      codeBackgroundColor: codeStyles.backgroundColor,
      codeBorderTopStyle: codeStyles.borderTopStyle,
      codeBorderTopWidth: codeStyles.borderTopWidth,
      codeBorderRadius: codeStyles.borderRadius,
      codeFontFamily: codeStyles.fontFamily,
      codeFontSize: codeStyles.fontSize,
      codeLineHeight: codeStyles.lineHeight,
      codePaddingLeft: codeStyles.paddingLeft,
      codePaddingRight: codeStyles.paddingRight,
      codeBlockBackgroundColor: codeBlockStyles?.backgroundColor ?? null,
      codeBlockBorderTopStyle: codeBlockStyles?.borderTopStyle ?? null,
      codeBlockFontSize: codeBlockStyles?.fontSize ?? null,
      codeBlockLineHeight: codeBlockStyles?.lineHeight ?? null,
      codeBlockPaddingLeft: codeBlockStyles?.paddingLeft ?? null,
    }
  })

  expect(previewInlineCode).not.toBeNull()
  expect(previewInlineCode?.paragraphFontSize).toBe('13px')
  expect(previewInlineCode?.codeBackgroundColor).toBe('rgb(244, 234, 219)')
  expect(previewInlineCode?.codeBorderTopStyle).toBe('solid')
  expect(previewInlineCode?.codeBorderTopWidth).toBe('1px')
  expect(parseFloat(previewInlineCode?.codeBorderRadius ?? '0')).toBeCloseTo(4.5448, 2)
  expect(previewInlineCode?.codeFontFamily).toContain('Cascadia Code')
  expect(parseFloat(previewInlineCode?.codeFontSize ?? '0')).toBeCloseTo(11.96, 2)
  expect(parseFloat(previewInlineCode?.codeLineHeight ?? '0')).toBeCloseTo(16.744, 2)
  expect(parseFloat(previewInlineCode?.codePaddingLeft ?? '0')).toBeCloseTo(4.3056, 2)
  expect(parseFloat(previewInlineCode?.codePaddingRight ?? '0')).toBeCloseTo(4.3056, 2)
  expect(previewInlineCode?.codeBlockBackgroundColor).toBe('rgba(0, 0, 0, 0)')
  expect(previewInlineCode?.codeBlockBorderTopStyle).toBe('none')
  expect(previewInlineCode?.codeBlockFontSize).toBe('13px')
  expect(previewInlineCode?.codeBlockLineHeight).toBe('20.8px')
  expect(previewInlineCode?.codeBlockPaddingLeft).toBe('0px')

  await openWritePanel(page)
  await switchToastEditorMode(page, 'wysiwyg')
  await expect(page.locator('.toastui-editor-ww-container .ProseMirror p code')).toBeVisible()

  const wysiwygInlineCode = await page.evaluate(() => {
    const paragraph = document.querySelector<HTMLElement>('.toastui-editor-ww-container .ProseMirror p')
    const code = document.querySelector<HTMLElement>('.toastui-editor-ww-container .ProseMirror p code')
    const codeBlock = document.querySelector<HTMLElement>('.toastui-editor-ww-container .ProseMirror pre')

    if (!paragraph || !code || !codeBlock) {
      return null
    }

    const paragraphStyles = getComputedStyle(paragraph)
    const codeStyles = getComputedStyle(code)
    const codeBlockStyles = getComputedStyle(codeBlock)
    const codeBlockRect = codeBlock.getBoundingClientRect()

    return {
      paragraphFontSize: paragraphStyles.fontSize,
      codeBackgroundColor: codeStyles.backgroundColor,
      codeBorderTopStyle: codeStyles.borderTopStyle,
      codeBorderTopWidth: codeStyles.borderTopWidth,
      codeBorderRadius: codeStyles.borderRadius,
      codeFontFamily: codeStyles.fontFamily,
      codeFontSize: codeStyles.fontSize,
      codeLineHeight: codeStyles.lineHeight,
      codePaddingLeft: codeStyles.paddingLeft,
      codePaddingRight: codeStyles.paddingRight,
      codeBlockFontFamily: codeBlockStyles.fontFamily,
      codeBlockFontSize: codeBlockStyles.fontSize,
      codeBlockLineHeight: codeBlockStyles.lineHeight,
      codeBlockHeight: codeBlockRect.height,
    }
  })

  expect(wysiwygInlineCode).not.toBeNull()
  expect(wysiwygInlineCode?.paragraphFontSize).toBe('13px')
  expect(wysiwygInlineCode?.codeBackgroundColor).toBe('rgb(244, 234, 219)')
  expect(wysiwygInlineCode?.codeBorderTopStyle).toBe('solid')
  expect(wysiwygInlineCode?.codeBorderTopWidth).toBe('1px')
  expect(parseFloat(wysiwygInlineCode?.codeBorderRadius ?? '0')).toBeCloseTo(4.5448, 2)
  expect(wysiwygInlineCode?.codeFontFamily).toContain('Cascadia Code')
  expect(parseFloat(wysiwygInlineCode?.codeFontSize ?? '0')).toBeCloseTo(11.96, 2)
  expect(parseFloat(wysiwygInlineCode?.codeLineHeight ?? '0')).toBeCloseTo(16.744, 2)
  expect(parseFloat(wysiwygInlineCode?.codePaddingLeft ?? '0')).toBeCloseTo(4.3056, 2)
  expect(parseFloat(wysiwygInlineCode?.codePaddingRight ?? '0')).toBeCloseTo(4.3056, 2)
  expect(wysiwygInlineCode?.codeBlockFontFamily).toContain('Cascadia Code')
  expect(wysiwygInlineCode?.codeBlockFontSize).toBe('13px')
  expect(wysiwygInlineCode?.codeBlockLineHeight).toBe('20.8px')
  expect(wysiwygInlineCode?.codeBlockHeight).toBeGreaterThan(40)
})

test('preview code fence and Mermaid blocks keep rendered content height', async ({ page }) => {
  await openWritePanel(page)
  await replaceMarkdownDocument(
    page,
    [
      '# Rendered blocks',
      '',
      '```ts',
      'const alpha = 1',
      'const beta = 2',
      'console.log(alpha + beta)',
      '```',
      '',
      '```mermaid',
      'flowchart TD',
      '  A[Start] --> B{Choice}',
      '  B --> C[One]',
      '  B --> D[Two]',
      '```',
      '',
    ].join('\n'),
  )

  await page.locator('.view-switch button').nth(1).click()
  await expect(page.locator('.view-switch button').nth(1)).toHaveClass(/active/)
  await expect(page.locator('.preview-panel .code-block-shell pre code')).toBeVisible()
  await expect(page.locator('.preview-panel .mermaid-block')).toHaveAttribute('data-render-state', 'ready')

  const renderedBlockMetrics = await page.evaluate(() => {
    const codeBlock = document.querySelector<HTMLElement>('.preview-panel .code-block-shell pre code')
    const mermaidBlock = document.querySelector<HTMLElement>('.preview-panel .mermaid-block')
    const mermaidSvg = document.querySelector<SVGElement>('.preview-panel .mermaid-block svg')

    if (!codeBlock || !mermaidBlock || !mermaidSvg) {
      return null
    }

    const codeBlockRect = codeBlock.getBoundingClientRect()
    const mermaidBlockRect = mermaidBlock.getBoundingClientRect()
    const mermaidSvgRect = mermaidSvg.getBoundingClientRect()
    const codeBlockStyles = getComputedStyle(codeBlock)
    const mermaidBlockStyles = getComputedStyle(mermaidBlock)
    const mermaidSvgStyles = getComputedStyle(mermaidSvg)

    return {
      codeBlockHeight: codeBlockRect.height,
      codeBlockFontFamily: codeBlockStyles.fontFamily,
      codeBlockFontSize: codeBlockStyles.fontSize,
      codeBlockLineHeight: codeBlockStyles.lineHeight,
      mermaidBlockHeight: mermaidBlockRect.height,
      mermaidBlockOverflow: mermaidBlockStyles.overflow,
      mermaidSvgDisplay: mermaidSvgStyles.display,
      mermaidSvgHeight: mermaidSvgRect.height,
    }
  })

  expect(renderedBlockMetrics).not.toBeNull()
  expect(renderedBlockMetrics?.codeBlockFontFamily).toContain('Cascadia Code')
  expect(renderedBlockMetrics?.codeBlockFontSize).toBe('13px')
  expect(renderedBlockMetrics?.codeBlockLineHeight).toBe('20.8px')
  expect(renderedBlockMetrics?.codeBlockHeight).toBeGreaterThan(60)
  expect(renderedBlockMetrics?.mermaidBlockOverflow).toBe('visible')
  expect(renderedBlockMetrics?.mermaidSvgDisplay).toBe('block')
  expect(renderedBlockMetrics?.mermaidSvgHeight).toBeGreaterThan(200)
  expect(renderedBlockMetrics?.mermaidBlockHeight).toBeGreaterThan(renderedBlockMetrics?.mermaidSvgHeight ?? 0)
})

test('preview fallback code blocks keep rendered content height', async ({ page }) => {
  await openWritePanel(page)
  await replaceMarkdownDocument(
    page,
    [
      '# Fallback code block',
      '',
      '```c++',
      'int main() {',
      '  return 0;',
      '}',
      '```',
      '',
    ].join('\n'),
    null,
  )

  await page.locator('.view-switch button').nth(1).click()
  await expect(page.locator('.view-switch button').nth(1)).toHaveClass(/active/)
  await expect(page.locator('.preview-panel .markdown-fragment pre code')).toBeVisible()
  await expect(page.locator('.preview-panel .code-block-shell')).toHaveCount(0)

  const fallbackCodeBlockMetrics = await page.evaluate(() => {
    const codeBlock = document.querySelector<HTMLElement>('.preview-panel .markdown-fragment pre code')
    const pre = document.querySelector<HTMLElement>('.preview-panel .markdown-fragment pre')

    if (!codeBlock || !pre) {
      return null
    }

    const preRect = pre.getBoundingClientRect()
    const codeBlockRect = codeBlock.getBoundingClientRect()
    const preStyles = getComputedStyle(pre)
    const codeBlockStyles = getComputedStyle(codeBlock)

    return {
      codeBlockDisplay: codeBlockStyles.display,
      codeBlockHeight: codeBlockRect.height,
      codeBlockText: codeBlock.textContent ?? '',
      preDisplay: preStyles.display,
      preFontFamily: preStyles.fontFamily,
      preFontSize: preStyles.fontSize,
      preHeight: preRect.height,
      preLineHeight: preStyles.lineHeight,
    }
  })

  expect(fallbackCodeBlockMetrics).not.toBeNull()
  expect(fallbackCodeBlockMetrics?.preDisplay).toBe('block')
  expect(fallbackCodeBlockMetrics?.codeBlockDisplay).toBe('block')
  expect(fallbackCodeBlockMetrics?.preFontFamily).toContain('Cascadia Code')
  expect(fallbackCodeBlockMetrics?.preFontSize).toBe('13px')
  expect(fallbackCodeBlockMetrics?.preLineHeight).toBe('20.8px')
  expect(fallbackCodeBlockMetrics?.codeBlockText).toContain('return 0;')
  expect(fallbackCodeBlockMetrics?.codeBlockHeight).toBeGreaterThan(60)
  expect(fallbackCodeBlockMetrics?.preHeight).toBeGreaterThan(fallbackCodeBlockMetrics?.codeBlockHeight ?? 0)
})

test('preview code block shells keep height in long documents', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 720 })
  await openWritePanel(page)

  const filler = Array.from({ length: 48 }, (_, index) => `Paragraph ${index + 1} with enough text to make the preview taller than the panel.`)
    .join('\n\n')

  await replaceMarkdownDocument(
    page,
    [
      '# Long rendered preview',
      '',
      filler,
      '',
      'Safety check:',
      '',
      '```bash',
      'python3 scripts/check_ops_capabilities.py',
      '```',
      '',
      'Import preview:',
      '',
      '```bash',
      'python3 scripts/import_home_ops_repos.py --dry-run',
      '```',
      '',
      'Secret key preview:',
      '',
      '```bash',
      'python3 scripts/copy_secdat_domain_keys.py',
      '```',
      '',
    ].join('\n'),
    null,
  )

  await page.locator('.view-switch button').nth(1).click()
  await expect(page.locator('.view-switch button').nth(1)).toHaveClass(/active/)
  await expect(page.locator('.preview-panel .code-block-shell')).toHaveCount(3)

  const bottomCodeBlockMetrics = await page.evaluate(() => {
    const shell = Array.from(document.querySelectorAll<HTMLElement>('.preview-panel .code-block-shell')).at(-1)
    const pre = shell?.querySelector<HTMLElement>('pre')
    const code = shell?.querySelector<HTMLElement>('code')

    if (!shell || !pre || !code) {
      return null
    }

    const shellRect = shell.getBoundingClientRect()
    const preRect = pre.getBoundingClientRect()
    const codeRect = code.getBoundingClientRect()
    const shellStyles = getComputedStyle(shell)

    return {
      codeHeight: codeRect.height,
      flexShrink: shellStyles.flexShrink,
      preHeight: preRect.height,
      shellHeight: shellRect.height,
      text: code.textContent ?? '',
    }
  })

  expect(bottomCodeBlockMetrics).not.toBeNull()
  expect(bottomCodeBlockMetrics?.flexShrink).toBe('0')
  expect(bottomCodeBlockMetrics?.text).toContain('copy_secdat_domain_keys.py')
  expect(bottomCodeBlockMetrics?.codeHeight).toBeGreaterThan(20)
  expect(bottomCodeBlockMetrics?.preHeight).toBeGreaterThan(40)
  expect(bottomCodeBlockMetrics?.shellHeight).toBeGreaterThan(70)
})

test('wysiwyg-focused H3 and H4 headings keep heading and inline-code reset chrome', async ({ page }) => {
  await openWritePanel(page)
  await replaceMarkdownDocument(
    page,
    '### Third `Heading`\n\nbody\n\n#### Fourth `Heading`\n\nmore\n',
  )

  await switchToastEditorMode(page, 'wysiwyg')

  const h3 = page.locator('.toastui-editor-ww-container .ProseMirror h3').first()
  const h4 = page.locator('.toastui-editor-ww-container .ProseMirror h4').first()
  const h3Code = page.locator('.toastui-editor-ww-container .ProseMirror h3 code').first()
  const h4Code = page.locator('.toastui-editor-ww-container .ProseMirror h4 code').first()

  await expect(h3).toBeVisible()
  await expect(h4).toBeVisible()
  await expect(h3Code).toBeVisible()
  await expect(h4Code).toBeVisible()

  await h3.click()

  const headingStyles = await page.evaluate(() => {
    const pick = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector)

      if (!element) {
        return null
      }

      const styles = getComputedStyle(element)

      return {
        className: element.className,
        backgroundColor: styles.backgroundColor,
        borderTopStyle: styles.borderTopStyle,
        borderTopWidth: styles.borderTopWidth,
        paddingTop: styles.paddingTop,
        paddingRight: styles.paddingRight,
        paddingBottom: styles.paddingBottom,
        paddingLeft: styles.paddingLeft,
        outlineStyle: styles.outlineStyle,
        outlineWidth: styles.outlineWidth,
      }
    }

    return {
      h3: pick('.toastui-editor-ww-container .ProseMirror h3'),
      h4: pick('.toastui-editor-ww-container .ProseMirror h4'),
      h3Code: pick('.toastui-editor-ww-container .ProseMirror h3 code'),
      h4Code: pick('.toastui-editor-ww-container .ProseMirror h4 code'),
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

test('wysiwyg heading DOM stays stable across focus and caret movement', async ({ page }) => {
  await openWritePanel(page)
  await replaceMarkdownDocument(
    page,
    '### Third `Heading`\n\nbody\n\n#### Fourth `Heading`\n\nmore\n',
  )

  await switchToastEditorMode(page, 'wysiwyg')

  const h3 = page.locator('.toastui-editor-ww-container .ProseMirror h3').first()
  const h4 = page.locator('.toastui-editor-ww-container .ProseMirror h4').first()

  await expect(h3).toBeVisible()
  await expect(h4).toBeVisible()

  const beforeSnapshot = await page.evaluate(() => {
    const pick = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector)

      if (!element) {
        return null
      }

      return {
        tagName: element.tagName,
        className: element.className,
        innerHTML: element.innerHTML,
        outerHTML: element.outerHTML,
      }
    }

    return {
      rootClassName: document.querySelector('.toastui-editor-ww-container .ProseMirror')?.className ?? null,
      h3: pick('.toastui-editor-ww-container .ProseMirror h3'),
      h4: pick('.toastui-editor-ww-container .ProseMirror h4'),
      h3Code: pick('.toastui-editor-ww-container .ProseMirror h3 code'),
      h4Code: pick('.toastui-editor-ww-container .ProseMirror h4 code'),
      selectedNodeCount: document.querySelectorAll('.toastui-editor-ww-container .ProseMirror .ProseMirror-selectednode').length,
    }
  })

  await h3.click()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowLeft')

  const afterSnapshot = await page.evaluate(() => {
    const pick = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector)

      if (!element) {
        return null
      }

      return {
        tagName: element.tagName,
        className: element.className,
        innerHTML: element.innerHTML,
        outerHTML: element.outerHTML,
      }
    }

    return {
      rootClassName: document.querySelector('.toastui-editor-ww-container .ProseMirror')?.className ?? null,
      h3: pick('.toastui-editor-ww-container .ProseMirror h3'),
      h4: pick('.toastui-editor-ww-container .ProseMirror h4'),
      h3Code: pick('.toastui-editor-ww-container .ProseMirror h3 code'),
      h4Code: pick('.toastui-editor-ww-container .ProseMirror h4 code'),
      selectedNodeCount: document.querySelectorAll('.toastui-editor-ww-container .ProseMirror .ProseMirror-selectednode').length,
    }
  })

  expect(beforeSnapshot.h3).not.toBeNull()
  expect(beforeSnapshot.h4).not.toBeNull()
  expect(beforeSnapshot.h3Code).not.toBeNull()
  expect(beforeSnapshot.h4Code).not.toBeNull()
  expect(afterSnapshot.h3).toEqual(beforeSnapshot.h3)
  expect(afterSnapshot.h4).toEqual(beforeSnapshot.h4)
  expect(afterSnapshot.h3Code).toEqual(beforeSnapshot.h3Code)
  expect(afterSnapshot.h4Code).toEqual(beforeSnapshot.h4Code)
  expect(afterSnapshot.selectedNodeCount).toBe(0)
})

test('wysiwyg inline-code selection inside heading keeps reset chrome and avoids selectednode classes', async ({ page }) => {
  await openWritePanel(page)
  await replaceMarkdownDocument(
    page,
    '### Third `Heading`\n\nbody\n\n#### Fourth `Heading`\n\nmore\n',
  )

  await switchToastEditorMode(page, 'wysiwyg')
  await expect(page.locator('.toastui-editor-ww-container .ProseMirror h3 code').first()).toBeVisible()

  await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>('.toastui-editor-ww-container .ProseMirror')
    const code = document.querySelector<HTMLElement>('.toastui-editor-ww-container .ProseMirror h3 code')

    if (!editor || !code || !code.firstChild) {
      throw new Error('Missing WYSIWYG heading code node')
    }

    editor.focus()

    const selection = window.getSelection()

    if (!selection) {
      throw new Error('Missing selection object')
    }

    const range = document.createRange()
    range.setStart(code.firstChild, 0)
    range.setEnd(code.firstChild, code.textContent?.length ?? 0)
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange', { bubbles: true }))
  })

  const selectionSnapshot = await page.evaluate(() => {
    const pick = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector)

      if (!element) {
        return null
      }

      const styles = getComputedStyle(element)

      return {
        className: element.className,
        backgroundColor: styles.backgroundColor,
        borderTopStyle: styles.borderTopStyle,
        borderTopWidth: styles.borderTopWidth,
        paddingTop: styles.paddingTop,
        paddingRight: styles.paddingRight,
        paddingBottom: styles.paddingBottom,
        paddingLeft: styles.paddingLeft,
        outlineStyle: styles.outlineStyle,
        outlineWidth: styles.outlineWidth,
      }
    }

    return {
      h3: pick('.toastui-editor-ww-container .ProseMirror h3'),
      h3Code: pick('.toastui-editor-ww-container .ProseMirror h3 code'),
      selectedNodes: Array.from(document.querySelectorAll('.toastui-editor-ww-container .ProseMirror .ProseMirror-selectednode')).map((node) => ({
        tagName: node.tagName,
        className: (node as HTMLElement).className,
      })),
      selectionText: window.getSelection()?.toString() ?? '',
    }
  })

  expect(selectionSnapshot.selectionText).toBe('Heading')
  expect(selectionSnapshot.selectedNodes).toEqual([])
  expect(selectionSnapshot.h3).not.toBeNull()
  expect(selectionSnapshot.h3Code).not.toBeNull()
  expect(selectionSnapshot.h3?.backgroundColor).toBe('rgba(0, 0, 0, 0)')
  expect(selectionSnapshot.h3?.borderTopStyle).toBe('none')
  expect(selectionSnapshot.h3?.borderTopWidth).toBe('0px')
  expect(selectionSnapshot.h3?.paddingTop).toBe('0px')
  expect(selectionSnapshot.h3?.paddingRight).toBe('0px')
  expect(selectionSnapshot.h3?.paddingBottom).toBe('0px')
  expect(selectionSnapshot.h3?.paddingLeft).toBe('0px')
  expect(selectionSnapshot.h3Code?.backgroundColor).toBe('rgba(0, 0, 0, 0)')
  expect(selectionSnapshot.h3Code?.borderTopStyle).toBe('none')
  expect(selectionSnapshot.h3Code?.borderTopWidth).toBe('0px')
  expect(selectionSnapshot.h3Code?.paddingTop).toBe('0px')
  expect(selectionSnapshot.h3Code?.paddingRight).toBe('0px')
  expect(selectionSnapshot.h3Code?.paddingBottom).toBe('0px')
  expect(selectionSnapshot.h3Code?.paddingLeft).toBe('0px')
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

    await installDesktopImageResolutionStub(aiPage)
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

      type TestStreamEvent =
        | { requestId: string; type: 'text-delta'; delta: string }
        | { requestId: string; type: 'tool-event'; phase: 'call' | 'result'; title: string; content: string }
        | { requestId: string; type: 'completed'; reply: string; model: string; responseId: string | null }
        | { requestId: string; type: 'proposal-pending'; proposal: MdvAiChangeProposalSummary; reply: string; model: string; responseId: string | null }

      const baseSettings: MdvSettings = {
        version: 3,
        general: {
          locale: 'ja',
          themeMode: 'system',
          defaultStartPanel: 'preview',
          openLinksBehavior: 'confirm-if-untrusted',
        },
        editor: {
          initialEditType: 'markdown',
          showModeSwitch: true,
          previewStyle: 'vertical',
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
            tavilyWebSearch: false,
            fetchUrl: false,
          },
          openai: {
            enabled: true,
            baseUrl: null,
            model: 'gpt-5.4',
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
            autoDisposeAfterMs: 60_000,
            maxResponseBytes: 1_000_000,
          },
        },
        safety: {
          confirmBeforeFullDocumentOverwrite: true,
          confirmBeforeNewDocumentFromAi: true,
          confirmBeforeExternalUrlOpen: true,
        },
        updates: {
          enabled: false,
          autoCheckOnLaunch: false,
          feedUrl: null,
        },
      }

      type DesktopApi = NonNullable<Window['mdvDesktop']>

      const testWindow = window as Window
      const existingDesktop = testWindow.mdvDesktop as Partial<DesktopApi> | undefined
      let streamCallback: ((event: TestStreamEvent) => void) | null = null
      let proposalResolvedCallback: ((resolution: MdvAiChangeProposalResolution) => void) | null = null
      let dispatchCount = 0

      const nextDesktop = {
        ...existingDesktop,
        platform: existingDesktop?.platform ?? 'test',
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
          updateSettings: async (patch) => {
            void patch
            return baseSettings
          },
          migrateLegacyTheme: async (themeMode) => {
            void themeMode
            return baseSettings
          },
          saveOpenAiApiKey: async (apiKey) => {
            void apiKey
            return {
            openaiConfigured: true,
            tavilyConfigured: false,
            }
          },
          clearOpenAiApiKey: async () => ({
            openaiConfigured: true,
            tavilyConfigured: false,
          }),
          saveTavilyApiKey: async (apiKey) => {
            void apiKey
            return {
            openaiConfigured: true,
            tavilyConfigured: false,
            }
          },
          clearTavilyApiKey: async () => ({
            openaiConfigured: true,
            tavilyConfigured: false,
          }),
          getProviderStatus: async () => ({
            openaiConfigured: true,
            tavilyConfigured: false,
          }),
        },
        sendAiChatMessage: async (payload: TestDispatchPayload) => {
          dispatchCount += 1
          window.setTimeout(() => {
            if (dispatchCount > 1) {
              const timestamp = new Date().toISOString()
              const latestMessage = payload.messages[payload.messages.length - 1]?.content ?? ''
              const resolutionStatus = latestMessage.includes('indeterminate') ? 'indeterminate' : 'applied'
              streamCallback?.({
                requestId: payload.requestId,
                type: 'tool-event',
                phase: 'result',
                title: 'write_target result',
                content: JSON.stringify({ dryRun: true, changeProposal: { proposalId: 'proposal:chat' } }),
              })
              streamCallback?.({
                requestId: payload.requestId,
                type: 'proposal-pending',
                proposal: {
                  proposalId: 'proposal:chat',
                  originRequestId: payload.requestId,
                  editorId: 'editor:chat',
                  title: 'Two line updates',
                  mode: 'replace',
                  hunkCount: 2,
                  wouldWriteBytes: 24,
                  span: { start: { line: 1, column: 1 }, end: { line: 2, column: 1 }, isEmpty: false },
                  replacedSpan: { start: { line: 1, column: 1 }, end: { line: 2, column: 1 }, isEmpty: false },
                  baselineFingerprint: 'baseline:chat',
                  proposalFingerprint: 'candidate:chat',
                  revision: 1,
                  createdAt: timestamp,
                  expiresAt: new Date(Date.now() + 600_000).toISOString(),
                },
                reply: 'RAW_PROVISIONAL_TOOL_ITERATION_SECRET',
                model: 'gpt-test',
                responseId: 'resp_proposal',
              })
              window.setTimeout(() => {
                proposalResolvedCallback?.({
                  proposalId: 'proposal:chat',
                  originRequestId: payload.requestId,
                  editorId: 'editor:chat',
                  title: 'Two line updates',
                  status: resolutionStatus,
                  revision: 1,
                  proposalFingerprint: 'candidate:chat',
                  selectedHunkIds: ['proposal:chat:hunk:2'],
                  appliedHunkCount: resolutionStatus === 'applied' ? 1 : undefined,
                  baselineFingerprint: 'baseline:chat',
                  resultFingerprint: resolutionStatus === 'applied' ? 'result:chat' : undefined,
                  resolvedAt: new Date().toISOString(),
                })
              }, 10)
              return
            }

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
        onAiChangeProposalResolved: (callback: (resolution: MdvAiChangeProposalResolution) => void) => {
          proposalResolvedCallback = callback
          return () => {
            if (proposalResolvedCallback === callback) {
              proposalResolvedCallback = null
            }
          }
        },
      } satisfies Partial<DesktopApi>

      testWindow.mdvDesktop = nextDesktop as DesktopApi
    })
    await aiPage.goto('/')

    await openAiDock(aiPage)
    await aiPage.getByPlaceholder(/アシスタントにメッセージを送る|Message the assistant/).fill('Summarize this')
    await aiPage.getByPlaceholder(/アシスタントにメッセージを送る|Message the assistant/).press('Enter')

    await expect(aiPage.getByText('Working reply')).toBeVisible()
    await expect(aiPage.locator('.chat-tool-summary-meta').getByText('Selection loaded')).toBeVisible()
    await expect(aiPage.getByText('ignore me')).toHaveCount(0)

    await aiPage.getByPlaceholder(/アシスタントにメッセージを送る|Message the assistant/).fill('Propose a change')
    await aiPage.getByPlaceholder(/アシスタントにメッセージを送る|Message the assistant/).press('Enter')

    await expect(aiPage.locator('.ai-chat-transcript')).toContainText('Two line updates')
    await expect(aiPage.locator('.ai-chat-transcript')).toContainText('この AI ターンは提案作成時点で終了し、自動再開しません')
    await expect(aiPage.locator('.ai-chat-transcript')).toContainText('依頼に残作業がある場合')
    await expect(aiPage.locator('.chat-tool-entry').last()).toContainText(/適用しました|Applied/i)
    await expect(aiPage.locator('.ai-chat-transcript')).not.toContainText('RAW_PROVISIONAL_TOOL_ITERATION_SECRET')
    await expect(aiPage.locator('.ai-chat-transcript')).not.toContainText('RAW_BEFORE_SECRET')
    await expect(aiPage.locator('.ai-chat-transcript')).not.toContainText('RAW_AFTER_SECRET')
    await expect(aiPage.locator('.ai-chat-transcript')).not.toContainText('baselineFingerprint')

    await aiPage.getByPlaceholder(/アシスタントにメッセージを送る|Message the assistant/).fill('Propose indeterminate')
    await aiPage.getByPlaceholder(/アシスタントにメッセージを送る|Message the assistant/).press('Enter')

    await expect(aiPage.locator('.chat-tool-entry').last()).toContainText('適用済みの可能性があります')
    await expect(aiPage.locator('.chat-tool-entry').last()).toContainText('現在の文書を確認してから')
    await expect(aiPage.locator('.chat-tool-entry').last()).not.toContainText('baselineFingerprint')

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

  test('preview routes a relative link through the document-link bridge without navigating', async ({ page }) => {
    await page.evaluate(() => {
      const testWindow = window as Window & { __openedDocumentHrefs?: string[] }
      const desktop = testWindow.mdvDesktop
      if (!desktop) {
        throw new Error('Missing desktop test bridge')
      }
      testWindow.__openedDocumentHrefs = []
      testWindow.mdvDesktop = {
        ...desktop,
        openDocumentLink: async (href) => {
          testWindow.__openedDocumentHrefs?.push(href)
          return { status: 'opened', target: 'local', displayName: 'next step.md' }
        },
      }
    })
    await openWritePanel(page)
    await replaceMarkdownDocument(page, '[Next](../guide/next%20step.md#overview)\n\n![Local image](file:///tmp/local-image.png)')
    await page.locator('.view-switch button').nth(1).click()
    const pageUrlBefore = page.url()

    await expect(page.locator('.preview-panel img[src^="file:"]')).toHaveCount(0)
    await expect(page.locator('.preview-panel')).toContainText('![Local image](file:///tmp/local-image.png)')
    await page.locator('.preview-panel a').evaluate((anchor) => {
      anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    })
    await expect.poll(() => page.evaluate(() => (window as Window & { __openedDocumentHrefs?: string[] }).__openedDocumentHrefs)).toEqual([])
    await page.locator('.preview-panel a').click()

    await expect.poll(() => page.evaluate(() => (window as Window & { __openedDocumentHrefs?: string[] }).__openedDocumentHrefs)).toEqual([
      '../guide/next%20step.md#overview',
    ])
    expect(page.url()).toBe(pageUrlBefore)
    await expect(page.locator('.statusbar')).toContainText(/MDV で開きました|Opened in MDV/)

    await openWritePanel(page)
    await switchToastEditorMode(page, 'wysiwyg')
    await page.locator('.toastui-editor-ww-container a').click()
    await expect.poll(() => page.evaluate(() => (window as Window & { __openedDocumentHrefs?: string[] }).__openedDocumentHrefs)).toEqual([
      '../guide/next%20step.md#overview',
      '../guide/next%20step.md#overview',
    ])
    expect(page.url()).toBe(pageUrlBefore)
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

  test('editor source view abbreviates inline data image markdown', async ({ page }) => {
    await openWritePanel(page)

    const markdown = '![logo](data:image/png;base64,QUJDRA==)'

    await replaceMarkdownDocument(page, markdown, null)

    await expect(page.locator('.inline-data-image-widget').first()).toHaveText('data:image/png;base64,<4 B omitted>')
    await expect(page.locator('.toastui-editor-md-container .toastui-editor').first()).not.toContainText('QUJDRA==')
  })

  test('editor source view keeps widgets for multiple inline data images', async ({ page }) => {
    await openWritePanel(page)

    const markdown = [
      '![logo-a](data:image/png;base64,QUJDRA==)',
      '',
      '![logo-b](data:image/png;base64,QUJD)',
    ].join('\n')

    await replaceMarkdownDocument(
      page,
      markdown,
      null,
    )

    await expect(page.locator('.inline-data-image-widget').filter({ hasText: 'data:image/png;base64,<4 B omitted>' })).toHaveCount(2)
    await expect(page.locator('.inline-data-image-widget').filter({ hasText: 'data:image/png;base64,<3 B omitted>' })).toHaveCount(2)
    await expect(page.locator('.toastui-editor-md-container .toastui-editor').first()).not.toContainText('QUJDRA==')
    await expect(page.locator('.toastui-editor-md-container .toastui-editor').first()).not.toContainText('QUJD')
  })

  test('preview renders inline data image markdown as an image', async ({ page }) => {
    await openWritePanel(page)

    const markdown = '![logo](data:image/png;base64,QUJDRA==)'

    await replaceMarkdownDocument(page, markdown, null)

    await page.locator('.view-switch button').nth(1).click()
    await expect(page.locator('.view-switch button').nth(1)).toHaveClass(/active/)
    await expect(page.locator('.preview-panel img').first()).toHaveAttribute('alt', 'logo')
    await expect(page.locator('.preview-panel img').first()).toHaveAttribute('src', 'data:image/png;base64,QUJDRA==')
    await expect(page.locator('.preview-panel')).not.toContainText(markdown)
  })

  test('preview renders url-encoded inline SVG data image markdown as an image', async ({ page }) => {
    await openWritePanel(page)

    const source = 'data:image/svg+xml;utf8,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%221%22%20height=%221%22%3E%3C/svg%3E'
    const markdown = `![logo](${source})`

    await replaceMarkdownDocument(page, markdown)

    await page.locator('.view-switch button').nth(1).click()
    await expect(page.locator('.view-switch button').nth(1)).toHaveClass(/active/)
    await expect(page.locator('.preview-panel img').first()).toHaveAttribute('alt', 'logo')
    await expect(page.locator('.preview-panel img').first()).toHaveAttribute('src', source)
    await expect(page.locator('.preview-panel')).not.toContainText(markdown)
  })

  test('preview keeps url-encoded inline SVG data links as literal markdown', async ({ page }) => {
    await openWritePanel(page)

    const source = 'data:image/svg+xml;utf8,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%221%22%20height=%221%22%3E%3C/svg%3E'
    const markdown = `[logo](${source})`

    await replaceMarkdownDocument(page, markdown)

    await page.locator('.view-switch button').nth(1).click()
    await expect(page.locator('.view-switch button').nth(1)).toHaveClass(/active/)
    await expect(page.locator('.preview-panel img')).toHaveCount(0)
    await expect(page.locator('.preview-panel a')).toHaveCount(0)
    await expect(page.locator('.preview-panel')).toContainText(markdown)
  })

  test('WYSIWYG resolves saved relative images to actual image sources', async ({ page }) => {
    const filePath = '/workspace/docs/example.md'
    const source = './assets/diagram.png'

    await installDesktopImageResolutionStub(page, {
      openFilePayload: {
        path: filePath,
        content: `![diagram](${source})`,
        snapshot: {
          path: filePath,
          contentHash: 'saved-image-hash',
          size: 24,
          mtimeMs: 1718000000000,
        },
      },
      draftWorkspace: null,
      dataUrlMap: {
        [`${filePath}\u0000${source}`]: 'data:image/png;base64,QUJDRA==',
      },
    })

    await page.reload()
    await triggerPrimaryShortcut(page, 'o')
    await expect(page.locator('.title-strip h1')).toContainText('example.md')
    await triggerPrimaryShortcut(page, '1')
    await expect(page.locator('.view-switch button').nth(0)).toHaveClass(/active/)
    await switchToastEditorMode(page, 'wysiwyg')

    const image = page.locator('.toastui-editor-ww-container img').first()
    await expect(image).toHaveAttribute('alt', 'diagram')
    await expect(image).toHaveAttribute('src', /^data:image\/png;base64,QUJDRA==$/)
  })

  test('preview resolves saved relative images to actual image sources', async ({ page }) => {
    const filePath = '/workspace/docs/example.md'
    const source = './assets/diagram.png'

    await installDesktopImageResolutionStub(page, {
      openFilePayload: {
        path: filePath,
        content: `![diagram](${source})`,
        snapshot: {
          path: filePath,
          contentHash: 'saved-image-preview-hash',
          size: 24,
          mtimeMs: 1718000000000,
        },
      },
      draftWorkspace: null,
      dataUrlMap: {
        [`${filePath}\u0000${source}`]: 'data:image/png;base64,UVJFVklFVw==',
      },
    })

    await page.reload()
    await triggerPrimaryShortcut(page, 'o')
    await expect(page.locator('.title-strip h1')).toContainText('example.md')
    await expect(page.locator('.view-switch button').nth(1)).toHaveClass(/active/)

    const image = page.locator('.preview-panel img').first()
    await expect(image).toHaveAttribute('alt', 'diagram')
    await expect(image).toHaveAttribute('src', /^data:image\/png;base64,UVJFVklFVw==$/)
  })

  test('WYSIWYG resolves draft-workspace relative images for unsaved documents', async ({ page }) => {
    const draftMarkdownPath = '/tmp/mdv-draft/workspace-1/untitled.md'
    const source = './assets/draft-image.png'

    await installDesktopImageResolutionStub(page, {
      openFilePayload: null,
      draftWorkspace: {
        workspaceId: 'workspace-1',
        rootDir: '/tmp/mdv-draft/workspace-1',
        markdownFilePath: draftMarkdownPath,
        assetDir: '/tmp/mdv-draft/workspace-1/assets',
        manifestPath: '/tmp/mdv-draft/workspace-1/manifest.json',
      },
      dataUrlMap: {
        [`${draftMarkdownPath}\u0000${source}`]: 'data:image/png;base64,RFJBRlQ=',
      },
    })

    await page.reload()
    await triggerPrimaryShortcut(page, '1')
    await expect(page.locator('.view-switch button').nth(0)).toHaveClass(/active/)
    await replaceMarkdownDocument(page, `![draft image](${source})`)
    await switchToastEditorMode(page, 'wysiwyg')

    const image = page.locator('.toastui-editor-ww-container img').first()
    await expect(image).toHaveAttribute('alt', 'draft image')
    await expect(image).toHaveAttribute('src', /^data:image\/png;base64,RFJBRlQ=$/)
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

  test('footnote command uses the WYSIWYG selection as the insert anchor', async ({ page }) => {
    await openWritePanel(page)
    await replaceMarkdownDocument(page, 'Intro paragraph with selected note text.')
    await switchToastEditorMode(page, 'wysiwyg')

    const wysiwygEditor = page.locator('.toastui-editor-ww-container .ProseMirror').first()
    await wysiwygEditor.click()
    await page.keyboard.press(moveEditorCursorToStartShortcut)

    for (let index = 0; index < 'Intro paragraph with '.length; index += 1) {
      await page.keyboard.press('ArrowRight')
    }

    await page.keyboard.down('Shift')

    for (let index = 0; index < 'selected note'.length; index += 1) {
      await page.keyboard.press('ArrowRight')
    }

    await page.keyboard.up('Shift')
    await page.locator('.topbar').getByRole('button', { name: /(脚注を挿入|Insert footnote)/ }).click()
    await switchToastEditorMode(page, 'markdown')

    const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()
    await expect(editor).toContainText('Intro paragraph with [^1] text.')
    await expect(editor).toContainText('[^1]: selected note')
  })

  test('horizontal rule command inserts a thematic break on its own block', async ({ page }) => {
    await openWritePanel(page)
    await replaceMarkdownDocument(page, 'before\n\nafter')
    await placeEditorCursorFromStart(page, 6)

    await page.locator('.topbar').getByRole('button', { name: /(水平線を挿入|Insert horizontal rule)/ }).click()

    await expect(page.locator('.toastui-editor-md-container .toastui-editor').first()).toContainText(/before[\s\S]*---[\s\S]*after/)
  })

  test('table command inserts a Markdown table template and updates the preview', async ({ page }) => {
    await openWritePanel(page)
    await replaceMarkdownDocument(page, 'before table')
    await placeEditorCursorFromStart(page, 'before table'.length)

    await clickTableAction(page, /(表を挿入|Insert table)/)

    const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()
    await expect(editor).toContainText('Column 1')
    await expect(editor).toContainText('Column 2')
    await expect(editor).toContainText('Column 3')

    await page.locator('.view-switch button').nth(1).click()
    await expect(page.locator('.preview-panel table')).toHaveCount(1)
    await expect(page.locator('.preview-panel th').nth(0)).toHaveText('Column 1')
    await expect(page.locator('.preview-panel td').nth(0)).toHaveText('Cell')
  })

  test('format table command aligns the current Markdown table block', async ({ page }) => {
    await openWritePanel(page)

    const markdown = [
      'Before',
      '',
      '| Name |Status|',
      '| --- | ---: |',
      '| Alpha |1|',
      '| Beta value |20|',
      '',
      'After',
    ].join('\n')

    await replaceMarkdownDocument(page, markdown, null)
    await placeEditorCursorFromStart(page, markdown.indexOf('Alpha'))
    await clickTableAction(page, /(表を整形|Format table)/)

    const editorText = await page.locator('.toastui-editor-md-container .toastui-editor').first().textContent()
    expect(editorText).toContain('Before')
    expect(editorText).toContain('| Name       | Status |')
    expect(editorText).toContain('| ---------- | -----: |')
    expect(editorText).toContain('| Alpha      |      1 |')
    expect(editorText).toContain('| Beta value |     20 |')
    expect(editorText).toContain('After')
  })

  test('format table command preserves adjacent non-table pipe blocks', async ({ page }) => {
    await openWritePanel(page)

    const markdown = [
      '| Name | Status |',
      '| --- | --- |',
      '| Alpha | Open |',
      '> note | value',
      '',
      '- list | value',
    ].join('\n')

    await replaceMarkdownDocument(page, markdown, null)
    await placeEditorCursorFromStart(page, markdown.indexOf('Alpha'))
    await clickTableAction(page, /(表を整形|Format table)/)

    const editorText = await page.locator('.toastui-editor-md-container .toastui-editor').first().textContent()
    expect(editorText).toContain('| Name  | Status |')
    expect(editorText).toContain('| ----- | ------ |')
    expect(editorText).toContain('| Alpha | Open   |')
    expect(editorText).toContain('> note | value')
    expect(editorText).toContain('- list | value')
  })

  test('format table command accepts GFM tables with short delimiters and pipe-less uneven body cells', async ({ page }) => {
    await openWritePanel(page)

    const markdown = [
      '| Name | Score |',
      '| - | -: |',
      'Alpha',
      '| Beta | 20 | ignored |',
    ].join('\n')

    await replaceMarkdownDocument(page, markdown, null)
    await placeEditorCursorFromStart(page, markdown.indexOf('Alpha'))
    await clickTableAction(page, /(表を整形|Format table)/)

    const editorText = await page.locator('.toastui-editor-md-container .toastui-editor').first().textContent()
    expect(editorText).toContain('| Name  | Score |')
    expect(editorText).toContain('| ----- | ----: |')
    expect(editorText).toContain('| Alpha |       |')
    expect(editorText).toContain('| Beta  |    20 |')
    expect(editorText).not.toContain('ignored')
  })

  test('add table row command inserts an empty row after the current table row', async ({ page }) => {
    await openWritePanel(page)

    const markdown = [
      '| Name | Status |',
      '| --- | --- |',
      '| Alpha | Open |',
      '| Beta | Done |',
    ].join('\n')

    await replaceMarkdownDocument(page, markdown, null)
    await placeEditorCursorFromStart(page, markdown.indexOf('Alpha'))
    await clickTableAction(page, /(表の行を追加|Add table row)/)

    const editorText = await page.locator('.toastui-editor-md-container .toastui-editor').first().textContent()
    const sourceText = editorText ?? ''
    const alphaRowIndex = sourceText.indexOf('| Alpha | Open |')
    const insertedRowIndex = sourceText.indexOf('|  |  |')
    const betaRowIndex = sourceText.indexOf('| Beta | Done |')

    expect(alphaRowIndex).toBeGreaterThanOrEqual(0)
    expect(insertedRowIndex).toBeGreaterThan(alphaRowIndex)
    expect(betaRowIndex).toBeGreaterThan(insertedRowIndex)

    await page.locator('.view-switch button').nth(1).click()
    await expect(page.locator('.preview-panel tbody tr')).toHaveCount(3)
  })

  test('add table row command reports no target outside rendered table blocks', async ({ page }) => {
    await openWritePanel(page)
    await replaceMarkdownDocument(page, 'Paragraph | value')
    await placeEditorCursorFromStart(page, 'Paragraph'.length)

    await clickTableAction(page, /(表の行を追加|Add table row)/)

    await expect(page.locator('.toastui-editor-md-container .toastui-editor').first()).toContainText('Paragraph | value')
    await expect(page.locator('.statusbar-status')).toContainText(/表の行を追加 できる対象がありません|No target for Add table row/)
  })

  test('add table column command inserts an empty column after the current table column', async ({ page }) => {
    await openWritePanel(page)

    const markdown = [
      '| Name | Status |',
      '| --- | --- |',
      '| Alpha | Open |',
      '| Beta | Done |',
    ].join('\n')

    await replaceMarkdownDocument(page, markdown, null)
    await placeEditorCursorFromStart(page, markdown.indexOf('Alpha'))
    await clickTableAction(page, /(表の列を追加|Add table column)/)

    const editorText = await page.locator('.toastui-editor-md-container .toastui-editor').first().textContent()
    expect(editorText).toContain('| Name  |     | Status |')
    expect(editorText).toContain('| ----- | --- | ------ |')
    expect(editorText).toContain('| Alpha |     | Open   |')
    expect(editorText).toContain('| Beta  |     | Done   |')

    await page.locator('.view-switch button').nth(1).click()
    await expect(page.locator('.preview-panel th')).toHaveCount(3)
    await expect(page.locator('.preview-panel tbody tr').first().locator('td').nth(1)).toHaveText('')
    await expect(page.locator('.preview-panel tbody tr').first().locator('td').nth(2)).toHaveText('Open')
  })

  test('add table column command preserves existing alignment and adjacent non-table pipe blocks', async ({ page }) => {
    await openWritePanel(page)

    const markdown = [
      '| Name | Score |',
      '| --- | ---: |',
      '| Alpha | 10 |',
      '| Beta | 200 |',
      '> note | value',
    ].join('\n')

    await replaceMarkdownDocument(page, markdown, null)
    await placeEditorCursorFromStart(page, markdown.indexOf('Alpha'))
    await clickTableAction(page, /(表の列を追加|Add table column)/)

    const editorText = await page.locator('.toastui-editor-md-container .toastui-editor').first().textContent()
    expect(editorText).toContain('| Name  |     | Score |')
    expect(editorText).toContain('| ----- | --- | ----: |')
    expect(editorText).toContain('| Alpha |     |    10 |')
    expect(editorText).toContain('| Beta  |     |   200 |')
    expect(editorText).toContain('> note | value')
  })

  test('add table column command uses the selection end column as the insertion anchor', async ({ page }) => {
    await openWritePanel(page)

    const markdown = [
      '| Name | Status |',
      '| --- | --- |',
      '| Alpha | Open |',
      '| Beta | Done |',
    ].join('\n')

    await replaceMarkdownDocument(page, markdown, null)
    await placeEditorCursorFromStart(page, markdown.indexOf('Alpha'))
    await page.keyboard.down('Shift')

    for (let index = 0; index < 'Alpha | Open'.length; index += 1) {
      await page.keyboard.press('ArrowRight')
    }

    await page.keyboard.up('Shift')
    await clickTableAction(page, /(表の列を追加|Add table column)/)

    const editorText = await page.locator('.toastui-editor-md-container .toastui-editor').first().textContent()
    expect(editorText).toContain('| Name  | Status |     |')
    expect(editorText).toContain('| Alpha | Open   |     |')
    expect(editorText).toContain('| Beta  | Done   |     |')
  })

  test('add table column command reports no target outside rendered table blocks', async ({ page }) => {
    await openWritePanel(page)
    await replaceMarkdownDocument(page, 'Paragraph | value')
    await placeEditorCursorFromStart(page, 'Paragraph'.length)

    await clickTableAction(page, /(表の列を追加|Add table column)/)

    await expect(page.locator('.toastui-editor-md-container .toastui-editor').first()).toContainText('Paragraph | value')
    await expect(page.locator('.statusbar-status')).toContainText(/表の列を追加 できる対象がありません|No target for Add table column/)
  })

  const tableColumnAlignmentCases = [
    {
      name: 'default',
      action: /(表の列揃えを標準にする|Set table column default alignment)/,
      separator: '| ----- | ----- |',
      alphaRow: '| Alpha | 10    |',
      betaRow: '| Beta  | 200   |',
    },
    {
      name: 'left',
      action: /(表の列を左揃え|Align table column left)/,
      separator: '| ----- | :---- |',
      alphaRow: '| Alpha | 10    |',
      betaRow: '| Beta  | 200   |',
    },
    {
      name: 'center',
      action: /(表の列を中央揃え|Align table column center)/,
      separator: '| ----- | :---: |',
      alphaRow: '| Alpha |  10   |',
      betaRow: '| Beta  |  200  |',
    },
    {
      name: 'right',
      action: /(表の列を右揃え|Align table column right)/,
      separator: '| ----- | ----: |',
      alphaRow: '| Alpha |    10 |',
      betaRow: '| Beta  |   200 |',
    },
  ]

  for (const alignmentCase of tableColumnAlignmentCases) {
    test(`table column alignment command updates the current column marker to ${alignmentCase.name}`, async ({ page }) => {
      await openWritePanel(page)

      const markdown = [
        '| Name | Score |',
        '| --- | ---: |',
        '| Alpha | 10 |',
        '| Beta | 200 |',
      ].join('\n')

      await replaceMarkdownDocument(page, markdown, null)
      await placeEditorCursorFromStart(page, markdown.indexOf('10'))
      await clickTableAction(page, alignmentCase.action)

      const editorText = await page.locator('.toastui-editor-md-container .toastui-editor').first().textContent()
      expect(editorText).toContain('| Name  | Score |')
      expect(editorText).toContain(alignmentCase.separator)
      expect(editorText).toContain(alignmentCase.alphaRow)
      expect(editorText).toContain(alignmentCase.betaRow)
    })
  }

  test('table column alignment command reports no target outside rendered table blocks', async ({ page }) => {
    await openWritePanel(page)
    await replaceMarkdownDocument(page, 'Paragraph | value')
    await placeEditorCursorFromStart(page, 'Paragraph'.length)

    await clickTableAction(page, /(表の列を右揃え|Align table column right)/)

    await expect(page.locator('.toastui-editor-md-container .toastui-editor').first()).toContainText('Paragraph | value')
    await expect(page.locator('.statusbar-status')).toContainText(/表の列を右揃え できる対象がありません|No target for Align table column right/)
  })

  test('standard editor continues ordered, unordered, nested, and task list items', async ({ page }) => {
    await openWritePanel(page)

    const cases = [
      { initial: '- Alpha', inserted: 'Beta', expected: '- Beta' },
      { initial: '1. Alpha', inserted: 'Beta', expected: '2. Beta' },
      { initial: '  - Alpha', inserted: 'Beta', expected: '  - Beta' },
      { initial: '- [ ] Alpha', inserted: 'Beta', expected: '- [ ] Beta' },
    ]

    const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()

    for (const listCase of cases) {
      await replaceMarkdownDocument(page, listCase.initial)
      await placeEditorCursorFromStart(page, listCase.initial.length)
      await page.keyboard.press('Enter')
      await page.keyboard.insertText(listCase.inserted)

      const editorText = await editor.textContent()
      expect(editorText).toContain(listCase.expected)
    }
  })

  test('task checkbox command toggles the current task item and updates the preview', async ({ page }) => {
    await openWritePanel(page)

    const markdown = '- [ ] Ship feature'

    await replaceMarkdownDocument(page, markdown)
    await placeEditorCursorFromStart(page, markdown.indexOf('Ship'))
    await page.locator('.topbar').getByRole('button', { name: /(タスクチェックを切替|Toggle task checkbox)/ }).click()

    const editor = page.locator('.toastui-editor-md-container .toastui-editor').first()
    await expect(editor).toContainText('- [x] Ship feature')

    await page.locator('.view-switch button').nth(1).click()
    await expect(page.locator('.preview-panel input[type="checkbox"]').first()).toBeChecked()
  })

  test('task checkbox command converts selected list items and toggles existing tasks', async ({ page }) => {
    await openWritePanel(page)

    const markdown = [
      '- Alpha',
      '- [x] Done',
      'Paragraph',
    ].join('\n')

    await replaceMarkdownDocument(page, markdown, null)
    await selectEditorLinesFromStart(page, 2)
    await page.locator('.topbar').getByRole('button', { name: /(タスクチェックを切替|Toggle task checkbox)/ }).click()

    const editorText = await page.locator('.toastui-editor-md-container .toastui-editor').first().textContent()
    expect(editorText).toContain('- [ ] Alpha')
    expect(editorText).toContain('- [ ] Done')
    expect(editorText).toContain('Paragraph')
  })
})
