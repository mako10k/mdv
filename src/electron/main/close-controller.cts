type WindowCloseAction = 'save' | 'discard' | 'cancel'

type EditorCloseSnapshot = {
  markdownText?: string
  persistedMarkdown?: string
  currentFilePath?: string | null
  pendingImportedAssets?: Array<{ filePath: string, relativePath?: string }>
  displayTitle?: string
  activePanel?: string
  isUntouchedUntitledBuffer?: boolean
  recoveryKey?: string | null
  fileSnapshot?: object | null
  draftWorkspace?: object | null
}

type EditorCloseState = {
  isDirty?: boolean
  snapshot?: EditorCloseSnapshot | null
}

type SaveResult = {
  status?: string
  path?: string
  content?: string
}

type MainI18n = {
  untitledTitle: string
  buttons: {
    save: string
    cancel: string
    continue: string
    close: string
  }
  unsaved: {
    file: string
    hasUnsavedChanges: string
    title: string
    message: (proceedLabel: string) => string
  }
  closeFallback: {
    title: string
    message: string
    detail: string
  }
}

type WindowLike = {
  id: number
  isDestroyed: () => boolean
  close: () => void
  webContents: {
    send: (channel: string, payload?: unknown) => void
  }
}

type CloseControllerDependencies = {
  approvedWindowCloseIds: Set<number>
  getMainI18n: () => MainI18n
  showMessageBox: (
    window: WindowLike,
    options: Record<string, unknown>,
  ) => Promise<{ response: number }>
  requestEditorWindowData: (
    editorWindow: WindowLike,
    request: { type: 'get-close-state' },
  ) => Promise<EditorCloseState>
  writeLog: (level: string, scope: string, ...parts: unknown[]) => void
  closeAuxiliaryWindowsForEditor: (window: WindowLike) => void
  cleanupDraftWorkspace: (payload: { draftWorkspace: object | null }) => Promise<void>
  saveContentToPath: (window: WindowLike, payload: Record<string, unknown>) => Promise<SaveResult | null>
  collectReferencedDraftAssetPaths: (markdown: string) => Iterable<string>
  cleanupImportedAssetFiles: (filePaths: string[]) => Promise<void>
  clearAutosaveRecovery: (payload: { recoveryKey?: string | null, filePath?: string | null }) => void
}

type CloseController = {
  confirmEditorWindowClose: (window: WindowLike | null | undefined) => Promise<void>
  requestEditorCloseState: (editorWindow: WindowLike) => Promise<EditorCloseState>
  showUnsavedChangesDialog: (
    window: WindowLike,
    payload: { currentFilePath?: string, displayTitle?: string, proceedLabel?: string },
  ) => Promise<{ action: WindowCloseAction }>
}

