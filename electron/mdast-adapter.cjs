const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const mdastRoot = path.join(__dirname, '..', 'vendor', 'mdast-control')
const mdastDistEntry = path.join(mdastRoot, 'dist', 'index.js')
const mdastLspEntry = path.join(mdastRoot, 'dist', 'lsp', 'server.js')

let mdastModulePromise = null

function getMdastPaths() {
  return {
    root: mdastRoot,
    distEntry: mdastDistEntry,
    lspEntry: mdastLspEntry,
  }
}

function isMdastBuilt() {
  return fs.existsSync(mdastDistEntry)
}

function ensureMdastBuilt() {
  if (isMdastBuilt()) {
    return
  }

  throw new Error(
    'mdast-control is not built. Run "npm run mdast:install" once, then "npm run mdast:build" before using MDV mdast integration.',
  )
}

async function loadMdastModule() {
  ensureMdastBuilt()

  if (!mdastModulePromise) {
    mdastModulePromise = import(pathToFileURL(mdastDistEntry).href)
  }

  return mdastModulePromise
}

async function getMdastCapabilities() {
  const mdast = await loadMdastModule()
  return mdast.getCapabilities()
}

async function validateMarkdownQuery(query) {
  const mdast = await loadMdastModule()
  return mdast.validateQuery(query)
}

async function queryMarkdown(markdown, query) {
  const mdast = await loadMdastModule()
  const tree = mdast.parseMarkdown(markdown)
  return mdast.queryAst(tree, query)
}

function toFiniteNumber(value) {
  const normalized = Number(value)
  return Number.isFinite(normalized) ? normalized : null
}

function summarizeNode(markdown, node, path, treeDepth, parentPath = null) {
  const start = node?.position?.start || null
  const end = node?.position?.end || null
  const startOffset = toFiniteNumber(start?.offset)
  const endOffset = toFiniteNumber(end?.offset)
  const rawMarkdown = startOffset !== null && endOffset !== null && endOffset >= startOffset
    ? markdown.slice(startOffset, endOffset)
    : ''

  return {
    path,
    parentPath,
    treeDepth,
    type: typeof node?.type === 'string' ? node.type : 'unknown',
    childCount: Array.isArray(node?.children) ? node.children.length : 0,
    depth: Number.isFinite(Number(node?.depth)) ? Number(node.depth) : undefined,
    ordered: typeof node?.ordered === 'boolean' ? node.ordered : undefined,
    checked: typeof node?.checked === 'boolean' ? node.checked : undefined,
    lang: typeof node?.lang === 'string' ? node.lang : undefined,
    url: typeof node?.url === 'string' ? node.url : undefined,
    title: typeof node?.title === 'string' ? node.title : undefined,
    text: collectVisibleText(node),
    markdown: rawMarkdown,
    position: {
      start: {
        line: Number.isFinite(Number(start?.line)) ? Number(start.line) : null,
        column: Number.isFinite(Number(start?.column)) ? Number(start.column) : null,
        offset: startOffset,
      },
      end: {
        line: Number.isFinite(Number(end?.line)) ? Number(end.line) : null,
        column: Number.isFinite(Number(end?.column)) ? Number(end.column) : null,
        offset: endOffset,
      },
    },
  }
}

function comparePath(left, right) {
  const maxLength = Math.max(left.length, right.length)

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = left[index]
    const rightValue = right[index]

    if (leftValue === rightValue) {
      continue
    }

    if (leftValue === undefined) {
      return -1
    }

    if (rightValue === undefined) {
      return 1
    }

    return leftValue - rightValue
  }

  return 0
}

function isPathPrefix(prefix, path) {
  return prefix.length <= path.length && prefix.every((value, index) => path[index] === value)
}

