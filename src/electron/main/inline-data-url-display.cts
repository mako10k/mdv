const INLINE_DATA_IMAGE_DATA_URL_PATTERN = /data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/g

function estimateBase64DecodedBytes(base64Text: string): number {
  const normalized = base64Text.replace(/\s+/g, '')

  if (normalized.length === 0) {
    return 0
  }

  let padding = 0

  if (normalized.endsWith('==')) {
    padding = 2
  } else if (normalized.endsWith('=')) {
    padding = 1
  }

  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding)
}

function formatInlineDataImageByteSize(bytes: number): string {
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
  const byteSizeLabel = formatInlineDataImageByteSize(estimateBase64DecodedBytes(base64Text))

  return `data:${mimeType};base64,<${byteSizeLabel} omitted>`
}

function abbreviateInlineDataImageMarkdown(markdown: string): string {
  return abbreviateInlineDataImageMarkdownInText(markdown)
}

function abbreviateInlineDataImageMarkdownInText(text: string): string {
  if (!text || !text.includes('data:image/')) {
    return text
  }

  return text.replace(INLINE_DATA_IMAGE_DATA_URL_PATTERN, (fullMatch) => abbreviateInlineDataImageDataUrl(fullMatch))
}

function abbreviateInlineDataImageMarkdownSlice(text: string, startOffset: number, endOffset: number): string {
  const normalizedStartOffset = Math.min(Math.max(0, Math.trunc(Number(startOffset) || 0)), text.length)
  const normalizedEndOffset = Math.min(Math.max(normalizedStartOffset, Math.trunc(Number(endOffset) || normalizedStartOffset)), text.length)

  if (!text || !text.includes('data:image/')) {
    return text.slice(normalizedStartOffset, normalizedEndOffset)
  }

  let output = ''
  let cursor = normalizedStartOffset

  INLINE_DATA_IMAGE_DATA_URL_PATTERN.lastIndex = 0

  for (const match of text.matchAll(INLINE_DATA_IMAGE_DATA_URL_PATTERN)) {
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

export {
  INLINE_DATA_IMAGE_DATA_URL_PATTERN,
  abbreviateInlineDataImageDataUrl,
  abbreviateInlineDataImageMarkdown,
  abbreviateInlineDataImageMarkdownInText,
  abbreviateInlineDataImageMarkdownSlice,
}
