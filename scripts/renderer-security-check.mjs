import path from 'node:path'

const RENDERER_ENTRY_PATTERN = /<script type="module"[^>]*src="\.\/(assets\/main-[^"]+\.js)"/
const LEGACY_DOMPURIFY_PATTERN = /DOMPurify 2\.3\.3|\.version=["'`]2\.3\.3["'`]/

export function findRendererEntryPath(indexHtml) {
  const entryMatch = indexHtml.match(RENDERER_ENTRY_PATTERN)
  if (!entryMatch) {
    throw new Error('Could not locate the renderer main entry in dist/index.html.')
  }
  return entryMatch[1]
}

export function findPackagedRendererEntryPath(indexHtml, pathImpl = path) {
  return pathImpl.join('dist', ...findRendererEntryPath(indexHtml).split('/'))
}

export function assertRendererSecurityEntry(packageJson, indexHtml, entrySource) {
  const expectedDomPurifyVersion = packageJson.dependencies?.dompurify
  if (typeof expectedDomPurifyVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(expectedDomPurifyVersion)) {
    throw new Error('package.json must declare DOMPurify as an exact direct dependency.')
  }

  const versionOccurrences = entrySource.split(expectedDomPurifyVersion).length - 1
  if (versionOccurrences !== 1) {
    throw new Error(
      `Renderer entry must contain exactly one DOMPurify ${expectedDomPurifyVersion} implementation marker; found ${versionOccurrences}.`,
    )
  }

  if (LEGACY_DOMPURIFY_PATTERN.test(entrySource)) {
    throw new Error('Renderer entry still contains Toast UI Editor\'s legacy DOMPurify 2.3.3 implementation.')
  }

  return {
    entryPath: findRendererEntryPath(indexHtml),
    domPurifyVersion: expectedDomPurifyVersion,
  }
}
