import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MutableRefObject,
  type ReactElement,
} from 'react'
import ToastUiEditor from '@toast-ui/editor'
import MarkdownIt from 'markdown-it'
import markdownItContainer from 'markdown-it-container'
import markdownItFootnote from 'markdown-it-footnote'
import markdownItTaskLists from 'markdown-it-task-lists'
import texmath from 'markdown-it-texmath'
import katex from 'katex'
import mermaid from 'mermaid'
import { clearLegacyThemeMode, readLegacyThemeMode, useDesktopTheme, type ResolvedTheme, type ThemeMode } from './shared/useDesktopTheme'
import './App.css'
import '@toast-ui/editor/dist/toastui-editor.css'
import 'katex/dist/katex.min.css'

type CodeBlockProps = {
  code: string
  language: string
  theme: ResolvedTheme
}

type CodeBlockRenderer = (props: CodeBlockProps) => ReactElement

type MarkdownSegment =
  | { type: 'markdown'; value: string }
  | { type: 'code'; language: string; code: string }

const initialDocument = `# MarkDownViewer

Windows 向けの Markdown ワークベンチです。

- WYSIWYG と Markdown ソースの切り替え
- CodeBlock renderer registry による拡張

:::note
右側の preview は Markdown-it ベースなので、code block renderer を React コンポーネントとして差し替えられます。
:::

\`\`\`mermaid
flowchart LR
  Editor[Editor] --> Preview[Rendered Preview]
  Preview --> Blocks[Custom Code Blocks]
\`\`\`

\`\`\`ts
registerCodeBlockRenderer('sql', SqlBlock)
registerCodeBlockRenderer('mermaid', MermaidBlock)
\`\`\`
`

const markdownParser = new MarkdownIt({
  html: true,
  breaks: true,
  linkify: true,
})
  .use(texmath, {
    engine: katex,
    delimiters: 'dollars',
  })
  .use(markdownItTaskLists, { enabled: true })
  .use(markdownItFootnote)
  .use(markdownItContainer, 'note')

function splitMarkdownSegments(markdown: string): MarkdownSegment[] {
  const fencePattern = /```([\w-]*)\r?\n([\s\S]*?)```/g
  const segments: MarkdownSegment[] = []
  let currentIndex = 0

  for (const match of markdown.matchAll(fencePattern)) {
    const matchIndex = match.index ?? 0
    if (matchIndex > currentIndex) {
      segments.push({
        type: 'markdown',
        value: markdown.slice(currentIndex, matchIndex),
      })
    }

    segments.push({
      type: 'code',
      language: match[1] || 'text',
      code: match[2].trimEnd(),
    })
    currentIndex = matchIndex + match[0].length
  }

  if (currentIndex < markdown.length) {
    segments.push({ type: 'markdown', value: markdown.slice(currentIndex) })
  }

  return segments
}

function estimateTokenCount(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / 4)
}

function getMarkdownLineStartOffsets(markdown: string): number[] {
  const offsets = [0]

  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] === '\n') {
      offsets.push(index + 1)
    }
  }

  return offsets
}

function getLineCount(markdown: string): number {
  return getMarkdownLineStartOffsets(markdown).length
}

function clampMarkdownPos(markdown: string, position: MdvAiMarkdownPos): MdvAiMarkdownPos {
  const lineStartOffsets = getMarkdownLineStartOffsets(markdown)
  const clampedLine = Math.min(Math.max(1, Math.trunc(position.line)), lineStartOffsets.length)
  const lineStartOffset = lineStartOffsets[clampedLine - 1]
  const nextLineStartOffset = clampedLine < lineStartOffsets.length ? lineStartOffsets[clampedLine] : markdown.length
  const lineEndOffset = nextLineStartOffset > lineStartOffset && markdown[nextLineStartOffset - 1] === '\n'
    ? nextLineStartOffset - 1
    : nextLineStartOffset
  const lineLength = lineEndOffset - lineStartOffset
  const clampedColumn = Math.min(Math.max(1, Math.trunc(position.column)), lineLength + 1)

  return {
    line: clampedLine,
    column: clampedColumn,
  }
}

function markdownPosToOffset(markdown: string, position: MdvAiMarkdownPos): number {
  const clampedPosition = clampMarkdownPos(markdown, position)
  const lineStartOffsets = getMarkdownLineStartOffsets(markdown)

  return lineStartOffsets[clampedPosition.line - 1] + clampedPosition.column - 1
}

function offsetToMarkdownPos(markdown: string, offset: number): MdvAiMarkdownPos {
  const normalizedOffset = Math.min(Math.max(0, Math.trunc(offset)), markdown.length)
  const lineStartOffsets = getMarkdownLineStartOffsets(markdown)
  let line = 1

  while (line < lineStartOffsets.length && lineStartOffsets[line] <= normalizedOffset) {
    line += 1
  }

  return {
    line,
    column: normalizedOffset - lineStartOffsets[line - 1] + 1,
  }
}

function toMarkdownPos(position: MdvAiMarkdownPos | [number, number]): MdvAiMarkdownPos {
  if (Array.isArray(position)) {
    return {
      line: Math.trunc(position[0] || 1),
      column: Math.trunc(position[1] || 1),
    }
  }

  return position
}

