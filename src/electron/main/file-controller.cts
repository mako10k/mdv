const path = require('node:path') as typeof import('node:path')

type MessageBoxResult = {
  response: number
}

type SaveDialogResult = {
  canceled: boolean
  filePath?: string
}

type FileSnapshot = {
  path: string
  contentHash?: string
  size?: number
  mtimeMs?: number | null
}

type OptionalUtf8File = {
  path: string
  content: string
  snapshot: FileSnapshot
} | null

type SettingsState = {
  general: {
    openLinksBehavior: string
  }
  safety: {
    confirmBeforeExternalUrlOpen: boolean
  }
}

type MainI18n = {
  buttons: {
    cancel: string
    close: string
    overwriteSave: string
    saveAs: string
    mergeSave: string
  }
  externalLink: {
    allowAndRemember: string
    openOnce: string
    title: string
    message: string
    suggestedRuleLabel: string
  }
  fileDialog: {
    markdownFilter: string
    htmlFilter: string
    allFilesFilter: string
  }
  saveConflict: {
    title: string
    message: string
    detail: (targetPath: string) => string
    mergePreviewTitle: string
    mergePreviewMessage: string
    mergePreviewDetail: (targetPath: string, preview: string) => string
    mergePreviewContinue: string
    mergeFailedTitle: string
    mergeFailedMessage: string
  }
}

type PendingImportedAsset = {
  filePath: string
  relativePath?: string
}

type SaveContentPayload = {
  content?: string
  path?: string
  forceDialog?: boolean
  defaultFileName?: string
  expectedSnapshot?: FileSnapshot | null
  baseContent?: string
  draftWorkspace?: object | null
  recoveryKey?: string | null
  pendingImportedAssets?: PendingImportedAsset[]
}

type SaveContentResult =
  | { status: 'cancelled' }
  | { status: 'merge-failed', message: string }
  | { status: 'saved', path: string, content: string, snapshot: FileSnapshot }

type SaveHtmlPayload = {
  content?: string
  defaultFileName?: string
}

type HtmlExportResult = {
  path: string
} | null

type LinkOpenResult = {
  status: 'blocked' | 'cancelled' | 'opened'
}

type ParentWindowLike = unknown

type FsLike = {
  readFileSync: (filePath: string, encoding: 'utf8') => string
  mkdirSync: (filePath: string, options: { recursive: true }) => void
  writeFileSync: (filePath: string, content: string, encoding: 'utf8') => void
}

type FsPromisesLike = {
  writeFile: (filePath: string, content: string, encoding: 'utf8') => Promise<void>
  stat: (filePath: string) => Promise<{ mtimeMs?: number }>
  readFile: (filePath: string) => Promise<Buffer>
}

type FileControllerDependencies = {
  fs: FsLike
  fsPromises: FsPromisesLike
  shell: {
    openExternal: (href: string) => Promise<void>
  }
  allowedLinkRulesPath: string
  getMainI18n: () => MainI18n
  getSettingsState: () => SettingsState
  showMessageBox: (parentWindow: ParentWindowLike, options: Record<string, unknown>) => Promise<MessageBoxResult>
  showSaveDialog: (parentWindow: ParentWindowLike, options: Record<string, unknown>) => Promise<SaveDialogResult>
  writeLog: (level: string, scope: string, ...parts: unknown[]) => void
  readOptionalUtf8File: (filePath: string) => Promise<OptionalUtf8File>
  areFileSnapshotsEqual: (left: FileSnapshot | null, right: FileSnapshot | null) => boolean
  buildMergePreviewText: (baseContent: string, content: string, mergedContent: string, currentDiskContent: string) => string
  createPatch: (filePath: string, baseContent: string, content: string) => string
  applyPatch: (currentDiskContent: string, patch: string) => string | false
  materializeDraftWorkspaceAssets: (
    draftWorkspace: object | null | undefined,
    targetPath: string,
    content: string,
    recoveryKey: string | null | undefined,
  ) => Promise<string>
  materializePendingImportedAssets: (
    pendingImportedAssets: PendingImportedAsset[] | undefined,
    currentPath: string,
    targetPath: string,
    content: string,
  ) => Promise<string>
  buildFileSnapshot: (filePath: string, content: string, stat: { mtimeMs?: number }) => FileSnapshot
}