function createCloseController({
  approvedWindowCloseIds,
  getMainI18n,
  showMessageBox,
  requestEditorWindowData,
  writeLog,
  closeAuxiliaryWindowsForEditor,
  cleanupDraftWorkspace,
  saveContentToPath,
  collectReferencedDraftAssetPaths,
  cleanupImportedAssetFiles,
  clearAutosaveRecovery,
}: CloseControllerDependencies): CloseController {
  async function showUnsavedChangesDialog(
    window: WindowLike,
    payload: { currentFilePath?: string, displayTitle?: string, proceedLabel?: string },
  ) {
    const messages = getMainI18n()
    const currentFilePath = typeof payload?.currentFilePath === 'string' ? payload.currentFilePath : ''
    const displayTitle = typeof payload?.displayTitle === 'string' && payload.displayTitle.trim().length > 0
      ? payload.displayTitle.trim()
      : messages.untitledTitle
    const proceedLabel = typeof payload?.proceedLabel === 'string' && payload.proceedLabel.trim().length > 0
      ? payload.proceedLabel.trim()
      : messages.buttons.continue
    const detailLines = [
      `${messages.unsaved.file}: ${currentFilePath || displayTitle}`,
      messages.unsaved.hasUnsavedChanges,
    ]
    const response = await showMessageBox(window, {
      type: 'warning',
      buttons: [messages.buttons.save, messages.buttons.cancel, proceedLabel],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: messages.unsaved.title,
      message: messages.unsaved.message(proceedLabel),
      detail: detailLines.join('\n'),
    })

    if (response.response === 0) {
      return { action: 'save' as const }
    }

    if (response.response === 2) {
      return { action: 'discard' as const }
    }

    return { action: 'cancel' as const }
  }

  async function showUnresponsiveCloseDialog(window: WindowLike) {
    const messages = getMainI18n()
    const response = await showMessageBox(window, {
      type: 'warning',
      buttons: [messages.buttons.cancel, messages.buttons.close],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: messages.closeFallback.title,
      message: messages.closeFallback.message,
      detail: messages.closeFallback.detail,
    })

    return response.response === 1
  }

  async function requestEditorCloseState(editorWindow: WindowLike) {
    return requestEditorWindowData(editorWindow, {
      type: 'get-close-state',
    })
  }

  function approveAndCloseWindow(window: WindowLike) {
    approvedWindowCloseIds.add(window.id)
    window.webContents.send('mdv:window-close-approved')
    setImmediate(() => {
      if (!window.isDestroyed()) {
        window.close()
      }
    })
  }

  async function confirmEditorWindowClose(window: WindowLike | null | undefined) {
    if (!window || window.isDestroyed()) {
      return
    }

    let closeState: EditorCloseState | null = null

    try {
      closeState = await requestEditorCloseState(window)
    } catch (error) {
      writeLog('ERROR', 'main', 'Failed to request editor close state', error instanceof Error ? error.message : String(error))
      const shouldForceClose = await showUnresponsiveCloseDialog(window)

      if (!shouldForceClose) {
        return
      }

      closeAuxiliaryWindowsForEditor(window)
      approveAndCloseWindow(window)
      return
    }

    if (!closeState?.isDirty) {
      await cleanupDraftWorkspace({ draftWorkspace: closeState?.snapshot?.draftWorkspace ?? null })
      closeAuxiliaryWindowsForEditor(window)
      approveAndCloseWindow(window)
      return
    }

    const messages = getMainI18n()
    const snapshot = closeState.snapshot || {
      markdownText: '',
      persistedMarkdown: '',
      currentFilePath: null,
      pendingImportedAssets: [],
      displayTitle: messages.untitledTitle,
      activePanel: 'write',
      isUntouchedUntitledBuffer: true,
    }
    const response = await showUnsavedChangesDialog(window, {
      currentFilePath: snapshot.currentFilePath ?? undefined,
      displayTitle: snapshot.displayTitle,
      proceedLabel: messages.buttons.close,
    })

    if (response.action === 'cancel') {
      return
    }

    if (response.action === 'save') {
      const saveResult = await saveContentToPath(window, {
        path: snapshot.currentFilePath ?? '',
        content: snapshot.markdownText ?? '',
        recoveryKey: snapshot.recoveryKey ?? null,
        defaultFileName: snapshot.displayTitle || messages.untitledTitle,
        expectedSnapshot: snapshot.fileSnapshot ?? null,
        baseContent: snapshot.persistedMarkdown ?? snapshot.markdownText ?? '',
        draftWorkspace: snapshot.draftWorkspace ?? null,
        pendingImportedAssets: snapshot.pendingImportedAssets ?? [],
      })

      if (!saveResult || saveResult.status !== 'saved') {
        return
      }

      const referencedAssetPaths = new Set(collectReferencedDraftAssetPaths(saveResult.content ?? ''))
      await cleanupImportedAssetFiles((snapshot.pendingImportedAssets ?? [])
        .filter((asset) => typeof asset?.relativePath === 'string' && !referencedAssetPaths.has(asset.relativePath))
        .map((asset) => asset.filePath))

      if (snapshot.currentFilePath && saveResult.path !== snapshot.currentFilePath) {
        await cleanupImportedAssetFiles((snapshot.pendingImportedAssets ?? []).map((asset) => asset.filePath))
      }

      if (!snapshot.currentFilePath && snapshot.draftWorkspace) {
        await cleanupDraftWorkspace({ draftWorkspace: snapshot.draftWorkspace })
      }

      clearAutosaveRecovery({
        recoveryKey: snapshot.recoveryKey ?? null,
        filePath: snapshot.currentFilePath ?? null,
      })

      if (saveResult.path && saveResult.path !== snapshot.currentFilePath) {
        clearAutosaveRecovery({ filePath: saveResult.path })
      }
    }

    if (response.action === 'discard') {
      await cleanupImportedAssetFiles((snapshot.pendingImportedAssets ?? []).map((asset) => asset.filePath))
      await cleanupDraftWorkspace({ draftWorkspace: snapshot.draftWorkspace ?? null })
      clearAutosaveRecovery({
        recoveryKey: snapshot.recoveryKey ?? null,
        filePath: snapshot.currentFilePath ?? null,
      })
    }

    closeAuxiliaryWindowsForEditor(window)
    approveAndCloseWindow(window)
  }

  return {
    confirmEditorWindowClose,
    requestEditorCloseState,
    showUnsavedChangesDialog,
  }
}

module.exports = {
  createCloseController,
}