function isMarkdownPosLike(value: unknown): value is MdvAiMarkdownPos {
  return Boolean(
    value
    && typeof value === 'object'
    && Number.isFinite(Number((value as MdvAiMarkdownPos).line))
    && Number.isFinite(Number((value as MdvAiMarkdownPos).column)),
  )
}

function normalizeMarkdownPosRef(markdown: string, value: unknown): MdvAiMarkdownPos {
  if (!isMarkdownPosLike(value)) {
    throw new Error('Invalid markdown position')
  }

  return clampMarkdownPos(markdown, {
    line: Math.max(1, Math.round(Number(value.line))),
    column: Math.max(1, Math.round(Number(value.column))),
  })
}

function normalizeSpanRef(markdown: string, span: MdvAiSpanRef): MdvAiSpanRef {
  if (span.kind === 'selection' || span.kind === 'document') {
    return { kind: span.kind }
  }

  if (span.kind === 'point') {
    return { kind: 'point', at: normalizeMarkdownPosRef(markdown, span.at) }
  }

  if (span.kind === 'line') {
    return { kind: 'line', line: Math.max(1, Math.round(Number(span.line))) }
  }

  if (span.kind === 'line-range') {
    const startLine = Math.max(1, Math.round(Number(span.startLine)))
    const endLine = Math.max(1, Math.round(Number(span.endLine)))
    return {
      kind: 'line-range',
      startLine: Math.min(startLine, endLine),
      endLine: Math.max(startLine, endLine),
    }
  }

  if (span.kind === 'from-start') {
    return { kind: 'from-start', end: normalizeMarkdownPosRef(markdown, span.end) }
  }

  if (span.kind === 'to-end') {
    return { kind: 'to-end', start: normalizeMarkdownPosRef(markdown, span.start) }
  }

  return {
    kind: 'range',
    start: normalizeMarkdownPosRef(markdown, span.start),
    end: normalizeMarkdownPosRef(markdown, span.end),
  }
}

function normalizeSelectionToMarkdownSpan(editor: ToastUiEditor, markdown: string): MdvAiNormalizedSpan {
  const selection = editor.getSelection()
  let start: MdvAiMarkdownPos
  let end: MdvAiMarkdownPos

  if (Array.isArray(selection[0])) {
    const [markdownStart, markdownEnd] = selection as [[number, number], [number, number]]
    start = clampMarkdownPos(markdown, toMarkdownPos(markdownStart))
    end = clampMarkdownPos(markdown, toMarkdownPos(markdownEnd))
  } else {
    const [markdownStart, markdownEnd] = editor.convertPosToMatchEditorMode(selection[0], selection[1], 'markdown') as [[number, number], [number, number]]
    start = clampMarkdownPos(markdown, toMarkdownPos(markdownStart))
    end = clampMarkdownPos(markdown, toMarkdownPos(markdownEnd))
  }

  const startOffset = markdownPosToOffset(markdown, start)
  const endOffset = markdownPosToOffset(markdown, end)

  return normalizeOffsetsToSpan(markdown, startOffset, endOffset)
}

function normalizeOffsetsToSpan(markdown: string, startOffset: number, endOffset: number): MdvAiNormalizedSpan {
  const normalizedStartOffset = Math.min(Math.max(0, startOffset), markdown.length)
  const normalizedEndOffset = Math.min(Math.max(normalizedStartOffset, endOffset), markdown.length)

  return {
    start: offsetToMarkdownPos(markdown, normalizedStartOffset),
    end: offsetToMarkdownPos(markdown, normalizedEndOffset),
    isEmpty: normalizedStartOffset === normalizedEndOffset,
  }
}

function getLineBoundaryOffsets(markdown: string, line: number): { startOffset: number; endOffset: number } {
  const totalLines = getLineCount(markdown)
  const clampedLine = Math.min(Math.max(1, Math.trunc(line)), totalLines)
  const startOffset = markdownPosToOffset(markdown, { line: clampedLine, column: 1 })
  const endOffset = clampedLine < totalLines
    ? markdownPosToOffset(markdown, { line: clampedLine + 1, column: 1 })
    : markdown.length

  return { startOffset, endOffset }
}

function resolveSpanToOffsets(markdown: string, editor: ToastUiEditor | null, span: MdvAiSpanRef): { startOffset: number; endOffset: number } {
  if (span.kind === 'selection') {
    if (!editor) {
      throw new Error('Editor is unavailable')
    }

    const normalizedSpan = normalizeSelectionToMarkdownSpan(editor, markdown)
    return {
      startOffset: markdownPosToOffset(markdown, normalizedSpan.start),
      endOffset: markdownPosToOffset(markdown, normalizedSpan.end),
    }
  }

  if (span.kind === 'document') {
    return {
      startOffset: 0,
      endOffset: markdown.length,
    }
  }

  if (span.kind === 'point') {
    const offset = markdownPosToOffset(markdown, span.at)
    return {
      startOffset: offset,
      endOffset: offset,
    }
  }

  if (span.kind === 'line') {
    return getLineBoundaryOffsets(markdown, span.line)
  }

  if (span.kind === 'line-range') {
    const startLine = Math.min(span.startLine, span.endLine)
    const endLine = Math.max(span.startLine, span.endLine)
    const startLineOffsets = getLineBoundaryOffsets(markdown, startLine)
    const endLineOffsets = getLineBoundaryOffsets(markdown, endLine)

    return {
      startOffset: startLineOffsets.startOffset,
      endOffset: Math.max(startLineOffsets.startOffset, endLineOffsets.endOffset),
    }
  }

  if (span.kind === 'from-start') {
    return {
      startOffset: 0,
      endOffset: markdownPosToOffset(markdown, span.end),
    }
  }

  if (span.kind === 'to-end') {
    return {
      startOffset: markdownPosToOffset(markdown, span.start),
      endOffset: markdown.length,
    }
  }

  const startOffset = markdownPosToOffset(markdown, span.start)
  const endOffset = markdownPosToOffset(markdown, span.end)

  return {
    startOffset: Math.min(startOffset, endOffset),
    endOffset: Math.max(startOffset, endOffset),
  }
}

