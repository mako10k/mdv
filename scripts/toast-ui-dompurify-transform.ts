import type { Plugin } from 'vite'

const TOAST_UI_EDITOR_ESM_SUFFIXES = [
  '/node_modules/@toast-ui/editor/dist/esm/index.js',
  '/node_modules/@toast-ui/editor/dist/esm/indexViewer.js',
]

const BUNDLED_INSTANCE_MARKER = 'var purify = createDOMPurify();'
const PATCHED_IMPORT = "import mdvDOMPurify from 'dompurify';"
const PATCHED_INSTANCE = 'var purify = mdvDOMPurify;'

function isToastUiEditorEsmModule(id: string) {
  const normalizedId = id.split('?', 1)[0].replaceAll('\\', '/')
  return TOAST_UI_EDITOR_ESM_SUFFIXES.some((suffix) => normalizedId.endsWith(suffix))
}

export function rebindToastUiBundledDomPurify(source: string, id: string): string | null {
  if (!isToastUiEditorEsmModule(id)) {
    return null
  }

  const markerCount = source.split(BUNDLED_INSTANCE_MARKER).length - 1
  if (markerCount !== 1) {
    throw new Error(
      `Refusing to build ${id}: expected exactly one Toast UI bundled DOMPurify instance marker, found ${markerCount}.`,
    )
  }

  return `${PATCHED_IMPORT}\n${source.replace(BUNDLED_INSTANCE_MARKER, PATCHED_INSTANCE)}`
}

export function toastUiDompurifyTransform(): Plugin {
  return {
    name: 'mdv-toast-ui-dompurify-transform',
    enforce: 'pre',
    transform(source, id) {
      return rebindToastUiBundledDomPurify(source, id)
    },
  }
}
