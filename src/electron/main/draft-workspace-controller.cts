type DraftWorkspaceRecord = {
  workspaceId: string
  rootDir: string
  markdownFilePath: string
  assetDir: string
  manifestPath: string
}

type PendingImportedAsset = {
  filePath: string
  relativePath: string
}

type RecoveryEntry = {
  snapshot?: {
    markdownText?: string
    draftWorkspace?: unknown
  } | null
} | null

type DraftWorkspaceControllerOptions = {
  fs: typeof import('node:fs')
  fsPromises: typeof import('node:fs/promises')
  path: typeof import('node:path')
  randomUUID: () => string
  draftWorkspaceRootPath: string
  normalizeRecoveryFilePath: (filePath: unknown) => string | null
  getAutosaveRecoveryByRecoveryKey: (recoveryKey: unknown) => RecoveryEntry
  getLatestAutosaveRecovery: () => RecoveryEntry
  getMimeTypeForFile: (filePath: string) => string
  isInlineExportImagePath: (filePath: string) => boolean
}

type DraftWorkspaceController = {
  ensureDraftWorkspace: (payload?: Record<string, unknown>) => Promise<DraftWorkspaceRecord>
  importImageAsset: (payload?: Record<string, unknown>) => Promise<{
    filePath: string
    relativePath: string
    markdownFilePath: string
    draftWorkspace: DraftWorkspaceRecord | null
  } | null>
  cleanupImportedAssetFiles: (filePaths: unknown) => Promise<void>
  cleanupDraftWorkspace: (payload?: Record<string, unknown>) => Promise<void>
  materializeDraftWorkspaceAssets: (
    draftWorkspace: unknown,
    targetMarkdownPath: string,
    markdown: string,
    recoveryKey?: string | null,
  ) => Promise<string>
  materializePendingImportedAssets: (
    pendingImportedAssets: PendingImportedAsset[] | undefined,
    currentMarkdownPath: string,
    targetMarkdownPath: string,
    markdown: string,
  ) => Promise<string>
  collectReferencedDraftAssetPaths: (markdown: string) => string[]
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function createDraftWorkspaceController(options: DraftWorkspaceControllerOptions): DraftWorkspaceController {
  const {
    fs,
    fsPromises,
    path,
    randomUUID,
    draftWorkspaceRootPath,
    normalizeRecoveryFilePath,
    getAutosaveRecoveryByRecoveryKey,
    getLatestAutosaveRecovery,
    getMimeTypeForFile,
    isInlineExportImagePath,
  } = options

  function normalizeWorkspaceId(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
  }

  function buildDraftWorkspaceRecord(workspaceId: string): DraftWorkspaceRecord {
    const rootDir = path.join(draftWorkspaceRootPath, workspaceId)

    return {
      workspaceId,
      rootDir,
      markdownFilePath: path.join(rootDir, 'document.md'),
      assetDir: path.join(rootDir, 'assets'),
      manifestPath: path.join(rootDir, 'manifest.json'),
    }
  }

  async function ensureDraftWorkspace(payload: Record<string, unknown> = {}) {
    const workspaceId = normalizeWorkspaceId(payload.workspaceId) || `wrk_${randomUUID()}`
    const workspace = buildDraftWorkspaceRecord(workspaceId)

    await fsPromises.mkdir(workspace.assetDir, { recursive: true })

    const existingManifest = await readDraftWorkspaceManifest(workspace)

    if (existingManifest) {
      return workspace
    }

    const manifest = {
      workspaceId,
      kind: 'draft',
      markdownFile: path.relative(workspace.rootDir, workspace.markdownFilePath),
      assetDir: path.relative(workspace.rootDir, workspace.assetDir),
      assets: [],
    }

    await fsPromises.writeFile(workspace.manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

    return workspace
  }

  function normalizeDraftWorkspacePayload(value: unknown) {
    const workspaceId = normalizeWorkspaceId(isObjectRecord(value) ? value.workspaceId : null)

    if (!workspaceId) {
      return null
    }

    return buildDraftWorkspaceRecord(workspaceId)
  }

  function ensurePosixRelativePath(value: string) {
    return value.split(path.sep).join('/')
  }

  function isImageMimeType(mimeType: unknown) {
    return typeof mimeType === 'string' && mimeType.startsWith('image/')
  }

  function getExtensionForMimeType(mimeType: unknown) {
    switch ((typeof mimeType === 'string' ? mimeType : '').toLowerCase()) {
      case 'image/png':
        return '.png'
      case 'image/jpeg':
        return '.jpg'
      case 'image/gif':
        return '.gif'
      case 'image/webp':
        return '.webp'
      case 'image/svg+xml':
        return '.svg'
      case 'image/bmp':
        return '.bmp'
      case 'image/x-icon':
        return '.ico'
      case 'image/avif':
        return '.avif'
      default:
        return ''
    }
  }

  function sanitizeAssetFileName(fileName: unknown, mimeType: unknown) {
    const trimmedName = typeof fileName === 'string' ? fileName.trim() : ''
    const normalizedName = trimmedName.length > 0 ? trimmedName : `image${getExtensionForMimeType(mimeType) || '.png'}`
    const parsedName = path.parse(normalizedName)
    const safeBaseName = (parsedName.name || 'image').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'image'
    const extension = parsedName.ext || getExtensionForMimeType(mimeType) || '.png'
    return `${safeBaseName}${extension.toLowerCase()}`
  }

  async function getUniqueFilePath(directoryPath: string, fileName: string) {
    const parsedName = path.parse(fileName)
    let candidateIndex = 1
    let candidatePath = path.join(directoryPath, fileName)

    while (true) {
      try {
        await fsPromises.access(candidatePath, fs.constants.F_OK)
        candidateIndex += 1
        candidatePath = path.join(directoryPath, `${parsedName.name}-${candidateIndex}${parsedName.ext}`)
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
          return candidatePath
        }

        throw error
      }
    }
  }

  async function readDraftWorkspaceManifest(draftWorkspace: DraftWorkspaceRecord) {
    try {
      const parsed: unknown = JSON.parse(await fsPromises.readFile(draftWorkspace.manifestPath, 'utf8'))
      return isObjectRecord(parsed) ? parsed : null
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return null
      }

      throw error
    }
  }

  async function writeDraftWorkspaceManifest(draftWorkspace: DraftWorkspaceRecord, manifest: Record<string, unknown>) {
    await fsPromises.mkdir(draftWorkspace.rootDir, { recursive: true })
    await fsPromises.writeFile(draftWorkspace.manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
  }

  async function appendDraftWorkspaceAssetRecord(draftWorkspace: DraftWorkspaceRecord, assetRecord: Record<string, unknown>) {
    const manifest = await readDraftWorkspaceManifest(draftWorkspace) || {
      workspaceId: draftWorkspace.workspaceId,
      kind: 'draft',
      markdownFile: path.relative(draftWorkspace.rootDir, draftWorkspace.markdownFilePath),
      assetDir: path.relative(draftWorkspace.rootDir, draftWorkspace.assetDir),
      assets: [],
    }

    const assets = Array.isArray(manifest.assets) ? manifest.assets : []
    assets.push(assetRecord)
    manifest.assets = assets
    await writeDraftWorkspaceManifest(draftWorkspace, manifest)
  }

  function buildWorkspaceAssetContext(payload: Record<string, unknown> = {}) {
    const currentFilePath = normalizeRecoveryFilePath(payload.currentFilePath)

    if (currentFilePath) {
      return {
        markdownFilePath: currentFilePath,
        assetDir: path.join(path.dirname(currentFilePath), 'assets'),
        draftWorkspace: null,
      }
    }

    const draftWorkspace = normalizeDraftWorkspacePayload(payload.draftWorkspace)

    if (!draftWorkspace) {
      return null
    }

    return {
      markdownFilePath: draftWorkspace.markdownFilePath,
      assetDir: draftWorkspace.assetDir,
      draftWorkspace,
    }
  }

  async function importImageAsset(payload: Record<string, unknown> = {}) {
    const workspaceContext = buildWorkspaceAssetContext(payload)

    if (!workspaceContext) {
      return null
    }

    const sourcePath = normalizeRecoveryFilePath(payload.sourcePath)
    const mimeType = typeof payload.mimeType === 'string' ? payload.mimeType.trim().toLowerCase() : ''
    const suggestedName = typeof payload.suggestedName === 'string' ? payload.suggestedName.trim() : ''
    let content: Buffer | null = null

    if (sourcePath) {
      if (!isInlineExportImagePath(sourcePath)) {
        return null
      }

      content = await fsPromises.readFile(sourcePath)
    } else if (typeof payload.bytesBase64 === 'string' && payload.bytesBase64.length > 0) {
      if (!isImageMimeType(mimeType)) {
        return null
      }

      content = Buffer.from(payload.bytesBase64, 'base64')
    }

    if (!content) {
      return null
    }

    await fsPromises.mkdir(workspaceContext.assetDir, { recursive: true })
    const fileName = sanitizeAssetFileName(suggestedName || (sourcePath ? path.basename(sourcePath) : ''), mimeType || (sourcePath ? getMimeTypeForFile(sourcePath) : ''))
    const targetPath = await getUniqueFilePath(workspaceContext.assetDir, fileName)
    await fsPromises.writeFile(targetPath, content)

    const relativePath = ensurePosixRelativePath(path.relative(path.dirname(workspaceContext.markdownFilePath), targetPath))

    if (workspaceContext.draftWorkspace) {
      const stat = await fsPromises.stat(targetPath)
      await appendDraftWorkspaceAssetRecord(workspaceContext.draftWorkspace, {
        assetId: `ast_${randomUUID()}`,
        relativePath,
        mimeType: mimeType || getMimeTypeForFile(targetPath),
        byteSize: Number(stat.size) || content.length,
        createdBy: payload.createdBy === 'drop' ? 'drop' : 'paste',
      })
    }

    return {
      filePath: targetPath,
      relativePath,
      markdownFilePath: workspaceContext.markdownFilePath,
      draftWorkspace: workspaceContext.draftWorkspace,
    }
  }

  function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function rewriteMarkdownAssetPath(markdown: string, currentRelativePath: string, nextRelativePath: string) {
    if (currentRelativePath === nextRelativePath) {
      return markdown
    }

    const expression = new RegExp(`(\\!?(?:\\[[^\\]]*\\])\\()${escapeRegExp(currentRelativePath)}(?=[)#?])`, 'g')
    return markdown.replace(expression, `$1${nextRelativePath}`)
  }

  function collectReferencedDraftAssetPaths(markdown: string) {
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

    return [...assetPaths]
  }

  function collectReferencedRelativeAssetPaths(markdown: string) {
    return new Set(collectReferencedDraftAssetPaths(markdown))
  }

  function collectDraftWorkspaceMaterializationPaths(_manifest: unknown, markdown: string) {
    const assetRelativePaths = new Set<string>()

    for (const relativePath of collectReferencedDraftAssetPaths(markdown)) {
      assetRelativePaths.add(relativePath)
    }

    return assetRelativePaths
  }

  async function cleanupImportedAssetFiles(filePaths: unknown) {
    for (const filePath of Array.isArray(filePaths) ? filePaths : []) {
      if (typeof filePath !== 'string' || filePath.trim().length === 0) {
        continue
      }

      try {
        await fsPromises.unlink(filePath)
      } catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
          throw error
        }
      }
    }
  }

  async function cleanupDraftWorkspace(payload: Record<string, unknown> = {}) {
    const draftWorkspace = normalizeDraftWorkspacePayload(payload.draftWorkspace)

    if (!draftWorkspace) {
      return
    }

    await fsPromises.rm(draftWorkspace.rootDir, { recursive: true, force: true })
  }

  async function resolveDraftWorkspaceForMaterialization(draftWorkspace: unknown, recoveryKey: string | null | undefined, markdown: string) {
    const normalizedDraftWorkspace = normalizeDraftWorkspacePayload(draftWorkspace)
    const recoveredEntry = getAutosaveRecoveryByRecoveryKey(recoveryKey)

    if (recoveredEntry?.snapshot?.draftWorkspace) {
      const recoveredDraftWorkspace = normalizeDraftWorkspacePayload(recoveredEntry.snapshot.draftWorkspace)

      if (recoveredDraftWorkspace) {
        const recoveredManifest = await readDraftWorkspaceManifest(recoveredDraftWorkspace)

        if (collectDraftWorkspaceMaterializationPaths(recoveredManifest, markdown).size > 0) {
          return recoveredDraftWorkspace
        }
      }
    }

    if (normalizedDraftWorkspace) {
      const manifest = await readDraftWorkspaceManifest(normalizedDraftWorkspace)

      if (collectDraftWorkspaceMaterializationPaths(manifest, markdown).size > 0) {
        return normalizedDraftWorkspace
      }
    }

    const latestRecovery = getLatestAutosaveRecovery()

    if (!latestRecovery?.snapshot || latestRecovery.snapshot.markdownText !== markdown) {
      return normalizedDraftWorkspace
    }

    const recoveredDraftWorkspace = normalizeDraftWorkspacePayload(latestRecovery.snapshot.draftWorkspace)

    if (!recoveredDraftWorkspace) {
      return normalizedDraftWorkspace
    }

    const recoveredManifest = await readDraftWorkspaceManifest(recoveredDraftWorkspace)

    if (collectDraftWorkspaceMaterializationPaths(recoveredManifest, markdown).size === 0) {
      return normalizedDraftWorkspace
    }

    return recoveredDraftWorkspace
  }

  async function materializeDraftWorkspaceAssets(
    draftWorkspace: unknown,
    targetMarkdownPath: string,
    markdown: string,
    recoveryKey: string | null = null,
  ) {
    const normalizedDraftWorkspace = await resolveDraftWorkspaceForMaterialization(
      draftWorkspace,
      recoveryKey,
      markdown,
    )

    if (!normalizedDraftWorkspace) {
      return markdown
    }

    const manifest = await readDraftWorkspaceManifest(normalizedDraftWorkspace)
    const assetRelativePaths = collectDraftWorkspaceMaterializationPaths(manifest, markdown)

    if (assetRelativePaths.size === 0) {
      return markdown
    }

    const targetAssetDir = path.join(path.dirname(targetMarkdownPath), 'assets')
    await fsPromises.mkdir(targetAssetDir, { recursive: true })
    let nextMarkdown = markdown

    for (const relativePath of assetRelativePaths) {
      const sourceAssetPath = path.resolve(normalizedDraftWorkspace.rootDir, relativePath)

      try {
        await fsPromises.access(sourceAssetPath, fs.constants.F_OK)
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
          continue
        }

        throw error
      }

      const targetAssetPath = await getUniqueFilePath(targetAssetDir, path.basename(relativePath))
      await fsPromises.copyFile(sourceAssetPath, targetAssetPath)
      const nextRelativePath = ensurePosixRelativePath(path.relative(path.dirname(targetMarkdownPath), targetAssetPath))
      nextMarkdown = rewriteMarkdownAssetPath(nextMarkdown, relativePath, nextRelativePath)
    }

    return nextMarkdown
  }

  async function materializePendingImportedAssets(
    pendingImportedAssets: PendingImportedAsset[] | undefined,
    currentMarkdownPath: string,
    targetMarkdownPath: string,
    markdown: string,
  ) {
    const assets = Array.isArray(pendingImportedAssets)
      ? pendingImportedAssets.filter((asset): asset is PendingImportedAsset => typeof asset?.filePath === 'string' && typeof asset?.relativePath === 'string')
      : []

    if (assets.length === 0 || !currentMarkdownPath || currentMarkdownPath === targetMarkdownPath) {
      return markdown
    }

    const referencedAssetPaths = collectReferencedRelativeAssetPaths(markdown)

    if (referencedAssetPaths.size === 0) {
      return markdown
    }

    const targetAssetDir = path.join(path.dirname(targetMarkdownPath), 'assets')
    await fsPromises.mkdir(targetAssetDir, { recursive: true })
    let nextMarkdown = markdown

    for (const asset of assets) {
      if (!referencedAssetPaths.has(asset.relativePath)) {
        continue
      }

      const targetAssetPath = await getUniqueFilePath(targetAssetDir, path.basename(asset.relativePath))
      await fsPromises.copyFile(asset.filePath, targetAssetPath)
      const nextRelativePath = ensurePosixRelativePath(path.relative(path.dirname(targetMarkdownPath), targetAssetPath))
      nextMarkdown = rewriteMarkdownAssetPath(nextMarkdown, asset.relativePath, nextRelativePath)
    }

    return nextMarkdown
  }

  return {
    ensureDraftWorkspace,
    importImageAsset,
    cleanupImportedAssetFiles,
    cleanupDraftWorkspace,
    materializeDraftWorkspaceAssets,
    materializePendingImportedAssets,
    collectReferencedDraftAssetPaths,
  }
}

export {
  createDraftWorkspaceController,
}
