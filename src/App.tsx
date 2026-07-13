import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import ToastUiEditor from '@toast-ui/editor'
import MarkdownIt from 'markdown-it'
import markdownItContainer from 'markdown-it-container'
import markdownItFootnote from 'markdown-it-footnote'
import markdownItTaskLists from 'markdown-it-task-lists'
import texmath from 'markdown-it-texmath'
import katex from 'katex'
import mermaid from 'mermaid'
import { clearLegacyThemeMode, readLegacyThemeMode, useDesktopTheme, type ResolvedTheme } from './shared/useDesktopTheme'
import { getTranslations, isLocale, useI18n } from './shared/i18n'
import ChatApp from './ai-chat/ChatApp'
import ChangePreviewDialog from './change-preview/ChangePreviewDialog'
import {
  applyTypographyToRoot,
  clampChatFontSizePx,
  clampEditorFontSizePx,
  DEFAULT_CHAT_FONT_SIZE_PX,
  DEFAULT_EDITOR_FONT_SIZE_PX,
} from './shared/desktopTypography'
import '@toast-ui/editor/dist/toastui-editor.css'
import 'katex/dist/katex.min.css'
import './App.css'
import './ai-chat/chat.css'
import './change-preview/change-preview.css'

type CodeBlockProps = {
  code: string
  language: string
  theme: ResolvedTheme
}

type CodeBlockRenderer = (props: CodeBlockProps) => ReactElement

type MarkdownSegment =
  | { type: 'markdown'; value: string }
  | { type: 'code'; language: string; code: string }

type MarkdownPosTuple = [number, number]
type MarkdownSelectionRange = [MarkdownPosTuple, MarkdownPosTuple]
type StatusToast = {
  id: number
  message: string
}

type ChangeProposalReviewState = {
  summary: MdvAiChangeProposalSummary
  proposal: MdvAiChangeProposalDetail | null
  acceptedHunkIds: Set<string>
  resolvingAction: 'apply' | 'cancel' | null
  error: string | null
}

type MarkdownInlineToken = {
  attrs: string[][] | null
  children?: MarkdownInlineToken[]
  content: string
}

type MarkdownParserInstance = InstanceType<typeof MarkdownIt>

type MarkdownInlineParserState = {
  src: string
  pos: number
  posMax: number
  env: unknown
  md: MarkdownParserInstance & {
    helpers: {
      parseLinkDestination: (source: string, position: number, max: number) => { ok: boolean; pos: number; str: string }
      parseLinkLabel: (state: MarkdownInlineParserState, position: number, disableNested?: boolean) => number
    }
    inline: {
      parse: (source: string, md: MarkdownInlineParserState['md'], env: unknown, tokens: MarkdownInlineToken[]) => void
    }
  }
  push: (type: string, tag: string, nesting: number) => MarkdownInlineToken
}

const DEFAULT_ASSISTANT_DOCK_WIDTH_PERCENT = 32
const MIN_ASSISTANT_DOCK_WIDTH_PERCENT = 24
const MAX_ASSISTANT_DOCK_WIDTH_PERCENT = 55

const INLINE_DATA_IMAGE_WIDGET_PATTERN = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/
const INLINE_DATA_IMAGE_DATA_URL_PATTERN = /^data:image\/[a-zA-Z0-9.+-]+(?:;[a-zA-Z0-9.+-]+(?:=[^,()\s]*)?)*,[^()\s]+$/
const INLINE_DATA_IMAGE_MARKDOWN_DATA_URL_PATTERN = /data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/g

function estimateInlineDataImageBytes(base64Text: string): number {
  if (base64Text.length === 0) {
    return 0
  }

  let padding = 0

  if (base64Text.endsWith('==')) {
    padding = 2
  } else if (base64Text.endsWith('=')) {
    padding = 1
  }

  return Math.max(0, Math.floor((base64Text.length * 3) / 4) - padding)
}

function formatInlineDataImageBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function abbreviateInlineDataImageDataUrl(dataUrl: string): string {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/)

  if (!match) {
    return dataUrl
  }

  const [, mimeType, base64Text] = match
  const byteSizeLabel = formatInlineDataImageBytes(estimateInlineDataImageBytes(base64Text))

  return `data:${mimeType};base64,<${byteSizeLabel} omitted>`
}

function abbreviateInlineDataImageMarkdownSlice(text: string, startOffset: number, endOffset: number): string {
  const normalizedStartOffset = Math.min(Math.max(0, Math.trunc(Number(startOffset) || 0)), text.length)
  const normalizedEndOffset = Math.min(Math.max(normalizedStartOffset, Math.trunc(Number(endOffset) || normalizedStartOffset)), text.length)

  if (!text || !text.includes('data:image/')) {
    return text.slice(normalizedStartOffset, normalizedEndOffset)
  }

  let output = ''
  let cursor = normalizedStartOffset

  INLINE_DATA_IMAGE_MARKDOWN_DATA_URL_PATTERN.lastIndex = 0

  for (const match of text.matchAll(INLINE_DATA_IMAGE_MARKDOWN_DATA_URL_PATTERN)) {
    const fullMatch = match[0]
    const matchStartOffset = match.index ?? 0
    const matchEndOffset = matchStartOffset + fullMatch.length

    if (matchEndOffset <= normalizedStartOffset) {
      continue
    }

    if (matchStartOffset >= normalizedEndOffset) {
      break
    }

    const visiblePrefixEndOffset = Math.min(matchStartOffset, normalizedEndOffset)

    if (cursor < visiblePrefixEndOffset) {
      output += text.slice(cursor, visiblePrefixEndOffset)
    }

    output += matchStartOffset >= normalizedStartOffset
      ? abbreviateInlineDataImageDataUrl(fullMatch)
      : 'data:image/*;base64,<continued data image omitted>'
    cursor = Math.min(matchEndOffset, normalizedEndOffset)
  }

  if (cursor < normalizedEndOffset) {
    output += text.slice(cursor, normalizedEndOffset)
  }

  return output
}

function createInlineDataImageWidget(text: string): HTMLElement {
  const element = document.createElement('span')
  element.className = 'inline-data-image-widget'
  element.textContent = abbreviateInlineDataImageDataUrl(text)
  element.title = 'Inline image data URL omitted from source view'
  element.setAttribute('contenteditable', 'false')
  return element
}

function isMarkdownSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0A || code === 0x0D
}

function parseInlineDataImage(state: MarkdownInlineParserState, silent: boolean): boolean {
  const oldPosition = state.pos
  const maxPosition = state.posMax

  if (state.src.charCodeAt(state.pos) !== 0x21 || state.src.charCodeAt(state.pos + 1) !== 0x5B) {
    return false
  }

  const labelStart = state.pos + 2
  const labelEnd = state.md.helpers.parseLinkLabel(state, state.pos + 1, false)

  if (labelEnd < 0) {
    return false
  }

  let position = labelEnd + 1

  if (position >= maxPosition || state.src.charCodeAt(position) !== 0x28) {
    return false
  }

  position += 1

  while (position < maxPosition && isMarkdownSpace(state.src.charCodeAt(position))) {
    position += 1
  }

  const destination = state.md.helpers.parseLinkDestination(state.src, position, maxPosition)

  if (!destination.ok) {
    return false
  }

  const source = state.md.normalizeLink(destination.str)

  if (!INLINE_DATA_IMAGE_DATA_URL_PATTERN.test(source.trim())) {
    return false
  }

  position = destination.pos

  while (position < maxPosition && isMarkdownSpace(state.src.charCodeAt(position))) {
    position += 1
  }

  if (position >= maxPosition || state.src.charCodeAt(position) !== 0x29) {
    state.pos = oldPosition
    return false
  }

  position += 1

  if (!silent) {
    const content = state.src.slice(labelStart, labelEnd)
    const tokens: MarkdownInlineToken[] = []
    state.md.inline.parse(content, state.md, state.env, tokens)

    const token = state.push('image', 'img', 0)
    token.attrs = [['src', source], ['alt', '']]
    token.children = tokens
    token.content = content
  }

  state.pos = position
  state.posMax = maxPosition
  return true
}

function hasStaleInlineDataImageWidgets(root: ParentNode | null, markdown: string): boolean {
  if (!root) {
    return false
  }

  const expectedWidgetLabels = Array.from(markdown.matchAll(new RegExp(INLINE_DATA_IMAGE_WIDGET_PATTERN, 'g')))
    .map((match) => abbreviateInlineDataImageDataUrl(match[0]))

  if (expectedWidgetLabels.length === 0) {
    return false
  }

  const actualWidgetLabels = Array.from(root.querySelectorAll<HTMLElement>('.inline-data-image-widget'))
    .map((widget) => widget.textContent ?? '')

  return expectedWidgetLabels.length !== actualWidgetLabels.length
    || expectedWidgetLabels.some((label, index) => actualWidgetLabels[index] !== label)
}

function disableEditorSpellcheck(root: HTMLElement) {
  const targets = [
    root,
    ...Array.from(root.querySelectorAll<HTMLElement>(
      'textarea, [contenteditable="true"], .toastui-editor, .toastui-editor-md-container .ProseMirror, .toastui-editor-ww-container .ProseMirror, .cm-content, .CodeMirror-code'
    )),
  ]

  for (const target of targets) {
    target.spellcheck = false
    target.setAttribute('spellcheck', 'false')
    target.setAttribute('autocorrect', 'off')
    target.setAttribute('autocapitalize', 'off')
  }
}

function getOutlineHeadingLabel(item: MdvMdastHeadingOutlineItem, fallbackLabel: (line: number) => string) {
  return item.text.trim() || fallbackLabel(item.position.line)
}

