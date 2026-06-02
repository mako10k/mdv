import { memo, useDeferredValue, useEffect, useMemo, useState, type ReactElement } from 'react'
import MarkdownIt from 'markdown-it'
import markdownItContainer from 'markdown-it-container'
import markdownItFootnote from 'markdown-it-footnote'
import markdownItTaskLists from 'markdown-it-task-lists'
import texmath from 'markdown-it-texmath'
import katex from 'katex'
import mermaid from 'mermaid'
import { type ResolvedTheme } from '../shared/useDesktopTheme'

type CodeBlockProps = {
  code: string
  language: string
  theme: ResolvedTheme
}

type CodeBlockRenderer = (props: CodeBlockProps) => ReactElement

type MarkdownSegment =
  | { type: 'markdown'; value: string }
  | { type: 'code'; language: string; code: string }

type MarkdownFragmentProps = {
  value: string
}

const markdownParser = new MarkdownIt({
  html: false,
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

function MermaidBlock({ code, theme }: CodeBlockProps) {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    mermaid.initialize({ startOnLoad: false, theme: theme === 'dark' ? 'dark' : 'neutral' })
  }, [theme])

  useEffect(() => {
    let active = true
    const id = `chat-mermaid-${crypto.randomUUID()}`

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

  return <div className="mermaid-block" dangerouslySetInnerHTML={{ __html: svg }} />
}

function createRendererRegistry(): Map<string, CodeBlockRenderer> {
  const registry = new Map<string, CodeBlockRenderer>()
  registry.set('mermaid', MermaidBlock)
  return registry
}

function renderMarkdownSegment(value: string): string {
  return markdownParser.render(value)
}

const MarkdownFragment = memo(function MarkdownFragment({ value }: MarkdownFragmentProps) {
  const html = useMemo(() => renderMarkdownSegment(value), [value])

  return (
    <section
      className="markdown-fragment"
      dangerouslySetInnerHTML={{
        __html: html,
      }}
    />
  )
})

type ChatMarkdownProps = {
  markdown: string
  theme: ResolvedTheme
  streaming?: boolean
}

const ChatMarkdown = memo(function ChatMarkdown({ markdown, theme, streaming = false }: ChatMarkdownProps) {
  const rendererRegistry = useMemo(() => createRendererRegistry(), [])
  const deferredMarkdown = useDeferredValue(markdown)
  const renderedMarkdown = streaming ? deferredMarkdown : markdown
  const segments = useMemo(() => splitMarkdownSegments(renderedMarkdown), [renderedMarkdown])

  return (
    <div className="chat-markdown-content">
      {segments.map((segment, index) => {
        if (segment.type === 'markdown') {
          return <MarkdownFragment key={`md-${index}`} value={segment.value} />
        }

        const Renderer = rendererRegistry.get(segment.language) ?? DefaultCodeBlock

        return (
          <Renderer
            key={`code-${index}`}
            code={segment.code}
            language={segment.language}
            theme={theme}
          />
        )
      })}
    </div>
  )
})

export default ChatMarkdown
