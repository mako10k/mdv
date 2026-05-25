declare module '@toast-ui/editor' {
  export type EditorOptions = {
    el: HTMLElement
    height?: string
    initialValue?: string
    previewStyle?: 'tab' | 'vertical'
    initialEditType?: 'markdown' | 'wysiwyg'
    usageStatistics?: boolean
    hideModeSwitch?: boolean
    events?: {
      change?: () => void
    }
  }

  export default class Editor {
    constructor(options: EditorOptions)
    getMarkdown(): string
    setMarkdown(markdown: string, cursorToEnd?: boolean): void
    destroy(): void
  }
}

declare module 'markdown-it'
declare module 'markdown-it-container'
declare module 'markdown-it-footnote'
declare module 'markdown-it-task-lists'

type MdvFilePayload = {
  path: string
  content: string
}

type MdvSavePayload = {
  path?: string | null
  content: string
  forceDialog?: boolean
}

type MdvExternalLinkResult = {
  status: 'opened' | 'cancelled' | 'blocked'
}

type MdvClientSnapshot = {
  markdownText: string
  currentFilePath: string | null
  activePanel: 'write' | 'preview'
  themeMode: 'system' | 'light' | 'dark'
}

type MdvServerCommand = {
  type: 'suspend' | 'resume'
  requestId: string
  snapshot?: MdvClientSnapshot | null
  reason?: string
  requestedAt?: string
}

type MdvMenuAction =
  | 'open'
  | 'save'
  | 'save-as'
  | 'show-editor'
  | 'show-preview'

interface Window {
  mdvDesktop?: {
    platform: string
    openFile: () => Promise<MdvFilePayload | null>
    readFile: (filePath: string) => Promise<MdvFilePayload | null>
    saveFile: (payload: MdvSavePayload) => Promise<{ path: string } | null>
    openExternalLink: (href: string) => Promise<MdvExternalLinkResult>
    onServerCommand: (callback: (command: MdvServerCommand) => void) => () => void
    sendServerCommandResult: (payload: {
      requestId: string
      type: 'suspend' | 'resume'
      status: 'completed' | 'failed'
      snapshot?: MdvClientSnapshot | null
    }) => void
    onOpenFileRequested: (callback: (filePath: string) => void) => () => void
    onMenuAction: (callback: (action: MdvMenuAction) => void) => () => void
    log: (level: string, scope: string, message: string) => void
    getLogPath: () => Promise<string>
  }
}