function adjustPathAfterRemovals(path, removedPaths) {
  const adjustedPath = [...path]

  for (const removedPath of removedPaths) {
    if (isPathPrefix(removedPath, adjustedPath)) {
      return null
    }

    const removedDepth = removedPath.length - 1
    if (removedDepth < 0 || adjustedPath.length <= removedDepth) {
      continue
    }

    const sameParent = removedPath.slice(0, removedDepth).every((value, index) => adjustedPath[index] === value)
    if (sameParent && removedPath[removedDepth] < adjustedPath[removedDepth]) {
      adjustedPath[removedDepth] -= 1
    }
  }

  return adjustedPath
}

function cloneNode(node) {
  return structuredClone(node)
}

function isValidPath(path) {
  return Array.isArray(path) && path.every((value) => Number.isInteger(value) && value >= 0)
}

function resolvePathEntry(tree, path) {
  if (!isValidPath(path)) {
    throw new Error('Invalid structure path')
  }

  if (path.length === 0) {
    return {
      node: tree,
      parent: null,
      index: -1,
      path: [],
    }
  }

  let parent = null
  let node = tree

  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index]

    if (!Array.isArray(node?.children) || segment >= node.children.length) {
      throw new Error(`Unknown structure path: ${JSON.stringify(path)}`)
    }

    parent = node
    node = node.children[segment]
  }

  return {
    node,
    parent,
    index: path[path.length - 1],
    path: [...path],
  }
}

function resolveSelectorMatches(tree, selector, queryAst) {
  if (!selector || typeof selector !== 'object') {
    throw new Error('Structure selector is required')
  }

  if (typeof selector.query === 'string' && selector.query.trim().length > 0) {
    return queryAst(tree, selector.query.trim())
  }

  if (selector.path !== undefined) {
    return [resolvePathEntry(tree, selector.path)]
  }

  throw new Error('Structure selector must provide query or path')
}

function assertInsertPosition(position) {
  if (position !== 'before' && position !== 'after' && position !== 'prepend' && position !== 'append') {
    throw new Error(`Unsupported insert position "${position}"`)
  }
}

function applyInsert(tree, matches, position, snippetNodes) {
  assertInsertPosition(position)
  const clones = snippetNodes.map(cloneNode)
  let inserted = 0
  const orderedMatches = [...matches].sort((left, right) => comparePath(right.path, left.path))

  for (const match of orderedMatches) {
    if (position === 'before' || position === 'after') {
      const parent = match.parent
      if (!parent?.children || match.index < 0) {
        throw new Error(`Cannot ${position} root node`)
      }
      const offset = position === 'before' ? 0 : 1
      parent.children.splice(match.index + offset, 0, ...clones.map(cloneNode))
      inserted += clones.length
      continue
    }

    if (!Array.isArray(match.node.children)) {
      throw new Error(`Cannot ${position} into non-container node type "${match.node.type}"`)
    }

    if (position === 'prepend') {
      match.node.children.unshift(...clones.map(cloneNode))
    } else {
      match.node.children.push(...clones.map(cloneNode))
    }
    inserted += clones.length
  }

  return { tree, inserted }
}

function applyDelete(tree, matches) {
  const normalizedMatches = normalizeNonOverlappingMatches(matches)
  let changed = 0
  const orderedMatches = [...normalizedMatches].sort((left, right) => comparePath(right.path, left.path))

  for (const match of orderedMatches) {
    if (!match.parent?.children || match.index < 0) {
      throw new Error('Cannot delete root node')
    }

    match.parent.children.splice(match.index, 1)
    changed += 1
  }

  return { tree, changed }
}

function applyReplace(tree, matches, snippetNodes) {
  const normalizedMatches = normalizeNonOverlappingMatches(matches)
  let changed = 0
  const orderedMatches = [...normalizedMatches].sort((left, right) => comparePath(right.path, left.path))

  for (const match of orderedMatches) {
    if (!match.parent?.children || match.index < 0) {
      throw new Error('Cannot replace root node')
    }

    match.parent.children.splice(match.index, 1, ...snippetNodes.map(cloneNode))
    changed += 1
  }

  return { tree, changed }
}

