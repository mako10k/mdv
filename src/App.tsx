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
import { DiffEditor } from '@monaco-editor/react'
import { applyPatch, createPatch } from 'diff'
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
}

type CodeBlockRenderer = (props: CodeBlockProps) => ReactElement

type MarkdownSegment =
  | { type: 'markdown'; value: string }
  | { type: 'code'; language: string; code: string }

const initialDocument = `# MDV Editor

Windows 向けの Markdown ワークベンチです。

- WYSIWYG と Markdown ソースの切り替え
- diff / patch の確認と適用
- CodeBlock renderer registry による拡張

:::note
右側の preview は Markdown-it ベースなので、code block renderer を React コンポーネントとして差し替えられます。
:::

\`\`\`mermaid
flowchart LR
  Writer[Editor] --> Diff[Diff / Patch]
  Diff --> Preview[Extensible Preview]
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

function MermaidBlock({ code }: CodeBlockProps) {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    mermaid.initialize({ startOnLoad: false, theme: 'neutral' })
  }, [])

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
  }, [code])

  if (error) {
    return <DefaultCodeBlock code={code} language="mermaid error" />
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

function App() {
  const [markdownText, setMarkdownText] = useState(initialDocument)
  const [baseline, setBaseline] = useState(initialDocument)
  const [patchText, setPatchText] = useState('')
  const [activePanel, setActivePanel] = useState<'write' | 'preview' | 'diff'>('write')
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null)
  const [statusText, setStatusText] = useState('Ready')
  const [isDraggingFile, setIsDraggingFile] = useState(false)
  const editorRef = useRef<ToastUiEditor | null>(null)
  const rendererRegistry = useMemo(() => createRendererRegistry(), [])
  const segments = useMemo(() => splitMarkdownSegments(markdownText), [markdownText])
  const generatedPatch = useMemo(
    () => createPatch('document.md', baseline, markdownText, 'baseline', 'working'),
    [baseline, markdownText],
  )

  useEffect(() => {
    document.title = `${basename(currentFilePath)} - MDV`
  }, [currentFilePath])

  const loadFilePayload = (payload: MdvFilePayload | null) => {
    if (!payload) {
      return
    }

    setMarkdownText(payload.content)
    setBaseline(payload.content)
    setPatchText('')
    setCurrentFilePath(payload.path)
    editorRef.current?.setMarkdown(payload.content)
    setStatusText(`Opened ${basename(payload.path)}`)
  }

  const handleOpen = async () => {
    const payload = await window.mdvDesktop?.openFile()
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
    setBaseline(content)
    setPatchText('')
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

  const applyUnifiedPatch = () => {
    const nextDocument = applyPatch(baseline, patchText)
    if (typeof nextDocument === 'string') {
      setMarkdownText(nextDocument)
      editorRef.current?.setMarkdown(nextDocument)
      setStatusText('Patch applied')
    }
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
            <button
              type="button"
              className={activePanel === 'write' ? 'active' : ''}
              onClick={() => setActivePanel('write')}
            >
              Editor
            </button>
            <button
              type="button"
              className={activePanel === 'preview' ? 'active' : ''}
              onClick={() => setActivePanel('preview')}
            >
              Rendered
            </button>
            <button
              type="button"
              className={activePanel === 'diff' ? 'active' : ''}
              onClick={() => setActivePanel('diff')}
            >
              Diff
            </button>
          </div>

          <div className="action-strip">
            <button type="button" onClick={handleOpen}>
              Open
            </button>
            <button type="button" onClick={() => void handleSave(false)}>
              Save
            </button>
            <button type="button" onClick={() => void handleSave(true)}>
              Save As
            </button>
            <button type="button" onClick={() => setBaseline(markdownText)}>
              Set Base
            </button>
            <button type="button" onClick={() => setPatchText(generatedPatch)}>
              Fill Patch
            </button>
            <button type="button" onClick={applyUnifiedPatch}>
              Apply
            </button>
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
                    />
                  )
                })}
              </div>
            </div>
          </div>
        ) : null}

        {activePanel === 'diff' ? (
          <div className="diff-grid compact-diff-grid">
            <div className="panel full-panel">
              <DiffEditor
                height="100%"
                language="markdown"
                original={baseline}
                modified={markdownText}
                options={{
                  readOnly: true,
                  renderSideBySide: true,
                  minimap: { enabled: false },
                }}
              />
            </div>

            <div className="panel patch-panel compact-patch-panel">
              <textarea
                value={patchText}
                onChange={(event) => setPatchText(event.target.value)}
                placeholder="Unified diff"
              />
              <pre className="generated-patch">
                <code>{generatedPatch}</code>
              </pre>
            </div>
          </div>
        ) : null}

        <div className="statusbar">
          <span>Drop a .md or .txt file anywhere to open it</span>
          <span>{window.mdvDesktop?.platform ?? 'browser'}</span>
        </div>
      </section>
    </main>
  )
}

export default App