function applyCursorToOffsets(markdown: string, offsets: { startOffset: number; endOffset: number }, cursor?: MdvAiCursor | null) {
  if (!cursor) {
    return offsets
  }

  const cursorOffset = markdownPosToOffset(markdown, cursor.after)

  return {
    startOffset: Math.min(offsets.endOffset, Math.max(offsets.startOffset, cursorOffset)),
    endOffset: offsets.endOffset,
  }
}

function materializeWriteSources(sources: MdvAiWriteSource[]): string {
  return sources.map((source) => {
    if (source.type !== 'literal') {
      throw new Error('Renderer write request must be resolved to literal sources')
    }

    return source.text
  }).join('')
}

function DefaultCodeBlock({ code, language }: CodeBlockProps) {
  return (
    <div className="code-block-shell">
      <div className="code-block-header">{language}</div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  )
}

type EditorSurfaceProps = {
  value: string
  onChange: (nextMarkdown: string) => void
  editorRef: MutableRefObject<ToastUiEditor | null>
  onReady?: (editor: ToastUiEditor) => void
}

function EditorSurface({ value, onChange, editorRef, onReady }: EditorSurfaceProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const onChangeRef = useRef(onChange)
  const onReadyRef = useRef(onReady)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])

  useEffect(() => {
    if (!hostRef.current) {
      return
    }

    const instance = new ToastUiEditor({
      el: hostRef.current,
      height: '100%',
      initialValue: value,
      initialEditType: 'markdown',
      previewStyle: 'tab',
      usageStatistics: false,
      hideModeSwitch: false,
      events: {
        change: () => {
          onChangeRef.current(instance.getMarkdown())
        },
      },
    })

    editorRef.current = instance
    onReadyRef.current?.(instance)

    return () => {
      editorRef.current = null
      instance.destroy()
    }
  }, [])

  useEffect(() => {
    const instance = editorRef.current
    if (!instance) {
      return
    }

    if (instance.getMarkdown() !== value) {
      instance.setMarkdown(value)
    }
  }, [editorRef, value])

  return <div className="toast-editor-host" ref={hostRef} />
}

function MermaidBlock({ code, theme }: CodeBlockProps) {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    mermaid.initialize({ startOnLoad: false, theme: theme === 'dark' ? 'dark' : 'neutral' })
  }, [theme])

  useEffect(() => {
    let active = true
    const id = `mermaid-${crypto.randomUUID()}`

    mermaid
      .render(id, code)
      .then(({ svg }) => {
        if (!active) {
          return
        }
        setError(null)
        setSvg(svg)
      })
      .catch((renderError: unknown) => {
        if (!active) {
          return
        }
        setSvg('')
        setError(renderError instanceof Error ? renderError.message : 'Render failed')
      })

    return () => {
      active = false
    }
  }, [code, theme])

  if (error) {
    return <DefaultCodeBlock code={code} language="mermaid error" theme={theme} />
  }

  return (
    <div
      className="mermaid-block"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

function createRendererRegistry(): Map<string, CodeBlockRenderer> {
  const registry = new Map<string, CodeBlockRenderer>()
  registry.set('mermaid', MermaidBlock)
  return registry
}

function renderMarkdownSegment(value: string): string {
  return markdownParser.render(value)
}

function basename(filePath: string | null): string {
  if (!filePath) {
    return 'Untitled.md'
  }

  const normalized = filePath.replaceAll('\\', '/')
  const parts = normalized.split('/')

  return parts.at(-1) || 'Untitled.md'
}

function isPrimaryModifierPressed(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.metaKey
}

function getActionForShortcut(event: KeyboardEvent): MdvMenuAction | null {
  if (event.defaultPrevented || event.isComposing || !isPrimaryModifierPressed(event)) {
    return null
  }

  const key = event.key.toLowerCase()

  if (key === 'o') {
    return 'open'
  }

  if (key === 's') {
    return event.shiftKey ? 'save-as' : 'save'
  }

  if (key === ',') {
    return 'open-settings'
  }

  if (key === 'i') {
    return 'open-ai-chat'
  }

  if (key === '1') {
    return 'show-editor'
  }

  if (key === '2') {
    return 'show-preview'
  }

  return null
}

function resolveExternalAnchor(target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof Element)) {
    return null
  }

  const anchor = target.closest('a[href]')

  if (!(anchor instanceof HTMLAnchorElement)) {
    return null
  }

  if (!anchor.href || anchor.hash === anchor.getAttribute('href')) {
    return null
  }

  try {
    const url = new URL(anchor.href)

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null
    }

    return anchor
  } catch {
    return null
  }
}