function applyWrap(tree, matches, wrapperNodes) {
  if (wrapperNodes.length !== 1) {
    throw new Error('Wrap requires exactly one top-level wrapper node')
  }

  const normalizedMatches = normalizeNonOverlappingMatches(matches)
  let changed = 0
  const orderedMatches = [...normalizedMatches].sort((left, right) => comparePath(right.path, left.path))

  for (const match of orderedMatches) {
    if (!match.parent?.children || match.index < 0) {
      throw new Error('Cannot wrap root node')
    }

    const wrapper = cloneNode(wrapperNodes[0])
    if (!Array.isArray(wrapper.children)) {
      throw new Error(`Cannot wrap with non-container node type "${wrapper.type}"`)
    }

    wrapper.children.push(cloneNode(match.node))
    match.parent.children.splice(match.index, 1, wrapper)
    changed += 1
  }

  return { tree, changed }
}

function applyUnwrap(tree, matches) {
  const normalizedMatches = normalizeNonOverlappingMatches(matches)
  let changed = 0
  const orderedMatches = [...normalizedMatches].sort((left, right) => comparePath(right.path, left.path))

  for (const match of orderedMatches) {
    if (!match.parent?.children || match.index < 0) {
      throw new Error('Cannot unwrap root node')
    }
    if (!Array.isArray(match.node.children)) {
      throw new Error(`Cannot unwrap non-container node type "${match.node.type}"`)
    }

    match.parent.children.splice(match.index, 1, ...match.node.children.map(cloneNode))
    changed += 1
  }

  return { tree, changed }
}

function normalizeNonOverlappingMatches(matches) {
  return matches.filter((candidate) => {
    return !matches.some((other) => {
      if (other === candidate || other.path.length >= candidate.path.length) {
        return false
      }

      return other.path.every((value, index) => candidate.path[index] === value)
    })
  })
}

async function mapMarkdownStructure(markdown, options = {}) {
  const mdast = await loadMdastModule()
  const tree = mdast.parseMarkdown(markdown)
  const maxNodes = Number.isInteger(options.maxNodes) && options.maxNodes > 0 ? options.maxNodes : 200
  const maxDepth = Number.isInteger(options.maxDepth) && options.maxDepth >= 0 ? options.maxDepth : 4
  const includeRoot = options.includeRoot === true
  const nodes = []
  let truncated = false

  const visit = (node, path, treeDepth, parentPath) => {
    if (nodes.length >= maxNodes) {
      truncated = true
      return
    }

    if ((includeRoot || path.length > 0) && treeDepth <= maxDepth) {
      nodes.push(summarizeNode(markdown, node, path, treeDepth, parentPath))
    }

    if (!Array.isArray(node?.children) || treeDepth >= maxDepth) {
      return
    }

    node.children.forEach((child, index) => {
      visit(child, [...path, index], treeDepth + 1, path)
    })
  }

  visit(tree, [], 0, null)

  return {
    nodes,
    truncated,
  }
}

async function getMarkdownStructure(markdown, selector, options = {}) {
  const mdast = await loadMdastModule()
  const tree = mdast.parseMarkdown(markdown)
  const matches = resolveSelectorMatches(tree, selector, mdast.queryAst)
  const maxMatches = Number.isInteger(options.maxMatches) && options.maxMatches > 0 ? options.maxMatches : matches.length
  const slicedMatches = matches.slice(0, maxMatches)

  return {
    totalMatches: matches.length,
    truncated: slicedMatches.length < matches.length,
    matches: slicedMatches.map((match) => summarizeNode(
      markdown,
      match.node,
      match.path,
      match.path.length,
      Array.isArray(match.parent?.children) ? match.path.slice(0, -1) : null,
    )),
  }
}