function extractMarkdownHeadingLines(markdown: string): Array<{ line: number }> {
  const headings: Array<{ line: number }> = []
  const lines = markdown.split('\n')
  let inFencedCodeBlock = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]

    if (/^```/.test(line)) {
      inFencedCodeBlock = !inFencedCodeBlock
      continue
    }

    if (inFencedCodeBlock) {
      continue
    }

    if (/^#{1,6}\s+\S/.test(line)) {
      headings.push({ line: index + 1 })
    }
  }

  return headings
}

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

markdownParser.inline.ruler.before('image', 'inline_data_image', parseInlineDataImage)

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

function isMarkdownPosTuple(value: unknown): value is MarkdownPosTuple {
  return Array.isArray(value)
    && value.length === 2
    && Number.isFinite(Number(value[0]))
    && Number.isFinite(Number(value[1]))
}

function isMarkdownSelectionRange(value: unknown): value is MarkdownSelectionRange {
  return Array.isArray(value)
    && value.length === 2
    && isMarkdownPosTuple(value[0])
    && isMarkdownPosTuple(value[1])
}

function isMarkdownPosLike(value: unknown): value is MdvAiMarkdownPos {
  if (!value || typeof value !== 'object') {
    return false
  }

  return Number.isFinite(Number(Reflect.get(value, 'line')))
    && Number.isFinite(Number(Reflect.get(value, 'column')))
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
  try {
    const selection = editor.getSelection()
    let start: MdvAiMarkdownPos
    let end: MdvAiMarkdownPos

    if (isMarkdownSelectionRange(selection)) {
      const [markdownStart, markdownEnd] = selection
      start = clampMarkdownPos(markdown, toMarkdownPos(markdownStart))
      end = clampMarkdownPos(markdown, toMarkdownPos(markdownEnd))
    } else {
      const convertedSelection = editor.convertPosToMatchEditorMode(selection[0], selection[1], 'markdown')

      if (!isMarkdownSelectionRange(convertedSelection)) {
        throw new Error('Toast UI Editor returned an unexpected selection shape')
      }

      const [markdownStart, markdownEnd] = convertedSelection
      start = clampMarkdownPos(markdown, toMarkdownPos(markdownStart))
      end = clampMarkdownPos(markdown, toMarkdownPos(markdownEnd))
    }

    const startOffset = markdownPosToOffset(markdown, start)
    const endOffset = markdownPosToOffset(markdown, end)

    return normalizeOffsetsToSpan(markdown, startOffset, endOffset)
  } catch (error) {
    // Toast UI can report a transient out-of-range WYSIWYG position while a fresh
    // paragraph is being initialized. Keep the renderer alive and treat it as a
    // collapsed caret at the current document end until the editor state settles.
    const errorMessage = error instanceof Error ? error.message : ''

    if (error instanceof RangeError || /out of range/i.test(errorMessage)) {
      return normalizeOffsetsToSpan(markdown, markdown.length, markdown.length)
    }

    throw error
  }
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

type RelativeImageResolutionCacheEntry = {
  resolvedSource: string | null
  failedAt: number | null
}

async function resolveRelativeImagesInRoot(options: {
  root: ParentNode
  selector: string
  contentBaseFilePath: string | null
  cache: Map<string, RelativeImageResolutionCacheEntry>
}) {
  const images = Array.from(options.root.querySelectorAll<HTMLImageElement>(options.selector))

  await Promise.all(images.map(async (image) => {
    const liveSource = image.getAttribute('src')?.trim() || ''
    const rememberedSource = image.getAttribute('data-mdv-source-src')?.trim() || ''
    const resolvedBasePath = image.getAttribute('data-mdv-resolved-base-path')?.trim() || ''
    const rememberedResolvedSource = image.getAttribute('data-mdv-resolved-src')?.trim() || ''
    const originalSource = isRelativeImageSource(liveSource)
      ? liveSource
      : rememberedSource && rememberedResolvedSource === liveSource
        ? rememberedSource
        : liveSource

    if (!isRelativeImageSource(originalSource)) {
      image.removeAttribute('data-mdv-source-src')
      image.removeAttribute('data-mdv-resolved-base-path')
      image.removeAttribute('data-mdv-resolved-src')
      return
    }

    if (!options.contentBaseFilePath) {
      if (image.getAttribute('src') !== originalSource) {
        image.setAttribute('src', originalSource)
      }

      image.removeAttribute('data-mdv-resolved-base-path')
      image.removeAttribute('data-mdv-resolved-src')
      return
    }

    if (resolvedBasePath && resolvedBasePath !== options.contentBaseFilePath && rememberedResolvedSource === liveSource && image.getAttribute('src') !== originalSource) {
      image.setAttribute('src', originalSource)
      image.removeAttribute('data-mdv-resolved-base-path')
      image.removeAttribute('data-mdv-resolved-src')
    }

    const cacheKey = `${options.contentBaseFilePath}\u0000${originalSource}`
    const cachedEntry = options.cache.get(cacheKey)
    let resolvedSource = cachedEntry?.resolvedSource

    if (cachedEntry?.resolvedSource === null && cachedEntry.failedAt && Date.now() - cachedEntry.failedAt < 3000) {
      resolvedSource = null
    } else if (cachedEntry === undefined || cachedEntry.resolvedSource === null) {
      try {
        const result = await window.mdvDesktop?.readRelativeAssetAsDataUrl({
          baseFilePath: options.contentBaseFilePath,
          source: originalSource,
        })

        resolvedSource = result?.dataUrl
          ? `${result.dataUrl}${getImageSourceTail(originalSource)}`
          : null
        options.cache.set(cacheKey, {
          resolvedSource,
          failedAt: resolvedSource ? null : Date.now(),
        })
      } catch {
        resolvedSource = null
        options.cache.set(cacheKey, {
          resolvedSource: null,
          failedAt: Date.now(),
        })
      }
    }

    if (!resolvedSource) {
      if (image.getAttribute('src') !== originalSource) {
        image.setAttribute('src', originalSource)
      }

      image.removeAttribute('data-mdv-resolved-base-path')
      image.removeAttribute('data-mdv-resolved-src')
      return
    }

    if (image.getAttribute('src') === resolvedSource) {
      image.setAttribute('data-mdv-source-src', originalSource)
      image.setAttribute('data-mdv-resolved-base-path', options.contentBaseFilePath)
      image.setAttribute('data-mdv-resolved-src', resolvedSource)
      return
    }

    image.setAttribute('data-mdv-source-src', originalSource)
    image.setAttribute('data-mdv-resolved-base-path', options.contentBaseFilePath)
    image.setAttribute('data-mdv-resolved-src', resolvedSource)
    image.setAttribute('src', resolvedSource)
  }))
}

function syncPreviewImageFallbackState(root: ParentNode) {
  const images = Array.from(root.querySelectorAll<HTMLImageElement>('img[src]'))

  for (const image of images) {
    const liveSource = image.getAttribute('src')?.trim() || ''
    const rememberedSource = image.getAttribute('data-mdv-source-src')?.trim() || ''
    const rememberedResolvedSource = image.getAttribute('data-mdv-resolved-src')?.trim() || ''
    const originalSource = isRelativeImageSource(liveSource)
      ? liveSource
      : rememberedSource && rememberedResolvedSource === liveSource
        ? rememberedSource
        : liveSource
    const fallback = image.nextElementSibling instanceof HTMLElement && image.nextElementSibling.classList.contains('preview-image-fallback')
      ? image.nextElementSibling
      : null
    const shouldShowFallback = isRelativeImageSource(originalSource) && liveSource === originalSource

    if (!shouldShowFallback) {
      image.removeAttribute('data-mdv-image-state')
      image.removeAttribute('aria-hidden')
      fallback?.remove()
      continue
    }

    const nextFallback = fallback ?? document.createElement('span')
    nextFallback.className = 'preview-image-fallback'
    nextFallback.setAttribute('role', 'note')
    nextFallback.textContent = `Missing image: ${originalSource}`

    if (!fallback) {
      image.insertAdjacentElement('afterend', nextFallback)
    }

    image.setAttribute('data-mdv-image-state', 'missing')
    image.setAttribute('aria-hidden', 'true')
  }
}

type EditorSurfaceProps = {
  value: string
  contentBaseFilePath: string | null
  onChange: (nextMarkdown: string) => void
  editorRef: MutableRefObject<ToastUiEditor | null>
  onReady?: (editor: ToastUiEditor) => void
  onSelectionChange?: (editor: ToastUiEditor) => void
}

function EditorSurface({
  value,
  contentBaseFilePath,
  onChange,
  editorRef,
  onReady,
  onSelectionChange,
}: EditorSurfaceProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const initialValueRef = useRef(value)
  const editorInstanceRef = useRef<ToastUiEditor | null>(null)
  const onChangeRef = useRef(onChange)
  const onReadyRef = useRef(onReady)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const selectionFrameRef = useRef<number | null>(null)
  const relativeImageCacheRef = useRef<Map<string, RelativeImageResolutionCacheEntry>>(new Map())
  const relativeImageResolveFrameRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    if (editorInstanceRef.current === null) {
      initialValueRef.current = value
    }
  }, [value])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange
  }, [onSelectionChange])

  useEffect(() => {
    if (!hostRef.current) {
      return
    }

    let active = true

    const resolveRelativeImages = async () => {
      const host = hostRef.current

      if (!active || !host) {
        return
      }

      await resolveRelativeImagesInRoot({
        root: host,
        selector: '.toastui-editor-ww-container img[src]',
        contentBaseFilePath,
        cache: relativeImageCacheRef.current,
      })
    }

    const scheduleRelativeImageResolution = () => {
      if (relativeImageResolveFrameRef.current !== null) {
        window.cancelAnimationFrame(relativeImageResolveFrameRef.current)
      }

      relativeImageResolveFrameRef.current = window.requestAnimationFrame(() => {
        relativeImageResolveFrameRef.current = null
        void resolveRelativeImages()
      })
    }

    const observer = new MutationObserver(scheduleRelativeImageResolution)
    observer.observe(hostRef.current, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] })
    scheduleRelativeImageResolution()

    return () => {
      active = false
      observer.disconnect()

      if (relativeImageResolveFrameRef.current !== null) {
        window.cancelAnimationFrame(relativeImageResolveFrameRef.current)
        relativeImageResolveFrameRef.current = null
      }
    }
  }, [contentBaseFilePath])

  useEffect(() => {
    if (!hostRef.current) {
      return
    }

    const emitSelectionChange = () => {
      if (selectionFrameRef.current !== null) {
        window.cancelAnimationFrame(selectionFrameRef.current)
      }

      selectionFrameRef.current = window.requestAnimationFrame(() => {
        selectionFrameRef.current = null
        const currentInstance = editorInstanceRef.current
        if (currentInstance) {
          onSelectionChangeRef.current?.(currentInstance)
        }
      })
    }

    const instance = new ToastUiEditor({
      el: hostRef.current,
      height: '100%',
      initialValue: initialValueRef.current,
      // Keep Toast UI itself single-surface; app-level preview owns rendered output.
      initialEditType: 'markdown',
      previewStyle: 'tab',
      usageStatistics: false,
      hideModeSwitch: false,
      widgetRules: [
        {
          rule: INLINE_DATA_IMAGE_WIDGET_PATTERN,
          toDOM: createInlineDataImageWidget,
        },
      ],
      events: {
        change: () => {
          onChangeRef.current(instance.getMarkdown())
          emitSelectionChange()
        },
      },
    })

    const host = hostRef.current
    disableEditorSpellcheck(host)

    const selectionChangeHandler = () => {
      const activeElement = document.activeElement

      if (host && activeElement instanceof Node && host.contains(activeElement)) {
        emitSelectionChange()
      }
    }

    const refreshEditorSpellcheck = () => {
      if (host) {
        disableEditorSpellcheck(host)
      }
    }

    const editorMutationObserver = new MutationObserver(refreshEditorSpellcheck)
    editorMutationObserver.observe(host, { childList: true, subtree: true })

    host?.addEventListener('keyup', emitSelectionChange)
    host?.addEventListener('mouseup', emitSelectionChange)
    host?.addEventListener('focusin', emitSelectionChange)
    host?.addEventListener('focusin', refreshEditorSpellcheck)
    document.addEventListener('selectionchange', selectionChangeHandler)

    editorInstanceRef.current = instance
    editorRef.current = instance
    onReadyRef.current?.(instance)
    emitSelectionChange()

    return () => {
      host?.removeEventListener('keyup', emitSelectionChange)
      host?.removeEventListener('mouseup', emitSelectionChange)
      host?.removeEventListener('focusin', emitSelectionChange)
      host?.removeEventListener('focusin', refreshEditorSpellcheck)
      document.removeEventListener('selectionchange', selectionChangeHandler)
      editorMutationObserver.disconnect()
      if (selectionFrameRef.current !== null) {
        window.cancelAnimationFrame(selectionFrameRef.current)
        selectionFrameRef.current = null
      }
      editorInstanceRef.current = null
      editorRef.current = null
      instance.destroy()
    }
  }, [editorRef])

  useEffect(() => {
    const instance = editorInstanceRef.current
    if (!instance) {
      return
    }

    const widgetStale = hasStaleInlineDataImageWidgets(hostRef.current, value)

    if (instance.getMarkdown() !== value || widgetStale) {
      instance.setMarkdown(value)
    }
  }, [value])

  return (
    <div className="toast-editor-shell">
      <div className="toast-editor-host" ref={hostRef} />
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
      data-render-state={svg ? 'ready' : 'loading'}
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

function basename(filePath: string | null, fallback = 'Untitled.md'): string {
  if (!filePath) {
    return fallback
  }

  const normalized = filePath.replaceAll('\\', '/')
  const parts = normalized.split('/')

  return parts.at(-1) || fallback
}

function normalizeFileUriPath(rawValue: string): string | null {
  if (!rawValue || !rawValue.startsWith('file://')) {
    return null
  }

  try {
    const parsedUrl = new URL(rawValue)
    let nextPath = decodeURIComponent(parsedUrl.pathname)

    if (/^\/[A-Za-z]:/.test(nextPath)) {
      nextPath = nextPath.slice(1)
    }

    return nextPath || null
  } catch {
    return null
  }
}

function resolveDroppedNativePath(event: DragEvent<HTMLElement>): string | null {
  const droppedFile = event.dataTransfer.files.item(0)

  if (!droppedFile) {
    return null
  }

  const directPath = typeof Reflect.get(droppedFile, 'path') === 'string'
    ? Reflect.get(droppedFile, 'path')
    : undefined

  if (directPath && directPath.trim().length > 0) {
    return directPath
  }

  const uriList = event.dataTransfer.getData('text/uri-list')
  const plainText = event.dataTransfer.getData('text/plain')

  for (const candidate of `${uriList}\n${plainText}`.split(/\r?\n/)) {
    const trimmedCandidate = candidate.trim()

    if (!trimmedCandidate || trimmedCandidate.startsWith('#')) {
      continue
    }

    const normalizedPath = normalizeFileUriPath(trimmedCandidate)

    if (normalizedPath) {
      return normalizedPath
    }
  }

  return null
}

function isImageFileName(fileName: string | null): boolean {
  return Boolean(fileName && /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(fileName))
}

function getImageMimeType(file: File): string {
  const normalizedType = file.type.trim().toLowerCase()

  if (normalizedType.startsWith('image/')) {
    return normalizedType
  }

  const fileName = file.name.toLowerCase()

  if (fileName.endsWith('.svg')) {
    return 'image/svg+xml'
  }

  if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) {
    return 'image/jpeg'
  }

  if (fileName.endsWith('.png')) {
    return 'image/png'
  }

  if (fileName.endsWith('.gif')) {
    return 'image/gif'
  }

  if (fileName.endsWith('.webp')) {
    return 'image/webp'
  }

  if (fileName.endsWith('.bmp')) {
    return 'image/bmp'
  }

  if (fileName.endsWith('.ico')) {
    return 'image/x-icon'
  }

  if (fileName.endsWith('.avif')) {
    return 'image/avif'
  }

  return 'image/png'
}

function isImageDropCandidate(file: File | null, nativePath: string | null): boolean {
  if (!file) {
    return false
  }

  if (nativePath) {
    return isImageFileName(nativePath) || file.type.startsWith('image/')
  }

  if (file.type.startsWith('image/')) {
    return true
  }

  if (isImageFileName(file.name)) {
    return true
  }

  return false
}

function isPrimaryModifierPressed(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.metaKey
}

function getActionForShortcut(event: KeyboardEvent): MdvMenuAction | null {
  if (event.defaultPrevented || event.isComposing) {
    return null
  }

  if (event.key === 'F5' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    return 'reload-file'
  }

  if (!isPrimaryModifierPressed(event)) {
    return null
  }

  const key = event.key.toLowerCase()

  if (key === 'y' && !event.shiftKey) {
    return 'redo'
  }

  if (key === 'n') {
    return 'new-document'
  }

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

type TypographyShortcutAction = 'increase' | 'decrease' | 'reset'
type TypographyShortcutTarget = 'editor' | 'chat'

function getTypographyShortcutAction(event: KeyboardEvent): TypographyShortcutAction | null {
  if (event.defaultPrevented || event.isComposing || !isPrimaryModifierPressed(event) || event.altKey) {
    return null
  }

  if (event.code === 'NumpadAdd' || event.key === '+' || event.key === '=') {
    return 'increase'
  }

  if (event.code === 'NumpadSubtract' || event.key === '-') {
    return 'decrease'
  }

  if (event.code === 'Digit0' || event.code === 'Numpad0' || event.key === '0') {
    return 'reset'
  }

  return null
}

function getFocusedTypographyTarget(target: EventTarget | null): TypographyShortcutTarget | null {
  const targetElement = target instanceof Element
    ? target
    : target instanceof Node
      ? target.parentElement
      : null

  if (!targetElement) {
    return null
  }

  if (targetElement.closest('.ai-chat-composer')) {
    return 'chat'
  }

  if (targetElement.closest('.cm-scroller, .CodeMirror-scroll, .toastui-editor-md-container .toastui-editor, .toastui-editor-ww-container .ProseMirror')) {
    return 'editor'
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
  disabled?: boolean
  onClick: () => void | Promise<void>
  children: ReactElement
}

type ToolbarMenuItem = {
  label: string
  icon: ReactElement
  onClick: () => void | Promise<void>
}

type ToolbarMenuButtonProps = {
  label: string
  children: ReactElement
  items: ToolbarMenuItem[]
}

type ToolbarGroupProps = {
  label: string
  children: ReactNode
}

type EditorSearchMode = 'exact' | 'semantic'

type EditorSearchDialogMode = 'search' | 'replace'

function isEditorSearchMode(value: string): value is EditorSearchMode {
  return value === 'exact' || value === 'semantic'
}

type EditorSearchResult = {
  id: string
  span: MdvAiNormalizedSpan
  preview: string
  meta: string
}

type ExactEditorSearchOptions = {
  matchCase: boolean
  useRegexp: boolean
  inSelection: boolean
}

type ExactEditorSearchExecution = {
  results: EditorSearchResult[]
  scope: ExactEditorSearchScope
}

type ExactEditorSearchScope = {
  startOffset: number
  endOffset: number
}

type MarkdownTableColumnAlignmentCommand = 'align-table-column-default' | 'align-table-column-left' | 'align-table-column-center' | 'align-table-column-right'

type MarkdownInsertCommand = 'heading' | 'link' | 'image' | 'code-block' | 'quote' | 'horizontal-rule' | 'footnote' | 'table' | 'format-table' | 'add-table-row' | 'add-table-column' | MarkdownTableColumnAlignmentCommand | 'toggle-task-list'

type MarkdownInsertResult = {
  nextMarkdown: string
  selection: MdvAiNormalizedSpan | null
  didFindTarget?: boolean
}

type MarkdownTableAlignment = 'default' | 'left' | 'center' | 'right'

type MarkdownLineInfo = {
  line: number
  text: string
  startOffset: number
  endOffset: number
}

type MarkdownTableBlock = {
  startLine: number
  endLine: number
  alignments: MarkdownTableAlignment[]
}

type MarkdownTableCellRange = {
  startIndex: number
  endIndex: number
}

type MarkdownTableTargetPosition = {
  lineNumber: number
  line: MarkdownLineInfo
  column: number
}

function ToolbarButton({ label, active = false, disabled = false, onClick, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className={active ? 'active icon-button' : 'icon-button'}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function ToolbarMenuButton({ label, children, items }: ToolbarMenuButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target

      if (target instanceof Node && menuRootRef.current?.contains(target)) {
        return
      }

      setIsOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const runItem = (item: ToolbarMenuItem) => {
    setIsOpen(false)
    void item.onClick()
  }

  return (
    <div className="toolbar-menu-shell" ref={menuRootRef}>
      <button
        type="button"
        className="icon-button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        {children}
      </button>
      {isOpen ? (
        <div className="toolbar-menu-panel" role="menu" aria-label={label}>
          {items.map((item) => (
            <button key={item.label} type="button" className="toolbar-menu-item" role="menuitem" onClick={() => runItem(item)}>
              <span className="toolbar-menu-item-icon" aria-hidden="true">{item.icon}</span>
              <span className="toolbar-menu-item-label">{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ToolbarGroup({ label, children }: ToolbarGroupProps) {
  return (
    <div className="action-group" role="group" aria-label={label}>
      {children}
    </div>
  )
}

function escapeRegExpPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
}

function buildExactSearchExpression(query: string, options: ExactEditorSearchOptions): RegExp {
  const source = options.useRegexp ? query : escapeRegExpPattern(query)
  const testExpression = new RegExp(source, options.matchCase ? '' : 'i')

  if (testExpression.test('')) {
    throw new Error('Search patterns that match empty text are not supported')
  }

  return new RegExp(source, options.matchCase ? 'g' : 'gi')
}

function buildEditorSearchPreview(markdown: string, startOffset: number, endOffset: number): string {
  const previewStart = Math.max(0, startOffset - 28)
  const previewEnd = Math.min(markdown.length, endOffset + 44)
  const prefix = previewStart > 0 ? '...' : ''
  const suffix = previewEnd < markdown.length ? '...' : ''

  return `${prefix}${markdown.slice(previewStart, previewEnd).replace(/\s+/g, ' ')}${suffix}`
}

function getExactEditorSearchScope(markdown: string, editor: ToastUiEditor | null, inSelection: boolean): ExactEditorSearchScope {
  if (!inSelection) {
    return {
      startOffset: 0,
      endOffset: markdown.length,
    }
  }

  if (!editor) {
    throw new Error('Editor is unavailable')
  }

  const selectionSpan = normalizeSelectionToMarkdownSpan(editor, markdown)

  if (selectionSpan.isEmpty) {
    throw new Error('A non-empty selection is required')
  }

  return {
    startOffset: markdownPosToOffset(markdown, selectionSpan.start),
    endOffset: markdownPosToOffset(markdown, selectionSpan.end),
  }
}

function runExactEditorSearch(
  markdown: string,
  editor: ToastUiEditor | null,
  query: string,
  options: ExactEditorSearchOptions,
  scopeOverride?: ExactEditorSearchScope | null,
): ExactEditorSearchExecution {
  const scope = scopeOverride ?? getExactEditorSearchScope(markdown, editor, options.inSelection)

  if (query.length === 0) {
    return { results: [], scope }
  }

  const scopedText = markdown.slice(scope.startOffset, scope.endOffset)
  const expression = buildExactSearchExpression(query, options)
  const results: EditorSearchResult[] = []
  let match = expression.exec(scopedText)

  while (match) {
    const matchStartOffset = scope.startOffset + match.index
    const matchEndOffset = matchStartOffset + match[0].length
    const span = normalizeOffsetsToSpan(markdown, matchStartOffset, matchEndOffset)

    results.push({
      id: `exact:${matchStartOffset}:${matchEndOffset}:${results.length}`,
      span,
      preview: buildEditorSearchPreview(markdown, matchStartOffset, matchEndOffset),
      meta: `${span.start.line}:${span.start.column}`,
    })

    match = expression.exec(scopedText)
  }

  return { results, scope }
}

function replaceOffsets(markdown: string, startOffset: number, endOffset: number, replacement: string): string {
  return `${markdown.slice(0, startOffset)}${replacement}${markdown.slice(endOffset)}`
}

function createMarkdownInsertResult(
  markdown: string,
  startOffset: number,
  endOffset: number,
  replacement: string,
  selectionStartOffset: number,
  selectionEndOffset: number,
): MarkdownInsertResult {
  const nextMarkdown = replaceOffsets(markdown, startOffset, endOffset, replacement)

  return {
    nextMarkdown,
    selection: normalizeOffsetsToSpan(nextMarkdown, selectionStartOffset, selectionEndOffset),
  }
}

function getSpanOffsets(markdown: string, span: MdvAiNormalizedSpan) {
  return {
    startOffset: markdownPosToOffset(markdown, span.start),
    endOffset: markdownPosToOffset(markdown, span.end),
  }
}

function expandOffsetsToSelectedLines(markdown: string, startOffset: number, endOffset: number) {
  const lineStartOffset = markdown.lastIndexOf('\n', Math.max(0, startOffset - 1)) + 1
  const normalizedEndOffset = endOffset > startOffset && markdown[endOffset - 1] === '\n'
    ? endOffset - 1
    : endOffset
  const nextLineBreakOffset = markdown.indexOf('\n', normalizedEndOffset)

  return {
    startOffset: lineStartOffset,
    endOffset: nextLineBreakOffset === -1 ? markdown.length : nextLineBreakOffset,
  }
}

function prefixSelectedLines(markdown: string, span: MdvAiNormalizedSpan, prefix: string, emptyPlaceholder: string): MarkdownInsertResult {
  const { startOffset, endOffset } = getSpanOffsets(markdown, span)
  const lineOffsets = expandOffsetsToSelectedLines(markdown, startOffset, endOffset)

  if (startOffset === endOffset) {
    const currentLineText = markdown.slice(lineOffsets.startOffset, lineOffsets.endOffset)

    if (currentLineText.length > 0) {
      const nextText = `${prefix}${currentLineText}`

      return createMarkdownInsertResult(
        markdown,
        lineOffsets.startOffset,
        lineOffsets.endOffset,
        nextText,
        lineOffsets.startOffset,
        lineOffsets.startOffset + nextText.length,
      )
    }

    const insertedText = `${prefix}${emptyPlaceholder}`
    const placeholderStartOffset = lineOffsets.startOffset + prefix.length
    return createMarkdownInsertResult(
      markdown,
      lineOffsets.startOffset,
      lineOffsets.endOffset,
      insertedText,
      placeholderStartOffset,
      placeholderStartOffset + emptyPlaceholder.length,
    )
  }

  const selectedText = markdown.slice(lineOffsets.startOffset, lineOffsets.endOffset)
  const nextText = selectedText
    .split(/\r?\n/)
    .map((line) => line.length > 0 ? `${prefix}${line}` : line)
    .join('\n')

  return createMarkdownInsertResult(
    markdown,
    lineOffsets.startOffset,
    lineOffsets.endOffset,
    nextText,
    lineOffsets.startOffset,
    lineOffsets.startOffset + nextText.length,
  )
}

function getNextFootnoteId(markdown: string): string {
  const matches = Array.from(markdown.matchAll(/^\[\^(\d+)\]:/gm))
  const maxValue = matches.reduce((currentMax, match) => {
    const nextValue = Number.parseInt(match[1], 10)
    return Number.isFinite(nextValue) ? Math.max(currentMax, nextValue) : currentMax
  }, 0)

  return String(maxValue + 1 || 1)
}

function insertImageMarkdown(markdown: string, span: MdvAiNormalizedSpan, source: string, fallbackAlt: string): MarkdownInsertResult {
  const { startOffset, endOffset } = getSpanOffsets(markdown, span)
  const selectedText = markdown.slice(startOffset, endOffset)
  const alt = selectedText.length > 0 ? selectedText : fallbackAlt
  const insertedText = `![${alt}](${source})`
  const sourceStartOffset = startOffset + insertedText.indexOf(source)

  return createMarkdownInsertResult(markdown, startOffset, endOffset, insertedText, sourceStartOffset, sourceStartOffset + source.length)
}

function insertImportedImageMarkdown(markdown: string, span: MdvAiNormalizedSpan, source: string, fallbackAlt: string): MarkdownInsertResult {
  const { startOffset, endOffset } = getSpanOffsets(markdown, span)
  const selectedText = markdown.slice(startOffset, endOffset)
  const alt = selectedText.length > 0 ? selectedText : fallbackAlt
  const leadingBreak = startOffset === 0
    ? ''
    : markdown[startOffset - 1] === '\n'
      ? startOffset >= 2 && markdown[startOffset - 2] === '\n' ? '' : '\n'
      : '\n\n'
  const trailingBreak = endOffset >= markdown.length
    ? '\n'
    : markdown[endOffset] === '\n'
      ? markdown[endOffset + 1] === '\n' ? '' : '\n'
      : '\n\n'
  const insertedText = `${leadingBreak}![${alt}](${source})${trailingBreak}`
  const insertedEndOffset = startOffset + insertedText.length

  return createMarkdownInsertResult(markdown, startOffset, endOffset, insertedText, insertedEndOffset, insertedEndOffset)
}

function countPrecedingBackslashes(value: string, index: number): number {
  let count = 0

  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    count += 1
  }

  return count
}

function isEscapedMarkdownCharacter(value: string, index: number): boolean {
  return countPrecedingBackslashes(value, index) % 2 === 1
}

function hasUnescapedMarkdownPipe(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '|' && !isEscapedMarkdownCharacter(value, index)) {
      return true
    }
  }

  return false
}

function trimMarkdownTableBoundaryPipes(line: string): string {
  let content = line.trim()

  if (content.startsWith('|')) {
    content = content.slice(1)
  }

  const lastIndex = content.length - 1

  if (lastIndex >= 0 && content[lastIndex] === '|' && !isEscapedMarkdownCharacter(content, lastIndex)) {
    content = content.slice(0, lastIndex)
  }

  return content
}

function splitMarkdownTableRow(line: string): string[] | null {
  if (!hasUnescapedMarkdownPipe(line)) {
    return null
  }

  const content = trimMarkdownTableBoundaryPipes(line)
  const cells: string[] = []
  let currentCell = ''

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]

    if (character === '|' && !isEscapedMarkdownCharacter(content, index)) {
      cells.push(currentCell.trim())
      currentCell = ''
      continue
    }

    currentCell += character
  }

  cells.push(currentCell.trim())

  return cells.length >= 1 ? cells : null
}

function getLastNonWhitespaceIndex(value: string): number {
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (!/\s/.test(value[index])) {
      return index
    }
  }

  return -1
}

function getMarkdownTableCellRanges(line: string): MarkdownTableCellRange[] {
  if (!hasUnescapedMarkdownPipe(line)) {
    return [{ startIndex: 0, endIndex: line.length }]
  }

  const firstNonWhitespaceIndex = line.search(/\S/)
  const lastNonWhitespaceIndex = getLastNonWhitespaceIndex(line)
  const startsWithBoundaryPipe = firstNonWhitespaceIndex >= 0 && line[firstNonWhitespaceIndex] === '|'
  const endsWithBoundaryPipe = lastNonWhitespaceIndex >= 0
    && line[lastNonWhitespaceIndex] === '|'
    && !isEscapedMarkdownCharacter(line, lastNonWhitespaceIndex)
  const contentStartIndex = startsWithBoundaryPipe ? firstNonWhitespaceIndex + 1 : 0
  const contentEndIndex = endsWithBoundaryPipe ? lastNonWhitespaceIndex : line.length
  const ranges: MarkdownTableCellRange[] = []
  let cellStartIndex = contentStartIndex

  for (let index = contentStartIndex; index < contentEndIndex; index += 1) {
    if (line[index] === '|' && !isEscapedMarkdownCharacter(line, index)) {
      ranges.push({ startIndex: cellStartIndex, endIndex: index })
      cellStartIndex = index + 1
    }
  }

  ranges.push({ startIndex: cellStartIndex, endIndex: contentEndIndex })

  return ranges
}

function getMarkdownLineInfos(markdown: string): MarkdownLineInfo[] {
  const lineStartOffsets = getMarkdownLineStartOffsets(markdown)

  return lineStartOffsets.map((startOffset, index) => {
    const nextStartOffset = index + 1 < lineStartOffsets.length ? lineStartOffsets[index + 1] : markdown.length
    const endOffset = nextStartOffset > startOffset && markdown[nextStartOffset - 1] === '\n'
      ? nextStartOffset - 1
      : nextStartOffset

    return {
      line: index + 1,
      text: markdown.slice(startOffset, endOffset),
      startOffset,
      endOffset,
    }
  })
}

function getEffectiveSelectionEndLine(span: MdvAiNormalizedSpan): number {
  if (span.isEmpty) {
    return span.start.line
  }

  return span.end.column === 1 ? Math.max(span.start.line, span.end.line - 1) : span.end.line
}

function getEffectiveSelectionEndPosition(span: MdvAiNormalizedSpan, lines: MarkdownLineInfo[]): MdvAiMarkdownPos {
  if (span.isEmpty) {
    return span.start
  }

  if (span.end.column !== 1) {
    return span.end
  }

  const line = Math.max(span.start.line, span.end.line - 1)
  const lineText = lines[line - 1]?.text ?? ''

  return {
    line,
    column: lineText.length + 1,
  }
}

function parseMarkdownTableAlignmentMarker(marker: string): MarkdownTableAlignment | null {
  const compactMarker = marker.replace(/\s+/g, '')

  if (!/^:?-+:?$/.test(compactMarker)) {
    return null
  }

  if (compactMarker.startsWith(':') && compactMarker.endsWith(':')) {
    return 'center'
  }

  if (compactMarker.startsWith(':')) {
    return 'left'
  }

  if (compactMarker.endsWith(':')) {
    return 'right'
  }

  return 'default'
}

function findMarkdownTableBlock(markdown: string, span: MdvAiNormalizedSpan): MarkdownTableBlock | null {
  const lines = getMarkdownLineInfos(markdown)
  const tokens = markdownParser.parse(markdown, {})
  const selectionStartLine = span.start.line
  const selectionEndLine = getEffectiveSelectionEndLine(span)

  for (const token of tokens) {
    if (token.type !== 'table_open' || token.level !== 0 || !token.map) {
      continue
    }

    const startLine = token.map[0] + 1
    const endLine = token.map[1]
    const separatorLine = lines[startLine]?.text
    const alignments = separatorLine
      ? splitMarkdownTableRow(separatorLine)
        ?.map(parseMarkdownTableAlignmentMarker)
      : null

    if (!alignments || alignments.some((alignment) => alignment === null)) {
      continue
    }

    const intersectsSelection = startLine <= selectionEndLine && endLine >= selectionStartLine

    if (intersectsSelection) {
      return {
        startLine,
        endLine,
        alignments: alignments.map((alignment) => alignment ?? 'default'),
      }
    }
  }

  return null
}

function getMarkdownTableAlignmentMarkerMinWidth(alignment: MarkdownTableAlignment): number {
  if (alignment === 'center') {
    return 5
  }

  if (alignment === 'left' || alignment === 'right') {
    return 4
  }

  return 3
}

function formatMarkdownTableSeparatorCell(width: number, alignment: MarkdownTableAlignment): string {
  if (alignment === 'center') {
    return `:${'-'.repeat(Math.max(3, width - 2))}:`
  }

  if (alignment === 'left') {
    return `:${'-'.repeat(Math.max(3, width - 1))}`
  }

  if (alignment === 'right') {
    return `${'-'.repeat(Math.max(3, width - 1))}:`
  }

  return '-'.repeat(Math.max(3, width))
}

function padMarkdownTableCell(cell: string, width: number, alignment: MarkdownTableAlignment): string {
  const padding = Math.max(0, width - cell.length)

  if (alignment === 'right') {
    return `${' '.repeat(padding)}${cell}`
  }

  if (alignment === 'center') {
    const leftPadding = Math.floor(padding / 2)
    const rightPadding = padding - leftPadding
    return `${' '.repeat(leftPadding)}${cell}${' '.repeat(rightPadding)}`
  }

  return `${cell}${' '.repeat(padding)}`
}

function formatMarkdownTableLines(lines: string[], alignments: MarkdownTableAlignment[]): string[] {
  const rows = lines.map((line, index) => {
    if (index === 1) {
      return []
    }

    const cells = splitMarkdownTableRow(line)
    return cells ?? [line.trim()]
  })
  const normalizedColumnCount = Math.max(1, alignments.length)
  const normalizedAlignments = Array.from(
    { length: normalizedColumnCount },
    (_, index) => alignments[index] ?? 'default',
  )
  const normalizedRows = rows.map((row) => Array.from({ length: normalizedColumnCount }, (_, index) => row[index]?.trim() ?? ''))
  const widths = Array.from({ length: normalizedColumnCount }, (_, columnIndex) => {
    return Math.max(
      getMarkdownTableAlignmentMarkerMinWidth(normalizedAlignments[columnIndex]),
      ...normalizedRows.map((row) => row[columnIndex].length),
    )
  })

  return normalizedRows.map((row, rowIndex) => {
    const cells = rowIndex === 1
      ? widths.map((width, columnIndex) => formatMarkdownTableSeparatorCell(width, normalizedAlignments[columnIndex]))
      : row.map((cell, columnIndex) => padMarkdownTableCell(cell, widths[columnIndex], normalizedAlignments[columnIndex]))

    return `| ${cells.join(' | ')} |`
  })
}

function formatMarkdownTableAtSpan(markdown: string, span: MdvAiNormalizedSpan): MarkdownInsertResult {
  const tableBlock = findMarkdownTableBlock(markdown, span)

  if (!tableBlock) {
    return {
      nextMarkdown: markdown,
      selection: span,
      didFindTarget: false,
    }
  }

  const lines = getMarkdownLineInfos(markdown)
  const tableLines = lines
    .filter((line) => line.line >= tableBlock.startLine && line.line <= tableBlock.endLine)
    .map((line) => line.text)
  const formattedTable = formatMarkdownTableLines(tableLines, tableBlock.alignments).join('\n')
  const startInfo = lines[tableBlock.startLine - 1]
  const endInfo = lines[tableBlock.endLine - 1]
  const nextMarkdown = replaceOffsets(markdown, startInfo.startOffset, endInfo.endOffset, formattedTable)
  const selectionStartOffset = startInfo.startOffset
  const selectionEndOffset = selectionStartOffset + formattedTable.length

  return {
    nextMarkdown,
    selection: normalizeOffsetsToSpan(nextMarkdown, selectionStartOffset, selectionEndOffset),
    didFindTarget: true,
  }
}

function createMarkdownTableEmptyRow(columnCount: number): string {
  const normalizedColumnCount = Math.max(1, columnCount)
  const cells = Array.from({ length: normalizedColumnCount }, () => '')

  return `| ${cells.join(' | ')} |`
}

function normalizeMarkdownTableRowCells(line: string, columnCount: number): string[] {
  const cells = splitMarkdownTableRow(line) ?? [line.trim()]

  return Array.from({ length: columnCount }, (_, index) => cells[index]?.trim() ?? '')
}

function getMarkdownTableColumnIndexAtPosition(line: string, column: number, columnCount: number): number {
  const ranges = getMarkdownTableCellRanges(line)
  const normalizedColumnCount = Math.max(1, columnCount)
  const targetIndex = Math.max(0, Math.min(line.length, column - 1))

  for (let index = 0; index < ranges.length; index += 1) {
    if (targetIndex <= ranges[index].endIndex) {
      return Math.min(index, normalizedColumnCount - 1)
    }
  }

  return normalizedColumnCount - 1
}

function createMarkdownTableRowWithInsertedColumn(line: string, columnCount: number, insertionColumnIndex: number): string {
  const cells = normalizeMarkdownTableRowCells(line, columnCount)

  cells.splice(insertionColumnIndex, 0, '')

  return `| ${cells.join(' | ')} |`
}

function getMarkdownTableCellCaretIndex(line: string, columnIndex: number): number {
  const ranges = getMarkdownTableCellRanges(line)
  const range = ranges[Math.min(Math.max(0, columnIndex), ranges.length - 1)]

  if (!range) {
    return line.length
  }

  return Math.min(range.endIndex, range.startIndex + 1)
}

function getMarkdownLineRelativeStartOffset(lines: string[], lineIndex: number): number {
  return lines.slice(0, lineIndex).reduce((offset, line) => offset + line.length + 1, 0)
}

function getMarkdownTableTargetPosition(tableBlock: MarkdownTableBlock, lines: MarkdownLineInfo[], span: MdvAiNormalizedSpan): MarkdownTableTargetPosition {
  const effectiveEndPosition = getEffectiveSelectionEndPosition(span, lines)
  const lineNumber = Math.min(
    Math.max(effectiveEndPosition.line, tableBlock.startLine),
    tableBlock.endLine,
  )
  const line = lines[lineNumber - 1]
  const column = lineNumber === effectiveEndPosition.line
    ? effectiveEndPosition.column
    : line.text.length + 1

  return {
    lineNumber,
    line,
    column,
  }
}

function getMarkdownTableColumnIndexAtSpan(tableBlock: MarkdownTableBlock, lines: MarkdownLineInfo[], span: MdvAiNormalizedSpan): number {
  const target = getMarkdownTableTargetPosition(tableBlock, lines, span)

  return getMarkdownTableColumnIndexAtPosition(target.line.text, target.column, tableBlock.alignments.length)
}

function addMarkdownTableRowAtSpan(markdown: string, span: MdvAiNormalizedSpan): MarkdownInsertResult {
  const tableBlock = findMarkdownTableBlock(markdown, span)

  if (!tableBlock) {
    return {
      nextMarkdown: markdown,
      selection: span,
      didFindTarget: false,
    }
  }

  const lines = getMarkdownLineInfos(markdown)
  const insertionLineNumber = Math.min(
    Math.max(getEffectiveSelectionEndLine(span), tableBlock.startLine + 1),
    tableBlock.endLine,
  )
  const insertionLine = lines[insertionLineNumber - 1]
  const insertedRow = createMarkdownTableEmptyRow(tableBlock.alignments.length)
  const insertedText = `\n${insertedRow}`
  const nextMarkdown = replaceOffsets(markdown, insertionLine.endOffset, insertionLine.endOffset, insertedText)
  const insertedRowStartOffset = insertionLine.endOffset + 1
  const firstCellOffset = insertedRowStartOffset + 2

  return {
    nextMarkdown,
    selection: normalizeOffsetsToSpan(nextMarkdown, firstCellOffset, firstCellOffset),
    didFindTarget: true,
  }
}

function addMarkdownTableColumnAtSpan(markdown: string, span: MdvAiNormalizedSpan): MarkdownInsertResult {
  const tableBlock = findMarkdownTableBlock(markdown, span)

  if (!tableBlock) {
    return {
      nextMarkdown: markdown,
      selection: span,
      didFindTarget: false,
    }
  }

  const lines = getMarkdownLineInfos(markdown)
  const target = getMarkdownTableTargetPosition(tableBlock, lines, span)
  const columnCount = tableBlock.alignments.length
  const targetColumnIndex = getMarkdownTableColumnIndexAtPosition(target.line.text, target.column, columnCount)
  const insertionColumnIndex = targetColumnIndex + 1
  const nextAlignments = [...tableBlock.alignments]

  nextAlignments.splice(insertionColumnIndex, 0, 'default')

  const augmentedTableLines = lines
    .filter((line) => line.line >= tableBlock.startLine && line.line <= tableBlock.endLine)
    .map((line, index) => index === 1
      ? line.text
      : createMarkdownTableRowWithInsertedColumn(line.text, columnCount, insertionColumnIndex))
  const formattedTableLines = formatMarkdownTableLines(augmentedTableLines, nextAlignments)
  const formattedTable = formattedTableLines.join('\n')
  const startInfo = lines[tableBlock.startLine - 1]
  const endInfo = lines[tableBlock.endLine - 1]
  const nextMarkdown = replaceOffsets(markdown, startInfo.startOffset, endInfo.endOffset, formattedTable)
  const caretLineNumber = target.lineNumber === tableBlock.startLine + 1
    ? tableBlock.startLine
    : target.lineNumber
  const caretLineIndex = caretLineNumber - tableBlock.startLine
  const caretLineStartOffset = startInfo.startOffset + getMarkdownLineRelativeStartOffset(formattedTableLines, caretLineIndex)
  const caretIndex = getMarkdownTableCellCaretIndex(formattedTableLines[caretLineIndex] ?? '', insertionColumnIndex)
  const caretOffset = caretLineStartOffset + caretIndex

  return {
    nextMarkdown,
    selection: normalizeOffsetsToSpan(nextMarkdown, caretOffset, caretOffset),
    didFindTarget: true,
  }
}

function setMarkdownTableColumnAlignmentAtSpan(markdown: string, span: MdvAiNormalizedSpan, alignment: MarkdownTableAlignment): MarkdownInsertResult {
  const tableBlock = findMarkdownTableBlock(markdown, span)

  if (!tableBlock) {
    return {
      nextMarkdown: markdown,
      selection: span,
      didFindTarget: false,
    }
  }

  const lines = getMarkdownLineInfos(markdown)
  const target = getMarkdownTableTargetPosition(tableBlock, lines, span)
  const targetColumnIndex = getMarkdownTableColumnIndexAtSpan(tableBlock, lines, span)
  const nextAlignments = [...tableBlock.alignments]

  nextAlignments[targetColumnIndex] = alignment

  const tableLines = lines
    .filter((line) => line.line >= tableBlock.startLine && line.line <= tableBlock.endLine)
    .map((line) => line.text)
  const formattedTableLines = formatMarkdownTableLines(tableLines, nextAlignments)
  const formattedTable = formattedTableLines.join('\n')
  const startInfo = lines[tableBlock.startLine - 1]
  const endInfo = lines[tableBlock.endLine - 1]
  const nextMarkdown = replaceOffsets(markdown, startInfo.startOffset, endInfo.endOffset, formattedTable)
  const caretLineNumber = target.lineNumber === tableBlock.startLine + 1
    ? tableBlock.startLine
    : target.lineNumber
  const caretLineIndex = caretLineNumber - tableBlock.startLine
  const caretLineStartOffset = startInfo.startOffset + getMarkdownLineRelativeStartOffset(formattedTableLines, caretLineIndex)
  const caretIndex = getMarkdownTableCellCaretIndex(formattedTableLines[caretLineIndex] ?? '', targetColumnIndex)
  const caretOffset = caretLineStartOffset + caretIndex

  return {
    nextMarkdown,
    selection: normalizeOffsetsToSpan(nextMarkdown, caretOffset, caretOffset),
    didFindTarget: true,
  }
}

function getMarkdownTableColumnAlignmentForCommand(command: MarkdownInsertCommand): MarkdownTableAlignment | null {
  if (command === 'align-table-column-default') {
    return 'default'
  }

  if (command === 'align-table-column-left') {
    return 'left'
  }

  if (command === 'align-table-column-center') {
    return 'center'
  }

  if (command === 'align-table-column-right') {
    return 'right'
  }

  return null
}

function toggleMarkdownTaskLine(line: string): string | null {
  const taskMatch = /^(\s*(?:[-+*]|\d+[.)])\s+\[)([ xX])(\]\s*)/.exec(line)

  if (taskMatch) {
    const nextCheck = taskMatch[2].toLowerCase() === 'x' ? ' ' : 'x'
    return `${taskMatch[1]}${nextCheck}${taskMatch[3]}${line.slice(taskMatch[0].length)}`
  }

  const listMatch = /^(\s*(?:[-+*]|\d+[.)])\s+)(?!\[[ xX]\]\s*)/.exec(line)

  if (!listMatch) {
    return null
  }

  return `${listMatch[1]}[ ] ${line.slice(listMatch[1].length)}`
}

function toggleTaskListAtSpan(markdown: string, span: MdvAiNormalizedSpan): MarkdownInsertResult {
  const lines = getMarkdownLineInfos(markdown)
  const startLine = Math.min(Math.max(1, span.start.line), lines.length)
  const endLine = Math.min(Math.max(startLine, getEffectiveSelectionEndLine(span)), lines.length)
  const targetLines = lines.filter((line) => line.line >= startLine && line.line <= endLine)
  let didChange = false
  const nextLines = targetLines.map((line) => {
    const toggledLine = toggleMarkdownTaskLine(line.text)

    if (toggledLine === null) {
      return line.text
    }

    didChange = true
    return toggledLine
  })

  if (!didChange) {
    return {
      nextMarkdown: markdown,
      selection: span,
      didFindTarget: false,
    }
  }

  const startInfo = lines[startLine - 1]
  const endInfo = lines[endLine - 1]
  const replacement = nextLines.join('\n')
  const nextMarkdown = replaceOffsets(markdown, startInfo.startOffset, endInfo.endOffset, replacement)
  const selectionStartOffset = startInfo.startOffset
  const selectionEndOffset = selectionStartOffset + replacement.length

  return {
    nextMarkdown,
    selection: normalizeOffsetsToSpan(nextMarkdown, selectionStartOffset, selectionEndOffset),
    didFindTarget: true,
  }
}

function insertMarkdownTableTemplate(markdown: string, span: MdvAiNormalizedSpan): MarkdownInsertResult {
  const { startOffset, endOffset } = getSpanOffsets(markdown, span)
  const tableTemplate = [
    '| Column 1 | Column 2 | Column 3 |',
    '| --- | --- | --- |',
    '| Cell | Cell | Cell |',
  ].join('\n')
  const leadingBreak = startOffset === 0
    ? ''
    : markdown[startOffset - 1] === '\n'
      ? startOffset >= 2 && markdown[startOffset - 2] === '\n' ? '' : '\n'
      : '\n\n'
  const trailingBreak = endOffset >= markdown.length
    ? '\n'
    : markdown[endOffset] === '\n'
      ? markdown[endOffset + 1] === '\n' ? '' : '\n'
      : '\n\n'
  const insertedText = `${leadingBreak}${tableTemplate}${trailingBreak}`
  const headerStartOffset = startOffset + leadingBreak.length + '| '.length
  const headerEndOffset = headerStartOffset + 'Column 1'.length

  return createMarkdownInsertResult(markdown, startOffset, endOffset, insertedText, headerStartOffset, headerEndOffset)
}

function runMarkdownInsertCommand(command: MarkdownInsertCommand, markdown: string, span: MdvAiNormalizedSpan): MarkdownInsertResult {
  const { startOffset, endOffset } = getSpanOffsets(markdown, span)
  const selectedText = markdown.slice(startOffset, endOffset)

  if (command === 'heading') {
    return prefixSelectedLines(markdown, span, '## ', 'Heading')
  }

  if (command === 'quote') {
    return prefixSelectedLines(markdown, span, '> ', 'Quote')
  }

  if (command === 'link') {
    const label = selectedText.length > 0 ? selectedText : 'link text'
    const href = 'https://example.com'
    const insertedText = `[${label}](${href})`
    const hrefStartOffset = startOffset + insertedText.indexOf(href)
    return createMarkdownInsertResult(markdown, startOffset, endOffset, insertedText, hrefStartOffset, hrefStartOffset + href.length)
  }

  if (command === 'image') {
    return insertImageMarkdown(markdown, span, './image.png', 'alt text')
  }

  if (command === 'code-block') {
    const body = selectedText.length > 0 ? selectedText : 'code'
    const insertedText = `\`\`\`\n${body}\n\`\`\``
    const bodyStartOffset = startOffset + 4
    return createMarkdownInsertResult(markdown, startOffset, endOffset, insertedText, bodyStartOffset, bodyStartOffset + body.length)
  }

  if (command === 'horizontal-rule') {
    const insertionOffset = endOffset
    const beforeText = markdown.slice(0, insertionOffset).replace(/\n*$/, '')
    const afterText = markdown.slice(insertionOffset).replace(/^\n*/, '')
    const nextMarkdown = `${beforeText}${beforeText.length > 0 ? '\n\n' : ''}---${afterText.length > 0 ? '\n\n' : ''}${afterText}`
    const caretOffset = beforeText.length + (beforeText.length > 0 ? 5 : 3)

    return {
      nextMarkdown,
      selection: normalizeOffsetsToSpan(nextMarkdown, caretOffset, caretOffset),
    }
  }

  if (command === 'table') {
    return insertMarkdownTableTemplate(markdown, span)
  }

  if (command === 'format-table') {
    return formatMarkdownTableAtSpan(markdown, span)
  }

  if (command === 'add-table-row') {
    return addMarkdownTableRowAtSpan(markdown, span)
  }

  if (command === 'add-table-column') {
    return addMarkdownTableColumnAtSpan(markdown, span)
  }

  const tableColumnAlignment = getMarkdownTableColumnAlignmentForCommand(command)

  if (tableColumnAlignment) {
    return setMarkdownTableColumnAlignmentAtSpan(markdown, span, tableColumnAlignment)
  }

  if (command === 'toggle-task-list') {
    return toggleTaskListAtSpan(markdown, span)
  }

  const footnoteId = getNextFootnoteId(markdown)
  const marker = `[^${footnoteId}]`
  const definitionText = selectedText.length > 0 ? selectedText : 'Footnote'
  const needsSeparator = markdown.length === 0 ? '' : markdown.endsWith('\n') ? '\n' : '\n\n'
  const definitionPrefix = `${needsSeparator}[^${footnoteId}]: `
  const nextMarkdown = `${replaceOffsets(markdown, startOffset, endOffset, marker)}${definitionPrefix}${definitionText}`
  const definitionStartOffset = nextMarkdown.length - definitionText.length

  return {
    nextMarkdown,
    selection: normalizeOffsetsToSpan(nextMarkdown, definitionStartOffset, definitionStartOffset + definitionText.length),
  }
}