type FileController = {
  openExternalLink: (parentWindow: ParentWindowLike, href: string) => Promise<LinkOpenResult>
  readRelativeAssetAsDataUrl: (baseFilePath: string, source: string) => Promise<{ path: string, dataUrl: string } | null>
  saveContentToPath: (parentWindow: ParentWindowLike, payload: SaveContentPayload | undefined) => Promise<SaveContentResult>
  saveHtmlExportToPath: (parentWindow: ParentWindowLike, payload: SaveHtmlPayload | undefined) => Promise<HtmlExportResult>
}

function getMimeTypeForFile(filePath: string) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.svg':
      return 'image/svg+xml'
    case '.bmp':
      return 'image/bmp'
    case '.ico':
      return 'image/x-icon'
    case '.avif':
      return 'image/avif'
    default:
      return 'application/octet-stream'
  }
}

function isInlineExportImagePath(filePath: string) {
  return getMimeTypeForFile(filePath).startsWith('image/')
}

function createFileController({
  fs,
  fsPromises,
  shell,
  allowedLinkRulesPath,
  getMainI18n,
  getSettingsState,
  showMessageBox,
  showSaveDialog,
  writeLog,
  readOptionalUtf8File,
  areFileSnapshotsEqual,
  buildMergePreviewText,
  createPatch,
  applyPatch,
  materializeDraftWorkspaceAssets,
  materializePendingImportedAssets,
  buildFileSnapshot,
}: FileControllerDependencies): FileController {
  let allowedLinkRules = loadAllowedLinkRules()

  function loadAllowedLinkRules(): string[] {
    try {
      const raw = fs.readFileSync(allowedLinkRulesPath, 'utf8')
      const parsed: unknown = JSON.parse(raw)

      if (!Array.isArray(parsed)) {
        return []
      }

      return parsed.filter((rule): rule is string => typeof rule === 'string' && rule.length > 0)
    } catch {
      return []
    }
  }

  function saveAllowedLinkRules() {
    fs.mkdirSync(path.dirname(allowedLinkRulesPath), { recursive: true })
    fs.writeFileSync(allowedLinkRulesPath, JSON.stringify(allowedLinkRules, null, 2), 'utf8')
  }

  function isSupportedExternalUrl(targetUrl: URL) {
    return targetUrl.protocol === 'http:' || targetUrl.protocol === 'https:'
  }

  function createAllowedLinkRule(targetUrl: URL) {
    return `${targetUrl.origin}/*`
  }

  function isUrlAllowed(targetUrl: URL) {
    return allowedLinkRules.some((rule) => {
      if (rule.endsWith('*')) {
        return targetUrl.href.startsWith(rule.slice(0, -1))
      }

      return targetUrl.href === rule
    })
  }

  function registerAllowedLinkRule(rule: string) {
    if (allowedLinkRules.includes(rule)) {
      return
    }

    allowedLinkRules = [...allowedLinkRules, rule]
    saveAllowedLinkRules()
  }

  async function confirmExternalNavigation(parentWindow: ParentWindowLike, targetUrl: URL) {
    const messages = getMainI18n()
    const suggestedRule = createAllowedLinkRule(targetUrl)
    const response = await showMessageBox(parentWindow, {
      type: 'warning',
      buttons: [messages.externalLink.allowAndRemember, messages.externalLink.openOnce, messages.buttons.cancel],
      defaultId: 1,
      cancelId: 2,
      title: messages.externalLink.title,
      message: messages.externalLink.message,
      detail: `URL: ${targetUrl.href}\n${messages.externalLink.suggestedRuleLabel}: ${suggestedRule}`,
      noLink: true,
    })

    if (response.response === 0) {
      registerAllowedLinkRule(suggestedRule)
      return true
    }

    return response.response === 1
  }

  async function openExternalLink(parentWindow: ParentWindowLike, href: string): Promise<LinkOpenResult> {
    let targetUrl: URL

    try {
      targetUrl = new URL(href)
    } catch {
      writeLog('WARN', 'link', 'Invalid URL', href)
      return { status: 'blocked' }
    }

    const settingsState = getSettingsState()

    if (!isSupportedExternalUrl(targetUrl)) {
      writeLog('WARN', 'link', 'Unsupported protocol', targetUrl.href)
      return { status: 'blocked' }
    }

    if (settingsState.general.openLinksBehavior === 'block-untrusted' && !isUrlAllowed(targetUrl)) {
      writeLog('INFO', 'link', 'Blocked by settings policy', targetUrl.href)
      return { status: 'blocked' }
    }

    if (!isUrlAllowed(targetUrl)) {
      const confirmed = await confirmExternalNavigation(parentWindow, targetUrl)

      if (!confirmed) {
        writeLog('INFO', 'link', 'Blocked by confirmation dialog', targetUrl.href)
        return { status: 'cancelled' }
      }
    }

    if (!settingsState.safety.confirmBeforeExternalUrlOpen) {
      await shell.openExternal(targetUrl.href)
      writeLog('INFO', 'link', 'Opened in default browser without trusted-link confirmation', targetUrl.href)
      return { status: 'opened' }
    }

    await shell.openExternal(targetUrl.href)
    writeLog('INFO', 'link', 'Opened in default browser', targetUrl.href)

    return { status: 'opened' }
  }

  async function saveContentToPath(parentWindow: ParentWindowLike, payload: SaveContentPayload = {}): Promise<SaveContentResult> {
    const content = typeof payload.content === 'string' ? payload.content : ''
    const currentPath = typeof payload.path === 'string' ? payload.path : ''
    const forceDialog = payload.forceDialog === true
    const defaultFileName = typeof payload.defaultFileName === 'string' && payload.defaultFileName.trim().length > 0
      ? payload.defaultFileName.trim()
      : 'document.md'
    const expectedSnapshot = payload.expectedSnapshot && typeof payload.expectedSnapshot === 'object'
      ? payload.expectedSnapshot
      : null
    const baseContent = typeof payload.baseContent === 'string' ? payload.baseContent : content

    let targetPath = currentPath

    if (!targetPath || forceDialog) {
      const messages = getMainI18n()
      const result = await showSaveDialog(parentWindow, {
        defaultPath: currentPath || defaultFileName,
        filters: [
          { name: messages.fileDialog.markdownFilter, extensions: ['md', 'markdown', 'txt'] },
          { name: messages.fileDialog.allFilesFilter, extensions: ['*'] },
        ],
      })

      if (result.canceled || !result.filePath) {
        writeLog('INFO', 'ipc', 'save-file cancelled')
        return { status: 'cancelled' }
      }

      targetPath = result.filePath
    }

    let nextContent = content
    const currentDiskFile = await readOptionalUtf8File(targetPath)
    const shouldPromptConflict = targetPath === currentPath
      && Boolean(expectedSnapshot)
      && (!currentDiskFile || !areFileSnapshotsEqual(currentDiskFile.snapshot, expectedSnapshot))

    if (shouldPromptConflict) {
      const messages = getMainI18n()
      const response = await showMessageBox(parentWindow, {
        type: 'warning',
        buttons: [messages.buttons.overwriteSave, messages.buttons.saveAs, messages.buttons.mergeSave, messages.buttons.cancel],
        defaultId: 3,
        cancelId: 3,
        noLink: true,
        title: messages.saveConflict.title,
        message: messages.saveConflict.message,
        detail: messages.saveConflict.detail(targetPath),
      })

      if (response.response === 3) {
        return { status: 'cancelled' }
      }

      if (response.response === 1) {
        const saveAsResult = await showSaveDialog(parentWindow, {
          defaultPath: defaultFileName,
          filters: [
            { name: messages.fileDialog.markdownFilter, extensions: ['md', 'markdown', 'txt'] },
            { name: messages.fileDialog.allFilesFilter, extensions: ['*'] },
          ],
        })

        if (saveAsResult.canceled || !saveAsResult.filePath) {
          writeLog('INFO', 'ipc', 'save-file cancelled during save-as after conflict')
          return { status: 'cancelled' }
        }

        targetPath = saveAsResult.filePath
      }

      if (response.response === 2) {
        try {
          if (!currentDiskFile) {
            throw new Error('The local file no longer exists, so merge save is unavailable.')
          }

          if (typeof payload.baseContent !== 'string') {
            throw new Error('Merge save requires the last synchronized document content.')
          }

          const patch = createPatch(targetPath || 'document.md', baseContent, content)
          const mergedContent = applyPatch(currentDiskFile.content, patch)

          if (typeof mergedContent !== 'string') {
            throw new Error('The local file changed in a way that could not be merged automatically.')
          }

          const mergePreview = await showMessageBox(parentWindow, {
            type: 'question',
            buttons: [messages.saveConflict.mergePreviewContinue, messages.buttons.saveAs, messages.buttons.cancel],
            defaultId: 0,
            cancelId: 2,
            noLink: true,
            title: messages.saveConflict.mergePreviewTitle,
            message: messages.saveConflict.mergePreviewMessage,
            detail: messages.saveConflict.mergePreviewDetail(
              targetPath,
              buildMergePreviewText(baseContent, content, mergedContent, currentDiskFile.content),
            ),
          })

          if (mergePreview.response === 2) {
            return { status: 'cancelled' }
          }

          if (mergePreview.response === 1) {
            const saveAsResult = await showSaveDialog(parentWindow, {
              defaultPath: defaultFileName,
              filters: [
                { name: messages.fileDialog.markdownFilter, extensions: ['md', 'markdown', 'txt'] },
                { name: messages.fileDialog.allFilesFilter, extensions: ['*'] },
              ],
            })

            if (saveAsResult.canceled || !saveAsResult.filePath) {
              writeLog('INFO', 'ipc', 'save-file cancelled during save-as after merge preview')
              return { status: 'cancelled' }
            }

            targetPath = saveAsResult.filePath
            nextContent = content
          } else {
            nextContent = mergedContent
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          await showMessageBox(parentWindow, {
            type: 'error',
            buttons: [messages.buttons.close],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
            title: messages.saveConflict.mergeFailedTitle,
            message: messages.saveConflict.mergeFailedMessage,
            detail: message,
          })
          return {
            status: 'merge-failed',
            message,
          }
        }
      }
    }

    if (!currentPath && (payload.draftWorkspace || payload.recoveryKey)) {
      nextContent = await materializeDraftWorkspaceAssets(payload.draftWorkspace, targetPath, nextContent, payload.recoveryKey)
    }

    if (currentPath && targetPath !== currentPath && payload.pendingImportedAssets) {
      nextContent = await materializePendingImportedAssets(payload.pendingImportedAssets, currentPath, targetPath, nextContent)
    }

    await fsPromises.writeFile(targetPath, nextContent, 'utf8')
    const stat = await fsPromises.stat(targetPath)
    writeLog('INFO', 'ipc', 'save-file wrote', targetPath)

    return {
      status: 'saved',
      path: targetPath,
      content: nextContent,
      snapshot: buildFileSnapshot(targetPath, nextContent, stat),
    }
  }

  async function saveHtmlExportToPath(parentWindow: ParentWindowLike, payload: SaveHtmlPayload = {}): Promise<HtmlExportResult> {
    const content = typeof payload.content === 'string' ? payload.content : ''
    const defaultFileName = typeof payload.defaultFileName === 'string' && payload.defaultFileName.trim().length > 0
      ? payload.defaultFileName.trim()
      : 'document.html'
    const messages = getMainI18n()
    const result = await showSaveDialog(parentWindow, {
      defaultPath: defaultFileName,
      filters: [
        { name: messages.fileDialog.htmlFilter, extensions: ['html', 'htm'] },
        { name: messages.fileDialog.allFilesFilter, extensions: ['*'] },
      ],
    })

    if (result.canceled || !result.filePath) {
      writeLog('INFO', 'ipc', 'export-html cancelled')
      return null
    }

    await fsPromises.writeFile(result.filePath, content, 'utf8')
    writeLog('INFO', 'ipc', 'export-html wrote', result.filePath)

    return {
      path: result.filePath,
    }
  }

  async function readRelativeAssetAsDataUrl(baseFilePath: string, source: string) {
    const normalizedBasePath = typeof baseFilePath === 'string' ? baseFilePath.trim() : ''
    const normalizedSource = typeof source === 'string' ? source.trim() : ''

    if (!normalizedBasePath || !normalizedSource || normalizedSource.startsWith('//')) {
      return null
    }

    if (/^[a-z][a-z0-9+.-]*:/i.test(normalizedSource)) {
      return null
    }

    const sourcePath = normalizedSource.split('#', 1)[0].split('?', 1)[0]
    let decodedSourcePath = sourcePath

    try {
      decodedSourcePath = decodeURI(sourcePath)
    } catch {
      return null
    }

    if (!decodedSourcePath || path.posix.isAbsolute(decodedSourcePath) || path.win32.isAbsolute(decodedSourcePath)) {
      return null
    }

    const resolvedPath = path.resolve(path.dirname(normalizedBasePath), decodedSourcePath)

    if (!isInlineExportImagePath(resolvedPath)) {
      return null
    }

    const content = await fsPromises.readFile(resolvedPath)

    return {
      path: resolvedPath,
      dataUrl: `data:${getMimeTypeForFile(resolvedPath)};base64,${content.toString('base64')}`,
    }
  }

  return {
    openExternalLink,
    readRelativeAssetAsDataUrl,
    saveContentToPath,
    saveHtmlExportToPath,
  }
}

export {
  createFileController,
  getMimeTypeForFile,
  isInlineExportImagePath,
}
