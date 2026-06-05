export const DEFAULT_EDITOR_FONT_SIZE_PX = 13
export const MIN_EDITOR_FONT_SIZE_PX = 11
export const MAX_EDITOR_FONT_SIZE_PX = 18

export const DEFAULT_CHAT_FONT_SIZE_PX = 12
export const MIN_CHAT_FONT_SIZE_PX = 11
export const MAX_CHAT_FONT_SIZE_PX = 16

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numericValue = Number(value)

  if (!Number.isFinite(numericValue)) {
    return fallback
  }

  return Math.min(max, Math.max(min, Math.round(numericValue)))
}

export function clampEditorFontSizePx(value: unknown): number {
  return clampInteger(value, DEFAULT_EDITOR_FONT_SIZE_PX, MIN_EDITOR_FONT_SIZE_PX, MAX_EDITOR_FONT_SIZE_PX)
}

export function clampChatFontSizePx(value: unknown): number {
  return clampInteger(value, DEFAULT_CHAT_FONT_SIZE_PX, MIN_CHAT_FONT_SIZE_PX, MAX_CHAT_FONT_SIZE_PX)
}

export function applyTypographyToRoot(settingsLike: {
  editor?: { fontSizePx?: number | null } | null
  ai?: { chatFontSizePx?: number | null } | null
} | null | undefined) {
  document.documentElement.style.setProperty('--editor-font-size', `${clampEditorFontSizePx(settingsLike?.editor?.fontSizePx)}px`)
  document.documentElement.style.setProperty('--chat-font-size', `${clampChatFontSizePx(settingsLike?.ai?.chatFontSizePx)}px`)
}

export function applyBootstrapTypography() {
  const bootstrap = window.mdvDesktop?.settings.getBootstrapSettings()
  applyTypographyToRoot(bootstrap?.settings)
}