type ToolbarButtonProps = {
  label: string
  active?: boolean
  onClick: () => void | Promise<void>
  children: ReactElement
}

type EditorSearchMode = 'exact' | 'semantic'

type EditorSearchResult = {
  id: string
  span: MdvAiNormalizedSpan
  preview: string
  meta: string
}

function ToolbarButton({ label, active = false, onClick, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className={active ? 'active icon-button' : 'icon-button'}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function toToastMarkdownPos(position: MdvAiMarkdownPos): [number, number] {
  return [position.line, position.column]
}

function selectSpanInEditor(editor: ToastUiEditor, span: MdvAiNormalizedSpan) {
  const markdownStart = toToastMarkdownPos(span.start)
  const markdownEnd = toToastMarkdownPos(span.end)
  const [selectionStart, selectionEnd] = editor.isMarkdownMode()
    ? [markdownStart, markdownEnd]
    : editor.convertPosToMatchEditorMode(markdownStart, markdownEnd, 'wysiwyg')

  editor.setSelection(selectionStart, selectionEnd)
}

function EditorIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="toolbar-icon">
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 8h8M8 12h8M8 16h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function RenderedIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="toolbar-icon">
      <path d="M3.5 12s3.2-5 8.5-5 8.5 5 8.5 5-3.2 5-8.5 5-8.5-5-8.5-5z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="2.7" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

function OpenIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="toolbar-icon">
      <path d="M4 8.5h5l1.6 2H20v7A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M4 8V6.5A1.5 1.5 0 0 1 5.5 5H9l1.5 2H18.5A1.5 1.5 0 0 1 20 8.5V10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  )
}

function SaveIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="toolbar-icon">
      <path d="M5.5 4h10.8L20 7.7v10.8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M8 4.5v5h7v-5M8 16h8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function SaveAsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="toolbar-icon">
      <path d="M5.5 4h10.8L20 7.7v10.8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M8 4.5v5h7v-5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 13v5M9.5 15.5 12 13l2.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="toolbar-icon">
      <path d="M12 8.9a3.1 3.1 0 1 0 0 6.2 3.1 3.1 0 0 0 0-6.2z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M19.4 13.2v-2.4l-2-.5a5.8 5.8 0 0 0-.6-1.4l1.1-1.8-1.7-1.7-1.8 1.1a5.8 5.8 0 0 0-1.4-.6l-.5-2h-2.4l-.5 2a5.8 5.8 0 0 0-1.4.6L6.4 5.4 4.7 7.1l1.1 1.8a5.8 5.8 0 0 0-.6 1.4l-2 .5v2.4l2 .5a5.8 5.8 0 0 0 .6 1.4l-1.1 1.8 1.7 1.7 1.8-1.1a5.8 5.8 0 0 0 1.4.6l.5 2h2.4l.5-2a5.8 5.8 0 0 0 1.4-.6l1.8 1.1 1.7-1.7-1.1-1.8a5.8 5.8 0 0 0 .6-1.4z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  )
}

