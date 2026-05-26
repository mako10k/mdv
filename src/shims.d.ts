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
  | 'open-settings'
  | 'open-ai-chat'
  | 'show-editor'
  | 'show-preview'

type MdvAiEditorRequest =
  | {
      requestId: string
      type: 'get-context'
    }
  | {
      requestId: string
      type: 'read'
      source: 'active:document'
    }
  | {
      requestId: string
      type: 'read'
      source: 'active:selection'
    }
  | {
      requestId: string
      type: 'write'
      destination: 'active:document'
      content: string
    }
  | {
      requestId: string
      type: 'write'
      destination: 'active:selection'
      content: string
    }

type MdvSettings = {
  version: 1
  general: {
    themeMode: 'system' | 'light' | 'dark'
    defaultStartPanel: 'write' | 'preview'
    openLinksBehavior: 'confirm-if-untrusted' | 'block-untrusted'
  }
  editor: {
    initialEditType: 'markdown' | 'wysiwyg'
    showModeSwitch: boolean
    previewStyle: 'tab' | 'vertical'
  }
  ai: {
    defaultWriteMode: 'direct' | 'suggest'
    toolPermissions: {
      readActiveDocument: boolean
      readActiveSelection: boolean
      writeActiveDocument: boolean
      writeActiveSelection: boolean
      writeNewDocument: boolean
      workspaceGrep: boolean
      tavilyWebSearch: boolean
    }
    openai: {
      enabled: boolean
      baseUrl: string | null
      model: string
    }
    tavily: {
      enabled: boolean
      defaultSearchDepth: 'basic' | 'advanced'
      defaultMaxResults: number
    }
  }
  safety: {
    confirmBeforeFullDocumentOverwrite: boolean
    confirmBeforeNewDocumentFromAi: boolean
    confirmBeforeExternalUrlOpen: boolean
  }
}

type MdvSettingsPatch = {
  general?: Partial<MdvSettings['general']>
  editor?: Partial<MdvSettings['editor']>
  ai?: {
    defaultWriteMode?: MdvSettings['ai']['defaultWriteMode']
    toolPermissions?: Partial<MdvSettings['ai']['toolPermissions']>
    openai?: Partial<MdvSettings['ai']['openai']>
    tavily?: Partial<MdvSettings['ai']['tavily']>
  }
  safety?: Partial<MdvSettings['safety']>
}

type MdvProviderStatus = {
  openaiConfigured: boolean
  tavilyConfigured: boolean
}

type MdvSettingsBootstrap = {
  settings: MdvSettings
  hasPersistedSettings: boolean
  hasReadableSettings: boolean
}

type MdvAiContextPayload = {
  currentFilePath: string | null
  title: string
  activePanel: 'write' | 'preview'
  textLength: number
  selectionTextLength: number
  isDirty: boolean
}

type MdvAiReadPayload = {
  source: 'active:document' | 'active:selection'
  text: string
}

type MdvAiWritePayload = {
  destination: 'active:document' | 'active:selection'
  text: string
}

interface Window {
  mdvDesktop?: {
    platform: string
    openFile: () => Promise<MdvFilePayload | null>
    readFile: (filePath: string) => Promise<MdvFilePayload | null>
    saveFile: (payload: MdvSavePayload) => Promise<{ path: string } | null>
    openAiChat: () => Promise<{ status: 'opened' | 'focused' } | null>
    openSettingsWindow: () => Promise<{ status: 'opened' | 'focused' } | null>
    getAiChatContext: () => Promise<MdvAiContextPayload | null>
    readAiActiveDocument: () => Promise<MdvAiReadPayload | null>
    readAiActiveSelection: () => Promise<MdvAiReadPayload | null>
    writeAiActiveDocument: (payload: { content: string }) => Promise<MdvAiWritePayload | null>
    writeAiActiveSelection: (payload: { content: string }) => Promise<MdvAiWritePayload | null>
    settings: {
      getBootstrapSettings: () => MdvSettingsBootstrap
      getSettings: () => Promise<MdvSettings>
      migrateLegacyTheme: (themeMode: 'light' | 'dark') => Promise<MdvSettings>
      updateSettings: (patch: MdvSettingsPatch) => Promise<MdvSettings>
      getProviderStatus: () => Promise<MdvProviderStatus>
      onSettingsChanged: (callback: (settings: MdvSettings) => void) => () => void
    }
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
    onAiEditorRequest: (callback: (request: MdvAiEditorRequest) => void | Promise<void>) => () => void
    sendAiEditorResponse: (payload: {
      requestId: string
      ok: boolean
      payload?: MdvAiContextPayload | MdvAiReadPayload | MdvAiWritePayload | null
      error?: string
    }) => void
    log: (level: string, scope: string, message: string) => void
    getLogPath: () => Promise<string>
  }
}