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

function abbreviateInlineDataImageMarkdownInText(text: string): string {
  if (!text || !text.includes('data:image/')) {
    return text
  }

  return text.replace(INLINE_DATA_IMAGE_DATA_URL_PATTERN, (fullMatch) => abbreviateInlineDataImageDataUrl(fullMatch))
}

export {
  INLINE_DATA_IMAGE_DATA_URL_PATTERN,
  abbreviateInlineDataImageDataUrl,
  abbreviateInlineDataImageMarkdownInText,
}