function toToastMarkdownPos(position: MdvAiMarkdownPos): [number, number] {
  return [position.line, position.column]
}

function getActiveEditorRoot(editor: ToastUiEditor): HTMLElement {
  const slots = editor.getEditorElements()
  return editor.isMarkdownMode() ? slots.mdEditor : slots.wwEditor
}

function getEditorSelectionStartLine(editor: ToastUiEditor, markdown: string): number {
  return normalizeSelectionToMarkdownSpan(editor, markdown).start.line
}

function findEditorSelectionAnchor(root: HTMLElement): HTMLElement | null {
  const selection = window.getSelection()

  if (selection && selection.rangeCount > 0) {
    const anchorNode = selection.getRangeAt(0).startContainer
    const anchorElement = anchorNode.nodeType === Node.ELEMENT_NODE ? anchorNode : anchorNode.parentElement

    if (anchorElement instanceof HTMLElement && root.contains(anchorElement)) {
      return anchorElement
    }
  }

  return root.querySelector<HTMLElement>(
    '.CodeMirror-selected, .cm-selectionBackground, .CodeMirror-cursor, .cm-cursor, .ProseMirror-selectednode'
  )
}

function findEditorScrollContainer(root: HTMLElement): HTMLElement {
  return root.querySelector<HTMLElement>('.CodeMirror-scroll, .cm-scroller, .toastui-editor, .ProseMirror') ?? root
}

function focusEditorAnchorTarget(root: HTMLElement) {
  const focusTarget =
    root.querySelector<HTMLElement>('textarea, .cm-content, .ProseMirror, [contenteditable="true"]') ?? root

  focusTarget.focus({ preventScroll: true })
}

function scrollElementIntoContainer(container: HTMLElement, target: HTMLElement) {
  const containerRect = container.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const topPadding = Math.max(40, Math.round(containerRect.height * 0.28))
  const bottomPadding = Math.max(28, Math.round(containerRect.height * 0.18))

  if (targetRect.top < containerRect.top + topPadding) {
    container.scrollTop += targetRect.top - containerRect.top - topPadding
    return
  }

  if (targetRect.bottom > containerRect.bottom - bottomPadding) {
    container.scrollTop += targetRect.bottom - containerRect.bottom + bottomPadding
  }
}

function scrollSpanIntoEditorView(editor: ToastUiEditor) {
  const root = getActiveEditorRoot(editor)
  const container = findEditorScrollContainer(root)
  const scrollToAnchor = () => {
    const anchor = findEditorSelectionAnchor(root)

    if (!anchor) {
      return false
    }

    scrollElementIntoContainer(container, anchor)
    return true
  }

  window.requestAnimationFrame(() => {
    if (scrollToAnchor()) {
      return
    }

    focusEditorAnchorTarget(root)
    window.requestAnimationFrame(() => {
      scrollToAnchor()
    })
  })
}

function selectSpanInEditor(editor: ToastUiEditor, span: MdvAiNormalizedSpan) {
  const markdownStart = toToastMarkdownPos(span.start)
  const markdownEnd = toToastMarkdownPos(span.end)
  const [selectionStart, selectionEnd] = editor.isMarkdownMode()
    ? [markdownStart, markdownEnd]
    : editor.convertPosToMatchEditorMode(markdownStart, markdownEnd, 'wysiwyg')

  editor.setSelection(selectionStart, selectionEnd)
  editor.focus()
  scrollSpanIntoEditorView(editor)
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

function ReloadFileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="toolbar-icon">
      <path d="M19 12a7 7 0 1 1-2-4.9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M17 3.8v4.1h-4.1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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

function NewDocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="toolbar-icon">
      <path d="M6.5 3.5h7l4 4v13a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M13.5 3.5v4h4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12 10v6M9 13h6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="toolbar-icon">
      <circle cx="10.5" cy="10.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m15 15 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function PrevIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="toolbar-icon">
      <path d="M14.5 6.5 9 12l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function NextIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="toolbar-icon">
      <path d="M9.5 6.5 15 12l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="toolbar-icon">
      <path d="M7 7 17 17M17 7 7 17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function ResultsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="toolbar-icon">
      <path d="M5 7.5h14M5 12h14M5 16.5h9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="toolbar-icon">
      <rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PrintIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="toolbar-icon">
      <path d="M7 8V4.5h10V8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M7 17H5.5A1.5 1.5 0 0 1 4 15.5v-5A1.5 1.5 0 0 1 5.5 9h13A1.5 1.5 0 0 1 20 10.5v5a1.5 1.5 0 0 1-1.5 1.5H17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M7 14h10v5.5H7z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  )
}

function ExportIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="toolbar-icon">
      <path d="M6 4.5h8l4 4v11A1.5 1.5 0 0 1 16.5 21h-10A1.5 1.5 0 0 1 5 19.5v-13A1.5 1.5 0 0 1 6.5 5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M14 4.5V9h4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12 11v5M9.5 13.5 12 11l2.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function HeadingCommandIcon() {
  return <span className="toolbar-text-icon" aria-hidden="true">H</span>
}

function LinkCommandIcon() {
  return <span className="toolbar-text-icon" aria-hidden="true">[]</span>
}

function ImageCommandIcon() {
  return <span className="toolbar-text-icon" aria-hidden="true">IMG</span>
}

function CodeBlockCommandIcon() {
  return <span className="toolbar-text-icon" aria-hidden="true">&lt;/&gt;</span>
}

function QuoteCommandIcon() {
  return <span className="toolbar-text-icon" aria-hidden="true">&#34;</span>
}

function HorizontalRuleCommandIcon() {
  return <span className="toolbar-text-icon" aria-hidden="true">---</span>
}

