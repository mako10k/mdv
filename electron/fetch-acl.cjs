const YAML = require('yaml')

const DEFAULT_FETCH_ACL_TEXT = [
  '*:',
  '  rules:',
  '    - - ALL',
  '',
].join('\n')

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function createDefaultFetchAclText() {
  return DEFAULT_FETCH_ACL_TEXT
}

function normalizeFetchAclText(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return DEFAULT_FETCH_ACL_TEXT
  }

  return value.endsWith('\n') ? value : `${value}\n`
}

function preprocessFetchAclYaml(value) {
  return value
    .split(/\r?\n/)
    .map((line) => {
      const ruleMatch = line.match(/^(\s*-\s*)([+\-?=].+)$/)

      if (ruleMatch) {
        const escapedValue = ruleMatch[2].replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        return `${ruleMatch[1]}"${escapedValue}"`
      }

      const keyMatch = line.match(/^(\s*)(\*|https?:\/\/\S+|=\/[^:]*|\/[^:]*):(\s*)$/)

      if (keyMatch) {
        return `${keyMatch[1]}"${keyMatch[2]}":${keyMatch[3]}`
      }

      return line
    })
    .join('\n')
}

function normalizeHeaderName(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function normalizeMethodName(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

function normalizePathPrefix(value) {
  if (typeof value !== 'string') {
    return '/'
  }

  const trimmedValue = value.trim()

  if (!trimmedValue.startsWith('/')) {
    throw new Error(`Fetch ACL path keys must start with "/": ${trimmedValue}`)
  }

  if (trimmedValue === '/') {
    return '/'
  }

  return trimmedValue.endsWith('/') ? trimmedValue.slice(0, -1) : trimmedValue
}

function parsePathSelectorKey(value) {
  if (typeof value !== 'string') {
    throw new Error(`Fetch ACL path keys must be strings: ${value}`)
  }

  const trimmedValue = value.trim()

  if (trimmedValue.startsWith('=/')) {
    const path = normalizePathPrefix(trimmedValue.slice(1))
    return {
      key: `=${path}`,
      match: 'exact',
      path,
    }
  }

  const path = normalizePathPrefix(trimmedValue)
  return {
    key: path,
    match: 'prefix',
    path,
  }
}

function validateOriginKey(value) {
  if (value === '*') {
    return value
  }

  let parsedUrl

  try {
    parsedUrl = new URL(value)
  } catch {
    throw new Error(`Fetch ACL top-level keys must be "*" or an exact origin: ${value}`)
  }

  if ((parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') || parsedUrl.origin !== value || parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash) {
    throw new Error(`Fetch ACL origin keys must be exact http(s) origins: ${value}`)
  }

  return value
}

function splitCommaSeparatedValues(value) {
  return Array.from(new Set(String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)))
}

function parseDirectiveString(value, scopeLabel) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Fetch ACL rules must be non-empty strings at ${scopeLabel}`)
  }

  const trimmedValue = value.trim()
  const prefix = trimmedValue[0]
  const remainder = trimmedValue.slice(1).trim()

  if (!['+', '-', '?', '='].includes(prefix) || remainder.length === 0) {
    throw new Error(`Invalid fetch ACL rule at ${scopeLabel}: ${value}`)
  }

  const action = prefix === '+'
    ? 'allow'
    : prefix === '-'
      ? 'deny'
      : prefix === '?'
        ? 'pending'
        : 'force'

  if (/^header\s*:/i.test(remainder)) {
    const headerContent = remainder.replace(/^header\s*:/i, '').trim()

    if (action === 'force') {
      const separatorIndex = headerContent.indexOf(':')

      if (separatorIndex <= 0) {
        throw new Error(`Forced fetch ACL headers must use "= Header: Name: Value" at ${scopeLabel}`)
      }

      const headerName = normalizeHeaderName(headerContent.slice(0, separatorIndex))
      const headerValue = headerContent.slice(separatorIndex + 1).trim()

      if (!headerName || headerValue.length === 0) {
        throw new Error(`Forced fetch ACL headers must include both name and value at ${scopeLabel}`)
      }

      return {
        kind: 'force-header',
        name: headerName,
        value: headerValue,
      }
    }

    const values = splitCommaSeparatedValues(headerContent)
      .map((entry) => entry.toUpperCase() === 'ALL' ? 'ALL' : normalizeHeaderName(entry))
      .filter((entry) => entry.length > 0)

    if (values.length === 0) {
      throw new Error(`Fetch ACL header rules must include at least one header at ${scopeLabel}`)
    }

    return {
      kind: 'header',
      action,
      values,
    }
  }

  if (action === 'force') {
    throw new Error(`Only header rules support '=' in fetch ACL at ${scopeLabel}`)
  }

  const values = splitCommaSeparatedValues(remainder)
    .map((entry) => entry.toUpperCase() === 'ALL' ? 'ALL' : normalizeMethodName(entry))
    .filter((entry) => entry.length > 0)

  if (values.length === 0) {
    throw new Error(`Fetch ACL method rules must include at least one method at ${scopeLabel}`)
  }

  return {
    kind: 'method',
    action,
    values,
  }
}

function parseRuleList(value, scopeLabel) {
  if (value == null) {
    return []
  }

  const rawEntries = Array.isArray(value) ? value : [value]
  return rawEntries.map((entry) => parseDirectiveString(entry, scopeLabel))
}

function parseAclNode(value, scopeLabel) {
  if (value == null) {
    return {
      rules: [],
      children: [],
    }
  }

  if (Array.isArray(value)) {
    return {
      rules: parseRuleList(value, scopeLabel),
      children: [],
    }
  }

  if (!isPlainObject(value)) {
    throw new Error(`Fetch ACL nodes must be a mapping or a rule list at ${scopeLabel}`)
  }

  const rules = parseRuleList(value.rules, `${scopeLabel}.rules`)
  const children = []

  for (const [key, childValue] of Object.entries(value)) {
    if (key === 'rules') {
      continue
    }

    const selector = parsePathSelectorKey(key)
    children.push({
      key: selector.key,
      match: selector.match,
      path: selector.path,
      node: parseAclNode(childValue, `${scopeLabel}${selector.key}`),
    })
  }

  children.sort((left, right) => {
    if (left.path.length !== right.path.length) {
      return left.path.length - right.path.length
    }

    if (left.match === right.match) {
      return left.key.localeCompare(right.key)
    }

    return left.match === 'prefix' ? -1 : 1
  })

  return {
    rules,
    children,
  }
}

function parseFetchAclText(aclText) {
  const normalizedText = normalizeFetchAclText(aclText)
  const document = YAML.parseDocument(preprocessFetchAclYaml(normalizedText))

  if (Array.isArray(document.errors) && document.errors.length > 0) {
    throw new Error(`Invalid fetch ACL YAML: ${document.errors[0].message}`)
  }

  const source = document.toJSON()

  if (!isPlainObject(source)) {
    throw new Error('Fetch ACL must be a YAML mapping at the top level')
  }

  const policies = {}

  for (const [key, value] of Object.entries(source)) {
    const validatedKey = validateOriginKey(key)
    policies[validatedKey] = parseAclNode(value, validatedKey)
  }

  return {
    text: normalizedText,
    policies,
  }
}

function pathSelectorMatches(selector, pathname) {
  if (selector.path === '/' && selector.match === 'prefix') {
    return true
  }

  if (selector.match === 'exact') {
    return pathname === selector.path
  }

  return pathname === selector.path || pathname.startsWith(`${selector.path}/`)
}

function collectMatchingDescendants(baseScope, node, pathname, matches) {
  for (const child of node.children) {
    if (!pathSelectorMatches(child, pathname)) {
      continue
    }

    const scope = `${baseScope}${child.key}`
    matches.push({ scope, node: child.node })
    collectMatchingDescendants(scope, child.node, pathname, matches)
  }
}

function collectMatchingNodes(parsedAcl, targetUrl) {
  const matches = []
  const wildcardNode = parsedAcl.policies['*']

  if (wildcardNode) {
    matches.push({ scope: '*', node: wildcardNode })
    collectMatchingDescendants('*', wildcardNode, targetUrl.pathname, matches)
  }

  const originNode = parsedAcl.policies[targetUrl.origin]

  if (originNode) {
    matches.push({ scope: targetUrl.origin, node: originNode })
    collectMatchingDescendants(targetUrl.origin, originNode, targetUrl.pathname, matches)
  }

  return matches
}

function directiveMatchesValue(values, candidate) {
  return values.includes('ALL') || values.includes(candidate)
}

function formatDirectiveLabel(rule) {
  if (rule.kind === 'force-header') {
    return `= Header: ${rule.name}: ${rule.value}`
  }

  const prefix = rule.action === 'allow' ? '+' : rule.action === 'deny' ? '-' : '?'
  const targetLabel = rule.kind === 'header' ? 'Header' : 'Method'
  return `${prefix} ${targetLabel}: ${rule.values.join(', ')}`
}

function normalizeRequestedHeaders(headerNames) {
  if (!Array.isArray(headerNames)) {
    return []
  }

  return Array.from(new Set(headerNames
    .map((entry) => normalizeHeaderName(entry))
    .filter((entry) => entry.length > 0)))
}

function evaluateFetchAcl(aclText, request) {
  const parsedAcl = typeof aclText === 'string' ? parseFetchAclText(aclText) : aclText
  const targetUrl = request.url instanceof URL ? request.url : new URL(request.url)
  const method = normalizeMethodName(request.method || 'GET') || 'GET'
  const requestedHeaders = normalizeRequestedHeaders(request.headerNames)
  const matchingNodes = collectMatchingNodes(parsedAcl, targetUrl)
  const forcedHeaders = {}
  let methodDecision = null
  const headerDecisions = new Map()

  for (const entry of matchingNodes) {
    for (const rule of entry.node.rules) {
      if (rule.kind === 'force-header') {
        forcedHeaders[rule.name] = rule.value
        continue
      }

      if (rule.kind === 'method' && directiveMatchesValue(rule.values, method)) {
        methodDecision = {
          status: rule.action,
          scope: entry.scope,
          rule: formatDirectiveLabel(rule),
        }
      }

      if (rule.kind === 'header') {
        for (const headerName of requestedHeaders) {
          if (headerName in forcedHeaders) {
            continue
          }

          if (!directiveMatchesValue(rule.values, headerName)) {
            continue
          }

          headerDecisions.set(headerName, {
            status: rule.action,
            scope: entry.scope,
            rule: formatDirectiveLabel(rule),
          })
        }
      }
    }
  }

  const deniedHeaders = []
  const pendingHeaders = []
  const undecidedHeaders = []

  for (const headerName of requestedHeaders) {
    if (headerName in forcedHeaders) {
      continue
    }

    const decision = headerDecisions.get(headerName)

    if (!decision) {
      undecidedHeaders.push(headerName)
      continue
    }

    if (decision.status === 'deny') {
      deniedHeaders.push({ name: headerName, ...decision })
      continue
    }

    if (decision.status === 'pending') {
      pendingHeaders.push({ name: headerName, ...decision })
    }
  }

  if (methodDecision?.status === 'deny') {
    return {
      status: 'deny',
      reason: 'method',
      targetUrl,
      method,
      requestedHeaders,
      forcedHeaders,
      detail: methodDecision,
    }
  }

  if (deniedHeaders.length > 0) {
    return {
      status: 'deny',
      reason: 'header',
      targetUrl,
      method,
      requestedHeaders,
      forcedHeaders,
      detail: deniedHeaders,
    }
  }

  if (methodDecision?.status !== 'allow' && methodDecision?.status !== 'pending') {
    return {
      status: 'deny',
      reason: 'method-default',
      targetUrl,
      method,
      requestedHeaders,
      forcedHeaders,
      detail: null,
    }
  }

  if (undecidedHeaders.length > 0) {
    return {
      status: 'deny',
      reason: 'header-default',
      targetUrl,
      method,
      requestedHeaders,
      forcedHeaders,
      detail: undecidedHeaders,
    }
  }

  if (methodDecision?.status === 'pending' || pendingHeaders.length > 0) {
    return {
      status: 'pending',
      targetUrl,
      method,
      requestedHeaders,
      forcedHeaders,
      methodDecision: methodDecision?.status === 'pending' ? methodDecision : null,
      pendingHeaders,
    }
  }

  return {
    status: 'allow',
    targetUrl,
    method,
    requestedHeaders,
    forcedHeaders,
  }
}

function parseMutableAclDocument(aclText) {
  const normalizedText = normalizeFetchAclText(aclText)
  const document = YAML.parseDocument(preprocessFetchAclYaml(normalizedText))

  if (Array.isArray(document.errors) && document.errors.length > 0) {
    throw new Error(`Invalid fetch ACL YAML: ${document.errors[0].message}`)
  }

  const source = document.toJSON()

  if (!isPlainObject(source)) {
    throw new Error('Fetch ACL must be a YAML mapping at the top level')
  }

  return source
}

function ensureNodeRecord(value) {
  if (Array.isArray(value)) {
    return { rules: value.slice() }
  }

  if (isPlainObject(value)) {
    const nextValue = { ...value }
    const nextRules = Array.isArray(nextValue.rules)
      ? nextValue.rules.filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
      : []
    nextValue.rules = nextRules
    return nextValue
  }

  return { rules: [] }
}

function ensureRuleTargetNode(root, origin, pathPrefix, pathMatch = 'prefix') {
  const normalizedOrigin = validateOriginKey(origin)
  root[normalizedOrigin] = ensureNodeRecord(root[normalizedOrigin])

  if (!pathPrefix || pathPrefix === '/') {
    if (pathMatch === 'exact' && pathPrefix === '/') {
      root[normalizedOrigin]['=/'] = ensureNodeRecord(root[normalizedOrigin]['=/'])
      return root[normalizedOrigin]['=/']
    }

    return root[normalizedOrigin]
  }

  const normalizedPathPrefix = normalizePathPrefix(pathPrefix)
  const ruleKey = pathMatch === 'exact' ? `=${normalizedPathPrefix}` : normalizedPathPrefix
  root[normalizedOrigin][ruleKey] = ensureNodeRecord(root[normalizedOrigin][ruleKey])
  return root[normalizedOrigin][ruleKey]
}

function appendRuleLine(ruleNode, line) {
  const trimmedLine = typeof line === 'string' ? line.trim() : ''

  if (!trimmedLine) {
    return
  }

  const existingRules = Array.isArray(ruleNode.rules) ? ruleNode.rules : []

  if (!existingRules.includes(trimmedLine)) {
    existingRules.push(trimmedLine)
  }

  ruleNode.rules = existingRules
}

function addFetchAclDecisionRule(aclText, payload) {
  const root = parseMutableAclDocument(aclText)
  const ruleNode = ensureRuleTargetNode(
    root,
    payload.origin,
    payload.applyToOrigin === true ? null : payload.path,
    payload.pathMatch === 'exact' ? 'exact' : 'prefix',
  )
  const directivePrefix = payload.decision === 'allow' ? '+' : '-'
  const normalizedMethod = normalizeMethodName(payload.method)
  const normalizedHeaders = normalizeRequestedHeaders(payload.headers)

  if (normalizedMethod) {
    appendRuleLine(ruleNode, `${directivePrefix} ${normalizedMethod}`)
  }

  if (normalizedHeaders.length > 0) {
    appendRuleLine(ruleNode, `${directivePrefix} Header: ${normalizedHeaders.join(', ')}`)
  }

  return YAML.stringify(root, { lineWidth: 0 })
}

function parseLegacyRuleToScope(rule) {
  if (typeof rule !== 'string' || rule.trim().length === 0) {
    return null
  }

  const trimmedRule = rule.trim()
  const hasWildcardSuffix = trimmedRule.endsWith('*')
  const baseRule = hasWildcardSuffix ? trimmedRule.slice(0, -1) : trimmedRule
  let parsedUrl

  try {
    parsedUrl = new URL(baseRule)
  } catch {
    return null
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return null
  }

  const origin = parsedUrl.origin
  const normalizedPath = normalizePathPrefix(parsedUrl.pathname || '/')

  if (hasWildcardSuffix) {
    return { origin, path: normalizedPath === '/' ? null : normalizedPath, pathMatch: 'prefix' }
  }

  return { origin, path: normalizedPath, pathMatch: 'exact' }
}

function migrateLegacyFetchConfig(legacyFetch) {
  let aclText = createDefaultFetchAclText()
  const normalizedMethods = Array.isArray(legacyFetch?.allowedMethods)
    ? legacyFetch.allowedMethods.map((entry) => normalizeMethodName(entry)).filter((entry) => entry.length > 0)
    : ['GET']
  const normalizedHeaders = Array.isArray(legacyFetch?.allowedHeaders)
    ? legacyFetch.allowedHeaders.map((entry) => normalizeHeaderName(entry)).filter((entry) => entry.length > 0)
    : []
  const legacyRules = Array.isArray(legacyFetch?.allowedUrlRules) ? legacyFetch.allowedUrlRules : []

  if (normalizedMethods.length === 0) {
    normalizedMethods.push('GET')
  }

  for (const legacyRule of legacyRules) {
    const scope = parseLegacyRuleToScope(legacyRule)

    if (!scope) {
      continue
    }

    aclText = addFetchAclDecisionRule(aclText, {
      decision: 'allow',
      origin: scope.origin,
      path: scope.path,
      applyToOrigin: scope.path == null,
      pathMatch: scope.pathMatch,
      method: normalizedMethods.join(', '),
      headers: normalizedHeaders,
    })
  }

  return aclText
}

module.exports = {
  addFetchAclDecisionRule,
  createDefaultFetchAclText,
  evaluateFetchAcl,
  migrateLegacyFetchConfig,
  parseFetchAclText,
}