import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

type MdastPositionPoint = {
  line?: number
  column?: number
  offset?: number
}

type MdastPosition = {
  start?: MdastPositionPoint | null
  end?: MdastPositionPoint | null
}

type MdastNode = {
  type?: string
  children?: MdastNode[]
  position?: MdastPosition | null
  depth?: number
  ordered?: boolean
  checked?: boolean | null
  lang?: string | null
  url?: string | null
  title?: string | null
  value?: string | null
}

type QuerySelector = {
  query?: string
  path?: number[]
}

type QueryMatch = {
  node: MdastNode
  parent: MdastNode | null
  index: number
  path: number[]
}

type StructurePositionPoint = {
  line: number | null
  column: number | null
  offset: number | null
}

type StructurePosition = {
  start: StructurePositionPoint
  end: StructurePositionPoint
}

type StructureNodeSummary = {
  path: number[]
  parentPath: number[] | null
  treeDepth: number
  type: string
  childCount: number
  depth?: number
  ordered?: boolean
  checked?: boolean
  lang?: string
  url?: string
  title?: string
  text: string
  markdown: string
  position: StructurePosition
}

type HeadingOutlineEntry = {
  path: number[]
  depth: number
  text: string
  position: {
    line: number
    column: number
  }
}

type MapMarkdownStructureOptions = {
  maxNodes?: number
  maxDepth?: number
  includeRoot?: boolean
}

type GetMarkdownStructureOptions = {
  maxMatches?: number
}

type StructureInsertPosition = 'before' | 'after' | 'prepend' | 'append'
type StructureMutationOperation = 'insert' | 'delete' | 'replace' | 'replaceAll' | 'wrap' | 'unwrap' | 'move'

type StructureMutationPayload = {
  selector: QuerySelector
  markdown?: string
  position?: StructureInsertPosition
  targetSelector?: QuerySelector
  expectedMatchCount?: number
}

type StructureMutationResult = {
  markdown: string
  matched: number
  inserted?: number
  changed?: number
  targetMatched?: number
}

type MdastControlModule = {
  getCapabilities: () => unknown
  validateQuery: (query: string) => string[] | Promise<string[]>
  parseMarkdown: (markdown: string) => MdastNode
  queryAst: (tree: MdastNode, query: string) => QueryMatch[]
  stringifyAst: (tree: MdastNode) => string
}

const mdastRoot = path.join(__dirname, '..', '..', 'vendor', 'mdast-control')
const mdastDistEntry = path.join(mdastRoot, 'dist', 'index.js')
const mdastLspEntry = path.join(mdastRoot, 'dist', 'lsp', 'server.js')

let mdastModulePromise: Promise<MdastControlModule> | null = null

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
    mdastModulePromise = import(pathToFileURL(mdastDistEntry).href) as Promise<MdastControlModule>
  }

  return mdastModulePromise
}

async function getMdastCapabilities() {
  const mdast = await loadMdastModule()
  return mdast.getCapabilities()
}

async function validateMarkdownQuery(query: string) {
  const mdast = await loadMdastModule()
  return Promise.resolve(mdast.validateQuery(query))
}

async function queryMarkdown(markdown: string, query: string) {
  const mdast = await loadMdastModule()
  const tree = mdast.parseMarkdown(markdown)
  return mdast.queryAst(tree, query)
}

function toFiniteNumber(value: unknown) {
  const normalized = Number(value)
  return Number.isFinite(normalized) ? normalized : null
}

