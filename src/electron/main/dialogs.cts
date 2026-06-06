// @ts-nocheck
function createE2eDialogController(options) {
  const { dialog, writeLog } = options
  const rawValue = process.env.MDV_E2E_DIALOG_RESPONSES
  let state = null

  if (typeof rawValue === 'string' && rawValue.trim().length > 0) {
    try {
      const parsed = JSON.parse(rawValue)
      state = {
        messageBox: Array.isArray(parsed?.messageBox) ? [...parsed.messageBox] : [],
        saveDialog: Array.isArray(parsed?.saveDialog) ? [...parsed.saveDialog] : [],
        openDialog: Array.isArray(parsed?.openDialog) ? [...parsed.openDialog] : [],
      }
    } catch (error) {
      writeLog('WARN', 'main', 'Failed to parse MDV_E2E_DIALOG_RESPONSES', error instanceof Error ? error.message : String(error))
    }
  }

  function takeNextResponse(kind) {
    if (!state) {
      return null
    }

    const queue = state[kind]

    if (!Array.isArray(queue) || queue.length === 0) {
      return null
    }

    return queue.shift() ?? null
  }

  async function showMessageBox(window, optionsArg) {
    const injectedResponse = takeNextResponse('messageBox')

    if (injectedResponse) {
      writeLog('INFO', 'e2e', 'Using injected showMessageBox response', injectedResponse)
      return {
        response: Number.isFinite(injectedResponse.response) ? injectedResponse.response : 0,
        checkboxChecked: injectedResponse.checkboxChecked === true,
      }
    }

    return dialog.showMessageBox(window ?? undefined, optionsArg)
  }

  async function showSaveDialog(window, optionsArg) {
    const injectedResponse = takeNextResponse('saveDialog')

    if (injectedResponse) {
      writeLog('INFO', 'e2e', 'Using injected showSaveDialog response', injectedResponse)
      return {
        canceled: injectedResponse.canceled !== false,
        filePath: typeof injectedResponse.filePath === 'string' ? injectedResponse.filePath : undefined,
        bookmark: typeof injectedResponse.bookmark === 'string' ? injectedResponse.bookmark : undefined,
      }
    }

    return dialog.showSaveDialog(window ?? undefined, optionsArg)
  }

  async function showOpenDialog(window, optionsArg) {
    const injectedResponse = takeNextResponse('openDialog')

    if (injectedResponse) {
      writeLog('INFO', 'e2e', 'Using injected showOpenDialog response', injectedResponse)
      return {
        canceled: injectedResponse.canceled !== false,
        filePaths: Array.isArray(injectedResponse.filePaths) ? injectedResponse.filePaths.filter((value) => typeof value === 'string') : [],
        bookmarks: Array.isArray(injectedResponse.bookmarks) ? injectedResponse.bookmarks.filter((value) => typeof value === 'string') : undefined,
      }
    }

    return dialog.showOpenDialog(window ?? undefined, optionsArg)
  }

  return {
    showMessageBox,
    showSaveDialog,
    showOpenDialog,
  }
}

export {
  createE2eDialogController,
}
