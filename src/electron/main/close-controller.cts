// @ts-nocheck
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
}) {
  async function showUnsavedChangesDialog(window, payload) {
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
      return { action: 'save' }
    }

    if (response.response === 2) {
      return { action: 'discard' }
    }

    return { action: 'cancel' }
  }

  async function showUnresponsiveCloseDialog(window) {
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

  async function requestEditorCloseState(editorWindow) {
    return requestEditorWindowData(editorWindow, {
      type: 'get-close-state',
    })
  }

  function approveAndCloseWindow(window) {
    approvedWindowCloseIds.add(window.id)
    window.webContents.send('mdv:window-close-approved')
    setImmediate(() => {
      if (!window.isDestroyed()) {
        window.close()
      }
    })
  }

  async function confirmEditorWindowClose(window) {
    if (!window || window.isDestroyed()) {
      return
    }

    let closeState = null

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
      await cleanupDraftWorkspace({ draftWorkspace: closeState?.snapshot?.draftWorkspace || null })
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
      currentFilePath: snapshot.currentFilePath,
      displayTitle: snapshot.displayTitle,
      proceedLabel: messages.buttons.close,
    })

    if (response.action === 'cancel') {
      return
    }

    if (response.action === 'save') {
      const saveResult = await saveContentToPath(window, {
        path: snapshot.currentFilePath,
        content: snapshot.markdownText,
        recoveryKey: snapshot.recoveryKey || null,
        defaultFileName: snapshot.displayTitle || messages.untitledTitle,
        expectedSnapshot: snapshot.fileSnapshot || null,
        baseContent: snapshot.persistedMarkdown,
        draftWorkspace: snapshot.draftWorkspace || null,
        pendingImportedAssets: snapshot.pendingImportedAssets || [],
      })

      if (!saveResult || saveResult.status !== 'saved') {
        return
      }

      const referencedAssetPaths = new Set(collectReferencedDraftAssetPaths(saveResult.content))
      await cleanupImportedAssetFiles((snapshot.pendingImportedAssets || [])
        .filter((asset) => typeof asset?.relativePath === 'string' && !referencedAssetPaths.has(asset.relativePath))
        .map((asset) => asset.filePath))

      if (snapshot.currentFilePath && saveResult.path !== snapshot.currentFilePath) {
        await cleanupImportedAssetFiles((snapshot.pendingImportedAssets || []).map((asset) => asset.filePath))
      }

      if (!snapshot.currentFilePath && snapshot.draftWorkspace) {
        await cleanupDraftWorkspace({ draftWorkspace: snapshot.draftWorkspace })
      }

      clearAutosaveRecovery({
        recoveryKey: snapshot.recoveryKey || null,
        filePath: snapshot.currentFilePath || null,
      })

      if (saveResult.path && saveResult.path !== snapshot.currentFilePath) {
        clearAutosaveRecovery({ filePath: saveResult.path })
      }
    }

    if (response.action === 'discard') {
      await cleanupImportedAssetFiles((snapshot.pendingImportedAssets || []).map((asset) => asset.filePath))
      await cleanupDraftWorkspace({ draftWorkspace: snapshot.draftWorkspace || null })
      clearAutosaveRecovery({
        recoveryKey: snapshot.recoveryKey || null,
        filePath: snapshot.currentFilePath || null,
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