async function mutateMarkdownStructure(markdown, operation, payload = {}) {
  const mdast = await loadMdastModule()
  const tree = mdast.parseMarkdown(markdown)
  const selector = payload.selector
  const matches = resolveSelectorMatches(tree, selector, mdast.queryAst)

  if (operation === 'insert') {
    const snippetTree = mdast.parseMarkdown(typeof payload.markdown === 'string' ? payload.markdown : '')
    const result = applyInsert(tree, matches, payload.position, snippetTree.children ?? [])
    return {
      markdown: mdast.stringifyAst(result.tree),
      inserted: result.inserted,
      matched: matches.length,
    }
  }

  if (operation === 'delete') {
    const result = applyDelete(tree, matches)
    return {
      markdown: mdast.stringifyAst(result.tree),
      changed: result.changed,
      matched: matches.length,
    }
  }

  if (operation === 'replace') {
    const snippetTree = mdast.parseMarkdown(typeof payload.markdown === 'string' ? payload.markdown : '')
    const result = applyReplace(tree, matches, snippetTree.children ?? [])
    return {
      markdown: mdast.stringifyAst(result.tree),
      changed: result.changed,
      matched: matches.length,
    }
  }

  if (operation === 'wrap') {
    const wrapperTree = mdast.parseMarkdown(typeof payload.markdown === 'string' ? payload.markdown : '')
    const result = applyWrap(tree, matches, wrapperTree.children ?? [])
    return {
      markdown: mdast.stringifyAst(result.tree),
      changed: result.changed,
      matched: matches.length,
    }
  }

  if (operation === 'unwrap') {
    const result = applyUnwrap(tree, matches)
    return {
      markdown: mdast.stringifyAst(result.tree),
      changed: result.changed,
      matched: matches.length,
    }
  }

  if (operation === 'move') {
    const sourceMatches = normalizeNonOverlappingMatches(matches)
    const movedNodes = sourceMatches.map((match) => cloneNode(match.node))

    const targetMatches = resolveSelectorMatches(tree, payload.targetSelector, mdast.queryAst)
    if (targetMatches.length !== 1) {
      throw new Error(`Move requires exactly one target match, received ${String(targetMatches.length)}`)
    }

    const adjustedTargetPath = adjustPathAfterRemovals(
      targetMatches[0].path,
      sourceMatches.map((match) => match.path),
    )

    if (!adjustedTargetPath) {
      throw new Error('Move target cannot be the same as, or nested inside, the moved source selection')
    }

    applyDelete(tree, sourceMatches)

    const adjustedTargetMatch = resolvePathEntry(tree, adjustedTargetPath)

    const result = applyInsert(tree, [adjustedTargetMatch], payload.position, movedNodes)
    return {
      markdown: mdast.stringifyAst(result.tree),
      changed: movedNodes.length,
      matched: sourceMatches.length,
      targetMatched: targetMatches.length,
    }
  }

  throw new Error(`Unsupported structure operation: ${operation}`)
}

function collectVisibleText(node) {
  if (!node || typeof node !== 'object') {
    return ''
  }

  if (typeof node.value === 'string') {
    return node.value
  }

  if (!Array.isArray(node.children)) {
    return ''
  }

  return node.children.map((child) => collectVisibleText(child)).join('')
}

async function extractHeadingOutline(markdown) {
  const matches = await queryMarkdown(markdown, 'heading')

  return matches.map((match) => {
    const node = match?.node || {}
    const start = node?.position?.start || {}
    return {
      path: Array.isArray(match?.path) ? match.path : [],
      depth: Number.isFinite(Number(node.depth)) ? Number(node.depth) : 0,
      text: collectVisibleText(node),
      position: {
        line: Number.isFinite(Number(start.line)) ? Number(start.line) : 1,
        column: Number.isFinite(Number(start.column)) ? Number(start.column) : 1,
      },
    }
  })
}

module.exports = {
  extractHeadingOutline,
  getMdastCapabilities,
  getMdastPaths,
  getMarkdownStructure,
  isMdastBuilt,
  loadMdastModule,
  mapMarkdownStructure,
  mutateMarkdownStructure,
  queryMarkdown,
  validateMarkdownQuery,
}