function collectVisibleText(node: MdastNode | null | undefined): string {
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

function summarizeNode(markdown: string, node: MdastNode, currentPath: number[], treeDepth: number, parentPath: number[] | null = null): StructureNodeSummary {
  const start = node.position?.start ?? null
  const end = node.position?.end ?? null
  const startOffset = toFiniteNumber(start?.offset)
  const endOffset = toFiniteNumber(end?.offset)
  const rawMarkdown = startOffset !== null && endOffset !== null && endOffset >= startOffset
    ? markdown.slice(startOffset, endOffset)
    : ''

  return {
    path: [...currentPath],
    parentPath: parentPath ? [...parentPath] : null,
    treeDepth,
    type: typeof node.type === 'string' ? node.type : 'unknown',
    childCount: Array.isArray(node.children) ? node.children.length : 0,
    depth: Number.isFinite(Number(node.depth)) ? Number(node.depth) : undefined,
    ordered: typeof node.ordered === 'boolean' ? node.ordered : undefined,
    checked: typeof node.checked === 'boolean' ? node.checked : undefined,
    lang: typeof node.lang === 'string' ? node.lang : undefined,
    url: typeof node.url === 'string' ? node.url : undefined,
    title: typeof node.title === 'string' ? node.title : undefined,
    text: collectVisibleText(node),
    markdown: rawMarkdown,
    position: {
      start: {
        line: Number.isFinite(Number(start?.line)) ? Number(start?.line) : null,
        column: Number.isFinite(Number(start?.column)) ? Number(start?.column) : null,
        offset: startOffset,
      },
      end: {
        line: Number.isFinite(Number(end?.line)) ? Number(end?.line) : null,
        column: Number.isFinite(Number(end?.column)) ? Number(end?.column) : null,
        offset: endOffset,
      },
    },
  }
}

function comparePath(left: number[], right: number[]) {
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

function isPathPrefix(prefix: number[], currentPath: number[]) {
  return prefix.length <= currentPath.length && prefix.every((value, index) => currentPath[index] === value)
}

function adjustPathAfterRemovals(currentPath: number[], removedPaths: number[][]) {
  const adjustedPath = [...currentPath]

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

function cloneNode<T>(node: T): T {
  return structuredClone(node)
}

function isValidPath(currentPath: unknown): currentPath is number[] {
  return Array.isArray(currentPath) && currentPath.every((value) => Number.isInteger(value) && value >= 0)
}

function resolvePathEntry(tree: MdastNode, currentPath: number[]): QueryMatch {
  if (!isValidPath(currentPath)) {
    throw new Error('Invalid structure path')
  }

  if (currentPath.length === 0) {
    return {
      node: tree,
      parent: null,
      index: -1,
      path: [],
    }
  }

  let parent: MdastNode | null = null
  let node: MdastNode = tree

  for (let index = 0; index < currentPath.length; index += 1) {
    const segment = currentPath[index]

    if (!Array.isArray(node.children) || segment >= node.children.length) {
      throw new Error(`Unknown structure path: ${JSON.stringify(currentPath)}`)
    }

    parent = node
    node = node.children[segment]
  }

  return {
    node,
    parent,
    index: currentPath[currentPath.length - 1],
    path: [...currentPath],
  }
}

function resolveSelectorMatches(tree: MdastNode, selector: QuerySelector, queryAst: MdastControlModule['queryAst']) {
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

function assertInsertPosition(position: unknown): asserts position is StructureInsertPosition {
  if (position !== 'before' && position !== 'after' && position !== 'prepend' && position !== 'append') {
    throw new Error(`Unsupported insert position "${String(position)}"`)
  }
}

function applyInsert(tree: MdastNode, matches: QueryMatch[], position: StructureInsertPosition, snippetNodes: MdastNode[]) {
  assertInsertPosition(position)
  const clones = snippetNodes.map(cloneNode)
  let inserted = 0
  const orderedMatches = [...matches].sort((left, right) => comparePath(right.path, left.path))

  for (const match of orderedMatches) {
    if (position === 'before' || position === 'after') {
      const parent = match.parent
      if (!Array.isArray(parent?.children) || match.index < 0) {
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

function normalizeNonOverlappingMatches(matches: QueryMatch[]) {
  return matches.filter((candidate) => {
    return !matches.some((other) => {
      if (other === candidate || other.path.length >= candidate.path.length) {
        return false
      }

      return other.path.every((value, index) => candidate.path[index] === value)
    })
  })
}

function applyDelete(tree: MdastNode, matches: QueryMatch[]) {
  const normalizedMatches = normalizeNonOverlappingMatches(matches)
  let changed = 0
  const orderedMatches = [...normalizedMatches].sort((left, right) => comparePath(right.path, left.path))

  for (const match of orderedMatches) {
    if (!Array.isArray(match.parent?.children) || match.index < 0) {
      throw new Error('Cannot delete root node')
    }

    match.parent.children.splice(match.index, 1)
    changed += 1
  }

  return { tree, changed }
}

function applyReplaceExactlyOne(tree: MdastNode, matches: QueryMatch[], snippetNodes: MdastNode[]) {
  const normalizedMatches = normalizeNonOverlappingMatches(matches)

  if (normalizedMatches.length === 0) {
    throw new Error('StructureHandleNotFound:\nThe specified handle was not found.\nRun query_structure or list_structure_map again and retry with a valid handle.')
  }

  if (normalizedMatches.length !== 1) {
    throw new Error('AmbiguousStructureHandle:\nThe specified handle does not resolve to exactly one structure node.\nRun query_structure or list_structure_map again and retry with a unique handle.')
  }

  let changed = 0
  const orderedMatches = [...normalizedMatches].sort((left, right) => comparePath(right.path, left.path))

  for (const match of orderedMatches) {
    if (!Array.isArray(match.parent?.children) || match.index < 0) {
      throw new Error('Cannot replace root node')
    }

    match.parent.children.splice(match.index, 1, ...snippetNodes.map(cloneNode))
    changed += 1
  }

  return {
    tree,
    changed,
  }
}

function applyReplaceAll(
  tree: MdastNode,
  matches: QueryMatch[],
  snippetNodes: MdastNode[],
  expectedMatchCount: number,
) {
  const normalizedMatches = normalizeNonOverlappingMatches(matches)

  if (normalizedMatches.length === 0) {
    throw new Error('NoStructureMatches:\nThe query matched no structure nodes.\nInspect the file with query_structure or list_structure_map and retry with a valid query.')
  }

  if (!Number.isInteger(expectedMatchCount) || expectedMatchCount < 1) {
    throw new Error('expectedMatchCount must be a positive integer')
  }

  if (normalizedMatches.length !== expectedMatchCount) {
    throw new Error(`UnexpectedMatchCount:\nExpected exactly ${String(expectedMatchCount)} matches, but found ${String(normalizedMatches.length)}.\nThis is not a replacement-limit error.\nInspect matches with query_structure and retry only after confirming the intended target set.`)
  }

  let changed = 0
  const orderedMatches = [...normalizedMatches].sort((left, right) => comparePath(right.path, left.path))

  for (const match of orderedMatches) {
    if (!Array.isArray(match.parent?.children) || match.index < 0) {
      throw new Error('Cannot replace root node')
    }

    match.parent.children.splice(match.index, 1, ...snippetNodes.map(cloneNode))
    changed += 1
  }

  return {
    tree,
    changed,
    matched: normalizedMatches.length,
  }
}

function applyWrap(tree: MdastNode, matches: QueryMatch[], wrapperNodes: MdastNode[]) {
  if (wrapperNodes.length !== 1) {
    throw new Error('Wrap requires exactly one top-level wrapper node')
  }

  const normalizedMatches = normalizeNonOverlappingMatches(matches)
  let changed = 0
  const orderedMatches = [...normalizedMatches].sort((left, right) => comparePath(right.path, left.path))

  for (const match of orderedMatches) {
    if (!Array.isArray(match.parent?.children) || match.index < 0) {
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

function applyUnwrap(tree: MdastNode, matches: QueryMatch[]) {
  const normalizedMatches = normalizeNonOverlappingMatches(matches)
  let changed = 0
  const orderedMatches = [...normalizedMatches].sort((left, right) => comparePath(right.path, left.path))

  for (const match of orderedMatches) {
    if (!Array.isArray(match.parent?.children) || match.index < 0) {
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

async function mapMarkdownStructure(markdown: string, options: MapMarkdownStructureOptions = {}) {
  const mdast = await loadMdastModule()
  const tree = mdast.parseMarkdown(markdown)
  const maxNodes = Number.isInteger(options.maxNodes) && Number(options.maxNodes) > 0 ? Number(options.maxNodes) : 200
  const maxDepth = Number.isInteger(options.maxDepth) && Number(options.maxDepth) >= 0 ? Number(options.maxDepth) : 4
  const includeRoot = options.includeRoot === true
  const nodes: StructureNodeSummary[] = []
  let truncated = false

  const visit = (node: MdastNode, currentPath: number[], treeDepth: number, parentPath: number[] | null) => {
    if (nodes.length >= maxNodes) {
      truncated = true
      return
    }

    if ((includeRoot || currentPath.length > 0) && treeDepth <= maxDepth) {
      nodes.push(summarizeNode(markdown, node, currentPath, treeDepth, parentPath))
    }

    if (!Array.isArray(node.children) || treeDepth >= maxDepth) {
      return
    }

    node.children.forEach((child, index) => {
      visit(child, [...currentPath, index], treeDepth + 1, currentPath)
    })
  }

  visit(tree, [], 0, null)

  return {
    nodes,
    truncated,
  }
}

async function getMarkdownStructure(markdown: string, selector: QuerySelector, options: GetMarkdownStructureOptions = {}) {
  const mdast = await loadMdastModule()
  const tree = mdast.parseMarkdown(markdown)
  const matches = resolveSelectorMatches(tree, selector, mdast.queryAst)
  const normalizedMatches = normalizeNonOverlappingMatches(matches)
  const maxMatches = Number.isInteger(options.maxMatches) && Number(options.maxMatches) > 0 ? Number(options.maxMatches) : normalizedMatches.length
  const slicedMatches = normalizedMatches.slice(0, maxMatches)

  return {
    totalMatches: normalizedMatches.length,
    truncated: slicedMatches.length < normalizedMatches.length,
    matches: slicedMatches.map((match) => summarizeNode(
      markdown,
      match.node,
      match.path,
      match.path.length,
      Array.isArray(match.parent?.children) ? match.path.slice(0, -1) : null,
    )),
  }
}

async function mutateMarkdownStructure(markdown: string, operation: StructureMutationOperation, payload: StructureMutationPayload): Promise<StructureMutationResult> {
  const mdast = await loadMdastModule()
  const tree = mdast.parseMarkdown(markdown)
  const matches = resolveSelectorMatches(tree, payload.selector, mdast.queryAst)

  if (operation === 'insert') {
    const snippetTree = mdast.parseMarkdown(typeof payload.markdown === 'string' ? payload.markdown : '')
    const result = applyInsert(tree, matches, payload.position ?? 'after', snippetTree.children ?? [])
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
    const result = applyReplaceExactlyOne(tree, matches, snippetTree.children ?? [])
    return {
      markdown: mdast.stringifyAst(result.tree),
      changed: result.changed,
      matched: matches.length,
    }
  }

  if (operation === 'replaceAll') {
    const snippetTree = mdast.parseMarkdown(typeof payload.markdown === 'string' ? payload.markdown : '')
    const result = applyReplaceAll(tree, matches, snippetTree.children ?? [], Number(payload.expectedMatchCount))
    return {
      markdown: mdast.stringifyAst(result.tree),
      changed: result.changed,
      matched: result.matched,
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

    if (!payload.targetSelector) {
      throw new Error('Move requires targetSelector')
    }

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
    const result = applyInsert(tree, [adjustedTargetMatch], payload.position ?? 'after', movedNodes)
    return {
      markdown: mdast.stringifyAst(result.tree),
      changed: movedNodes.length,
      matched: sourceMatches.length,
      targetMatched: targetMatches.length,
    }
  }

  throw new Error(`Unsupported structure operation: ${operation}`)
}

async function extractHeadingOutline(markdown: string): Promise<HeadingOutlineEntry[]> {
  const matches = await queryMarkdown(markdown, 'heading')

  return matches.map((match) => {
    const node = match.node ?? {}
    const start = node.position?.start ?? {}
    return {
      path: Array.isArray(match.path) ? [...match.path] : [],
      depth: Number.isFinite(Number(node.depth)) ? Number(node.depth) : 0,
      text: collectVisibleText(node),
      position: {
        line: Number.isFinite(Number(start.line)) ? Number(start.line) : 1,
        column: Number.isFinite(Number(start.column)) ? Number(start.column) : 1,
      },
    }
  })
}

export {
  extractHeadingOutline,
  getMarkdownStructure,
  getMdastCapabilities,
  getMdastPaths,
  isMdastBuilt,
  loadMdastModule,
  mapMarkdownStructure,
  mutateMarkdownStructure,
  queryMarkdown,
  validateMarkdownQuery,
}
