declare module '@toast-ui/editor' {
  export type MarkdownPos = [number, number]
  export type Sourcepos = [MarkdownPos, MarkdownPos]
  export type EditorPos = MarkdownPos | number
  export type EditorSelection = [EditorPos, EditorPos]
  export type SelectionPos = Sourcepos | EditorSelection

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
    exec(name: string, payload?: Record<string, unknown>): void
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
    convertPosToMatchEditorMode(start: EditorPos, end?: EditorPos, mode?: 'markdown' | 'wysiwyg'): EditorSelection
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

type MdvRelativeAssetDataUrlPayload = {
  baseFilePath: string
  source: string
}

type MdvRelativeAssetDataUrlResult = {
  path: string
  dataUrl: string
}

type MdvSavePayload = {
  path?: string | null
  content: string
  forceDialog?: boolean
}

type MdvUnsavedChangesDialogResult = {
  action: 'save' | 'discard' | 'cancel'
}

type MdvExternalLinkResult = {
  status: 'opened' | 'cancelled' | 'blocked'
}

type MdvLocale = 'ja' | 'en'

type MdvClientSnapshot = {
  markdownText: string
  persistedMarkdown: string
  currentFilePath: string | null
  displayTitle: string
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
  | 'redo'
  | 'open'
  | 'save'
  | 'save-as'
  | 'open-settings'
  | 'open-ai-chat'
  | 'show-editor'
  | 'show-preview'

type MdvAiEditorId = string

type MdvAiMarkdownPos = {
  line: number
  column: number
}

type MdvAiSpanRef =
  | { kind: 'selection' }
  | { kind: 'document' }
  | { kind: 'point'; at: MdvAiMarkdownPos }
  | { kind: 'line'; line: number }
  | { kind: 'line-range'; startLine: number; endLine: number }
  | { kind: 'from-start'; end: MdvAiMarkdownPos }
  | { kind: 'to-end'; start: MdvAiMarkdownPos }
  | { kind: 'range'; start: MdvAiMarkdownPos; end: MdvAiMarkdownPos }

type MdvAiNormalizedSpan = {
  start: MdvAiMarkdownPos
  end: MdvAiMarkdownPos
  isEmpty: boolean
}

type MdvAiCursor = {
  after: MdvAiMarkdownPos
}

type MdvAiEditorTarget = {
  editorId: MdvAiEditorId
  span: MdvAiSpanRef
}

type MdvAiWriteSource =
  | {
      type: 'literal'
      text: string
    }
  | {
      type: 'slice-ref'
      editorId: MdvAiEditorId
      span: MdvAiSpanRef
    }
  | {
      type: 'slice-ref'
      target: MdvAiEditorTarget
    }

type MdvAiBufferSummary = {
  editorId: MdvAiEditorId
  kind: 'editor-window' | 'temp-buffer'
  title: string
  currentFilePath: string | null
  isDirty: boolean
  capabilities: {
    read: boolean
    write: boolean
    sliceOps: boolean
  }
  createdAt: string
  updatedAt: string
}

type MdvAiEditorRequest =
  | {
      requestId: string
      type: 'get-context'
      editorId: MdvAiEditorId
    }
  | {
      requestId: string
      type: 'read'
      target: MdvAiEditorTarget
      cursor?: MdvAiCursor | null
      maxTokens?: number
    }
  | {
      requestId: string
      type: 'write'
      destination: MdvAiEditorTarget
      sources: MdvAiWriteSource[]
      mode: 'replace' | 'insert'
      title?: string
    }
  | {
      requestId: string
      type: 'list-buffers'
    }
  | {
      requestId: string
      type: 'get-close-state'
    }

type MdvEditorCloseStatePayload = {
  snapshot: MdvClientSnapshot
  isDirty: boolean
}

type MdvSettings = {
  version: 2
  general: {
    locale: MdvLocale
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
      sliceSearch: boolean
      workspaceGrep: boolean
      tavilyWebSearch: boolean
      fetchUrl: boolean
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
    fetch: {
      aclText: string
      requestTimeoutMs: number
      idleTimeoutMs: number
      autoDisposeAfterMs: number
      maxResponseBytes: number
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
    fetch?: Partial<MdvSettings['ai']['fetch']>
  }
  safety?: Partial<MdvSettings['safety']>
}

type MdvProviderStatus = {
  openaiConfigured: boolean
  tavilyConfigured: boolean
}

type MdvInitialPanel = 'write' | 'preview'

type MdvLaunchRequest = {
  filePath: string | null
  initialPanel: MdvInitialPanel
  isInitialLaunch?: boolean
}

type MdvSettingsBootstrap = {
  settings: MdvSettings
  hasPersistedSettings: boolean
  hasReadableSettings: boolean
  initialPanel: MdvInitialPanel
}

type MdvAiContextPayload = {
  editorId: MdvAiEditorId
  currentFilePath: string | null
  title: string
  activePanel: 'write' | 'preview'
  textLength: number
  selectionTextLength: number
  tokenEstimate: number
  isDirty: boolean
}

type MdvAiReadPayload = {
  editorId: MdvAiEditorId
  span: MdvAiNormalizedSpan
  target?: MdvAiEditorTarget
  pageTarget?: MdvAiEditorTarget
  text: string
  estimatedTokens: number
  truncated: boolean
  nextCursor?: MdvAiCursor | null
}

type MdvAiWritePayload = {
  editorId: MdvAiEditorId
  span: MdvAiNormalizedSpan
  target?: MdvAiEditorTarget
  text: string
  mode: 'replace' | 'insert'
  bytesWritten: number
  created?: boolean
}

type MdvAiListBuffersPayload = {
  buffers: MdvAiBufferSummary[]
}

type MdvAiSliceMatch = {
  line: number
  column: number
  preview: string
  span: MdvAiNormalizedSpan
  target?: MdvAiEditorTarget
}

type MdvAiGrepSlicePayload = {
  editorId: MdvAiEditorId
  span: MdvAiNormalizedSpan
  target?: MdvAiEditorTarget
  query: string
  isRegexp: boolean
  caseSensitive: boolean
  matches: MdvAiSliceMatch[]
  truncated: boolean
  bufferId?: MdvAiEditorId | null
}

type MdvAiStatsPayload = {
  editorId: MdvAiEditorId
  span: MdvAiNormalizedSpan
  target?: MdvAiEditorTarget
  characters: number
  lines: number
  emptyLines: number
  nonEmptyLines: number
  maxLineLength: number
  uniqueLines: number
  estimatedTokens: number
}

type MdvAiSemanticSearchResult = {
  editorId: MdvAiEditorId
  span: MdvAiNormalizedSpan
  target?: MdvAiEditorTarget
  layer: string
  score: number
  preview: string
}

type MdvAiSemanticSearchPayload = {
  editorId: MdvAiEditorId
  span: MdvAiNormalizedSpan
  target?: MdvAiEditorTarget
  query: string
  results: MdvAiSemanticSearchResult[]
  bufferId?: MdvAiEditorId | null
  indexBuiltAt: string
}

type MdvAiToolEvent = {
  title: string
  content: string
}

type MdvAiChatMessage = {
  role: 'user' | 'assistant' | 'tool'
  content: string
  title?: string
}

type MdvAiChatResponse = {
  reply: string
  model: string
  responseId: string | null
  toolEvents?: MdvAiToolEvent[]
}

interface Window {
  mdvDesktop?: {
    platform: string
    openFile: () => Promise<MdvFilePayload | null>
    readFile: (filePath: string) => Promise<MdvFilePayload | null>
    readRelativeAssetAsDataUrl: (payload: MdvRelativeAssetDataUrlPayload) => Promise<MdvRelativeAssetDataUrlResult | null>
    saveFile: (payload: MdvSavePayload) => Promise<{ path: string } | null>
    exportHtml: (payload: { content: string; defaultFileName?: string | null }) => Promise<{ path: string } | null>
    notifyInitialLaunchOpenHandled: () => void
    confirmUnsavedChanges: (payload: { currentFilePath?: string | null; displayTitle?: string; proceedLabel: string }) => Promise<MdvUnsavedChangesDialogResult>
    openAiChat: () => Promise<{ status: 'opened' | 'focused' } | null>
    openSettingsWindow: () => Promise<{ status: 'opened' | 'focused' } | null>
    openFetchPermissionsWindow: () => Promise<{ status: 'opened' | 'focused' } | null>
    getAiChatContext: () => Promise<MdvAiContextPayload | null>
    readAiActiveDocument: () => Promise<MdvAiReadPayload | null>
    readAiActiveSelection: () => Promise<MdvAiReadPayload | null>
    readAiTarget: (payload: { target: MdvAiEditorTarget; cursor?: MdvAiCursor | null; maxTokens?: number }) => Promise<MdvAiReadPayload | null>
    grepAiSlice: (payload: { target: MdvAiEditorTarget; query: string; isRegexp?: boolean; caseSensitive?: boolean; maxResults?: number; persistBuffer?: boolean }) => Promise<MdvAiGrepSlicePayload | null>
    statsAiSlice: (payload: { target: MdvAiEditorTarget }) => Promise<MdvAiStatsPayload | null>
    semanticSearchAiSlice: (payload: { target: MdvAiEditorTarget; query: string; maxResults?: number; persistBuffer?: boolean }) => Promise<MdvAiSemanticSearchPayload | null>
    writeAiActiveDocument: (payload: { content: string }) => Promise<MdvAiWritePayload | null>
    writeAiActiveSelection: (payload: { content: string }) => Promise<MdvAiWritePayload | null>
    writeAiTarget: (payload: { destination: MdvAiEditorTarget; sources: MdvAiWriteSource[]; mode: 'replace' | 'insert'; title?: string }) => Promise<MdvAiWritePayload | null>
    listAiBuffers: () => Promise<MdvAiListBuffersPayload | null>
    sendAiChatMessage: (payload: { messages: MdvAiChatMessage[] }) => Promise<MdvAiChatResponse>
    settings: {
      getBootstrapSettings: () => MdvSettingsBootstrap
      getSettings: () => Promise<MdvSettings>
      migrateLegacyTheme: (themeMode: 'light' | 'dark') => Promise<MdvSettings>
      updateSettings: (patch: MdvSettingsPatch) => Promise<MdvSettings>
      saveOpenAiApiKey: (apiKey: string) => Promise<MdvProviderStatus>
      clearOpenAiApiKey: () => Promise<MdvProviderStatus>
      saveTavilyApiKey: (apiKey: string) => Promise<MdvProviderStatus>
      clearTavilyApiKey: () => Promise<MdvProviderStatus>
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
    onOpenFileRequested: (callback: (request: MdvLaunchRequest | string) => void) => () => void
    onMenuAction: (callback: (action: MdvMenuAction) => void) => () => void
    onAiEditorRequest: (callback: (request: MdvAiEditorRequest) => void | Promise<void>) => () => void
    onWindowCloseApproved: (callback: () => void) => () => void
    sendAiEditorResponse: (payload: {
      requestId: string
      ok: boolean
      payload?: MdvAiContextPayload | MdvAiReadPayload | MdvAiWritePayload | MdvAiListBuffersPayload | MdvAiGrepSlicePayload | MdvAiStatsPayload | MdvEditorCloseStatePayload | null
      error?: string
    }) => void
    log: (level: string, scope: string, message: string) => void
    getLogPath: () => Promise<string>
  }
}