function FootnoteCommandIcon() {
  return <span className="toolbar-text-icon" aria-hidden="true">FN</span>
}

function TableCommandIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="toolbar-icon">
      <rect x="4" y="5" width="16" height="14" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 10h16M4 14.5h16M9.5 5v14M14.5 5v14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function FormatTableCommandIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="toolbar-icon">
      <path d="M5 5.5h14M5 10h9M5 14.5h14M5 19h9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M17 9.5v5M14.5 12H19.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function AddTableRowCommandIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="toolbar-icon">
      <rect x="4" y="5" width="16" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 9h16M4 13h16M9.5 5v12M14.5 5v12M12 18.5v3M10.5 20h3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function AddTableColumnCommandIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="toolbar-icon">
      <rect x="4" y="5" width="12" height="14" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 10h12M4 14.5h12M8 5v14M12 5v14M18.5 12h3M20 10.5v3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function AlignTableColumnDefaultIcon() {
  return <span className="toolbar-text-icon" aria-hidden="true">--</span>
}

function AlignTableColumnLeftIcon() {
  return <span className="toolbar-text-icon" aria-hidden="true">L</span>
}

function AlignTableColumnCenterIcon() {
  return <span className="toolbar-text-icon" aria-hidden="true">C</span>
}

function AlignTableColumnRightIcon() {
  return <span className="toolbar-text-icon" aria-hidden="true">R</span>
}

function TaskCheckboxCommandIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="toolbar-icon">
      <rect x="4.5" y="5" width="14" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m8 12 2.5 2.5L16 9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  const didCopy = document.execCommand('copy')
  textarea.remove()

  if (!didCopy) {
    throw new Error('Clipboard copy command was rejected')
  }
}

function buildHtmlExportFileName(currentFilePath: string | null, displayTitle: string, untitledTitle: string): string {
  if (currentFilePath) {
    return currentFilePath.replace(/\.(md|markdown|txt|html?)$/i, '') + '.html'
  }

  const sourceName = basename(currentFilePath, displayTitle || untitledTitle)
  const withoutExtension = sourceName.replace(/\.(md|markdown|txt|html?)$/i, '')
  return `${withoutExtension || untitledTitle.replace(/\.[^.]+$/, '')}.html`
}

function isRelativeImageSource(source: string): boolean {
  const normalizedSource = source.trim().toLowerCase()

  if (!normalizedSource || normalizedSource.startsWith('#') || normalizedSource.startsWith('//') || normalizedSource.startsWith('data:')) {
    return false
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(normalizedSource)) {
    return false
  }

  return !normalizedSource.startsWith('/') && !/^[a-z]:[/\\]/i.test(normalizedSource)
}

function getImageSourceTail(source: string): string {
  const markerIndex = source.search(/[?#]/)
  return markerIndex >= 0 ? source.slice(markerIndex) : ''
}

async function inlineRelativeImagesForExport(
  previewRoot: HTMLDivElement | null,
  options: {
    currentFilePath: string | null
    requireSavedFileMessage: string
    inlineFailedMessage: (source: string) => string
  },
): Promise<string> {
  const exportRoot = previewRoot?.cloneNode(true)

  if (!(exportRoot instanceof HTMLDivElement)) {
    return ''
  }

  const images = Array.from(exportRoot.querySelectorAll('img[src]'))

  await Promise.all(images.map(async (image) => {
    const source = image.getAttribute('src')?.trim() ?? ''

    if (!isRelativeImageSource(source)) {
      return
    }

    if (!options.currentFilePath) {
      throw new Error(options.requireSavedFileMessage)
    }

    const result = await window.mdvDesktop?.readRelativeAssetAsDataUrl({
      baseFilePath: options.currentFilePath,
      source,
    })

    if (!result?.dataUrl) {
      throw new Error(options.inlineFailedMessage(source))
    }

    image.setAttribute('src', `${result.dataUrl}${getImageSourceTail(source)}`)
  }))

  return sanitizeExportHtmlFragment(exportRoot.innerHTML)
}

function sanitizeExportHtmlFragment(html: string): string {
  const parser = new DOMParser()
  const documentFragment = parser.parseFromString(`<div id="export-root">${html}</div>`, 'text/html')
  const root = documentFragment.getElementById('export-root')

  if (!root) {
    return ''
  }

  root.querySelectorAll('script, link, base, iframe, object, embed, form, input, button, textarea, select, meta[http-equiv="refresh"]').forEach((element) => {
    element.remove()
  })

  root.querySelectorAll('style').forEach((element) => {
    if (element.namespaceURI !== 'http://www.w3.org/2000/svg') {
      element.remove()
    }
  })

  root.querySelectorAll('.katex').forEach((element) => {
    const mathml = element.querySelector('.katex-mathml')

    if (!mathml) {
      return
    }

    const replacement = documentFragment.createElement('span')
    replacement.className = 'katex-export-mathml'
    replacement.innerHTML = mathml.innerHTML
    element.replaceWith(replacement)
  })

  root.querySelectorAll('*').forEach((element) => {
    for (const attributeName of element.getAttributeNames()) {
      const attributeValue = element.getAttribute(attributeName) ?? ''
      const normalizedName = attributeName.toLowerCase()
      const normalizedValue = Array.from(attributeValue)
        .filter((char) => {
          const code = char.charCodeAt(0)
          return !((code >= 0 && code <= 32) || (code >= 127 && code <= 159))
        })
        .join('')
        .toLowerCase()

      if (normalizedName.startsWith('on')) {
        element.removeAttribute(attributeName)
        continue
      }

      if (normalizedName === 'style' && element.namespaceURI !== 'http://www.w3.org/2000/svg') {
        element.removeAttribute(attributeName)
        continue
      }

      if (normalizedName === 'srcset' || normalizedName === 'poster') {
        element.removeAttribute(attributeName)
        continue
      }

      if (normalizedName === 'href') {
        if (element.namespaceURI === 'http://www.w3.org/2000/svg') {
          if (!normalizedValue.startsWith('#')) {
            element.removeAttribute(attributeName)
          }

          continue
        }

        const schemeMatch = normalizedValue.match(/^([a-z][a-z0-9+.-]*):/i)
        const scheme = schemeMatch?.[1] ?? null

        if (normalizedValue.startsWith('//')) {
          element.removeAttribute(attributeName)
          continue
        }

        if (scheme && !['http', 'https', 'mailto', 'tel'].includes(scheme)) {
          element.removeAttribute(attributeName)
        }

        continue
      }

      if (normalizedName === 'src') {
        const schemeMatch = normalizedValue.match(/^([a-z][a-z0-9+.-]*):/i)
        const scheme = schemeMatch?.[1] ?? null
        const isSafeLocalReference = normalizedValue.startsWith('#')
          || normalizedValue.startsWith('data:image/')
          || (!scheme && !normalizedValue.startsWith('//'))

        if (!isSafeLocalReference) {
          element.removeAttribute(attributeName)
        }

        continue
      }

      if (normalizedName === 'xlink:href') {
        if (!normalizedValue.startsWith('#')) {
          element.removeAttribute(attributeName)
        }
      }
    }
  })

  return root.innerHTML
}

function buildExportHtmlDocument(title: string, bodyHtml: string): string {
  const rootStyles = getComputedStyle(document.documentElement)
  const readVar = (name: string, fallback: string) => rootStyles.getPropertyValue(name).trim() || fallback
  const background = readVar('--bg-elevated', '#f6f1e8')
  const surface = readVar('--bg-panel', '#ffffff')
  const surfaceStrong = readVar('--bg-panel-strong', '#f3eee3')
  const text = readVar('--text', '#222222')
  const textMuted = readVar('--text-muted', '#5c5c5c')
  const textHeading = readVar('--text-h', text)
  const border = readVar('--border', '#d6cfbf')
  const link = readVar('--link', '#0b5bd3')
  const codeBg = readVar('--code-bg', '#f4f0e8')
  const codeBorder = readVar('--code-border', border)
  const codeShellBg = readVar('--code-shell-bg', surfaceStrong)
  const codeShellText = readVar('--code-shell-text', text)
  const mono = readVar('--mono', "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace")
  const sans = readVar('--sans', "'Segoe UI', 'Noto Sans JP', sans-serif")
  const safeTitle = title.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char))

  return `<!doctype html>
<html lang="${document.documentElement.lang || 'en'}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${safeTitle}</title>
    <style>
      :root {
        color-scheme: light;
      }
      body {
        margin: 0;
        background: ${background};
        color: ${text};
        font: 14px/1.75 ${sans};
      }
      .export-shell {
        max-width: 980px;
        margin: 0 auto;
        padding: 40px 32px 56px;
      }
      .export-shell > * {
        margin-left: auto;
        margin-right: auto;
      }
      .markdown-fragment h1,
      .markdown-fragment h2,
      .markdown-fragment h3,
      .markdown-fragment h4 {
        color: ${textHeading};
        line-height: 1.18;
        margin: 1.4em 0 0.6em;
        padding: 0;
        border: none;
        border-radius: 0;
        background: transparent;
        font-family: inherit;
      }
      .markdown-fragment h1 { font-size: 1.9rem; }
      .markdown-fragment h2 { font-size: 1.45rem; }
      .markdown-fragment h3 { font-size: 1.15rem; }
      .markdown-fragment h4 { font-size: 1rem; }
      .markdown-fragment p,
      .markdown-fragment ul,
      .markdown-fragment ol,
      .markdown-fragment blockquote { line-height: 1.75; }
      .markdown-fragment a { color: ${link}; }
      .markdown-fragment blockquote {
        margin: 1em 0;
        padding: 0.7em 1em;
        border-left: 3px solid ${link};
        background: ${surfaceStrong};
        color: ${textMuted};
      }
      .markdown-fragment table {
        width: 100%;
        border-collapse: collapse;
        border: 1px solid ${border};
        margin: 1em 0;
        overflow: hidden;
        border-radius: 10px;
      }
      .markdown-fragment th,
      .markdown-fragment td {
        border: 1px solid ${border};
        padding: 0.65em 0.75em;
        background: ${surface};
      }
      .markdown-fragment th {
        background: ${surfaceStrong};
        color: ${textHeading};
      }
      .markdown-fragment code {
        background: ${codeBg};
        border: 1px solid ${codeBorder};
        border-radius: 0.38em;
        color: ${text};
        font-family: ${mono};
        font-size: 0.92em;
        line-height: 1.4;
        padding: 0.12em 0.36em;
      }
      .markdown-fragment h1 code,
      .markdown-fragment h2 code,
      .markdown-fragment h3 code,
      .markdown-fragment h4 code {
        padding: 0;
        border: none;
        border-radius: 0;
        background: transparent;
        color: inherit;
        font: inherit;
      }
      .markdown-fragment pre {
        margin: 1em 0;
        padding: 12px 14px;
        overflow: auto;
        border: 1px solid ${border};
        border-radius: 12px;
        background: ${codeShellBg};
        color: ${codeShellText};
        font: 12px/1.6 ${mono};
      }
      .markdown-fragment pre code {
        display: block;
        padding: 0;
        border: none;
        border-radius: 0;
        background: transparent;
        color: inherit;
        font: inherit;
      }
      .code-block-shell {
        display: flex;
        flex-direction: column;
        border-radius: 12px;
        overflow: hidden;
        border: 1px solid ${border};
        background: ${codeShellBg};
        color: ${codeShellText};
      }
      .code-block-header {
        padding: 6px 8px;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        background: rgba(0, 0, 0, 0.04);
      }
      .code-block-shell pre {
        margin: 0;
        padding: 12px 14px;
        overflow: auto;
        font: 12px/1.6 ${mono};
      }
      .code-block-shell code {
        background: transparent;
        border: none;
        padding: 0;
        border-radius: 0;
        color: inherit;
        font: inherit;
      }
      .mermaid-block {
        border-radius: 12px;
        border: 1px solid ${border};
        background: ${surface};
        padding: 14px;
      }
      .mermaid-block svg {
        display: block;
        max-width: 100%;
        height: auto;
      }
      .katex-export-mathml math {
        font-size: 1.05em;
      }
    </style>
  </head>
  <body>
    <main class="export-shell">${bodyHtml}</main>
  </body>
</html>`
}

async function waitForRenderedPreviewReady(previewRoot: HTMLDivElement | null) {
  if (!previewRoot) {
    return
  }

  const deadline = performance.now() + 1500

  while (performance.now() < deadline) {
    const hasPendingMermaidRender = previewRoot.querySelector('.mermaid-block[data-render-state="loading"]') !== null

    if (!hasPendingMermaidRender) {
      return
    }

    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve())
    })
  }

  throw new Error('Rendered preview is still updating. Retry once rendering completes.')
}

async function waitForDelay(delayMs: number) {
  if (delayMs <= 0) {
    return
  }

  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs)
  })
}

const EMPTY_UNTITLED_DOCUMENT = ''

function createDocumentInstanceId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

function inferUntouchedUntitledBuffer(snapshot: Partial<MdvClientSnapshot> | null | undefined) {
  if (snapshot?.isUntouchedUntitledBuffer === true) {
    return true
  }

  return typeof snapshot?.isUntouchedUntitledBuffer !== 'boolean'
    && (snapshot?.currentFilePath ?? null) === null
    && (snapshot?.markdownText ?? EMPTY_UNTITLED_DOCUMENT) === EMPTY_UNTITLED_DOCUMENT
    && (snapshot?.persistedMarkdown ?? EMPTY_UNTITLED_DOCUMENT) === EMPTY_UNTITLED_DOCUMENT
}