function App() {
  const { themeMode, resolvedTheme, setThemeMode } = useDesktopTheme()
  const [markdownText, setMarkdownText] = useState(initialDocument)
  const [activePanel, setActivePanel] = useState<'write' | 'preview'>('write')
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null)
  const [displayTitle, setDisplayTitle] = useState('Untitled.md')
  const [statusText, setStatusText] = useState('Ready')
  const [isDraggingFile, setIsDraggingFile] = useState(false)
  const [editorSearchMode, setEditorSearchMode] = useState<EditorSearchMode>('exact')
  const [editorSearchQuery, setEditorSearchQuery] = useState('')
  const [editorSearchResults, setEditorSearchResults] = useState<EditorSearchResult[]>([])
  const [selectedSearchResultIndex, setSelectedSearchResultIndex] = useState(-1)
  const [pendingSearchJump, setPendingSearchJump] = useState<MdvAiNormalizedSpan | null>(null)
  const [isRunningEditorSearch, setIsRunningEditorSearch] = useState(false)
  const [editorSearchError, setEditorSearchError] = useState<string | null>(null)
  const [isSliceSearchEnabled, setIsSliceSearchEnabled] = useState(true)
  const [isSemanticSearchAvailable, setIsSemanticSearchAvailable] = useState(false)
  const editorRef = useRef<ToastUiEditor | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const persistedMarkdownRef = useRef(initialDocument)
  const rendererRegistry = useMemo(() => createRendererRegistry(), [])
  const segments = useMemo(() => splitMarkdownSegments(markdownText), [markdownText])

  useEffect(() => {
    const bootstrap = window.mdvDesktop?.settings.getBootstrapSettings()

    if (bootstrap?.hasPersistedSettings) {
      return
    }

    const legacyTheme = readLegacyThemeMode()

    if (!legacyTheme || legacyTheme === 'system') {
      return
    }

    void window.mdvDesktop?.settings.migrateLegacyTheme(legacyTheme).then(() => {
      clearLegacyThemeMode()
    })
  }, [])

  useEffect(() => {
    document.title = `${displayTitle} - MDV`
  }, [displayTitle])

  useEffect(() => {
    let active = true
    const refreshSemanticAvailability = async (nextSettings?: MdvSettings | null) => {
      const [resolvedSettings, providerStatus] = await Promise.all([
        nextSettings ? Promise.resolve(nextSettings) : window.mdvDesktop?.settings.getSettings(),
        window.mdvDesktop?.settings.getProviderStatus(),
      ])

      if (!active) {
        return
      }

      const sliceSearchEnabled = resolvedSettings?.ai.toolPermissions.sliceSearch !== false
      setIsSliceSearchEnabled(sliceSearchEnabled)
      setIsSemanticSearchAvailable(Boolean(sliceSearchEnabled && resolvedSettings?.ai.openai.enabled && providerStatus?.openaiConfigured))
    }

    const unsubscribe = window.mdvDesktop?.settings.onSettingsChanged((nextSettings) => {
      void refreshSemanticAvailability(nextSettings)
    })

    void refreshSemanticAvailability().catch(() => {
      if (active) {
        setIsSliceSearchEnabled(false)
        setIsSemanticSearchAvailable(false)
      }
    })

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    if (activePanel !== 'write' || !pendingSearchJump) {
      return
    }

    const editor = editorRef.current

    if (!editor) {
      return
    }

    selectSpanInEditor(editor, pendingSearchJump)
    setPendingSearchJump(null)
  }, [activePanel, pendingSearchJump])

  const buildClientSnapshot = (): MdvClientSnapshot => ({
    markdownText,
    currentFilePath,
    displayTitle,
    activePanel,
  })

  const invalidateEditorSearch = () => {
    setEditorSearchResults([])
    setSelectedSearchResultIndex(-1)
    setPendingSearchJump(null)
    setEditorSearchError(null)
  }

  const applyClientSnapshot = (snapshot: MdvClientSnapshot) => {
    invalidateEditorSearch()
    setMarkdownText(snapshot.markdownText)
    setCurrentFilePath(snapshot.currentFilePath)
    setDisplayTitle(snapshot.displayTitle || basename(snapshot.currentFilePath))
    setActivePanel(snapshot.activePanel)
    editorRef.current?.setMarkdown(snapshot.markdownText)
  }

  const loadFilePayload = (payload: MdvFilePayload | null) => {
    if (!payload) {
      return
    }

    invalidateEditorSearch()
    setMarkdownText(payload.content)
    setCurrentFilePath(payload.path)
    setDisplayTitle(basename(payload.path))
    persistedMarkdownRef.current = payload.content
    editorRef.current?.setMarkdown(payload.content)
    setStatusText(`Opened ${basename(payload.path)}`)
  }

  const handleOpen = async () => {
    const payload = await window.mdvDesktop?.openFile()
    loadFilePayload(payload ?? null)
  }

  const handleOpenByPath = async (filePath: string) => {
    const payload = await window.mdvDesktop?.readFile(filePath)
    loadFilePayload(payload ?? null)
  }

  const handleSave = async (forceDialog = false) => {
    const result = await window.mdvDesktop?.saveFile({
      path: currentFilePath,
      content: markdownText,
      forceDialog,
    })

    if (!result) {
      return
    }

    setCurrentFilePath(result.path)
    setDisplayTitle(basename(result.path))
    persistedMarkdownRef.current = markdownText
    setStatusText(`Saved ${basename(result.path)}`)
  }

  const applyMarkdownContent = (nextMarkdown: string, statusMessage: string) => {
    invalidateEditorSearch()
    setMarkdownText(nextMarkdown)
    editorRef.current?.setMarkdown(nextMarkdown)
    setStatusText(statusMessage)
  }

  const focusEditorSearch = () => {
    searchInputRef.current?.focus()
    searchInputRef.current?.select()
    setStatusText('Focused editor search')
  }

  const jumpToEditorSearchResult = (result: EditorSearchResult, index: number) => {
    setSelectedSearchResultIndex(index)
    setPendingSearchJump(result.span)
    setActivePanel('write')
    setStatusText(`Jumped to search result ${index + 1}/${Math.max(editorSearchResults.length, index + 1)}`)
  }

  const resolvedEditorSearchMode = editorSearchMode === 'semantic' && !isSemanticSearchAvailable ? 'exact' : editorSearchMode
  const isResolvedEditorSearchAvailable = resolvedEditorSearchMode === 'exact' ? isSliceSearchEnabled : isSemanticSearchAvailable

  const handleRunEditorSearch = async () => {
    const query = editorSearchQuery.trim()

    if (query.length === 0) {
      setEditorSearchResults([])
      setSelectedSearchResultIndex(-1)
      setEditorSearchError(null)
      setStatusText('Cleared editor search')
      return
    }

    setIsRunningEditorSearch(true)
    setEditorSearchError(null)

    try {
      if (resolvedEditorSearchMode === 'exact') {
        if (!isSliceSearchEnabled) {
          throw new Error('Slice search is disabled in settings')
        }

        const payload = await window.mdvDesktop?.grepAiSlice({
          target: {
            editorId: 'editor:active',
            span: { kind: 'document' },
          },
          query,
          maxResults: 40,
          persistBuffer: false,
        })

        const results = payload?.matches.map((match, index) => ({
          id: `exact:${match.line}:${match.column}:${index}`,
          span: match.span,
          preview: match.preview,
          meta: `${match.line}:${match.column}`,
        })) ?? []

        setEditorSearchResults(results)
        setSelectedSearchResultIndex(results.length > 0 ? 0 : -1)

        if (results.length > 0) {
          jumpToEditorSearchResult(results[0], 0)
        } else {
          setStatusText(`No exact matches for "${query}"`)
        }

        return
      }

      if (!isSemanticSearchAvailable) {
        throw new Error('Semantic search requires OpenAI to be enabled and configured')
      }

      const payload = await window.mdvDesktop?.semanticSearchAiSlice({
        target: {
          editorId: 'editor:active',
          span: { kind: 'document' },
        },
        query,
        maxResults: 12,
        persistBuffer: false,
      })

      const results = payload?.results.map((result, index) => ({
        id: `semantic:${result.layer}:${result.span.start.line}:${result.span.start.column}:${index}`,
        span: result.span,
        preview: result.preview,
        meta: `${result.layer} ${(result.score * 100).toFixed(1)}%`,
      })) ?? []

      setEditorSearchResults(results)
      setSelectedSearchResultIndex(results.length > 0 ? 0 : -1)

      if (results.length > 0) {
        jumpToEditorSearchResult(results[0], 0)
      } else {
        setStatusText(`No semantic matches for "${query}"`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setEditorSearchError(message)
      setEditorSearchResults([])
      setSelectedSearchResultIndex(-1)
      setStatusText(`Search failed: ${message}`)
    } finally {
      setIsRunningEditorSearch(false)
    }
  }

  const moveEditorSearchSelection = (delta: number) => {
    if (editorSearchResults.length === 0) {
      return
    }

    const baseIndex = selectedSearchResultIndex >= 0 ? selectedSearchResultIndex : 0
    const nextIndex = (baseIndex + delta + editorSearchResults.length) % editorSearchResults.length
    jumpToEditorSearchResult(editorSearchResults[nextIndex], nextIndex)
  }

  const respondToAiEditorRequest = (request: MdvAiEditorRequest) => {
    try {
      if (request.type === 'get-context') {
        const selectedText = editorRef.current?.getSelectedText() ?? ''
        const contextSummary = [
          `Title: ${displayTitle}`,
          `Path: ${currentFilePath ?? '(untitled)'}`,
          `Panel: ${activePanel}`,
          `Text length: ${markdownText.length}`,
          `Selection length: ${selectedText.length}`,
          `Dirty: ${markdownText !== persistedMarkdownRef.current ? 'yes' : 'no'}`,
        ].join('\n')

        window.mdvDesktop?.sendAiEditorResponse({
          requestId: request.requestId,
          ok: true,
          payload: {
            editorId: request.editorId,
            currentFilePath,
            title: displayTitle,
            activePanel,
            textLength: markdownText.length,
            selectionTextLength: selectedText.length,
            tokenEstimate: estimateTokenCount(contextSummary),
            isDirty: markdownText !== persistedMarkdownRef.current,
          },
        })
        return
      }

      if (request.type === 'read') {
        const editor = editorRef.current
        const resolvedOffsets = applyCursorToOffsets(
          markdownText,
          resolveSpanToOffsets(markdownText, editor, request.target.span),
          request.cursor,
        )
        const maxTokens = typeof request.maxTokens === 'number' && Number.isFinite(request.maxTokens)
          ? Math.max(1, Math.round(request.maxTokens))
          : 1600
        const maxChars = maxTokens * 4
        const availableText = markdownText.slice(resolvedOffsets.startOffset, resolvedOffsets.endOffset)
        const nextText = availableText.slice(0, maxChars)
        const finalEndOffset = resolvedOffsets.startOffset + nextText.length
        const truncated = availableText.length > nextText.length
        const returnedSpan = normalizeOffsetsToSpan(markdownText, resolvedOffsets.startOffset, finalEndOffset)

        window.mdvDesktop?.sendAiEditorResponse({
          requestId: request.requestId,
          ok: true,
          payload: {
            editorId: request.target.editorId,
            span: returnedSpan,
            target: {
              editorId: request.target.editorId,
              span: normalizeSpanRef(markdownText, request.target.span),
            },
            pageTarget: {
              editorId: request.target.editorId,
              span: {
                kind: 'range',
                start: returnedSpan.start,
                end: returnedSpan.end,
              },
            },
            text: nextText,
            estimatedTokens: estimateTokenCount(nextText),
            truncated,
            nextCursor: truncated
              ? { after: offsetToMarkdownPos(markdownText, finalEndOffset) }
              : null,
          },
        })
        return
      }

      if (request.type === 'write') {
        const nextText = materializeWriteSources(request.sources)
        const resolvedOffsets = resolveSpanToOffsets(markdownText, editorRef.current, request.destination.span)
        const insertionOffsets = request.mode === 'insert'
          ? {
              startOffset: resolvedOffsets.startOffset,
              endOffset: resolvedOffsets.startOffset,
            }
          : resolvedOffsets
        const updatedMarkdown = `${markdownText.slice(0, insertionOffsets.startOffset)}${nextText}${markdownText.slice(insertionOffsets.endOffset)}`

        if (typeof request.title === 'string' && request.title.trim().length > 0) {
          setDisplayTitle(request.title.trim())
        }

        applyMarkdownContent(updatedMarkdown, request.mode === 'insert' ? 'AI inserted content' : 'AI updated document')

        window.mdvDesktop?.sendAiEditorResponse({
          requestId: request.requestId,
          ok: true,
          payload: {
            editorId: request.destination.editorId,
            span: normalizeOffsetsToSpan(updatedMarkdown, insertionOffsets.startOffset, insertionOffsets.startOffset + nextText.length),
            text: nextText,
            mode: request.mode,
            bytesWritten: new TextEncoder().encode(nextText).length,
            created: false,
          },
        })
        return
      }

      if (request.type === 'list-buffers') {
        throw new Error('Renderer does not handle list-buffers requests')
      }

      throw new Error('Unsupported AI editor request')
    } catch (error) {
      window.mdvDesktop?.sendAiEditorResponse({
        requestId: request.requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const runDesktopAction = (action: MdvMenuAction) => {
    if (action === 'open') {
      void handleOpen()
      return
    }

    if (action === 'save') {
      void handleSave(false)
      return
    }

    if (action === 'save-as') {
      void handleSave(true)
      return
    }

    if (action === 'open-settings') {
      void window.mdvDesktop?.openSettingsWindow().then(() => {
        setStatusText('Opened settings')
      })
      return
    }

    if (action === 'open-ai-chat') {
      void window.mdvDesktop?.openAiChat().then(() => {
        setStatusText('Opened AI chat')
      })
      return
    }

    if (action === 'show-editor') {
      setActivePanel('write')
      setStatusText('Switched to editor')
      return
    }

    setActivePanel('preview')
    setStatusText('Switched to preview')
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.defaultPrevented && !event.isComposing && isPrimaryModifierPressed(event) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        focusEditorSearch()
        return
      }

      const action = getActionForShortcut(event)

      if (!action) {
        return
      }

      event.preventDefault()
      runDesktopAction(action)
    }

    window.addEventListener('keydown', handleKeyDown, true)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [handleOpen, handleSave])

  useEffect(() => {
    const unsubscribe = window.mdvDesktop?.onServerCommand((command) => {
      if (command.type === 'suspend') {
        const snapshot = buildClientSnapshot()
        setStatusText('Suspending for update')
        window.mdvDesktop?.sendServerCommandResult({
          requestId: command.requestId,
          type: 'suspend',
          status: 'completed',
          snapshot,
        })
        return
      }

      if (command.type === 'resume' && command.snapshot) {
        applyClientSnapshot(command.snapshot)
      }

      setStatusText('Resumed from server state')
      window.mdvDesktop?.sendServerCommandResult({
        requestId: command.requestId,
        type: 'resume',
        status: 'completed',
        snapshot: command.snapshot || buildClientSnapshot(),
      })
    })

    return () => {
      unsubscribe?.()
    }
  }, [activePanel, currentFilePath, markdownText])

  useEffect(() => {
    const unsubscribe = window.mdvDesktop?.onOpenFileRequested((filePath) => {
      void handleOpenByPath(filePath)
    })

    return () => {
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.mdvDesktop?.onMenuAction((action) => {
      runDesktopAction(action)
    })

    return () => {
      unsubscribe?.()
    }
  }, [handleOpen, handleSave])

  useEffect(() => {
    const unsubscribe = window.mdvDesktop?.onAiEditorRequest((request) => {
      respondToAiEditorRequest(request)
    })

    return () => {
      unsubscribe?.()
    }
  }, [activePanel, currentFilePath, markdownText])

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      const anchor = resolveExternalAnchor(event.target)

      if (!anchor) {
        return
      }

      event.preventDefault()
      void window.mdvDesktop?.openExternalLink(anchor.href).then((result) => {
        if (!result || result.status === 'opened') {
          setStatusText(`Opened link: ${anchor.hostname}`)
          return
        }

        if (result.status === 'cancelled') {
          setStatusText('Cancelled external link')
          return
        }

        setStatusText('Blocked external link')
      })
    }

    document.addEventListener('click', handleDocumentClick, true)

    return () => {
      document.removeEventListener('click', handleDocumentClick, true)
    }
  }, [])

  const handleDrop = async (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setIsDraggingFile(false)

    const droppedFile = event.dataTransfer.files.item(0)
    if (!droppedFile) {
      return
    }

    const nativePath = 'path' in droppedFile ? (droppedFile as File & { path?: string }).path : undefined
    if (nativePath && window.mdvDesktop) {
      const payload = await window.mdvDesktop.readFile(nativePath)
      loadFilePayload(payload)
      return
    }

    const content = await droppedFile.text()
    setMarkdownText(content)
    setCurrentFilePath(null)
    editorRef.current?.setMarkdown(content)
    setStatusText(`Loaded ${droppedFile.name}`)
  }

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setIsDraggingFile(true)
  }

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return
    }

    setIsDraggingFile(false)
  }

  return (
    <main className="shell">
      <section
        className={`workspace compact-workspace${isDraggingFile ? ' dragging' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <header className="topbar">
          <div className="title-strip">
            <h1>{displayTitle}</h1>
            <span>{statusText}</span>
          </div>

          <div className="view-switch">
            <ToolbarButton label="Editor (Ctrl/Cmd+1)" active={activePanel === 'write'} onClick={() => setActivePanel('write')}>
              <EditorIcon />
            </ToolbarButton>
            <ToolbarButton label="Rendered (Ctrl/Cmd+2)" active={activePanel === 'preview'} onClick={() => setActivePanel('preview')}>
              <RenderedIcon />
            </ToolbarButton>
          </div>

          <div className="action-strip">
            <div className="editor-search-shell" role="search">
              <select
                className="editor-search-mode"
                aria-label="Search mode"
                value={resolvedEditorSearchMode}
                onChange={(event) => {
                  const nextMode = event.target.value as EditorSearchMode

                  if (nextMode === 'semantic' && !isSemanticSearchAvailable) {
                    setStatusText('Semantic search requires OpenAI to be enabled and configured')
                    setEditorSearchMode('exact')
                    return
                  }

                  setEditorSearchMode(nextMode)
                }}
              >
                <option value="exact">Exact</option>
                <option value="semantic" disabled={!isSemanticSearchAvailable}>Semantic</option>
              </select>
              <input
                ref={searchInputRef}
                className="editor-search-input"
                type="search"
                placeholder="Search in editor"
                value={editorSearchQuery}
                onChange={(event) => setEditorSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()

                    if (event.shiftKey) {
                      moveEditorSearchSelection(-1)
                      return
                    }

                    void handleRunEditorSearch()
                  }

                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    moveEditorSearchSelection(1)
                  }

                  if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    moveEditorSearchSelection(-1)
                  }
                }}
              />
              <button type="button" onClick={() => void handleRunEditorSearch()} disabled={isRunningEditorSearch || !isResolvedEditorSearchAvailable}>
                {isRunningEditorSearch ? '...' : 'Go'}
              </button>
              <button type="button" onClick={() => moveEditorSearchSelection(-1)} disabled={editorSearchResults.length === 0}>
                Prev
              </button>
              <button type="button" onClick={() => moveEditorSearchSelection(1)} disabled={editorSearchResults.length === 0}>
                Next
              </button>
              <span className="editor-search-count">
                {editorSearchResults.length === 0 ? '0' : `${selectedSearchResultIndex + 1}/${editorSearchResults.length}`}
              </span>
            </div>
            <label className="theme-select-shell" title="Theme">
              <span>Theme</span>
              <select
                className="theme-select"
                value={themeMode}
                onChange={(event) => {
                  void setThemeMode(event.target.value as ThemeMode)
                }}
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <ToolbarButton label="Open (Ctrl/Cmd+O)" onClick={handleOpen}>
              <OpenIcon />
            </ToolbarButton>
            <ToolbarButton label="Save (Ctrl/Cmd+S)" onClick={() => void handleSave(false)}>
              <SaveIcon />
            </ToolbarButton>
            <ToolbarButton label="Save As (Ctrl/Cmd+Shift+S)" onClick={() => void handleSave(true)}>
              <SaveAsIcon />
            </ToolbarButton>
            <ToolbarButton label="Settings (Ctrl/Cmd+,)" onClick={() => runDesktopAction('open-settings')}>
              <SettingsIcon />
            </ToolbarButton>
          </div>
        </header>

        {(editorSearchError || editorSearchResults.length > 0) ? (
          <section className="editor-search-results" aria-label="Editor search results">
            {editorSearchError ? <div className="editor-search-error">{editorSearchError}</div> : null}
            {editorSearchResults.map((result, index) => (
              <button
                key={result.id}
                type="button"
                className={index === selectedSearchResultIndex ? 'editor-search-result active' : 'editor-search-result'}
                onClick={() => jumpToEditorSearchResult(result, index)}
              >
                <span className="editor-search-result-meta">{result.meta}</span>
                <span className="editor-search-result-preview">{result.preview}</span>
              </button>
            ))}
          </section>
        ) : null}

        {activePanel === 'write' ? (
          <div className="single-panel">
            <div className="panel editor-panel full-panel">
              <EditorSurface
                value={markdownText}
                onChange={(nextMarkdown) => {
                  invalidateEditorSearch()
                  setMarkdownText(nextMarkdown)
                }}
                editorRef={editorRef}
                onReady={(editor) => {
                  if (!pendingSearchJump) {
                    return
                  }

                  selectSpanInEditor(editor, pendingSearchJump)
                  setPendingSearchJump(null)
                }}
              />
            </div>
          </div>
        ) : null}

        {activePanel === 'preview' ? (
          <div className="single-panel">
            <div className="panel preview-panel full-panel">
              <div className="preview-scroll compact-preview">
                {segments.map((segment, index) => {
                  if (segment.type === 'markdown') {
                    return (
                      <section
                        key={`md-${index}`}
                        className="markdown-fragment"
                        dangerouslySetInnerHTML={{
                          __html: renderMarkdownSegment(segment.value),
                        }}
                      />
                    )
                  }

                  const Renderer =
                    rendererRegistry.get(segment.language) ?? DefaultCodeBlock

                  return (
                    <Renderer
                      key={`code-${index}`}
                      code={segment.code}
                      language={segment.language}
                      theme={resolvedTheme}
                    />
                  )
                })}
              </div>
            </div>
          </div>
        ) : null}

        <div className="statusbar">
          <span>Drop a .md or .txt file anywhere to open it. Shortcuts: Ctrl/Cmd+F, Ctrl/Cmd+O, Ctrl/Cmd+S, Ctrl/Cmd+Shift+S, Ctrl/Cmd+Comma, Ctrl/Cmd+I, Ctrl/Cmd+1, Ctrl/Cmd+2</span>
          <span>{window.mdvDesktop?.platform ?? 'browser'}</span>
        </div>
      </section>
    </main>
  )
}

export default App
