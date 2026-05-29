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

async function queryMarkdown(markdown, query) {
  const mdast = await loadMdastModule()
  const tree = mdast.parseMarkdown(markdown)
  return mdast.queryAst(tree, query)
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
  isMdastBuilt,
  loadMdastModule,
  queryMarkdown,
}