function App() {
  const { resolvedTheme } = useDesktopTheme()
  const { t } = useI18n()
  const bootstrap = window.mdvDesktop?.settings.getBootstrapSettings()
  const [markdownText, setMarkdownText] = useState<string>(EMPTY_UNTITLED_DOCUMENT)
  const [activePanel, setActivePanel] = useState<'write' | 'preview'>(() => {
    return bootstrap?.initialPanel === 'write' ? 'write' : 'preview'
  })
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null)
  const [currentDraftWorkspace, setCurrentDraftWorkspace] = useState<MdvDraftWorkspace | null>(null)
  const [pendingImportedAssets, setPendingImportedAssets] = useState<MdvPendingImportedAsset[]>([])
  const [displayTitle, setDisplayTitle] = useState<string>(() => t.app.untitledTitle)
  const [statusText, setStatusTextState] = useState<string>(t.common.ready)
  const [activeToast, setActiveToast] = useState<StatusToast | null>(null)
  const [isInitialLaunchOpenSettled, setIsInitialLaunchOpenSettled] = useState(() => !(bootstrap?.hasInitialLaunchRequest ?? false))
  const [isStartupRecoveryResolved, setIsStartupRecoveryResolved] = useState(false)
  const [isAssistantDockOpen, setIsAssistantDockOpen] = useState(false)
  const [assistantFocusNonce, setAssistantFocusNonce] = useState(0)
  const [assistantDockWidthPercent, setAssistantDockWidthPercent] = useState(DEFAULT_ASSISTANT_DOCK_WIDTH_PERCENT)
  const [isDraggingFile, setIsDraggingFile] = useState(false)
  const [editorSearchMode, setEditorSearchMode] = useState<EditorSearchMode>('exact')
  const contentBaseFilePath = currentFilePath ?? currentDraftWorkspace?.markdownFilePath ?? null
  const [editorSearchQuery, setEditorSearchQuery] = useState('')
  const [editorSearchReplacement, setEditorSearchReplacement] = useState('')
  const [isEditorSearchMatchCase, setIsEditorSearchMatchCase] = useState(false)
  const [isEditorSearchRegexp, setIsEditorSearchRegexp] = useState(false)
  const [isEditorSearchInSelection, setIsEditorSearchInSelection] = useState(false)
  const [exactEditorSearchScope, setExactEditorSearchScope] = useState<ExactEditorSearchScope | null>(null)
  const [editorSearchResults, setEditorSearchResults] = useState<EditorSearchResult[]>([])
  const [selectedSearchResultIndex, setSelectedSearchResultIndex] = useState(-1)
  const [pendingSearchJump, setPendingSearchJump] = useState<MdvAiNormalizedSpan | null>(null)
  const [isRunningEditorSearch, setIsRunningEditorSearch] = useState(false)
  const [editorSearchError, setEditorSearchError] = useState<string | null>(null)
  const [isEditorSearchResultsVisible, setIsEditorSearchResultsVisible] = useState(false)
  const [isSemanticSearchAvailable, setIsSemanticSearchAvailable] = useState(false)
  const [isAiChatAvailable, setIsAiChatAvailable] = useState(false)
  const [isEditorSearchDialogOpen, setIsEditorSearchDialogOpen] = useState(false)
  const [changeProposalReview, setChangeProposalReview] = useState<ChangeProposalReviewState | null>(null)
  const [editorSearchDialogMode, setEditorSearchDialogMode] = useState<EditorSearchDialogMode>('search')
  const [headingOutline, setHeadingOutline] = useState<MdvMdastHeadingOutlineItem[]>([])
  const [headingOutlineMode, setHeadingOutlineMode] = useState<'document' | 'placeholder'>('document')
  const [isUntouchedUntitledBuffer, setIsUntouchedUntitledBuffer] = useState(true)
  const [activeOutlineLine, setActiveOutlineLine] = useState<number | null>(null)
  const [editorSessionKey, setEditorSessionKey] = useState(0)
  const [persistedMarkdown, setPersistedMarkdown] = useState<string>(EMPTY_UNTITLED_DOCUMENT)
  const editorRef = useRef<ToastUiEditor | null>(null)
  const workspaceBodyRef = useRef<HTMLDivElement | null>(null)
  const previewRootRef = useRef<HTMLDivElement | null>(null)
  const previewRelativeImageCacheRef = useRef<Map<string, RelativeImageResolutionCacheEntry>>(new Map())
  const previewRelativeImageResolveFrameRef = useRef<number | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const currentFilePathRef = useRef<string | null>(null)
  const documentInstanceIdRef = useRef(createDocumentInstanceId())
  const activeChangeProposalIdRef = useRef<string | null>(null)
  const persistedMarkdownRef = useRef<string>(EMPTY_UNTITLED_DOCUMENT)
  const currentFileSnapshotRef = useRef<MdvFileSnapshot | null>(null)
  const pendingImportedAssetsRef = useRef<MdvPendingImportedAsset[]>([])
  const untitledTitleRef = useRef<string>(t.app.untitledTitle)
  const localeRef = useRef<'ja' | 'en'>(document.documentElement.lang === 'ja' ? 'ja' : 'en')
  const toastIdRef = useRef(0)
  const toastTimerRef = useRef<number | null>(null)
  const shouldCanonicalizeLoadedBaselineRef = useRef(true)
  const allowWindowCloseRef = useRef(false)
  const recoveryKeyRef = useRef<string>('')
  const lastAutosaveRecoveryStorageKeyRef = useRef<string | null>(null)
  const lastAutosaveSignatureRef = useRef<string | null>(null)
  const handledRecoveryKeysRef = useRef(new Set<string>())
  const confirmUnsavedChangesBeforeProceedRef = useRef<(proceedLabel: string) => Promise<boolean>>(async () => true)
  const handleSaveRef = useRef<(forceDialog?: boolean) => Promise<boolean>>(async () => false)
  const loadFilePayloadRef = useRef<(payload: MdvFilePayload | null) => void>(() => {})
  const focusEditorSearchRef = useRef<() => void>(() => {})
  const openEditorReplaceDialogRef = useRef<() => void>(() => {})
  const i18nRef = useRef(t)
  const canAbandonCurrentBufferRef = useRef<(nextActionLabel: string) => boolean>(() => true)
  const runDesktopActionRef = useRef<(action: MdvMenuAction) => void>(() => {})
  const typographySettingsRef = useRef({
    editorFontSizePx: clampEditorFontSizePx(bootstrap?.settings.editor.fontSizePx ?? DEFAULT_EDITOR_FONT_SIZE_PX),
    chatFontSizePx: clampChatFontSizePx(bootstrap?.settings.ai.chatFontSizePx ?? DEFAULT_CHAT_FONT_SIZE_PX),
  })
  const outlineRequestIdRef = useRef(0)
  const outlineListRef = useRef<HTMLDivElement | null>(null)
  const activeOutlineItemRef = useRef<HTMLButtonElement | null>(null)
  const activePreviewHeadingRef = useRef<HTMLElement | null>(null)
  const currentDraftWorkspaceRef = useRef<MdvDraftWorkspace | null>(null)
  const updateCurrentFilePath = (nextFilePath: string | null) => {
    currentFilePathRef.current = nextFilePath
    setCurrentFilePath(nextFilePath)
  }
  const buildClientSnapshotRef = useRef<() => MdvClientSnapshot>(() => ({
    markdownText: EMPTY_UNTITLED_DOCUMENT,
    persistedMarkdown: EMPTY_UNTITLED_DOCUMENT,
    currentFilePath: null,
    fileSnapshot: null,
    draftWorkspace: null,
    pendingImportedAssets: [],
    displayTitle: t.app.untitledTitle,
    activePanel: bootstrap?.initialPanel === 'write' ? 'write' : 'preview',
    isUntouchedUntitledBuffer: true,
    recoveryKey: recoveryKeyRef.current,
  }))
  const buildLiveClientSnapshotRef = useRef<() => MdvClientSnapshot>(() => buildClientSnapshotRef.current())
  const applyClientSnapshotRef = useRef<(snapshot: MdvClientSnapshot) => void>(() => {})
  const respondToAiEditorRequestRef = useRef<(request: MdvAiEditorRequest) => void>(() => {})
  const rendererRegistry = useMemo(() => createRendererRegistry(), [])
  const hasUnsavedChanges = markdownText !== persistedMarkdown
  const visibleDisplayTitle = hasUnsavedChanges ? `${displayTitle}*` : displayTitle
  const isStartupPending = !isInitialLaunchOpenSettled || !isStartupRecoveryResolved
  const isPlaceholderDocument = currentFilePath === null
    && isUntouchedUntitledBuffer
    && markdownText === EMPTY_UNTITLED_DOCUMENT
    && persistedMarkdown === EMPTY_UNTITLED_DOCUMENT
  const updatePendingImportedAssets = useCallback((nextAssets: MdvPendingImportedAsset[] | ((currentAssets: MdvPendingImportedAsset[]) => MdvPendingImportedAsset[])) => {
    const resolvedAssets = typeof nextAssets === 'function'
      ? nextAssets(pendingImportedAssetsRef.current)
      : nextAssets

    pendingImportedAssetsRef.current = resolvedAssets
    setPendingImportedAssets(resolvedAssets)
  }, [setPendingImportedAssets])
  const isLivePlaceholderDocument = useCallback((
    liveMarkdown: string = editorRef.current?.getMarkdown() ?? markdownText,
    livePersistedMarkdown: string = persistedMarkdownRef.current,
  ) => currentFilePath === null
    && isUntouchedUntitledBuffer
    && liveMarkdown === EMPTY_UNTITLED_DOCUMENT
    && livePersistedMarkdown === EMPTY_UNTITLED_DOCUMENT, [currentFilePath, isUntouchedUntitledBuffer, markdownText])
  const isPlaceholderOutline = isPlaceholderDocument || headingOutlineMode === 'placeholder'
  const visibleHeadingOutline = useMemo(
    () => (headingOutlineMode === 'document' ? headingOutline : []),
    [headingOutline, headingOutlineMode],
  )
  const outlineMarkdownText = markdownText
  const displaySegments = useMemo(() => splitMarkdownSegments(outlineMarkdownText), [outlineMarkdownText])
  const previewHeadingLines = useMemo(() => extractMarkdownHeadingLines(outlineMarkdownText), [outlineMarkdownText])

  const setStatusText = (message: string, options?: { toast?: boolean }) => {
    setStatusTextState(message)

    if (options?.toast === false) {
      return
    }

    toastIdRef.current += 1
    const toastId = toastIdRef.current

    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current)
    }

    setActiveToast({ id: toastId, message })
    toastTimerRef.current = window.setTimeout(() => {
      setActiveToast((currentToast) => (currentToast?.id === toastId ? null : currentToast))
      toastTimerRef.current = null
    }, 2600)
  }

  const openAssistantDock = (options?: { focus?: boolean; statusMessage?: string }) => {
    setIsAssistantDockOpen(true)

    if (options?.focus) {
      setAssistantFocusNonce((currentValue) => currentValue + 1)
    }

    if (options?.statusMessage) {
      setStatusText(options.statusMessage)
    }
  }

  const ensureRecoveryKey = () => {
    if (!recoveryKeyRef.current) {
      recoveryKeyRef.current = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
    }

    return recoveryKeyRef.current
  }

  const closeAssistantDock = () => {
    setIsAssistantDockOpen(false)

    const editor = editorRef.current

    if (editor) {
      focusEditorAnchorTarget(getActiveEditorRoot(editor))
    }
  }

  const updateAssistantDockWidthFromClientX = (clientX: number) => {
    const workspaceBody = workspaceBodyRef.current

    if (!workspaceBody) {
      return
    }

    const bounds = workspaceBody.getBoundingClientRect()

    if (bounds.width <= 0) {
      return
    }

    const nextPercent = ((bounds.right - clientX) / bounds.width) * 100
    setAssistantDockWidthPercent(Math.min(
      MAX_ASSISTANT_DOCK_WIDTH_PERCENT,
      Math.max(MIN_ASSISTANT_DOCK_WIDTH_PERCENT, nextPercent),
    ))
  }

  const handleAssistantDockResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    updateAssistantDockWidthFromClientX(event.clientX)
  }

  const handleAssistantDockResizePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      return
    }

    updateAssistantDockWidthFromClientX(event.clientX)
  }

  const handleAssistantDockResizeKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return
    }

    event.preventDefault()
    setAssistantDockWidthPercent((currentWidth) => Math.min(
      MAX_ASSISTANT_DOCK_WIDTH_PERCENT,
      Math.max(
        MIN_ASSISTANT_DOCK_WIDTH_PERCENT,
        currentWidth + (event.key === 'ArrowLeft' ? 2 : -2),
      ),
    ))
  }

  const replaceLoadedDocument = (nextMarkdown: string) => {
    documentInstanceIdRef.current = createDocumentInstanceId()
    setMarkdownText(nextMarkdown)
    setEditorSessionKey((currentKey) => currentKey + 1)
  }

  const updateMarkdownText = (nextMarkdown: string) => {
    if (isUntouchedUntitledBuffer && nextMarkdown !== EMPTY_UNTITLED_DOCUMENT) {
      setIsUntouchedUntitledBuffer(false)
    }

    setMarkdownText(nextMarkdown)
  }

  useEffect(() => () => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.mdvDesktop?.settings.onSettingsChanged((nextSettings) => {
      typographySettingsRef.current = {
        editorFontSizePx: clampEditorFontSizePx(nextSettings.editor.fontSizePx),
        chatFontSizePx: clampChatFontSizePx(nextSettings.ai.chatFontSizePx),
      }
      applyTypographyToRoot(nextSettings)

      if (!isLocale(nextSettings.general.locale) || nextSettings.general.locale === localeRef.current) {
        return
      }

      localeRef.current = nextSettings.general.locale
      const nextTranslations = getTranslations(nextSettings.general.locale)

      if (currentFilePath === null && isUntouchedUntitledBuffer) {
        setDisplayTitle(nextTranslations.app.untitledTitle)
      }
      untitledTitleRef.current = nextTranslations.app.untitledTitle
      setStatusText(nextTranslations.common.ready, { toast: false })
    })

    return () => {
      unsubscribe?.()
    }
  }, [currentFilePath, displayTitle, isUntouchedUntitledBuffer, markdownText, persistedMarkdown])

  useEffect(() => {
    canAbandonCurrentBufferRef.current = (nextActionLabel: string) => {
      const liveMarkdown = editorRef.current?.getMarkdown() ?? markdownText

      if (liveMarkdown === persistedMarkdownRef.current || isLivePlaceholderDocument(liveMarkdown)) {
        return true
      }

      const currentT = i18nRef.current
      return window.confirm(currentT.common.beforeUnloadConfirm(nextActionLabel))
    }
  }, [isLivePlaceholderDocument, markdownText])

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
    currentFilePathRef.current = currentFilePath
  }, [currentFilePath])

  useEffect(() => {
    currentDraftWorkspaceRef.current = currentDraftWorkspace
  }, [currentDraftWorkspace])

  useEffect(() => {
    document.title = `${visibleDisplayTitle} - MDV`
  }, [visibleDisplayTitle])

  useEffect(() => {
    window.mdvDesktop?.debug?.notify('workspace-ready', {
      activePanel,
      displayTitle,
      hasInitialLaunchRequest: bootstrap?.hasInitialLaunchRequest ?? false,
    })
  }, [activePanel, bootstrap?.hasInitialLaunchRequest, displayTitle])

  useLayoutEffect(() => {
    const previewRoot = previewRootRef.current

    if (!previewRoot) {
      return
    }

    let active = true
    const retryTimeouts = new Set<number>()

    const resolvePreviewRelativeImages = async () => {
      const liveRoot = previewRootRef.current

      if (!active || !liveRoot) {
        return
      }

      await resolveRelativeImagesInRoot({
        root: liveRoot,
        selector: 'img[src]',
        contentBaseFilePath,
        cache: previewRelativeImageCacheRef.current,
      })
      syncPreviewImageFallbackState(liveRoot)

      if (!active || !contentBaseFilePath) {
        return
      }

      const hasRemainingRelativeImages = Array.from(liveRoot.querySelectorAll<HTMLImageElement>('img[src]'))
        .some((image) => isRelativeImageSource(image.getAttribute('src')?.trim() || ''))

      if (!hasRemainingRelativeImages) {
        return
      }

      for (const delayMs of [180, 900]) {
        const timeoutId = window.setTimeout(() => {
          retryTimeouts.delete(timeoutId)
          void resolvePreviewRelativeImages()
        }, delayMs)

        retryTimeouts.add(timeoutId)
      }
    }

    const schedulePreviewRelativeImageResolution = () => {
      if (previewRelativeImageResolveFrameRef.current !== null) {
        window.cancelAnimationFrame(previewRelativeImageResolveFrameRef.current)
      }

      previewRelativeImageResolveFrameRef.current = window.requestAnimationFrame(() => {
        previewRelativeImageResolveFrameRef.current = null
        void resolvePreviewRelativeImages()
      })
    }

    const observer = new MutationObserver(schedulePreviewRelativeImageResolution)
    observer.observe(previewRoot, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] })
    schedulePreviewRelativeImageResolution()

    return () => {
      active = false
      observer.disconnect()

      for (const timeoutId of retryTimeouts) {
        window.clearTimeout(timeoutId)
      }
      retryTimeouts.clear()

      if (previewRelativeImageResolveFrameRef.current !== null) {
        window.cancelAnimationFrame(previewRelativeImageResolveFrameRef.current)
        previewRelativeImageResolveFrameRef.current = null
      }
    }
  }, [contentBaseFilePath, markdownText])

  useLayoutEffect(() => {
    const previewRoot = previewRootRef.current

    if (!previewRoot) {
      return
    }

    void resolveRelativeImagesInRoot({
      root: previewRoot,
      selector: 'img[src]',
      contentBaseFilePath,
      cache: previewRelativeImageCacheRef.current,
    })
      .then(() => {
        syncPreviewImageFallbackState(previewRoot)
      })
  })

  useEffect(() => {
    if (!isInitialLaunchOpenSettled || !isStartupRecoveryResolved) {
      return
    }

    window.mdvDesktop?.debug?.notify('workspace-interactive', {
      activePanel,
      currentFilePath,
      hasUnsavedChanges,
      isAssistantDockOpen,
      isPlaceholderDocument,
    })
  }, [activePanel, currentFilePath, hasUnsavedChanges, isAssistantDockOpen, isInitialLaunchOpenSettled, isPlaceholderDocument, isStartupRecoveryResolved])

  useEffect(() => {
    void window.mdvDesktop?.trackCurrentFile(currentFilePath)

    return () => {
      void window.mdvDesktop?.trackCurrentFile(null)
    }
  }, [currentFilePath])

  useEffect(() => {
    const unsubscribe = window.mdvDesktop?.onCurrentFileChanged((event) => {
      void (async () => {
        const trackedPath = currentFilePathRef.current

        if (!trackedPath || event?.path !== trackedPath) {
          return
        }

        const currentName = basename(trackedPath)

        if (!event.exists) {
          setStatusText(t.app.status.localFileMissing(currentName))
          return
        }

        if (hasUnsavedChanges) {
          setStatusText(t.app.status.localFileChangedWhileDirty(currentName))
          return
        }

        let payload: MdvFilePayload | null

        try {
          payload = await window.mdvDesktop?.readFile(trackedPath) ?? null
        } catch {
          setStatusText(t.app.status.localFileMissing(currentName))
          return
        }

        if (!payload) {
          return
        }

        if (currentFilePathRef.current !== trackedPath) {
          return
        }

        if (currentFileSnapshotRef.current && payload.snapshot.contentHash === currentFileSnapshotRef.current.contentHash) {
          return
        }

        loadFilePayloadRef.current(payload)
        setStatusText(t.app.status.reloadedExternalChanges(currentName))
      })()
    })

    return () => {
      unsubscribe?.()
    }
  }, [currentFilePath, hasUnsavedChanges, t])

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
      const isOpenAiReady = Boolean(resolvedSettings?.ai.openai.enabled && providerStatus?.openaiConfigured)
      setIsSemanticSearchAvailable(Boolean(sliceSearchEnabled && isOpenAiReady))
      setIsAiChatAvailable(isOpenAiReady)
    }

    const unsubscribe = window.mdvDesktop?.settings.onSettingsChanged((nextSettings) => {
      void refreshSemanticAvailability(nextSettings)
    })

    void refreshSemanticAvailability().catch(() => {
      if (active) {
        setIsSemanticSearchAvailable(false)
        setIsAiChatAvailable(false)
      }
    })

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    if (!pendingSearchJump) {
      return
    }

    if (activePanel !== 'write') {
      return
    }

    const jumpSpan = pendingSearchJump
    const frameId = window.requestAnimationFrame(() => {
      const editor = editorRef.current

      if (!editor) {
        return
      }

      selectSpanInEditor(editor, jumpSpan)
      setPendingSearchJump(null)
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [activePanel, pendingSearchJump])

  useEffect(() => {
    let active = true
    outlineRequestIdRef.current += 1
    const requestId = outlineRequestIdRef.current
    const nextOutlineMode: 'document' | 'placeholder' = isPlaceholderDocument ? 'placeholder' : 'document'

    const refreshOutline = async () => {
      try {
        const nextOutline = await window.mdvDesktop?.extractMdastHeadingOutline(outlineMarkdownText)

        if (!active || requestId !== outlineRequestIdRef.current) {
          return
        }

        setHeadingOutline(Array.isArray(nextOutline) ? nextOutline : [])
        setHeadingOutlineMode(nextOutlineMode)
      } catch {
        if (active && requestId === outlineRequestIdRef.current) {
          setHeadingOutline([])
          setHeadingOutlineMode(nextOutlineMode)
        }
      }
    }

    const refreshTimer = window.setTimeout(() => {
      void refreshOutline()
    }, 180)

    return () => {
      active = false
      window.clearTimeout(refreshTimer)
    }
  }, [isPlaceholderDocument, outlineMarkdownText])

  const syncActiveOutlineLine = (editor: ToastUiEditor | null = editorRef.current) => {
    if (!editor) {
      setActiveOutlineLine(null)
      return
    }

    setActiveOutlineLine(getEditorSelectionStartLine(editor, markdownText))
  }

  useEffect(() => {
    const editor = editorRef.current

    if (!editor) {
      setActiveOutlineLine(null)
      return
    }

    setActiveOutlineLine(getEditorSelectionStartLine(editor, markdownText))
  }, [markdownText])

  useEffect(() => {
    if (activePanel !== 'preview') {
      return
    }

    const editor = editorRef.current

    if (!editor) {
      setActiveOutlineLine(null)
      return
    }

    setActiveOutlineLine(getEditorSelectionStartLine(editor, markdownText))
  }, [activePanel, markdownText])

  const activeOutlineIndex = useMemo(() => {
    if (isPlaceholderOutline || visibleHeadingOutline.length === 0 || activeOutlineLine === null) {
      return -1
    }

    let nextIndex = -1

    for (let index = 0; index < visibleHeadingOutline.length; index += 1) {
      if (visibleHeadingOutline[index].position.line <= activeOutlineLine) {
        nextIndex = index
        continue
      }

      break
    }

    return nextIndex
  }, [activeOutlineLine, isPlaceholderOutline, visibleHeadingOutline])

  const activePreviewHeadingIndex = useMemo(() => {
    if (isPlaceholderOutline) {
      return -1
    }

    const headings = visibleHeadingOutline.length > 0
      ? visibleHeadingOutline.map((item) => ({ line: item.position.line }))
      : previewHeadingLines

    if (headings.length === 0 || activeOutlineLine === null) {
      return -1
    }

    let nextIndex = -1

    for (let index = 0; index < headings.length; index += 1) {
      if (headings[index].line <= activeOutlineLine) {
        nextIndex = index
        continue
      }

      break
    }

    return nextIndex
  }, [activeOutlineLine, isPlaceholderOutline, previewHeadingLines, visibleHeadingOutline])

  useEffect(() => {
    const container = outlineListRef.current
    const activeItem = activeOutlineItemRef.current

    if (!container || !activeItem) {
      return
    }

    scrollElementIntoContainer(container, activeItem)
  }, [activeOutlineIndex])

  useEffect(() => {
    const previewRoot = previewRootRef.current

    if (activePreviewHeadingRef.current) {
      activePreviewHeadingRef.current.removeAttribute('data-mdv-preview-active')
      activePreviewHeadingRef.current = null
    }

    if (!previewRoot || activePreviewHeadingIndex < 0) {
      return
    }

    const headings = Array.from(previewRoot.querySelectorAll<HTMLElement>('.markdown-fragment h1, .markdown-fragment h2, .markdown-fragment h3, .markdown-fragment h4, .markdown-fragment h5, .markdown-fragment h6'))
    const activeHeading = headings[activePreviewHeadingIndex] ?? null

    if (!activeHeading) {
      return
    }

    activeHeading.setAttribute('data-mdv-preview-active', 'true')
    activePreviewHeadingRef.current = activeHeading

    if (activePanel === 'preview') {
      scrollElementIntoContainer(previewRoot, activeHeading)
    }
  }, [activePanel, activePreviewHeadingIndex, displaySegments])

  const buildClientSnapshot = (): MdvClientSnapshot => ({
    markdownText,
    persistedMarkdown,
    currentFilePath,
    fileSnapshot: currentFileSnapshotRef.current,
    draftWorkspace: currentDraftWorkspace,
    pendingImportedAssets: pendingImportedAssetsRef.current,
    displayTitle,
    activePanel,
    isUntouchedUntitledBuffer,
    recoveryKey: ensureRecoveryKey(),
  })

  const collectReferencedImportedAssetPaths = (markdown: string) => {
    const assetPaths = new Set<string>()
    const expression = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
    let match = expression.exec(markdown)

    while (match) {
      const candidate = typeof match[1] === 'string' ? match[1].trim() : ''

      if (candidate.startsWith('assets/')) {
        assetPaths.add(candidate)
      }

      match = expression.exec(markdown)
    }

    return assetPaths
  }

  const cleanupCurrentDraftWorkspace = async (draftWorkspaceOverride?: MdvDraftWorkspace | null) => {
    const draftWorkspace = draftWorkspaceOverride ?? currentDraftWorkspace

    if (!draftWorkspace) {
      return
    }

    await window.mdvDesktop?.cleanupDraftWorkspace({ draftWorkspace })
    setCurrentDraftWorkspace((currentWorkspace) => {
      if (!currentWorkspace || currentWorkspace.workspaceId !== draftWorkspace.workspaceId) {
        return currentWorkspace
      }

      return null
    })
  }

  const invalidateEditorSearch = () => {
    setEditorSearchResults([])
    setSelectedSearchResultIndex(-1)
    setPendingSearchJump(null)
    setEditorSearchError(null)
    setIsEditorSearchResultsVisible(false)
    setExactEditorSearchScope(null)
  }

  const applyClientSnapshot = (snapshot: MdvClientSnapshot) => {
    invalidateEditorSearch()
    shouldCanonicalizeLoadedBaselineRef.current = snapshot.markdownText === snapshot.persistedMarkdown
    if (typeof snapshot.recoveryKey === 'string' && snapshot.recoveryKey.length > 0) {
      recoveryKeyRef.current = snapshot.recoveryKey
    }
    replaceLoadedDocument(snapshot.markdownText)
    setIsUntouchedUntitledBuffer(false)
    updateCurrentFilePath(snapshot.currentFilePath)
    currentFileSnapshotRef.current = snapshot.fileSnapshot || null
    setCurrentDraftWorkspace(snapshot.draftWorkspace ?? null)
    updatePendingImportedAssets(Array.isArray(snapshot.pendingImportedAssets) ? snapshot.pendingImportedAssets : [])
    setDisplayTitle(snapshot.displayTitle || basename(snapshot.currentFilePath, i18nRef.current.app.untitledTitle))
    setActivePanel(snapshot.activePanel)
    const nextIsUntouchedUntitledBuffer = inferUntouchedUntitledBuffer(snapshot)
    setIsUntouchedUntitledBuffer(nextIsUntouchedUntitledBuffer)
    setHeadingOutline([])
    setHeadingOutlineMode(nextIsUntouchedUntitledBuffer ? 'placeholder' : 'document')
    const nextPersistedMarkdown = typeof snapshot.persistedMarkdown === 'string'
      ? snapshot.persistedMarkdown
      : snapshot.markdownText
    persistedMarkdownRef.current = nextPersistedMarkdown
    setPersistedMarkdown(nextPersistedMarkdown)
  }

  const loadFilePayload = (payload: MdvFilePayload | null) => {
    if (!payload) {
      return
    }

    if (currentDraftWorkspace && !hasUnsavedChanges) {
      void cleanupCurrentDraftWorkspace(currentDraftWorkspace)
    }

    invalidateEditorSearch()
    shouldCanonicalizeLoadedBaselineRef.current = true
    recoveryKeyRef.current = ''
    replaceLoadedDocument(payload.content)
    setIsUntouchedUntitledBuffer(false)
    updateCurrentFilePath(payload.path)
    currentFileSnapshotRef.current = payload.snapshot
    setCurrentDraftWorkspace(null)
    updatePendingImportedAssets([])
    setHeadingOutline([])
    setHeadingOutlineMode('document')
    setDisplayTitle(basename(payload.path))
    persistedMarkdownRef.current = payload.content
    setPersistedMarkdown(payload.content)
    setStatusText(t.app.status.opened(basename(payload.path)))

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const previewRoot = previewRootRef.current

        if (!previewRoot) {
          return
        }

        void resolveRelativeImagesInRoot({
          root: previewRoot,
          selector: 'img[src]',
          contentBaseFilePath: payload.path,
          cache: previewRelativeImageCacheRef.current,
        })
      })
    })
  }

  useEffect(() => {
    loadFilePayloadRef.current = loadFilePayload
  })

  const loadDetachedFile = (fileName: string, content: string) => {
    if (currentDraftWorkspace && !hasUnsavedChanges) {
      void cleanupCurrentDraftWorkspace(currentDraftWorkspace)
    }

    invalidateEditorSearch()
    shouldCanonicalizeLoadedBaselineRef.current = true
    recoveryKeyRef.current = ''
    replaceLoadedDocument(content)
    setIsUntouchedUntitledBuffer(false)
    updateCurrentFilePath(null)
    currentFileSnapshotRef.current = null
    setCurrentDraftWorkspace(null)
    updatePendingImportedAssets([])
    setHeadingOutline([])
    setHeadingOutlineMode('document')
    setDisplayTitle(fileName || i18nRef.current.app.untitledTitle)
    persistedMarkdownRef.current = content
    setPersistedMarkdown(content)
    setStatusText(t.app.status.loaded(fileName || i18nRef.current.app.untitledTitle))
  }

  const handleCopyDocument = async () => {
    try {
      await copyTextToClipboard(markdownText)
      setStatusText(t.app.status.copiedDocument)
    } catch (error) {
      setStatusText(t.app.status.copyFailed(error instanceof Error ? error.message : String(error)))
    }
  }

  const handleCopyRendered = async () => {
    try {
      if (isPlaceholderDocument) {
        await copyTextToClipboard(markdownText)
        setStatusText(t.app.status.copiedRendered)
        return
      }

      await waitForRenderedPreviewReady(previewRootRef.current)
      const previewText = previewRootRef.current?.innerText?.trim() ?? ''
      await copyTextToClipboard(previewText || markdownText)
      setStatusText(t.app.status.copiedRendered)
    } catch (error) {
      setStatusText(t.app.status.copyFailed(error instanceof Error ? error.message : String(error)))
    }
  }

  const handlePrintRendered = async () => {
    try {
      if (!isPlaceholderDocument) {
        await waitForRenderedPreviewReady(previewRootRef.current)
      }

      setStatusText(t.app.status.openedPrintDialog)
      window.print()
    } catch (error) {
      setStatusText(t.app.status.printFailed(error instanceof Error ? error.message : String(error)))
    }
  }

  const handleExportHtml = async () => {
    try {
      const previewHtml = isPlaceholderDocument
        ? ''
        : await (async () => {
          await waitForRenderedPreviewReady(previewRootRef.current)
          return inlineRelativeImagesForExport(previewRootRef.current, {
            currentFilePath,
            requireSavedFileMessage: t.app.exportRequiresSavedFileForRelativeImages,
            inlineFailedMessage: t.app.exportInlineImageFailed,
          })
        })()
      const result = await window.mdvDesktop?.exportHtml({
        content: buildExportHtmlDocument(displayTitle, previewHtml),
        defaultFileName: buildHtmlExportFileName(currentFilePath, displayTitle, t.app.untitledTitle),
      })

      if (!result) {
        return
      }

      setStatusText(t.app.status.exportedHtml(basename(result.path)))
    } catch (error) {
      setStatusText(t.app.status.exportHtmlFailed(error instanceof Error ? error.message : String(error)))
    }
  }

  const buildLiveClientSnapshot = (): MdvClientSnapshot => {
    const liveMarkdown = editorRef.current?.getMarkdown() ?? markdownText

    return {
      markdownText: liveMarkdown,
      persistedMarkdown: persistedMarkdownRef.current,
      currentFilePath,
      fileSnapshot: currentFileSnapshotRef.current,
      draftWorkspace: currentDraftWorkspace,
      pendingImportedAssets: pendingImportedAssetsRef.current,
      displayTitle,
      activePanel,
      isUntouchedUntitledBuffer,
      recoveryKey: ensureRecoveryKey(),
    }
  }

  useEffect(() => {
    let active = true

    if (!isStartupRecoveryResolved) {
      return () => {
        active = false
      }
    }

    const requestedWorkspaceId = ensureRecoveryKey()

    if (currentFilePath !== null) {
      return () => {
        active = false
      }
    }

    if (currentDraftWorkspace) {
      return () => {
        active = false
      }
    }

    void window.mdvDesktop?.ensureDraftWorkspace({ workspaceId: requestedWorkspaceId }).then((workspace) => {
      if (!active || !workspace || currentFilePathRef.current !== null || recoveryKeyRef.current !== requestedWorkspaceId) {
        return
      }

      setCurrentDraftWorkspace(workspace)
    })

    return () => {
      active = false
    }
  }, [currentDraftWorkspace, currentFilePath, isStartupRecoveryResolved])

  const clearAutosaveRecovery = async (payload?: { recoveryKey?: string | null; filePath?: string | null }) => {
    await window.mdvDesktop?.clearAutosaveRecovery(payload ?? {
      recoveryKey: lastAutosaveRecoveryStorageKeyRef.current,
      filePath: currentFilePathRef.current,
    })
    lastAutosaveRecoveryStorageKeyRef.current = null
    lastAutosaveSignatureRef.current = null
  }

  const confirmUnsavedChangesBeforeProceed = async (proceedLabel: string) => {
    const liveMarkdown = editorRef.current?.getMarkdown() ?? markdownText

    if (liveMarkdown === persistedMarkdownRef.current || isLivePlaceholderDocument(liveMarkdown)) {
      return true
    }

    const result = await window.mdvDesktop?.confirmUnsavedChanges({
      currentFilePath,
      displayTitle,
      proceedLabel,
    })

    if (!result || result.action === 'cancel') {
      return false
    }

    if (result.action === 'save') {
      return handleSaveRef.current(false)
    }

    const currentPendingImportedAssets = pendingImportedAssetsRef.current

    if (currentPendingImportedAssets.length > 0) {
      await window.mdvDesktop?.cleanupImportedAssets({ filePaths: currentPendingImportedAssets.map((asset) => asset.filePath) })
      updatePendingImportedAssets([])
    }

    if (currentDraftWorkspace) {
      await window.mdvDesktop?.cleanupDraftWorkspace({ draftWorkspace: currentDraftWorkspace })
      setCurrentDraftWorkspace(null)
    }

    await clearAutosaveRecovery()

    return true
  }

  useEffect(() => {
    confirmUnsavedChangesBeforeProceedRef.current = confirmUnsavedChangesBeforeProceed
  })

  const handleOpen = async () => {
    if (!await confirmUnsavedChangesBeforeProceed(t.common.open)) {
      setStatusText(t.app.status.openCancelled)
      return
    }

    const payload = await window.mdvDesktop?.openFile()
    loadFilePayload(payload ?? null)
  }

  const handleReloadCurrentFile = async () => {
    const trackedPath = currentFilePathRef.current

    if (!trackedPath) {
      setStatusText(t.app.status.noFileToReload)
      return
    }

    const currentName = basename(trackedPath)
    const liveMarkdown = editorRef.current?.getMarkdown() ?? markdownText

    if (liveMarkdown !== persistedMarkdownRef.current) {
      setStatusText(t.app.status.reloadBlockedByUnsavedChanges(currentName))
      return
    }

    let payload: MdvFilePayload | null

    try {
      payload = await window.mdvDesktop?.readFile(trackedPath) ?? null
    } catch (error) {
      setStatusText(t.app.status.reloadFileFailed(error instanceof Error ? error.message : String(error)))
      return
    }

    if (!payload || currentFilePathRef.current !== trackedPath) {
      return
    }

    if (currentFileSnapshotRef.current && payload.snapshot.contentHash === currentFileSnapshotRef.current.contentHash) {
      currentFileSnapshotRef.current = payload.snapshot
      setStatusText(t.app.status.reloadFileUnchanged(currentName))
      return
    }

    loadFilePayloadRef.current(payload)
    setStatusText(t.app.status.reloadedFile(currentName))
  }

  const handleCreateNewDocument = async () => {
    if (window.mdvDesktop?.newDocumentWindow) {
      const result = await window.mdvDesktop.newDocumentWindow()

      if (result?.status === 'opened') {
        return
      }
    }

    if (!await confirmUnsavedChangesBeforeProceed(t.app.createNewDocument)) {
      setStatusText(t.app.status.newDocumentCancelled)
      return
    }

    const currentPendingImportedAssets = pendingImportedAssetsRef.current

    if (currentPendingImportedAssets.length > 0) {
      await window.mdvDesktop?.cleanupImportedAssets({ filePaths: currentPendingImportedAssets.map((asset) => asset.filePath) })
    }

    if (currentDraftWorkspace) {
      await window.mdvDesktop?.cleanupDraftWorkspace({ draftWorkspace: currentDraftWorkspace })
    }

    await clearAutosaveRecovery()

    invalidateEditorSearch()
    shouldCanonicalizeLoadedBaselineRef.current = true
    recoveryKeyRef.current = ''
    replaceLoadedDocument(EMPTY_UNTITLED_DOCUMENT)
    setIsUntouchedUntitledBuffer(true)
    updateCurrentFilePath(null)
    currentFileSnapshotRef.current = null
    setCurrentDraftWorkspace(null)
    updatePendingImportedAssets([])
    setHeadingOutline([])
    setHeadingOutlineMode('placeholder')
    setDisplayTitle(i18nRef.current.app.untitledTitle)
    persistedMarkdownRef.current = EMPTY_UNTITLED_DOCUMENT
    setPersistedMarkdown(EMPTY_UNTITLED_DOCUMENT)
    setActivePanel('write')
    setStatusText(t.app.status.createdNewDocument)
  }

  const handleSave = async (forceDialog = false) => {
    try {
      const liveMarkdown = editorRef.current?.getMarkdown() ?? markdownText
      const previousFilePath = currentFilePath
      let draftWorkspace = currentDraftWorkspace

      if (!currentFilePath && !draftWorkspace) {
        const recovery = await window.mdvDesktop?.getLatestAutosaveRecovery()
        const recoverySnapshot = recovery?.snapshot
        const matchesCurrentBuffer = recoverySnapshot
          && !recoverySnapshot.currentFilePath
          && recoverySnapshot.markdownText === liveMarkdown
          && recoverySnapshot.recoveryKey === recoveryKeyRef.current

        if (matchesCurrentBuffer && recoverySnapshot.draftWorkspace) {
          draftWorkspace = recoverySnapshot.draftWorkspace
          setCurrentDraftWorkspace(recoverySnapshot.draftWorkspace)
        }
      }

      const currentPendingImportedAssets = pendingImportedAssetsRef.current
      const result = await window.mdvDesktop?.saveFile({
        path: currentFilePath,
        content: liveMarkdown,
        forceDialog,
        recoveryKey: currentFilePath ? null : recoveryKeyRef.current,
        defaultFileName: displayTitle,
        displayTitle,
        expectedSnapshot: currentFileSnapshotRef.current,
        baseContent: persistedMarkdownRef.current,
        draftWorkspace,
        pendingImportedAssets: currentPendingImportedAssets,
      })

      if (!result || result.status === 'cancelled') {
        return false
      }

      if (result.status === 'merge-failed') {
        setStatusText(t.app.status.mergeSaveFailed(result.message))
        return false
      }

      invalidateEditorSearch()
      updateCurrentFilePath(result.path)
      currentFileSnapshotRef.current = result.snapshot
      setCurrentDraftWorkspace(null)
      const referencedImportedAssets = collectReferencedImportedAssetPaths(result.content)
      const abandonedImportedAssets = currentPendingImportedAssets
        .filter((asset) => !referencedImportedAssets.has(asset.relativePath))

      if (abandonedImportedAssets.length > 0) {
        await window.mdvDesktop?.cleanupImportedAssets({
          filePaths: abandonedImportedAssets.map((asset) => asset.filePath),
        })
      }

      if (previousFilePath && previousFilePath !== result.path && currentPendingImportedAssets.length > 0) {
        await window.mdvDesktop?.cleanupImportedAssets({
          filePaths: currentPendingImportedAssets.map((asset) => asset.filePath),
        })
      }

      if (!previousFilePath && draftWorkspace) {
        await cleanupCurrentDraftWorkspace(draftWorkspace)
      }

      updatePendingImportedAssets([])
      setIsUntouchedUntitledBuffer(false)
      setDisplayTitle(basename(result.path))
      if (result.content !== liveMarkdown) {
        updateMarkdownText(result.content)
        editorRef.current?.setMarkdown(result.content)
      }
      persistedMarkdownRef.current = result.content
      setPersistedMarkdown(result.content)
      await clearAutosaveRecovery({ recoveryKey: lastAutosaveRecoveryStorageKeyRef.current, filePath: previousFilePath })
      if (previousFilePath !== result.path) {
        await clearAutosaveRecovery({ filePath: result.path })
      }
      setStatusText(t.app.status.saved(basename(result.path)))
      return true
    } catch (error) {
      setStatusText(t.app.status.saveFailed(error instanceof Error ? error.message : String(error)))
      return false
    }
  }

  useEffect(() => {
    handleSaveRef.current = handleSave
  })

  useEffect(() => {
    if (isPlaceholderDocument || !hasUnsavedChanges) {
      void clearAutosaveRecovery({
        recoveryKey: lastAutosaveRecoveryStorageKeyRef.current,
      })
      return
    }

    const autosaveTimer = window.setTimeout(() => {
      const snapshot = buildLiveClientSnapshotRef.current()
      const signature = `${snapshot.currentFilePath ?? ''}\u0000${snapshot.markdownText}\u0000${snapshot.persistedMarkdown}\u0000${snapshot.draftWorkspace?.workspaceId ?? ''}\u0000${snapshot.pendingImportedAssets?.map((asset) => asset.filePath).join('|') ?? ''}`

      if (lastAutosaveSignatureRef.current === signature) {
        return
      }

      void window.mdvDesktop?.autosaveRecoveryUpsert({ snapshot }).then((result) => {
        if (!result) {
          return
        }

        handledRecoveryKeysRef.current.delete(result.recoveryKey)
        lastAutosaveRecoveryStorageKeyRef.current = result.recoveryKey
        lastAutosaveSignatureRef.current = signature
      })
    }, 1200)

    return () => {
      window.clearTimeout(autosaveTimer)
    }
  }, [currentFilePath, currentDraftWorkspace, pendingImportedAssets, displayTitle, activePanel, markdownText, hasUnsavedChanges, isPlaceholderDocument])

  useEffect(() => {
    let active = true

    const maybeRestoreStartupRecovery = async () => {
      if (!isInitialLaunchOpenSettled) {
        return
      }

      if (currentFilePath !== null || !isPlaceholderDocument) {
        if (active) {
          setIsStartupRecoveryResolved(true)
        }
        return
      }

      const startupRecoveryDelayMs = window.mdvDesktop?.e2e?.startupRecoveryDelayMs ?? 0

      if (startupRecoveryDelayMs > 0) {
        await waitForDelay(startupRecoveryDelayMs)
      }

      if (!active) {
        return
      }

      const recovery = await window.mdvDesktop?.getLatestAutosaveRecovery()

      if (!active || !recovery || recovery.snapshot.currentFilePath || handledRecoveryKeysRef.current.has(recovery.recoveryKey)) {
        if (active) {
          setIsStartupRecoveryResolved(true)
        }
        return
      }

      handledRecoveryKeysRef.current.add(recovery.recoveryKey)
      const recoveryName = recovery.snapshot.currentFilePath
        ? basename(recovery.snapshot.currentFilePath)
        : recovery.snapshot.displayTitle

      const recoveryPromptMode = window.mdvDesktop?.e2e?.recoveryPromptMode ?? 'interactive'
      const shouldRestoreRecovery = recoveryPromptMode === 'accept'
        ? true
        : recoveryPromptMode === 'decline'
          ? false
          : window.confirm(t.app.recoveryRestorePrompt(recoveryName))

      if (!shouldRestoreRecovery) {
        if (recovery.snapshot.pendingImportedAssets?.length) {
          await window.mdvDesktop?.cleanupImportedAssets({
            filePaths: recovery.snapshot.pendingImportedAssets.map((asset) => asset.filePath),
          })
        }
        if (recovery.snapshot.draftWorkspace) {
          await window.mdvDesktop?.cleanupDraftWorkspace({ draftWorkspace: recovery.snapshot.draftWorkspace })
        }
        await clearAutosaveRecovery({ recoveryKey: recovery.recoveryKey, filePath: recovery.snapshot.currentFilePath })
        setStatusText(t.app.status.discardedRecovery)
        if (active) {
          setIsStartupRecoveryResolved(true)
        }
        return
      }

      applyClientSnapshotRef.current(recovery.snapshot)
      lastAutosaveRecoveryStorageKeyRef.current = recovery.recoveryKey
      lastAutosaveSignatureRef.current = null
      setStatusText(t.app.status.restoredRecovery(recoveryName))
      if (active) {
        setIsStartupRecoveryResolved(true)
      }
    }

    void maybeRestoreStartupRecovery()

    return () => {
      active = false
    }
  }, [currentFilePath, isInitialLaunchOpenSettled, isPlaceholderDocument, t])

  useEffect(() => {
    let active = true

    const maybeRestoreFileRecovery = async () => {
      if (!currentFilePath || hasUnsavedChanges) {
        return
      }

      const recovery = await window.mdvDesktop?.getAutosaveRecoveryForFile(currentFilePath)

      if (!active || !recovery || handledRecoveryKeysRef.current.has(recovery.recoveryKey)) {
        return
      }

      if (recovery.snapshot.markdownText === persistedMarkdownRef.current) {
        handledRecoveryKeysRef.current.add(recovery.recoveryKey)
        await clearAutosaveRecovery({ recoveryKey: recovery.recoveryKey, filePath: currentFilePath })
        return
      }

      handledRecoveryKeysRef.current.add(recovery.recoveryKey)
      const recoveryName = basename(currentFilePath)
      const recoveryPromptMode = window.mdvDesktop?.e2e?.recoveryPromptMode ?? 'interactive'
      const shouldRestoreRecovery = recoveryPromptMode === 'accept'
        ? true
        : recoveryPromptMode === 'decline'
          ? false
          : window.confirm(t.app.recoveryRestorePrompt(recoveryName))

      if (!shouldRestoreRecovery) {
        if (recovery.snapshot.pendingImportedAssets?.length) {
          await window.mdvDesktop?.cleanupImportedAssets({
            filePaths: recovery.snapshot.pendingImportedAssets.map((asset) => asset.filePath),
          })
        }
        if (recovery.snapshot.draftWorkspace) {
          await window.mdvDesktop?.cleanupDraftWorkspace({ draftWorkspace: recovery.snapshot.draftWorkspace })
        }
        await clearAutosaveRecovery({ recoveryKey: recovery.recoveryKey, filePath: currentFilePath })
        setStatusText(t.app.status.discardedRecovery)
        return
      }

      applyClientSnapshotRef.current(recovery.snapshot)
      lastAutosaveRecoveryStorageKeyRef.current = recovery.recoveryKey
      lastAutosaveSignatureRef.current = null
      setStatusText(t.app.status.restoredRecovery(recoveryName))
    }

    void maybeRestoreFileRecovery()

    return () => {
      active = false
    }
  }, [currentFilePath, hasUnsavedChanges, t])

  const applyMarkdownContent = (nextMarkdown: string, statusMessage: string) => {
    invalidateEditorSearch()
    updateMarkdownText(nextMarkdown)
    editorRef.current?.setMarkdown(nextMarkdown)
    setStatusText(statusMessage)
  }

  const applyMarkdownInsertCommand = (command: MarkdownInsertCommand, commandLabel: string) => {
    const editor = editorRef.current

    if (!editor) {
      return
    }

    const liveMarkdown = editor.getMarkdown()
    const selection = normalizeSelectionToMarkdownSpan(editor, liveMarkdown)
    const result = runMarkdownInsertCommand(command, liveMarkdown, selection)

    if (result.nextMarkdown === liveMarkdown && result.didFindTarget === false) {
      setStatusText(t.app.status.markdownCommandNoTarget(commandLabel))
      return
    }

    invalidateEditorSearch()
    updateMarkdownText(result.nextMarkdown)
    if (command === 'footnote' && editor.isWysiwygMode()) {
      editor.changeMode('markdown', true)
    }
    editor.setMarkdown(result.nextMarkdown)
    setPendingSearchJump(result.selection)
    setActivePanel('write')
    setStatusText(t.app.status.insertedMarkdownCommand(commandLabel))
  }

  const importImageIntoEditor = async (payload: {
    file?: File | null
    nativePath?: string | null
    createdBy: 'paste' | 'drop'
  }) => {
    const editor = editorRef.current

    if (!editor || !payload.file) {
      return false
    }

    try {
      const bytesBase64 = bytesToBase64(new Uint8Array(await payload.file.arrayBuffer()))
      const dataUrl = `data:${getImageMimeType(payload.file)};base64,${bytesBase64}`

      const liveMarkdown = editor.getMarkdown()
      const selection = normalizeSelectionToMarkdownSpan(editor, liveMarkdown)
      const imageResult = insertImportedImageMarkdown(liveMarkdown, selection, dataUrl, payload.file.name || 'image')

      invalidateEditorSearch()
      updateMarkdownText(imageResult.nextMarkdown)
      editor.setMarkdown(imageResult.nextMarkdown)
      setPendingSearchJump(imageResult.selection)
      setActivePanel('write')
      setStatusText(t.app.status.insertedImageAsset(payload.file.name || 'image'))
      return true
    } catch (error) {
      setStatusText(t.app.status.imageImportFailed(error instanceof Error ? error.message : String(error)))
      return false
    }
  }

  const focusEditorSearch = () => {
    setEditorSearchDialogMode('search')
    setIsEditorSearchDialogOpen(true)
    setActivePanel('write')
    setStatusText(t.app.status.focusedEditorSearch)
  }

  const openEditorReplaceDialog = () => {
    invalidateEditorSearch()
    setEditorSearchMode('exact')
    setEditorSearchDialogMode('replace')
    setIsEditorSearchDialogOpen(true)
    setActivePanel('write')
    setStatusText(t.app.status.focusedEditorSearch)
  }

  const closeEditorSearchDialog = () => {
    setIsEditorSearchDialogOpen(false)
  }

  useEffect(() => {
    if (!isEditorSearchDialogOpen) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [isEditorSearchDialogOpen, editorSearchDialogMode])

  useEffect(() => {
    focusEditorSearchRef.current = focusEditorSearch
    openEditorReplaceDialogRef.current = openEditorReplaceDialog
    i18nRef.current = t
  })

  const jumpToEditorSearchResult = (result: EditorSearchResult, index: number, total = editorSearchResults.length) => {
    setSelectedSearchResultIndex(index)
    setPendingSearchJump(result.span)
    setActivePanel('write')
    setStatusText(t.app.status.jumpedToSearchResult(index + 1, Math.max(total, index + 1)))
  }

  const jumpToOutlineHeading = (item: MdvMdastHeadingOutlineItem) => {
    const headingLabel = getOutlineHeadingLabel(item, t.app.outlineUntitledHeading)
    setPendingSearchJump({
      start: item.position,
      end: item.position,
      isEmpty: true,
    })
    setActivePanel('write')
    setStatusText(t.app.status.jumpedToOutlineHeading(headingLabel))
  }

  const resolvedEditorSearchMode = editorSearchMode === 'semantic' && !isSemanticSearchAvailable ? 'exact' : editorSearchMode
  const isResolvedEditorSearchAvailable = resolvedEditorSearchMode === 'exact' ? true : isSemanticSearchAvailable
  const isReplaceDialog = editorSearchDialogMode === 'replace'
  const exactEditorSearchOptions: ExactEditorSearchOptions = {
    matchCase: isEditorSearchMatchCase,
    useRegexp: isEditorSearchRegexp,
    inSelection: isEditorSearchInSelection,
  }

  const applyEditorSearchState = (
    nextResults: EditorSearchResult[],
    nextSelectedIndex: number,
    options?: {
      error?: string | null
      visible?: boolean
      jump?: boolean
    },
  ) => {
    setEditorSearchResults(nextResults)
    setSelectedSearchResultIndex(nextSelectedIndex)
    setEditorSearchError(options?.error ?? null)
    setIsEditorSearchResultsVisible(options?.visible ?? (nextResults.length > 0 || Boolean(options?.error)))

    if (options?.jump && nextSelectedIndex >= 0 && nextSelectedIndex < nextResults.length) {
      const result = nextResults[nextSelectedIndex]
      setPendingSearchJump(result.span)
      setActivePanel('write')
      return
    }

    setPendingSearchJump(null)
  }

  const runLocalExactEditorSearch = (sourceMarkdown: string, scopeOverride?: ExactEditorSearchScope | null) => {
    return runExactEditorSearch(sourceMarkdown, editorRef.current, editorSearchQuery, exactEditorSearchOptions, scopeOverride)
  }

  const handleRunEditorSearch = async () => {
    const query = resolvedEditorSearchMode === 'semantic' ? editorSearchQuery.trim() : editorSearchQuery

    if (query.length === 0) {
      applyEditorSearchState([], -1, { visible: false })
      setStatusText(t.app.status.clearedEditorSearch)
      return
    }

    setIsRunningEditorSearch(true)
    setEditorSearchError(null)

    try {
      if (resolvedEditorSearchMode === 'exact') {
        const execution = runLocalExactEditorSearch(markdownText)
        const { results } = execution

        setExactEditorSearchScope(execution.scope)

        applyEditorSearchState(results, results.length > 0 ? 0 : -1, { visible: results.length > 0 })

        if (results.length > 0) {
          jumpToEditorSearchResult(results[0], 0, results.length)
        } else {
          setStatusText(t.app.status.noExactMatches(query))
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

      applyEditorSearchState(results, results.length > 0 ? 0 : -1, { visible: results.length > 0 })

      if (results.length > 0) {
        jumpToEditorSearchResult(results[0], 0, results.length)
      } else {
        setStatusText(t.app.status.noSemanticMatches(query))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      applyEditorSearchState([], -1, { error: message, visible: true })
      setStatusText(t.app.status.searchFailed(message))
    } finally {
      setIsRunningEditorSearch(false)
    }
  }

  const handleReplaceCurrentEditorSearchResult = () => {
    try {
      const query = editorSearchQuery

      if (resolvedEditorSearchMode !== 'exact' || query.length === 0) {
        return
      }

      const execution = runLocalExactEditorSearch(markdownText, exactEditorSearchScope)
      const { results } = execution

      setExactEditorSearchScope(execution.scope)

      if (results.length === 0) {
        applyEditorSearchState([], -1, { visible: false })
        setStatusText(t.app.status.noExactMatches(query))
        return
      }

      const targetIndex = selectedSearchResultIndex >= 0 && selectedSearchResultIndex < results.length
        ? selectedSearchResultIndex
        : 0
      const targetResult = results[targetIndex]
      const startOffset = markdownPosToOffset(markdownText, targetResult.span.start)
      const endOffset = markdownPosToOffset(markdownText, targetResult.span.end)
      const replacementText = isEditorSearchRegexp
        ? markdownText.slice(startOffset, endOffset).replace(
          new RegExp(query, isEditorSearchMatchCase ? '' : 'i'),
          editorSearchReplacement,
        )
        : editorSearchReplacement
      const nextMarkdown = replaceOffsets(markdownText, startOffset, endOffset, replacementText)
      const nextScope = execution.scope.endOffset >= endOffset
        ? {
          startOffset: execution.scope.startOffset,
          endOffset: execution.scope.endOffset + (replacementText.length - (endOffset - startOffset)),
        }
        : execution.scope
      const nextSearch = runLocalExactEditorSearch(nextMarkdown, nextScope)
      const nextIndex = nextSearch.results.length === 0 ? -1 : Math.min(targetIndex, nextSearch.results.length - 1)

      updateMarkdownText(nextMarkdown)
      editorRef.current?.setMarkdown(nextMarkdown)
      setExactEditorSearchScope(nextScope)
      applyEditorSearchState(nextSearch.results, nextIndex, {
        visible: nextSearch.results.length > 0,
        jump: nextIndex >= 0,
      })
      setStatusText(t.app.status.replacedSearchResult(targetIndex + 1, results.length))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      applyEditorSearchState([], -1, { error: message, visible: true })
      setStatusText(t.app.status.replaceFailed(message))
    }
  }

  const handleReplaceAllEditorSearchResults = () => {
    try {
      const query = editorSearchQuery

      if (resolvedEditorSearchMode !== 'exact' || query.length === 0) {
        return
      }

      const execution = runLocalExactEditorSearch(markdownText, exactEditorSearchScope)

      setExactEditorSearchScope(execution.scope)

      if (execution.results.length === 0) {
        applyEditorSearchState([], -1, { visible: false })
        setStatusText(t.app.status.noExactMatches(query))
        return
      }

      let nextMarkdown = markdownText

      if (isEditorSearchRegexp) {
        const scopedText = markdownText.slice(execution.scope.startOffset, execution.scope.endOffset)
        const replacedScopedText = scopedText.replace(
          buildExactSearchExpression(query, exactEditorSearchOptions),
          editorSearchReplacement,
        )
        nextMarkdown = replaceOffsets(markdownText, execution.scope.startOffset, execution.scope.endOffset, replacedScopedText)
      } else {
        for (let index = execution.results.length - 1; index >= 0; index -= 1) {
          const result = execution.results[index]
          const startOffset = markdownPosToOffset(nextMarkdown, result.span.start)
          const endOffset = markdownPosToOffset(nextMarkdown, result.span.end)
          nextMarkdown = replaceOffsets(nextMarkdown, startOffset, endOffset, editorSearchReplacement)
        }
      }

      updateMarkdownText(nextMarkdown)
      editorRef.current?.setMarkdown(nextMarkdown)
      applyEditorSearchState([], -1, { visible: false })
      setStatusText(t.app.status.replacedAllSearchResults(execution.results.length))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      applyEditorSearchState([], -1, { error: message, visible: true })
      setStatusText(t.app.status.replaceFailed(message))
    }
  }

  const hideEditorSearchResults = () => {
    setIsEditorSearchResultsVisible(false)
    setStatusText(t.app.status.searchResultsHidden)
  }

  const showEditorSearchResults = () => {
    if (!editorSearchError && editorSearchResults.length === 0) {
      return
    }

    setIsEditorSearchResultsVisible(true)
    setStatusText(t.app.status.searchResultsShown)
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
          `Path: ${currentFilePath ?? i18nRef.current.app.untitledPath}`,
          `Panel: ${activePanel}`,
          `Text length: ${markdownText.length}`,
          `Selection length: ${selectedText.length}`,
          `Dirty: ${markdownText !== persistedMarkdown ? 'yes' : 'no'}`,
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
            isDirty: markdownText !== persistedMarkdown,
          },
        })
        return
      }

      if (request.type === 'get-close-state') {
        const snapshot = buildLiveClientSnapshot()
        window.mdvDesktop?.sendAiEditorResponse({
          requestId: request.requestId,
          ok: true,
          payload: {
            snapshot,
            isDirty: snapshot.markdownText !== snapshot.persistedMarkdown && !isLivePlaceholderDocument(snapshot.markdownText, snapshot.persistedMarkdown),
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
        const responseText = request.publicDisplay === true
          ? abbreviateInlineDataImageMarkdownSlice(markdownText, resolvedOffsets.startOffset, finalEndOffset)
          : nextText

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
            text: responseText,
            estimatedTokens: estimateTokenCount(responseText),
            truncated,
            nextCursor: truncated
              ? { after: offsetToMarkdownPos(markdownText, finalEndOffset) }
              : null,
          },
        })
        return
      }

      if (request.type === 'capture-change-proposal') {
        const liveMarkdown = editorRef.current?.getMarkdown() ?? markdownText
        const resolvedOffsets = resolveSpanToOffsets(liveMarkdown, editorRef.current, request.destination.span)
        const insertionOffsets = request.mode === 'insert'
          ? {
              startOffset: resolvedOffsets.startOffset,
              endOffset: resolvedOffsets.startOffset,
            }
          : request.mode === 'append'
            ? {
                startOffset: resolvedOffsets.endOffset,
                endOffset: resolvedOffsets.endOffset,
              }
            : resolvedOffsets
        const proposedMarkdown = `${liveMarkdown.slice(0, insertionOffsets.startOffset)}${request.content}${liveMarkdown.slice(insertionOffsets.endOffset)}`

        window.mdvDesktop?.sendAiEditorResponse({
          requestId: request.requestId,
          ok: true,
          payload: {
            proposalId: request.proposalId,
            editorId: request.destination.editorId,
            documentIdentity: {
              instanceId: documentInstanceIdRef.current,
              currentFilePath: currentFilePathRef.current,
            },
            title: displayTitle,
            baselineMarkdown: liveMarkdown,
            proposedMarkdown,
            replacedSpan: normalizeOffsetsToSpan(liveMarkdown, insertionOffsets.startOffset, insertionOffsets.endOffset),
            span: normalizeOffsetsToSpan(proposedMarkdown, insertionOffsets.startOffset, insertionOffsets.startOffset + request.content.length),
            mode: request.mode,
            wouldWriteBytes: new TextEncoder().encode(request.content).length,
          },
        })
        return
      }

      if (request.type === 'apply-change-proposal') {
        const liveMarkdown = editorRef.current?.getMarkdown() ?? markdownText
        const hasMatchingIdentity = documentInstanceIdRef.current === request.expectedDocumentIdentity.instanceId
          && currentFilePathRef.current === request.expectedDocumentIdentity.currentFilePath

        if (!hasMatchingIdentity || liveMarkdown !== request.expectedBaselineMarkdown) {
          window.mdvDesktop?.sendAiEditorResponse({
            requestId: request.requestId,
            ok: true,
            payload: {
              proposalId: request.proposalId,
              editorId: request.editorId,
              status: 'stale',
              reason: hasMatchingIdentity ? 'baseline-changed' : 'document-identity-changed',
            },
          })
          return
        }

        shouldCanonicalizeLoadedBaselineRef.current = false
        applyMarkdownContent(request.nextMarkdown, i18nRef.current.app.status.aiChangeProposalApplied)
        window.mdvDesktop?.sendAiEditorResponse({
          requestId: request.requestId,
          ok: true,
          payload: {
            proposalId: request.proposalId,
            editorId: request.editorId,
            status: 'applied',
            bytesWritten: new TextEncoder().encode(request.nextMarkdown).length,
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
          : request.mode === 'append'
            ? {
                startOffset: resolvedOffsets.endOffset,
                endOffset: resolvedOffsets.endOffset,
              }
          : resolvedOffsets
        const updatedMarkdown = `${markdownText.slice(0, insertionOffsets.startOffset)}${nextText}${markdownText.slice(insertionOffsets.endOffset)}`

        if (typeof request.title === 'string' && request.title.trim().length > 0) {
          setDisplayTitle(request.title.trim())
        }

        shouldCanonicalizeLoadedBaselineRef.current = false
        applyMarkdownContent(updatedMarkdown, request.mode === 'replace' ? i18nRef.current.app.status.aiUpdatedDocument : i18nRef.current.app.status.aiInsertedContent)

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

  useEffect(() => {
    buildClientSnapshotRef.current = buildClientSnapshot
    buildLiveClientSnapshotRef.current = buildLiveClientSnapshot
    applyClientSnapshotRef.current = applyClientSnapshot
    respondToAiEditorRequestRef.current = respondToAiEditorRequest
  })

  const completeChangeProposalReview = (resolution: MdvAiChangeProposalResolution) => {
    if (activeChangeProposalIdRef.current !== resolution.proposalId) {
      return
    }

    activeChangeProposalIdRef.current = null
    setChangeProposalReview(null)

    if (resolution.status === 'applied') {
      setStatusText(t.app.status.aiChangeProposalApplied)
    } else if (resolution.status === 'cancelled') {
      setStatusText(t.app.status.aiChangeProposalCancelled)
    } else if (resolution.status === 'stale') {
      setStatusText(t.app.status.aiChangeProposalStale)
    } else if (resolution.status === 'indeterminate') {
      setStatusText(t.app.status.aiChangeProposalIndeterminate)
    } else {
      setStatusText(t.app.status.aiChangeProposalInvalidated)
    }
  }

  const toggleChangeProposalHunk = (hunkId: string) => {
    setChangeProposalReview((current) => {
      if (!current?.proposal || current.resolvingAction) {
        return current
      }

      const acceptedHunkIds = new Set(current.acceptedHunkIds)
      if (acceptedHunkIds.has(hunkId)) {
        acceptedHunkIds.delete(hunkId)
      } else {
        acceptedHunkIds.add(hunkId)
      }

      return {
        ...current,
        acceptedHunkIds,
        error: null,
      }
    })
  }

  const applySelectedChangeProposalHunks = async () => {
    const review = changeProposalReview
    if (!review?.proposal || review.resolvingAction || review.acceptedHunkIds.size === 0) {
      return
    }

    setChangeProposalReview((current) => current?.summary.proposalId === review.summary.proposalId
      ? { ...current, resolvingAction: 'apply', error: null }
      : current)

    try {
      const resolution = await window.mdvDesktop?.applyAiChangeProposal({
        proposalId: review.summary.proposalId,
        selectedHunkIds: Array.from(review.acceptedHunkIds),
      })

      if (!resolution) {
        throw new Error(t.app.status.aiChangeProposalResolutionUnconfirmed)
      }
      completeChangeProposalReview(resolution)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setChangeProposalReview((current) => current?.summary.proposalId === review.summary.proposalId
        ? { ...current, resolvingAction: null, error: message }
        : current)
      setStatusText(t.app.status.aiChangeProposalActionFailed(message))
    }
  }

  const cancelChangeProposal = async () => {
    const review = changeProposalReview
    if (!review || review.resolvingAction) {
      return
    }

    setChangeProposalReview((current) => current?.summary.proposalId === review.summary.proposalId
      ? { ...current, resolvingAction: 'cancel', error: null }
      : current)

    try {
      const resolution = await window.mdvDesktop?.cancelAiChangeProposal({
        proposalId: review.summary.proposalId,
      })

      if (!resolution) {
        throw new Error(t.app.status.aiChangeProposalResolutionUnconfirmed)
      }
      completeChangeProposalReview(resolution)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setChangeProposalReview((current) => current?.summary.proposalId === review.summary.proposalId
        ? { ...current, resolvingAction: null, error: message }
        : current)
      setStatusText(t.app.status.aiChangeProposalActionFailed(message))
    }
  }

  const handleAiChangeProposalOpen = useEffectEvent((summary: MdvAiChangeProposalSummary) => {
    activeChangeProposalIdRef.current = summary.proposalId
    setChangeProposalReview({
      summary,
      proposal: null,
      acceptedHunkIds: new Set(),
      resolvingAction: null,
      error: null,
    })
    setStatusText(i18nRef.current.app.status.loadingAiChangeProposal)

    void window.mdvDesktop?.getAiChangeProposal({ proposalId: summary.proposalId })
      .then((proposal) => {
        if (activeChangeProposalIdRef.current !== summary.proposalId) {
          return
        }

        setChangeProposalReview((current) => current?.summary.proposalId === summary.proposalId
          ? {
              ...current,
              proposal,
              acceptedHunkIds: new Set(proposal.hunks.map((hunk) => hunk.hunkId)),
              error: null,
            }
          : current)
      })
      .catch(async (error) => {
        if (activeChangeProposalIdRef.current !== summary.proposalId) {
          return
        }

        const message = error instanceof Error ? error.message : String(error)
        setChangeProposalReview((current) => current?.summary.proposalId === summary.proposalId
          ? { ...current, resolvingAction: 'cancel', error: message }
          : current)
        setStatusText(i18nRef.current.app.status.aiChangeProposalLoadFailed(message))
        try {
          const resolution = await window.mdvDesktop?.cancelAiChangeProposal({ proposalId: summary.proposalId })
          if (!resolution) {
            throw new Error(i18nRef.current.app.status.aiChangeProposalResolutionUnconfirmed)
          }
          completeChangeProposalReview(resolution)
          setStatusText(i18nRef.current.app.status.aiChangeProposalLoadFailedCancelled(message))
        } catch (cancelError) {
          if (activeChangeProposalIdRef.current === summary.proposalId) {
            const cancelMessage = cancelError instanceof Error ? cancelError.message : String(cancelError)
            const actionError = i18nRef.current.app.status.aiChangeProposalActionFailed(cancelMessage)
            setChangeProposalReview((current) => current?.summary.proposalId === summary.proposalId
              ? { ...current, resolvingAction: null, error: `${i18nRef.current.app.status.aiChangeProposalLoadFailed(message)} ${actionError}` }
              : current)
            setStatusText(actionError)
          }
        }
      })
  })

  const handleAiChangeProposalResolved = useEffectEvent((resolution: MdvAiChangeProposalResolution) => {
    completeChangeProposalReview(resolution)
  })

  useEffect(() => {
    const unsubscribeOpen = window.mdvDesktop?.onAiChangeProposalOpen(handleAiChangeProposalOpen)
    const unsubscribeResolved = window.mdvDesktop?.onAiChangeProposalResolved((resolution) => {
      handleAiChangeProposalResolved(resolution)
    })

    return () => {
      unsubscribeOpen?.()
      unsubscribeResolved?.()
    }
  }, [])

  const runDesktopAction = (action: MdvMenuAction) => {
    if (activeChangeProposalIdRef.current) {
      return
    }

    if (action === 'redo') {
      editorRef.current?.exec('redo')
      setStatusText(t.app.status.redidLastEdit)
      return
    }

    if (action === 'new-document') {
      void handleCreateNewDocument()
      return
    }

    if (action === 'open') {
      void handleOpen()
      return
    }

    if (action === 'reload-file') {
      void handleReloadCurrentFile()
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
        setStatusText(t.app.status.openedSettings)
      })
      return
    }

    if (action === 'open-ai-chat') {
      if (!isAiChatAvailable) {
        setStatusText(t.app.semanticSearchRequiresOpenAi)
        return
      }

      if (isAssistantDockOpen) {
        closeAssistantDock()
        return
      }

      openAssistantDock({ focus: true, statusMessage: t.app.status.openedAiChat })
      return
    }

    if (action === 'show-editor') {
      setActivePanel('write')
      setStatusText(t.app.status.switchedToEditor)
      return
    }

    setActivePanel('preview')
    setStatusText(t.app.status.switchedToPreview)
  }

  useEffect(() => {
    runDesktopActionRef.current = runDesktopAction
  })

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (allowWindowCloseRef.current) {
        return
      }

      if (canAbandonCurrentBufferRef.current(i18nRef.current.common.close)) {
        return
      }

      event.preventDefault()
      event.returnValue = false
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [])

  useEffect(() => window.mdvDesktop?.onWindowCloseApproved(() => {
    allowWindowCloseRef.current = true
  }), [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (activeChangeProposalIdRef.current) {
        const key = event.key.toLowerCase()
        const isBlockedShortcut = getActionForShortcut(event) !== null
          || getTypographyShortcutAction(event) !== null
          || (!event.isComposing && isPrimaryModifierPressed(event) && (key === 'f' || key === 'h' || key === 'r'))

        if (isBlockedShortcut) {
          event.preventDefault()
          event.stopPropagation()
        }
        return
      }

      const typographyAction = getTypographyShortcutAction(event)

      if (typographyAction) {
        const target = getFocusedTypographyTarget(event.target)

        if (!target) {
          return
        }

        event.preventDefault()
        const currentTypography = typographySettingsRef.current
        const nextValue = target === 'chat'
          ? typographyAction === 'reset'
            ? DEFAULT_CHAT_FONT_SIZE_PX
            : clampChatFontSizePx(currentTypography.chatFontSizePx + (typographyAction === 'increase' ? 1 : -1))
          : typographyAction === 'reset'
            ? DEFAULT_EDITOR_FONT_SIZE_PX
            : clampEditorFontSizePx(currentTypography.editorFontSizePx + (typographyAction === 'increase' ? 1 : -1))

        const patch = target === 'chat'
          ? { ai: { chatFontSizePx: nextValue } }
          : { editor: { fontSizePx: nextValue } }

        typographySettingsRef.current = target === 'chat'
          ? { ...currentTypography, chatFontSizePx: nextValue }
          : { ...currentTypography, editorFontSizePx: nextValue }

        void window.mdvDesktop?.settings.updateSettings(patch)
          .then((updatedSettings) => {
            typographySettingsRef.current = {
              editorFontSizePx: clampEditorFontSizePx(updatedSettings.editor.fontSizePx),
              chatFontSizePx: clampChatFontSizePx(updatedSettings.ai.chatFontSizePx),
            }

            setStatusText(
              target === 'chat'
                ? typographyAction === 'reset'
                  ? i18nRef.current.app.status.chatFontSizeReset(updatedSettings.ai.chatFontSizePx)
                  : i18nRef.current.app.status.chatFontSizeChanged(updatedSettings.ai.chatFontSizePx)
                : typographyAction === 'reset'
                  ? i18nRef.current.app.status.editorFontSizeReset(updatedSettings.editor.fontSizePx)
                  : i18nRef.current.app.status.editorFontSizeChanged(updatedSettings.editor.fontSizePx),
            )
          })
          .catch((error: unknown) => {
            typographySettingsRef.current = currentTypography
            setStatusText(error instanceof Error ? error.message : String(error))
          })
        return
      }

      if (!event.defaultPrevented && !event.isComposing && isPrimaryModifierPressed(event) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        focusEditorSearchRef.current()
        return
      }

      if (!event.defaultPrevented && !event.isComposing && isPrimaryModifierPressed(event) && event.key.toLowerCase() === 'h') {
        event.preventDefault()
        openEditorReplaceDialogRef.current()
        return
      }

      const action = getActionForShortcut(event)

      if (!action) {
        return
      }

      event.preventDefault()
      runDesktopActionRef.current(action)
    }

    window.addEventListener('keydown', handleKeyDown, true)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [t.app.status])

  useEffect(() => {
    const unsubscribe = window.mdvDesktop?.onServerCommand((command) => {
      if (command.type === 'suspend') {
        const snapshot = buildClientSnapshotRef.current()
        setStatusText(i18nRef.current.app.status.suspendingForUpdate)
        window.mdvDesktop?.sendServerCommandResult({
          requestId: command.requestId,
          type: 'suspend',
          status: 'completed',
          snapshot,
        })
        return
      }

      if (command.type === 'resume' && command.snapshot) {
        applyClientSnapshotRef.current(command.snapshot)
      }

      setStatusText(i18nRef.current.app.status.resumedFromServerState)
      window.mdvDesktop?.sendServerCommandResult({
        requestId: command.requestId,
        type: 'resume',
        status: 'completed',
        snapshot: command.snapshot || buildClientSnapshotRef.current(),
      })
    })

    return () => {
      unsubscribe?.()
    }
  }, [])

  useLayoutEffect(() => {
    const unsubscribe = window.mdvDesktop?.onOpenFileRequested((request) => {
      const isInitialLaunch = typeof request !== 'string' && request.isInitialLaunch === true

      if (isInitialLaunch) {
        setIsInitialLaunchOpenSettled(false)
      }

      void (async () => {
        try {
          if (!await confirmUnsavedChangesBeforeProceedRef.current(i18nRef.current.common.open)) {
            setStatusText(i18nRef.current.app.status.openRequestCancelled)
            return
          }

          const filePath = typeof request === 'string' ? request : request.filePath
          const initialPanel = typeof request === 'string' ? undefined : request.initialPanel

          if (!filePath) {
            if (initialPanel) {
              setActivePanel(initialPanel)
            }

            return
          }

          const payload = await window.mdvDesktop?.readFile(filePath)
          if (initialPanel) {
            setActivePanel(initialPanel)
          }

          if (!payload) {
            return
          }

          loadFilePayloadRef.current(payload)
        } finally {
          if (isInitialLaunch) {
            window.mdvDesktop?.notifyInitialLaunchOpenHandled()
          }

          setIsInitialLaunchOpenSettled(true)
        }
      })()
    })

    return () => {
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.mdvDesktop?.onMenuAction((action) => {
      runDesktopActionRef.current(action)
    })

    return () => {
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.mdvDesktop?.onAiEditorRequest((request) => {
      respondToAiEditorRequestRef.current(request)
    })

    return () => {
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('.assistant-dock')) {
        return
      }

      const anchor = resolveExternalAnchor(event.target)

      if (!anchor) {
        return
      }

      event.preventDefault()
      void window.mdvDesktop?.openExternalLink(anchor.href).then((result) => {
        if (!result || result.status === 'opened') {
          setStatusText(i18nRef.current.app.status.openedLink(anchor.hostname))
          return
        }

        if (result.status === 'cancelled') {
          setStatusText(i18nRef.current.app.status.cancelledExternalLink)
          return
        }

        setStatusText(i18nRef.current.app.status.blockedExternalLink)
      })
    }

    document.addEventListener('click', handleDocumentClick, true)

    return () => {
      document.removeEventListener('click', handleDocumentClick, true)
    }
  }, [])

  const handleImagePaste = useEffectEvent((event: ClipboardEvent) => {
    const editor = editorRef.current

    if (activePanel !== 'write' || !editor) {
      return
    }

    const editorRoot = getActiveEditorRoot(editor)
    const activeElement = document.activeElement

    if (!(activeElement instanceof Node) || !editorRoot.contains(activeElement)) {
      return
    }

    const imageItem = Array.from(event.clipboardData?.items ?? []).find((item) => item.kind === 'file' && item.type.startsWith('image/'))
    const imageFile = imageItem?.getAsFile()

    if (!imageFile) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    void importImageIntoEditor({ file: imageFile, createdBy: 'paste' })
  })

  useEffect(() => {
    document.addEventListener('paste', handleImagePaste, true)

    return () => {
      document.removeEventListener('paste', handleImagePaste, true)
    }
  }, [])

  const handleDrop = async (event: DragEvent<HTMLElement>) => {
    const droppedFile = event.dataTransfer.files.item(0)

    if (!droppedFile) {
      setIsDraggingFile(false)
      return
    }

    event.preventDefault()
    event.stopPropagation()
    setIsDraggingFile(false)

    const nativePath = resolveDroppedNativePath(event)

    if (isImageDropCandidate(droppedFile, nativePath)) {
      void importImageIntoEditor({ file: droppedFile, nativePath, createdBy: 'drop' })
      return
    }

    if (!await confirmUnsavedChangesBeforeProceed(t.common.open)) {
      setStatusText(t.app.status.dropCancelled)
      return
    }

    if (nativePath && window.mdvDesktop) {
      const payload = await window.mdvDesktop.readFile(nativePath)
      loadFilePayload(payload)
      return
    }

    const content = await droppedFile.text()
    loadDetachedFile(droppedFile.name, content)
  }

  const handleOpenHelp = () => {
    const openHelpWindow = window.mdvDesktop?.openAboutWindow

    if (!openHelpWindow) {
      setStatusText(t.common.unavailable)
      return
    }

    void openHelpWindow()
      .then(() => {
        setStatusText(t.app.status.openedHelp)
      })
      .catch((error: unknown) => {
        setStatusText(error instanceof Error ? error.message : String(error))
      })
  }

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setIsDraggingFile(true)
  }

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
      return
    }

    setIsDraggingFile(false)
  }

  return (
    <main className="shell">
      <section
        className={`workspace compact-workspace${isDraggingFile ? ' dragging' : ''}`}
        onDropCapture={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <header className={isStartupPending ? 'topbar topbar-pending' : 'topbar'}>
          <div className="title-strip">
            <h1>{visibleDisplayTitle}</h1>
          </div>

          {isStartupPending ? (
            <div className="startup-topbar-status" role="status" aria-live="polite">{t.app.startingWorkspace}</div>
          ) : (
            <>
              <div className="view-switch">
                <ToolbarButton label={`${t.app.editor} (Ctrl/Cmd+1)`} active={activePanel === 'write'} onClick={() => setActivePanel('write')}>
                  <EditorIcon />
                </ToolbarButton>
                <ToolbarButton label={`${t.app.rendered} (Ctrl/Cmd+2)`} active={activePanel === 'preview'} onClick={() => setActivePanel('preview')}>
                  <RenderedIcon />
                </ToolbarButton>
              </div>

              <div className="action-strip">
                {activePanel === 'write' ? (
                  <div className="action-group" role="group" aria-label={t.app.searchInEditor}>
                    <ToolbarButton label={`${t.app.searchInEditor} (Ctrl/Cmd+F)`} active={isEditorSearchDialogOpen} onClick={focusEditorSearch}>
                      <SearchIcon />
                    </ToolbarButton>
                  </div>
                ) : null}
                <ToolbarGroup label={t.app.fileActions}>
                  <ToolbarButton label={`${t.app.createNewDocument} (Ctrl/Cmd+N)`} onClick={() => void handleCreateNewDocument()}>
                    <NewDocumentIcon />
                  </ToolbarButton>
                  <ToolbarButton label={`${t.common.open} (Ctrl/Cmd+O)`} onClick={handleOpen}>
                    <OpenIcon />
                  </ToolbarButton>
                  <ToolbarButton label={`${t.app.reloadFile} (F5)`} disabled={!currentFilePath} onClick={() => void handleReloadCurrentFile()}>
                    <ReloadFileIcon />
                  </ToolbarButton>
                  {activePanel === 'write' ? (
                    <ToolbarButton label={`${t.common.save} (Ctrl/Cmd+S)`} disabled={!hasUnsavedChanges} onClick={() => void handleSave(false)}>
                      <SaveIcon />
                    </ToolbarButton>
                  ) : null}
                  <ToolbarButton label={`${t.common.saveAs} (Ctrl/Cmd+Shift+S)`} onClick={() => void handleSave(true)}>
                    <SaveAsIcon />
                  </ToolbarButton>
                </ToolbarGroup>
                {activePanel === 'write' ? (
                  <ToolbarGroup label={t.app.insertActions}>
                    <ToolbarButton label={t.app.insertHeading} onClick={() => applyMarkdownInsertCommand('heading', t.app.insertHeading)}>
                      <HeadingCommandIcon />
                    </ToolbarButton>
                    <ToolbarButton label={t.app.insertLink} onClick={() => applyMarkdownInsertCommand('link', t.app.insertLink)}>
                      <LinkCommandIcon />
                    </ToolbarButton>
                    <ToolbarButton label={t.app.insertImage} onClick={() => applyMarkdownInsertCommand('image', t.app.insertImage)}>
                      <ImageCommandIcon />
                    </ToolbarButton>
                    <ToolbarButton label={t.app.insertCodeBlock} onClick={() => applyMarkdownInsertCommand('code-block', t.app.insertCodeBlock)}>
                      <CodeBlockCommandIcon />
                    </ToolbarButton>
                    <ToolbarButton label={t.app.insertQuote} onClick={() => applyMarkdownInsertCommand('quote', t.app.insertQuote)}>
                      <QuoteCommandIcon />
                    </ToolbarButton>
                    <ToolbarButton label={t.app.insertHorizontalRule} onClick={() => applyMarkdownInsertCommand('horizontal-rule', t.app.insertHorizontalRule)}>
                      <HorizontalRuleCommandIcon />
                    </ToolbarButton>
                    <ToolbarButton label={t.app.insertFootnote} onClick={() => applyMarkdownInsertCommand('footnote', t.app.insertFootnote)}>
                      <FootnoteCommandIcon />
                    </ToolbarButton>
                    <ToolbarMenuButton
                      label={t.app.tableActions}
                      items={[
                        { label: t.app.insertTable, icon: <TableCommandIcon />, onClick: () => applyMarkdownInsertCommand('table', t.app.insertTable) },
                        { label: t.app.formatTable, icon: <FormatTableCommandIcon />, onClick: () => applyMarkdownInsertCommand('format-table', t.app.formatTable) },
                        { label: t.app.addTableRow, icon: <AddTableRowCommandIcon />, onClick: () => applyMarkdownInsertCommand('add-table-row', t.app.addTableRow) },
                        { label: t.app.addTableColumn, icon: <AddTableColumnCommandIcon />, onClick: () => applyMarkdownInsertCommand('add-table-column', t.app.addTableColumn) },
                        { label: t.app.alignTableColumnDefault, icon: <AlignTableColumnDefaultIcon />, onClick: () => applyMarkdownInsertCommand('align-table-column-default', t.app.alignTableColumnDefault) },
                        { label: t.app.alignTableColumnLeft, icon: <AlignTableColumnLeftIcon />, onClick: () => applyMarkdownInsertCommand('align-table-column-left', t.app.alignTableColumnLeft) },
                        { label: t.app.alignTableColumnCenter, icon: <AlignTableColumnCenterIcon />, onClick: () => applyMarkdownInsertCommand('align-table-column-center', t.app.alignTableColumnCenter) },
                        { label: t.app.alignTableColumnRight, icon: <AlignTableColumnRightIcon />, onClick: () => applyMarkdownInsertCommand('align-table-column-right', t.app.alignTableColumnRight) },
                      ]}
                    >
                      <TableCommandIcon />
                    </ToolbarMenuButton>
                    <ToolbarButton label={t.app.toggleTaskCheckbox} onClick={() => applyMarkdownInsertCommand('toggle-task-list', t.app.toggleTaskCheckbox)}>
                      <TaskCheckboxCommandIcon />
                    </ToolbarButton>
                  </ToolbarGroup>
                ) : null}
                <ToolbarGroup label={t.app.outputActions}>
                  {activePanel === 'write' ? (
                    <ToolbarButton label={t.app.copyDocument} onClick={() => void handleCopyDocument()}>
                      <CopyIcon />
                    </ToolbarButton>
                  ) : null}
                  {activePanel === 'preview' ? (
                    <ToolbarButton label={t.app.copyRendered} onClick={() => void handleCopyRendered()}>
                      <CopyIcon />
                    </ToolbarButton>
                  ) : null}
                  {activePanel === 'preview' ? (
                    <ToolbarButton label={t.app.printRendered} onClick={handlePrintRendered}>
                      <PrintIcon />
                    </ToolbarButton>
                  ) : null}
                  {activePanel === 'preview' ? (
                    <ToolbarButton label={t.app.exportHtml} onClick={() => void handleExportHtml()}>
                      <ExportIcon />
                    </ToolbarButton>
                  ) : null}
                </ToolbarGroup>
                <ToolbarGroup label={t.app.workspaceActions}>
                  {isAiChatAvailable ? (
                    <ToolbarButton
                      label={`${t.chat.title} (Ctrl/Cmd+I)`}
                      active={isAssistantDockOpen}
                      onClick={() => runDesktopAction('open-ai-chat')}
                    >
                      <span className="toolbar-text-icon" aria-hidden="true">AI</span>
                    </ToolbarButton>
                  ) : null}
                  <ToolbarButton label={`${t.common.settings} (Ctrl/Cmd+,)`} onClick={() => runDesktopAction('open-settings')}>
                    <SettingsIcon />
                  </ToolbarButton>
                </ToolbarGroup>
              </div>
            </>
          )}
        </header>

        {isStartupPending ? (
          <div className="workspace-startup-shell" role="status" aria-live="polite">
            <div className="workspace-startup-card">
              <div className="workspace-startup-eyebrow">MDV</div>
              <strong>{t.app.startingWorkspace}</strong>
            </div>
          </div>
        ) : (
          <div
            ref={workspaceBodyRef}
            className={isAssistantDockOpen ? 'workspace-body workspace-body-with-assistant' : 'workspace-body'}
            style={{ '--assistant-dock-width': `${assistantDockWidthPercent}%` } as CSSProperties}
          >
            <div className="workspace-main-column">
              {isEditorSearchResultsVisible && (editorSearchError || editorSearchResults.length > 0) ? (
                <section className="editor-search-results" aria-label={t.app.searchResults}>
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

              <div className={activePanel === 'write' ? 'single-panel single-panel-with-outline' : 'single-panel single-panel-preview-only'}>
                {activePanel === 'write' ? (
                  <aside className="panel outline-panel" aria-label={t.app.outline}>
                    <div className="outline-panel-header">{t.app.outline}</div>
                    {visibleHeadingOutline.length === 0 ? (
                      <div className="outline-empty">{t.app.outlineEmpty}</div>
                    ) : (
                      <div ref={outlineListRef} className="outline-list">
                        {visibleHeadingOutline.map((item, index) => {
                          const isActiveOutlineItem = index === activeOutlineIndex
                          const headingLabel = getOutlineHeadingLabel(item, t.app.outlineUntitledHeading)

                          return (
                            <button
                              key={`${item.path.join('.')}:${item.position.line}:${item.position.column}`}
                              type="button"
                              className={isPlaceholderOutline ? 'outline-item outline-item-disabled' : isActiveOutlineItem ? 'outline-item active' : 'outline-item'}
                              style={{ paddingInlineStart: 10 + Math.max(0, item.depth - 1) * 12 }}
                              onClick={() => jumpToOutlineHeading(item)}
                              title={headingLabel}
                              aria-current={!isPlaceholderOutline && isActiveOutlineItem ? 'location' : undefined}
                              aria-disabled={isPlaceholderOutline ? 'true' : undefined}
                              disabled={isPlaceholderOutline}
                              ref={isActiveOutlineItem ? activeOutlineItemRef : null}
                            >
                              <span className="outline-item-depth">H{Math.max(1, item.depth)}</span>
                              <span className="outline-item-label">{headingLabel}</span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </aside>
                ) : null}
                <div className="panel-stack full-panel">
                  <div className={activePanel === 'write' ? 'panel editor-panel panel-stack-item panel-stack-item-active' : 'panel editor-panel panel-stack-item panel-stack-item-inactive'}>
                    <EditorSurface
                      key={editorSessionKey}
                      value={markdownText}
                      contentBaseFilePath={contentBaseFilePath}
                      onChange={(nextMarkdown) => {
                        invalidateEditorSearch()
                        updateMarkdownText(nextMarkdown)
                      }}
                      editorRef={editorRef}
                      onReady={(editor) => {
                        if (shouldCanonicalizeLoadedBaselineRef.current) {
                          const canonicalMarkdown = editor.getMarkdown()
                          shouldCanonicalizeLoadedBaselineRef.current = false
                          persistedMarkdownRef.current = canonicalMarkdown
                          setPersistedMarkdown(canonicalMarkdown)
                          updateMarkdownText(canonicalMarkdown)
                        }

                        syncActiveOutlineLine(editor)

                        if (!pendingSearchJump) {
                          return
                        }

                        selectSpanInEditor(editor, pendingSearchJump)
                        setPendingSearchJump(null)
                      }}
                      onSelectionChange={syncActiveOutlineLine}
                    />
                  </div>
                  <div className={activePanel === 'preview' ? 'panel preview-panel panel-stack-item panel-stack-item-active' : 'panel preview-panel panel-stack-item panel-stack-item-inactive'}>
                    <div
                      ref={previewRootRef}
                      className="preview-scroll compact-preview"
                    >
                      {displaySegments.map((segment, index) => {
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
              </div>
            </div>

            {isAssistantDockOpen ? (
              <button
                type="button"
                className="assistant-dock-resize-handle"
                aria-label="Resize AI Chat dock"
                title="Resize AI Chat dock"
                onPointerDown={handleAssistantDockResizePointerDown}
                onPointerMove={handleAssistantDockResizePointerMove}
                onKeyDown={handleAssistantDockResizeKeyDown}
              />
            ) : null}

            <aside
              className={isAssistantDockOpen ? 'assistant-dock panel' : 'assistant-dock panel assistant-dock-hidden'}
              aria-label={t.chat.title}
              aria-hidden={!isAssistantDockOpen}
              hidden={!isAssistantDockOpen}
            >
              <ChatApp
                variant="dock"
                autoFocusNonce={assistantFocusNonce}
                onRequestClose={() => {
                  closeAssistantDock()
                }}
              />
            </aside>
          </div>
        )}

        <div className="statusbar">
          <button type="button" className="statusbar-help-button" onClick={handleOpenHelp}>{t.app.openHelp}</button>
          <span className="statusbar-status">{statusText}</span>
          <span>{window.mdvDesktop?.platform ?? 'browser'}</span>
        </div>

        {activeToast ? (
          <div className="status-toast-layer">
            <div key={activeToast.id} className="status-toast" role="status">{activeToast.message}</div>
          </div>
        ) : null}

        {changeProposalReview ? (
          <ChangePreviewDialog
            summary={changeProposalReview.summary}
            proposal={changeProposalReview.proposal}
            acceptedHunkIds={changeProposalReview.acceptedHunkIds}
            resolvingAction={changeProposalReview.resolvingAction}
            error={changeProposalReview.error}
            labels={{
              ...t.app.changeProposal,
              cancel: t.common.cancel,
              loading: t.app.status.loadingAiChangeProposal,
            }}
            onToggleHunk={toggleChangeProposalHunk}
            onApply={() => void applySelectedChangeProposalHunks()}
            onCancel={() => void cancelChangeProposal()}
          />
        ) : null}

        {isEditorSearchDialogOpen ? (
          <div className="search-dialog-backdrop" onClick={closeEditorSearchDialog}>
            <section
              className="search-dialog"
              role="dialog"
              aria-modal="true"
              aria-label={isReplaceDialog ? t.app.replaceInEditor : t.app.searchInEditor}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  closeEditorSearchDialog()
                }
              }}
            >
              <div className="search-dialog-header">
                <strong>{isReplaceDialog ? t.app.replaceInEditor : t.app.searchInEditor}</strong>
                <button
                  type="button"
                  className="editor-search-icon-button"
                  onClick={closeEditorSearchDialog}
                  aria-label={t.common.close}
                  title={t.common.close}
                >
                  <CloseIcon />
                </button>
              </div>
              <div className="search-dialog-body">
                <label className="search-field">
                  <span>{t.app.searchInEditor}</span>
                  <input
                    ref={searchInputRef}
                    className="search-dialog-input"
                    type="search"
                    placeholder={t.app.searchInEditor}
                    value={editorSearchQuery}
                    onChange={(event) => {
                      invalidateEditorSearch()
                      setEditorSearchQuery(event.target.value)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()

                        if (isReplaceDialog && resolvedEditorSearchMode === 'exact') {
                          handleReplaceCurrentEditorSearchResult()
                          return
                        }

                        void handleRunEditorSearch()
                      }
                    }}
                  />
                </label>
                <div className="search-dialog-row search-dialog-row-compact">
                  <label className="search-field search-field-mode">
                    <span>{t.app.searchMode}</span>
                    <select
                      className="search-dialog-select"
                      aria-label={t.app.searchMode}
                      value={resolvedEditorSearchMode}
                      onChange={(event) => {
                        const nextMode = event.currentTarget.value

                        if (!isEditorSearchMode(nextMode)) {
                          setStatusText(t.common.invalidSearchMode)
                          return
                        }

                        if (nextMode === 'semantic' && !isSemanticSearchAvailable) {
                          setStatusText(t.app.semanticSearchRequiresOpenAi)
                          setEditorSearchMode('exact')
                          return
                        }

                        invalidateEditorSearch()
                        setEditorSearchMode(nextMode)
                      }}
                    >
                      <option value="exact">{t.app.exact}</option>
                      <option value="semantic" disabled={!isSemanticSearchAvailable || isReplaceDialog}>{t.app.semantic}</option>
                    </select>
                  </label>
                  {resolvedEditorSearchMode === 'exact' ? (
                    <>
                      <button
                        type="button"
                        className={isEditorSearchMatchCase ? 'editor-search-toggle active' : 'editor-search-toggle'}
                        onClick={() => {
                          invalidateEditorSearch()
                          setIsEditorSearchMatchCase((value) => !value)
                        }}
                        aria-label={t.app.toggleSearchMatchCase}
                        title={t.app.toggleSearchMatchCase}
                      >
                        Aa
                      </button>
                      <button
                        type="button"
                        className={isEditorSearchRegexp ? 'editor-search-toggle active' : 'editor-search-toggle'}
                        onClick={() => {
                          invalidateEditorSearch()
                          setIsEditorSearchRegexp((value) => !value)
                        }}
                        aria-label={t.app.toggleSearchRegexp}
                        title={t.app.toggleSearchRegexp}
                      >
                        .*
                      </button>
                      <button
                        type="button"
                        className={isEditorSearchInSelection ? 'editor-search-toggle active' : 'editor-search-toggle'}
                        onClick={() => {
                          invalidateEditorSearch()
                          setIsEditorSearchInSelection((value) => !value)
                        }}
                        aria-label={t.app.toggleSearchInSelection}
                        title={t.app.toggleSearchInSelection}
                      >
                        {t.app.toggleSearchInSelectionShort}
                      </button>
                    </>
                  ) : null}
                </div>
                {isReplaceDialog && resolvedEditorSearchMode === 'exact' ? (
                  <label className="search-field">
                    <span>{t.app.replaceInEditor}</span>
                    <input
                      className="search-dialog-input"
                      type="text"
                      placeholder={t.app.replaceInEditor}
                      value={editorSearchReplacement}
                      onChange={(event) => setEditorSearchReplacement(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()

                          if (event.shiftKey) {
                            handleReplaceAllEditorSearchResults()
                            return
                          }

                          handleReplaceCurrentEditorSearchResult()
                        }
                      }}
                    />
                  </label>
                ) : null}
                <div className="search-dialog-actions">
                  <button
                    type="button"
                    className="editor-search-text-button"
                    onClick={() => void handleRunEditorSearch()}
                    disabled={isRunningEditorSearch || !isResolvedEditorSearchAvailable}
                  >
                    {isRunningEditorSearch ? t.common.searching : t.app.runSearch}
                  </button>
                  {isReplaceDialog && resolvedEditorSearchMode === 'exact' ? (
                    <>
                      <button
                        type="button"
                        className="editor-search-text-button"
                        onClick={handleReplaceCurrentEditorSearchResult}
                        disabled={isRunningEditorSearch}
                      >
                        {t.app.replace}
                      </button>
                      <button
                        type="button"
                        className="editor-search-text-button"
                        onClick={handleReplaceAllEditorSearchResults}
                        disabled={isRunningEditorSearch}
                      >
                        {t.app.replaceAll}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="editor-search-icon-button"
                        onClick={() => moveEditorSearchSelection(-1)}
                        disabled={!isEditorSearchResultsVisible || editorSearchResults.length === 0}
                        aria-label={t.app.previousResult}
                        title={t.app.previousResult}
                      >
                        <PrevIcon />
                      </button>
                      <button
                        type="button"
                        className="editor-search-icon-button"
                        onClick={() => moveEditorSearchSelection(1)}
                        disabled={!isEditorSearchResultsVisible || editorSearchResults.length === 0}
                        aria-label={t.app.nextResult}
                        title={t.app.nextResult}
                      >
                        <NextIcon />
                      </button>
                    </>
                  )}
                  <span className="editor-search-count">
                    {!isEditorSearchResultsVisible || editorSearchResults.length === 0 ? '0' : `${selectedSearchResultIndex + 1}/${editorSearchResults.length}`}
                  </span>
                  {(editorSearchError || editorSearchResults.length > 0) ? (
                    <button
                      type="button"
                      className="editor-search-icon-button"
                      onClick={isEditorSearchResultsVisible ? hideEditorSearchResults : showEditorSearchResults}
                      aria-label={isEditorSearchResultsVisible ? t.app.hideSearchResults : t.app.showSearchResults}
                      title={isEditorSearchResultsVisible ? t.app.hideSearchResults : t.app.showSearchResults}
                    >
                      {isEditorSearchResultsVisible ? <CloseIcon /> : <ResultsIcon />}
                    </button>
                  ) : null}
                </div>
              </div>
            </section>
          </div>
        ) : null}
      </section>
    </main>
  )
}

export default App
