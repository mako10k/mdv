declare module '@toast-ui/editor' {
  export type MarkdownPos = [number, number]
  export type Sourcepos = [MarkdownPos, MarkdownPos]
  export type SelectionPos = Sourcepos | [number, number]
  export type EditorPos = MarkdownPos | number

  export type EditorOptions = {
    el: HTMLElement
    minHeight?: string
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
    getSelection(): SelectionPos
    setSelection(start: EditorPos, end?: EditorPos): void
    getSelectedText(start?: EditorPos, end?: EditorPos): string
    replaceSelection(text: string, start?: EditorPos, end?: EditorPos): void
    deleteSelection(start?: EditorPos, end?: EditorPos): void
    changeMode(mode: 'markdown' | 'wysiwyg', withoutFocus?: boolean): void
    isMarkdownMode(): boolean
    isWysiwygMode(): boolean
    convertPosToMatchEditorMode(start: EditorPos, end?: EditorPos, mode?: 'markdown' | 'wysiwyg'): EditorPos[]
    destroy(): void
  }
}

declare module 'markdown-it'
declare module 'markdown-it-container'
declare module 'markdown-it-footnote'
declare module 'markdown-it-task-lists'
declare module 'markdown-it-texmath'
declare module 'katex'

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
  | 'open-ai-chat'
  | 'show-editor'
  | 'show-preview'

interface Window {
  mdvDesktop?: {
    platform: string
    openFile: () => Promise<MdvFilePayload | null>
    readFile: (filePath: string) => Promise<MdvFilePayload | null>
    saveFile: (payload: MdvSavePayload) => Promise<{ path: string } | null>
    openAiChat: () => Promise<{ status: 'opened' | 'focused' } | null>
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