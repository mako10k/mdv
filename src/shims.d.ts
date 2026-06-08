declare module '@toast-ui/editor' {
  export type MarkdownPos = [number, number]
  export type Sourcepos = [MarkdownPos, MarkdownPos]
  export type EditorPos = MarkdownPos | number
  export type EditorSelection = [EditorPos, EditorPos]
  export type SelectionPos = Sourcepos | EditorSelection
  export type EditorSlots = {
    mdEditor: HTMLElement
    mdPreview: HTMLElement
    wwEditor: HTMLElement
  }

  export type WidgetRule = {
    rule: RegExp
    toDOM: (text: string) => HTMLElement
  }

  export type EditorOptions = {
    el: HTMLElement
    minHeight?: string
    height?: string
    initialValue?: string
    placeholder?: string
    previewStyle?: 'tab' | 'vertical'
    initialEditType?: 'markdown' | 'wysiwyg'
    usageStatistics?: boolean
    hideModeSwitch?: boolean
    widgetRules?: WidgetRule[]
    events?: {
      change?: () => void
    }
  }

  export default class Editor {
    constructor(options: EditorOptions)
    exec(name: string, payload?: Record<string, unknown>): void
    focus(): void
    getMarkdown(): string
    getEditorElements(): EditorSlots
    setMarkdown(markdown: string, cursorToEnd?: boolean): void
    getSelection(): SelectionPos
    setSelection(start: EditorPos, end?: EditorPos): void
    setPlaceholder(placeholder: string): void
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
  snapshot: MdvFileSnapshot
}

type MdvFileSnapshot = {
  path: string
  contentHash: string
  size: number
  mtimeMs: number | null
}

type MdvRelativeAssetDataUrlPayload = {
  baseFilePath: string
  source: string
}

type MdvRelativeAssetDataUrlResult = {
  path: string
  dataUrl: string
}

type MdvDraftWorkspace = {
  workspaceId: string
  rootDir: string
  markdownFilePath: string
  assetDir: string
  manifestPath: string
}

type MdvEnsureDraftWorkspacePayload = {
  workspaceId?: string | null
}

type MdvImportImageAssetPayload = {
  currentFilePath?: string | null
  draftWorkspace?: MdvDraftWorkspace | null
  sourcePath?: string | null
  bytesBase64?: string | null
  mimeType?: string | null
  suggestedName?: string | null
  createdBy: 'paste' | 'drop'
}

type MdvImportImageAssetResult = {
  filePath: string
  relativePath: string
  markdownFilePath: string
  draftWorkspace?: MdvDraftWorkspace | null
}

type MdvPendingImportedAsset = {
  filePath: string
  relativePath: string
}

type MdvSavePayload = {
  path?: string | null
  content: string
  forceDialog?: boolean
  recoveryKey?: string | null
  defaultFileName?: string | null
  displayTitle?: string | null
  expectedSnapshot?: MdvFileSnapshot | null
  baseContent?: string | null
  draftWorkspace?: MdvDraftWorkspace | null
  pendingImportedAssets?: MdvPendingImportedAsset[]
}

type MdvSaveResult =
  | {
      status: 'saved'
      path: string
      content: string
      snapshot: MdvFileSnapshot
    }
  | {
      status: 'cancelled'
    }
  | {
      status: 'merge-failed'
      message: string
    }

type MdvCurrentFileChangeEvent = {
  path: string
  exists: boolean
}

type MdvUnsavedChangesDialogResult = {
  action: 'save' | 'discard' | 'cancel'
}

type MdvExternalLinkResult = {
  status: 'opened' | 'cancelled' | 'blocked'
}

type MdvJsonValue = string | number | boolean | null | MdvJsonValue[] | { [key: string]: MdvJsonValue }

type MdvMdastHeadingOutlineItem = {
  path: number[]
  depth: number
  text: string
  position: MdvAiMarkdownPos
}

type MdvLocale = 'ja' | 'en'

type MdvClientSnapshot = {
  markdownText: string
  persistedMarkdown: string
  currentFilePath: string | null
  fileSnapshot?: MdvFileSnapshot | null
  draftWorkspace?: MdvDraftWorkspace | null
  pendingImportedAssets?: MdvPendingImportedAsset[]
  displayTitle: string
  activePanel: 'write' | 'preview'
  isUntouchedUntitledBuffer?: boolean
  recoveryKey: string
}

type MdvAutosaveRecoveryEntry = {
  recoveryKey: string
  savedAt: string
  snapshot: MdvClientSnapshot
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
  | 'new-document'
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
      mode: 'replace' | 'insert' | 'append'
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
  version: 3
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
    fontSizePx: number
  }
  ai: {
    defaultWriteMode: 'direct' | 'suggest'
    chatFontSizePx: number
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
  updates: {
    enabled: boolean
    autoCheckOnLaunch: boolean
    feedUrl: string | null
  }
}

type MdvSettingsPatch = {
  general?: Partial<MdvSettings['general']>
  editor?: Partial<MdvSettings['editor']>
  ai?: {
    defaultWriteMode?: MdvSettings['ai']['defaultWriteMode']
    chatFontSizePx?: MdvSettings['ai']['chatFontSizePx']
    toolPermissions?: Partial<MdvSettings['ai']['toolPermissions']>
    openai?: Partial<MdvSettings['ai']['openai']>
    tavily?: Partial<MdvSettings['ai']['tavily']>
    fetch?: Partial<MdvSettings['ai']['fetch']>
  }
  safety?: Partial<MdvSettings['safety']>
  updates?: Partial<MdvSettings['updates']>
}

type MdvUpdaterState = {
  supported: boolean
  enabled: boolean
  configured: boolean
  feedUrl: string | null
  status: 'idle' | 'unsupported' | 'disabled' | 'unconfigured' | 'checking' | 'update-available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error'
  currentVersion: string
  availableVersion: string | null
  downloadedVersion: string | null
  checkedAt: string | null
  progressPercent: number | null
  error: string | null
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
  hasInitialLaunchRequest: boolean
  initialPanel: MdvInitialPanel
}

type MdvAppMetadata = {
  productName: string
  version: string
  releaseTag: string
  platform: string
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
  mode: 'replace' | 'insert' | 'append'
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
  phase: 'call' | 'result'
  title: string
  content: string
}

type MdvAiChatMessage = {
  role: 'user' | 'assistant' | 'tool'
  content: string
  title?: string
}

type MdvAiChatDispatchResponse = {
  status: 'started'
  requestId: string
}

type MdvAiChatStreamEvent =
  | {
      requestId: string
      type: 'text-delta'
      delta: string
    }
  | {
      requestId: string
      type: 'tool-event'
      phase: 'call' | 'result'
      title: string
      content: string
    }
  | {
      requestId: string
      type: 'completed'
      reply: string
      model: string
      responseId: string | null
    }
  | {
      requestId: string
      type: 'failed'
      error: string
    }

interface Window {
  mdvDesktop?: {
    platform: string
    e2e?: {
      recoveryPromptMode: 'accept' | 'decline' | 'interactive'
      startupRecoveryDelayMs?: number
    }
    getAppMetadata: () => Promise<MdvAppMetadata>
    updater: {
      getState: () => Promise<MdvUpdaterState>
      checkForUpdates: () => Promise<MdvUpdaterState>
      downloadUpdate: () => Promise<MdvUpdaterState>
      installUpdate: () => Promise<{ started: boolean }>
      onStateChanged: (callback: (state: MdvUpdaterState) => void) => () => void
    }
    newDocumentWindow: () => Promise<{ status: 'opened'; windowId: number } | { status: 'unavailable'; reason: string } | null>
    openFile: () => Promise<MdvFilePayload | null>
    readFile: (filePath: string) => Promise<MdvFilePayload | null>
    getMdastCapabilities: () => Promise<MdvJsonValue>
    extractMdastHeadingOutline: (markdown: string) => Promise<MdvMdastHeadingOutlineItem[]>
    readRelativeAssetAsDataUrl: (payload: MdvRelativeAssetDataUrlPayload) => Promise<MdvRelativeAssetDataUrlResult | null>
    ensureDraftWorkspace: (payload?: MdvEnsureDraftWorkspacePayload) => Promise<MdvDraftWorkspace | null>
    importImageAsset: (payload: MdvImportImageAssetPayload) => Promise<MdvImportImageAssetResult | null>
    cleanupImportedAssets: (payload: { filePaths: string[] }) => Promise<void>
    cleanupDraftWorkspace: (payload: { draftWorkspace?: MdvDraftWorkspace | null }) => Promise<void>
    saveFile: (payload: MdvSavePayload) => Promise<MdvSaveResult>
    exportHtml: (payload: { content: string; defaultFileName?: string | null }) => Promise<{ path: string } | null>
    trackCurrentFile: (filePath?: string | null) => Promise<void>
    autosaveRecoveryUpsert: (payload: { snapshot: MdvClientSnapshot }) => Promise<{ recoveryKey: string; savedAt: string } | null>
    clearAutosaveRecovery: (payload?: { recoveryKey?: string | null; filePath?: string | null }) => Promise<void>
    getLatestAutosaveRecovery: () => Promise<MdvAutosaveRecoveryEntry | null>
    getAutosaveRecoveryForFile: (filePath: string) => Promise<MdvAutosaveRecoveryEntry | null>
    notifyInitialLaunchOpenHandled: () => void
    confirmUnsavedChanges: (payload: { currentFilePath?: string | null; displayTitle?: string; proceedLabel: string }) => Promise<MdvUnsavedChangesDialogResult>
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
    writeAiTarget: (payload: { destination: MdvAiEditorTarget; sources: MdvAiWriteSource[]; mode: 'replace' | 'insert' | 'append'; title?: string }) => Promise<MdvAiWritePayload | null>
    listAiBuffers: () => Promise<MdvAiListBuffersPayload | null>
    sendAiChatMessage: (payload: { requestId: string; messages: MdvAiChatMessage[] }) => Promise<MdvAiChatDispatchResponse>
    debug?: {
      notify: (type: string, payload?: unknown) => void
    }
    onAiChatStreamEvent: (callback: (event: MdvAiChatStreamEvent) => void) => () => void
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
    onCurrentFileChanged: (callback: (event: MdvCurrentFileChangeEvent) => void) => () => void
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
