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
import mermaid from 'mermaid'
import './App.css'
import '@toast-ui/editor/dist/toastui-editor.css'

type CodeBlockProps = {
  code: string
  language: string
  theme: ResolvedTheme
}

type CodeBlockRenderer = (props: CodeBlockProps) => ReactElement

type MarkdownSegment =
  | { type: 'markdown'; value: string }
  | { type: 'code'; language: string; code: string }

type ThemeMode = 'system' | 'light' | 'dark'
type ResolvedTheme = 'light' | 'dark'

const themeStorageKey = 'mdv-theme-mode'

const initialDocument = `# MDV Editor

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

function readStoredThemeMode(): ThemeMode {
  const storedValue = window.localStorage.getItem(themeStorageKey)

  if (storedValue === 'light' || storedValue === 'dark' || storedValue === 'system') {
    return storedValue
  }

  return 'system'
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolveTheme(themeMode: ThemeMode): ResolvedTheme {
  return themeMode === 'system' ? getSystemTheme() : themeMode
}

type EditorSurfaceProps = {
  value: string
  onChange: (nextMarkdown: string) => void
  editorRef: MutableRefObject<ToastUiEditor | null>
}

function EditorSurface({ value, onChange, editorRef }: EditorSurfaceProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

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

function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readStoredThemeMode())
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemTheme())
  const [markdownText, setMarkdownText] = useState(initialDocument)
  const [activePanel, setActivePanel] = useState<'write' | 'preview'>('write')
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null)
  const [statusText, setStatusText] = useState('Ready')
  const [isDraggingFile, setIsDraggingFile] = useState(false)
  const editorRef = useRef<ToastUiEditor | null>(null)
  const resolvedTheme = useMemo(
    () => (themeMode === 'system' ? systemTheme : resolveTheme(themeMode)),
    [systemTheme, themeMode],
  )
  const rendererRegistry = useMemo(() => createRendererRegistry(), [])
  const segments = useMemo(() => splitMarkdownSegments(markdownText), [markdownText])

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.dataset.themeMode = themeMode
    window.localStorage.setItem(themeStorageKey, themeMode)
  }, [resolvedTheme, themeMode])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      setSystemTheme(mediaQuery.matches ? 'dark' : 'light')
    }

    handleChange()
    mediaQuery.addEventListener('change', handleChange)

    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [])

  useEffect(() => {
    document.title = `${basename(currentFilePath)} - MDV`
  }, [currentFilePath])

  const loadFilePayload = (payload: MdvFilePayload | null) => {
    if (!payload) {
      return
    }

    setMarkdownText(payload.content)
    setCurrentFilePath(payload.path)
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
    setStatusText(`Saved ${basename(result.path)}`)
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
            <h1>{basename(currentFilePath)}</h1>
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
            <label className="theme-select-shell" title="Theme">
              <span>Theme</span>
              <select
                className="theme-select"
                value={themeMode}
                onChange={(event) => setThemeMode(event.target.value as ThemeMode)}
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
          </div>
        </header>

        {activePanel === 'write' ? (
          <div className="single-panel">
            <div className="panel editor-panel full-panel">
              <EditorSurface
                value={markdownText}
                onChange={setMarkdownText}
                editorRef={editorRef}
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
          <span>Drop a .md or .txt file anywhere to open it. Shortcuts: Ctrl/Cmd+O, S, Shift+S, 1, 2</span>
          <span>{window.mdvDesktop?.platform ?? 'browser'}</span>
        </div>
      </section>
    </main>
  )
}

export default App
