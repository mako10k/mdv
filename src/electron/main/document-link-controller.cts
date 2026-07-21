const path = require('node:path') as typeof import('node:path')
const { fileURLToPath } = require('node:url') as typeof import('node:url')

type WindowLike = {
  id: number
  isDestroyed: () => boolean
}

type EditorRuntimeState = {
  trackedFilePath?: string | null
}

type ExternalLinkResult = {
  status: 'opened' | 'cancelled' | 'blocked'
}

type DocumentLinkResult = {
  status: 'opened' | 'focused' | 'cancelled' | 'blocked'
  target: 'external' | 'local'
  displayName?: string
  reason?: 'invalid-target' | 'missing-source-path' | 'missing-file' | 'not-file' | 'unsupported-scheme' | 'managed-client'
}

type DocumentLinkControllerDependencies = {
  fsPromises: Pick<typeof import('node:fs/promises'), 'stat'>
  pathImpl?: typeof import('node:path')
  fileURLToPathImpl?: typeof import('node:url')['fileURLToPath']
  ensureEditorRuntimeState: (window: WindowLike) => EditorRuntimeState
  openExternalLink: (window: WindowLike, href: string) => Promise<ExternalLinkResult>
  findEditorWindowByTrackedFilePath: (filePath: string) => WindowLike | null
  focusWindow: (window: WindowLike) => void
  createWindow: (launchRequest: { filePath: string; explicitInitialPanel: 'preview' }) => Promise<WindowLike>
  isManagedClient: () => boolean
  writeLog: (level: string, scope: string, ...parts: unknown[]) => void
}

type DocumentLinkController = {
  openDocumentLink: (sourceWindow: WindowLike | null, href: string) => Promise<DocumentLinkResult>
}

function splitLocalHrefSuffix(href: string) {
  const hashIndex = href.indexOf('#')
  const queryIndex = href.indexOf('?')
  const suffixIndexes = [hashIndex, queryIndex].filter((index) => index >= 0)
  const suffixIndex = suffixIndexes.length > 0 ? Math.min(...suffixIndexes) : href.length

  return href.slice(0, suffixIndex)
}

function decodeLocalHrefPath(href: string) {
  try {
    return decodeURIComponent(href)
  } catch {
    return null
  }
}

function hasExplicitScheme(href: string) {
  return /^[a-z][a-z\d+.-]*:/i.test(href)
}

function createDocumentLinkController({
  fsPromises,
  pathImpl = path,
  fileURLToPathImpl = fileURLToPath,
  ensureEditorRuntimeState,
  openExternalLink,
  findEditorWindowByTrackedFilePath,
  focusWindow,
  createWindow,
  isManagedClient,
  writeLog,
}: DocumentLinkControllerDependencies): DocumentLinkController {
  function resolveLocalTarget(sourceWindow: WindowLike, rawHref: string): { filePath: string } | { reason: DocumentLinkResult['reason'] } {
    const hrefWithoutSuffix = splitLocalHrefSuffix(rawHref)

    if (hrefWithoutSuffix.toLowerCase().startsWith('file:')) {
      try {
        return { filePath: pathImpl.normalize(fileURLToPathImpl(new URL(hrefWithoutSuffix))) }
      } catch {
        return { reason: 'invalid-target' }
      }
    }

    const decodedPath = decodeLocalHrefPath(hrefWithoutSuffix)
    if (!decodedPath || decodedPath.trim().length === 0) {
      return { reason: 'invalid-target' }
    }

    if (pathImpl.isAbsolute(decodedPath)) {
      return { filePath: pathImpl.normalize(decodedPath) }
    }

    if (hasExplicitScheme(decodedPath)) {
      return { reason: 'unsupported-scheme' }
    }

    const trackedFilePath = ensureEditorRuntimeState(sourceWindow).trackedFilePath
    if (!trackedFilePath) {
      return { reason: 'missing-source-path' }
    }

    return { filePath: pathImpl.resolve(pathImpl.dirname(trackedFilePath), decodedPath) }
  }

  async function openDocumentLink(sourceWindow: WindowLike | null, href: string): Promise<DocumentLinkResult> {
    const rawHref = typeof href === 'string' ? href.trim() : ''
    if (!sourceWindow || sourceWindow.isDestroyed() || rawHref.length === 0 || rawHref.startsWith('#')) {
      writeLog('WARN', 'document-link', 'Blocked invalid document link target', rawHref)
      return { status: 'blocked', target: 'local', reason: 'invalid-target' }
    }

    let parsedUrl: URL | null = null
    try {
      parsedUrl = new URL(rawHref)
    } catch {
      // Relative and native absolute paths are resolved below.
    }

    if (parsedUrl?.protocol === 'http:' || parsedUrl?.protocol === 'https:') {
      const result = await openExternalLink(sourceWindow, parsedUrl.href)
      return {
        ...result,
        target: 'external',
        displayName: parsedUrl.hostname,
      }
    }

    const resolvedTarget = resolveLocalTarget(sourceWindow, rawHref)
    if (!('filePath' in resolvedTarget)) {
      writeLog('WARN', 'document-link', 'Blocked local document link', { href: rawHref, reason: resolvedTarget.reason })
      return { status: 'blocked', target: 'local', reason: resolvedTarget.reason }
    }

    let targetStat: Awaited<ReturnType<typeof fsPromises.stat>>
    try {
      targetStat = await fsPromises.stat(resolvedTarget.filePath)
    } catch {
      writeLog('WARN', 'document-link', 'Local document link target is missing', resolvedTarget.filePath)
      return { status: 'blocked', target: 'local', reason: 'missing-file', displayName: pathImpl.basename(resolvedTarget.filePath) }
    }

    if (!targetStat.isFile()) {
      writeLog('WARN', 'document-link', 'Local document link target is not a file', resolvedTarget.filePath)
      return { status: 'blocked', target: 'local', reason: 'not-file', displayName: pathImpl.basename(resolvedTarget.filePath) }
    }

    const existingWindow = findEditorWindowByTrackedFilePath(resolvedTarget.filePath)
    if (existingWindow && !existingWindow.isDestroyed()) {
      focusWindow(existingWindow)
      writeLog('INFO', 'document-link', 'Focused existing editor for local link', resolvedTarget.filePath)
      return { status: 'focused', target: 'local', displayName: pathImpl.basename(resolvedTarget.filePath) }
    }

    if (isManagedClient()) {
      writeLog('WARN', 'document-link', 'Blocked local document link in managed-client mode', resolvedTarget.filePath)
      return { status: 'blocked', target: 'local', reason: 'managed-client', displayName: pathImpl.basename(resolvedTarget.filePath) }
    }

    const nextWindow = await createWindow({
      filePath: resolvedTarget.filePath,
      explicitInitialPanel: 'preview',
    })
    focusWindow(nextWindow)
    writeLog('INFO', 'document-link', 'Opened local document link in MDV', resolvedTarget.filePath)

    return { status: 'opened', target: 'local', displayName: pathImpl.basename(resolvedTarget.filePath) }
  }

  return {
    openDocumentLink,
  }
}

module.exports = {
  createDocumentLinkController,
}
