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
    onMenuAction: (callback: (action: MdvMenuAction) => void) => () => void
    log: (level: string, scope: string, message: string) => void
    getLogPath: () => Promise<string>
  }
}