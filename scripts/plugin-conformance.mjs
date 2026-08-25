import path from 'node:path'
import { createRequire } from 'node:module'

import { extractFile, statFile } from '@electron/asar'

const require = createRequire(import.meta.url)
const {
  createContainedFileReader,
  INTERNAL_PLUGIN_CONTRACT,
  loadPluginCatalog,
  toPublicPluginDiagnostics,
} = require('../electron/lib/main/plugin-catalog.cjs')

function assertContainedPosixPath(relativePath, label) {
  if (typeof relativePath !== 'string'
    || relativePath.length === 0
    || relativePath.startsWith('/')
    || relativePath.includes('\\')
    || relativePath.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`${label} must be a contained bundle-relative POSIX path`)
  }
  return relativePath
}

function createFileSystemReader(packageRoot) {
  let readerPromise = null
  return async (relativePath) => {
    readerPromise ??= createContainedFileReader(packageRoot)
    return (await readerPromise)(relativePath)
  }
}

function createAsarReader(asarPath, packageRoot) {
  const containedRoot = packageRoot === '.'
    ? ''
    : assertContainedPosixPath(packageRoot, 'Packaged Plugin root')
  return async (relativePath) => {
    const containedPath = assertContainedPosixPath(relativePath, 'Packaged Plugin resource path')
    const archivePath = containedRoot ? path.posix.join(containedRoot, containedPath) : containedPath
    let currentPath = ''
    for (const segment of archivePath.split('/')) {
      currentPath = currentPath ? path.posix.join(currentPath, segment) : segment
      const stat = statFile(asarPath, currentPath)
      if (stat && typeof stat === 'object' && typeof stat.link === 'string') {
        throw new Error(`Packaged Plugin paths must not contain symbolic links: ${archivePath}`)
      }
    }
    return extractFile(asarPath, archivePath)
  }
}

function toDeveloperConformanceReport(catalog) {
  const publicDiagnostics = toPublicPluginDiagnostics(catalog)
  return {
    ok: catalog.packages.every((entry) => entry.status === 'ready'),
    contractVersion: catalog.contractVersion,
    hostVersion: catalog.hostVersion,
    packages: catalog.packages.map((entry, index) => ({
      ...publicDiagnostics.packages[index],
      manifestSha256: entry.locatedFacts?.manifestSha256 ?? null,
      resources: entry.locatedFacts?.resources.map((resource) => ({
        id: resource.id,
        relativePath: resource.relativePath,
        declaredSha256: resource.declaredSha256,
        actualSha256: resource.actualSha256,
        digestMatches: resource.digestMatches,
      })) ?? [],
      diagnostics: entry.diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        severity: diagnostic.severity,
        message: diagnostic.publicMessage,
        detail: diagnostic.developerDetail,
        remediation: diagnostic.remediation,
        relativeLocation: diagnostic.relativeLocation,
      })),
    })),
  }
}

export async function validatePluginPackageRoot(options) {
  const packageRoot = path.resolve(options.packageRoot)
  const manifestRelativePath = assertContainedPosixPath(options.manifestRelativePath ?? 'plugin.json', 'Plugin manifest path')
  const catalog = await loadPluginCatalog(options.hostVersion, [{
    catalogId: options.catalogId ?? 'explicit-package',
    origin: 'bundled',
    packageRoot,
    manifestRelativePath,
    readFile: createFileSystemReader(packageRoot),
  }])
  return toDeveloperConformanceReport(catalog)
}

export async function validatePluginPackageInAsar(options) {
  const manifestPath = assertContainedPosixPath(options.manifestPath, 'Packaged Plugin manifest path')
  const packageRoot = path.posix.dirname(manifestPath)
  const manifestRelativePath = path.posix.basename(manifestPath)
  const catalog = await loadPluginCatalog(options.hostVersion, [{
    catalogId: options.catalogId ?? 'explicit-packaged-plugin',
    origin: 'bundled',
    packageRoot,
    manifestRelativePath,
    readFile: createAsarReader(path.resolve(options.asarPath), packageRoot),
  }])
  return toDeveloperConformanceReport(catalog)
}

export async function validateBundledPluginCatalogInAsar(options) {
  const sources = INTERNAL_PLUGIN_CONTRACT.bundledRegistrations.map((registration) => {
    const manifestPath = assertContainedPosixPath(registration.manifestPath, 'Bundled Plugin manifest path')
    const packageRoot = path.posix.dirname(manifestPath)
    return {
      catalogId: registration.catalogId,
      origin: 'bundled',
      packageRoot,
      manifestRelativePath: path.posix.basename(manifestPath),
      readFile: createAsarReader(path.resolve(options.asarPath), packageRoot),
    }
  })
  const catalog = await loadPluginCatalog(options.hostVersion, sources)
  return toDeveloperConformanceReport(catalog)
}
