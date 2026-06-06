type BrowserWindowLike = unknown

type MessageBoxResult = {
  response: number
  checkboxChecked: boolean
}

type SaveDialogResult = {
  canceled: boolean
  filePath?: string
  bookmark?: string
}

type OpenDialogResult = {
  canceled: boolean
  filePaths: string[]
  bookmarks?: string[]
}

type InjectedMessageBoxResult = {
  response?: number
  checkboxChecked?: boolean
}

type InjectedSaveDialogResult = {
  canceled?: boolean
  filePath?: string
  bookmark?: string
}

type InjectedOpenDialogResult = {
  canceled?: boolean
  filePaths?: unknown[]
  bookmarks?: unknown[]
}

type InjectedDialogState = {
  messageBox: InjectedMessageBoxResult[]
  saveDialog: InjectedSaveDialogResult[]
  openDialog: InjectedOpenDialogResult[]
}

type DialogLike = {
  showMessageBox: (window: BrowserWindowLike | undefined, options: Record<string, unknown>) => Promise<MessageBoxResult>
  showSaveDialog: (window: BrowserWindowLike | undefined, options: Record<string, unknown>) => Promise<SaveDialogResult>
  showOpenDialog: (window: BrowserWindowLike | undefined, options: Record<string, unknown>) => Promise<OpenDialogResult>
}

type E2eDialogControllerOptions = {
  dialog: DialogLike
  writeLog: (level: string, scope: string, ...parts: unknown[]) => void
}

type E2eDialogController = {
  showMessageBox: (window: BrowserWindowLike | null, options: Record<string, unknown>) => Promise<MessageBoxResult>
  showSaveDialog: (window: BrowserWindowLike | null, options: Record<string, unknown>) => Promise<SaveDialogResult>
  showOpenDialog: (window: BrowserWindowLike | null, options: Record<string, unknown>) => Promise<OpenDialogResult>
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function createE2eDialogController(options: E2eDialogControllerOptions): E2eDialogController {
  const { dialog, writeLog } = options
  const rawValue = process.env.MDV_E2E_DIALOG_RESPONSES
  let state: InjectedDialogState | null = null

  if (typeof rawValue === 'string' && rawValue.trim().length > 0) {
    try {
      const parsed: unknown = JSON.parse(rawValue)
      const parsedRecord = isObjectRecord(parsed) ? parsed : null
      state = {
        messageBox: Array.isArray(parsedRecord?.messageBox) ? [...parsedRecord.messageBox] as InjectedMessageBoxResult[] : [],
        saveDialog: Array.isArray(parsedRecord?.saveDialog) ? [...parsedRecord.saveDialog] as InjectedSaveDialogResult[] : [],
        openDialog: Array.isArray(parsedRecord?.openDialog) ? [...parsedRecord.openDialog] as InjectedOpenDialogResult[] : [],
      }
    } catch (error) {
      writeLog('WARN', 'main', 'Failed to parse MDV_E2E_DIALOG_RESPONSES', error instanceof Error ? error.message : String(error))
    }
  }

  function takeNextMessageBoxResponse(): InjectedMessageBoxResult | null {
    if (!state || state.messageBox.length === 0) {
      return null
    }
    return state.messageBox.shift() ?? null
  }

  function takeNextSaveDialogResponse(): InjectedSaveDialogResult | null {
    if (!state || state.saveDialog.length === 0) {
      return null
    }
    return state.saveDialog.shift() ?? null
  }

  function takeNextOpenDialogResponse(): InjectedOpenDialogResult | null {
    if (!state || state.openDialog.length === 0) {
      return null
    }
    return state.openDialog.shift() ?? null
  }

  async function showMessageBox(window: BrowserWindowLike | null, optionsArg: Record<string, unknown>) {
    const injectedResponse = takeNextMessageBoxResponse()

    if (injectedResponse) {
      writeLog('INFO', 'e2e', 'Using injected showMessageBox response', injectedResponse)
      return {
        response: typeof injectedResponse.response === 'number' && Number.isFinite(injectedResponse.response) ? injectedResponse.response : 0,
        checkboxChecked: injectedResponse.checkboxChecked === true,
      }
    }

    return dialog.showMessageBox(window ?? undefined, optionsArg)
  }

  async function showSaveDialog(window: BrowserWindowLike | null, optionsArg: Record<string, unknown>) {
    const injectedResponse = takeNextSaveDialogResponse()

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

  async function showOpenDialog(window: BrowserWindowLike | null, optionsArg: Record<string, unknown>) {
    const injectedResponse = takeNextOpenDialogResponse()

    if (injectedResponse) {
      writeLog('INFO', 'e2e', 'Using injected showOpenDialog response', injectedResponse)
      return {
        canceled: injectedResponse.canceled !== false,
        filePaths: Array.isArray(injectedResponse.filePaths) ? injectedResponse.filePaths.filter((value: unknown): value is string => typeof value === 'string') : [],
        bookmarks: Array.isArray(injectedResponse.bookmarks) ? injectedResponse.bookmarks.filter((value: unknown): value is string => typeof value === 'string') : undefined,
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
