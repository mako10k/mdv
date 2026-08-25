const fsPromises = require('node:fs/promises') as typeof import('node:fs/promises')
const path = require('node:path') as typeof import('node:path')
const { createHash } = require('node:crypto') as typeof import('node:crypto')
const Ajv2020 = (require('ajv/dist/2020') as typeof import('ajv/dist/2020')).default
const generatedContract = require('./plugin-manifest-contract.generated.cjs') as PluginRuntimeContract

import type {
  PluginDiagnosticCode,
  PluginDiagnosticSeverity,
  PluginLifecycleStatus,
  PluginManifestCapability,
  PluginManifestFacts,
  PluginManifestResource,
  PluginOrigin,
  PluginPublicCatalogDiagnostics,
  PluginRuntimeContract,
  PluginSkillContribution,
} from './plugin-manifest-contract-types.generated.cjs'

const {
  BUNDLED_PLUGIN_REGISTRATIONS,
  PLUGIN_CONTRACT,
  PLUGIN_DIAGNOSTICS,
  PLUGIN_MANIFEST_SCHEMA,
} = generatedContract

type PluginDiagnostic = {
  code: PluginDiagnosticCode
  severity: PluginDiagnosticSeverity
  publicMessage: string
  developerDetail: string
  remediation: string
  relativeLocation: string | null
}

type PluginLocatedResourceFacts = {
  id: string
  relativePath: string
  declaredSha256: string
  actualSha256: string | null
  digestMatches: boolean
}

type PluginLocatedFacts = {
  origin: PluginOrigin
  packageRoot: string
  manifestRelativePath: string
  manifestSha256: string
  packageDigestSha256: string | null
  resources: PluginLocatedResourceFacts[]
}

type PluginPackageSource = {
  catalogId: string
  origin: PluginOrigin
  packageRoot: string
  manifestRelativePath: string
  readFile: (relativePath: string) => Promise<Buffer>
}

type PluginPackageValidation = {
  catalogId: string
  manifestFacts: PluginManifestFacts | null
  locatedFacts: PluginLocatedFacts | null
  status: PluginLifecycleStatus
  diagnostics: PluginDiagnostic[]
}

export type PluginCatalog = {
  contractVersion: number
  hostVersion: string
  packages: PluginPackageValidation[]
}

type ParseResult = {
  manifestFacts: PluginManifestFacts | null
  diagnostics: PluginDiagnostic[]
}

const diagnosticByCode = new Map(
  PLUGIN_DIAGNOSTICS.map((diagnostic) => [diagnostic.code, diagnostic]),
)
const idPattern = new RegExp(PLUGIN_CONTRACT.idPattern)
const versionPattern = new RegExp(PLUGIN_CONTRACT.versionPattern)
const resourcePathPattern = new RegExp(PLUGIN_CONTRACT.resourcePathPattern)
const sha256Pattern = new RegExp(PLUGIN_CONTRACT.sha256Pattern)
const capabilityContractByFamily: Map<string, (typeof PLUGIN_CONTRACT.capabilityFamilies)[number]> = new Map(
  PLUGIN_CONTRACT.capabilityFamilies.map((family) => [family.family, family]),
)
const mediaTypes = new Set<string>(PLUGIN_CONTRACT.mediaTypes)
const resourcePurposes = new Set<string>(PLUGIN_CONTRACT.resourcePurposes)
const manifestSchemaValidator = new Ajv2020({ allErrors: true, strict: true }).compile(PLUGIN_MANIFEST_SCHEMA)

function createDiagnostic(
  code: PluginDiagnosticCode,
  relativeLocation: string | null = null,
  developerDetail: string | null = null,
): PluginDiagnostic {
  const definition = diagnosticByCode.get(code)
  if (!definition) {
    throw new Error(`Plugin diagnostic definition is missing for ${code}`)
  }

  return {
    code: definition.code,
    severity: definition.severity,
    publicMessage: definition.publicMessage,
    developerDetail: developerDetail ?? definition.developerDetail,
    remediation: definition.remediation,
    relativeLocation,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actualKeys = Object.keys(value).sort()
  const sortedExpectedKeys = [...expectedKeys].sort()
  return actualKeys.length === sortedExpectedKeys.length
    && actualKeys.every((key, index) => key === sortedExpectedKeys[index])
}

function isBoundedString(
  value: unknown,
  pattern: RegExp | null = null,
  maxCharacters: number = PLUGIN_CONTRACT.limits.displayNameCharacters,
): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxCharacters
    && (!pattern || pattern.test(value))
}

function isStringList(
  value: unknown,
  options: { pattern?: RegExp; allowed?: readonly string[]; allowEmpty?: boolean } = {},
): value is string[] {
  if (!Array.isArray(value) || (!options.allowEmpty && value.length === 0) || value.length > PLUGIN_CONTRACT.limits.stringListItems) {
    return false
  }

  if (!value.every((item) => typeof item === 'string')) {
    return false
  }

  const strings = value as string[]
  if (new Set(strings).size !== strings.length) {
    return false
  }

  return strings.every((item) => {
    if (options.pattern && !options.pattern.test(item)) {
      return false
    }
    return !options.allowed || options.allowed.includes(item)
  })
}

function isContainedResourcePath(value: unknown): value is string {
  if (typeof value !== 'string' || !resourcePathPattern.test(value)) {
    return false
  }

  const segments = value.split('/')
  return segments.length > 0
    && segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

function parseCompatibility(value: unknown): PluginManifestFacts['compatibility'] | null {
  if (!isRecord(value) || !hasExactKeys(value, ['mdv', 'pluginApiVersion'])) {
    return null
  }
  if (!isRecord(value.mdv) || !hasExactKeys(value.mdv, ['minVersion', 'maxVersionExclusive'])) {
    return null
  }
  if (!isBoundedString(value.mdv.minVersion, versionPattern, PLUGIN_CONTRACT.limits.versionCharacters)
    || !isBoundedString(value.mdv.maxVersionExclusive, versionPattern, PLUGIN_CONTRACT.limits.versionCharacters)) {
    return null
  }
  if (!Number.isInteger(value.pluginApiVersion) || Number(value.pluginApiVersion) < 1) {
    return null
  }

  return {
    mdv: {
      minVersion: value.mdv.minVersion,
      maxVersionExclusive: value.mdv.maxVersionExclusive,
    },
    pluginApiVersion: Number(value.pluginApiVersion),
  }
}

function parseResource(value: unknown): PluginManifestResource | null {
  if (!isRecord(value) || !hasExactKeys(value, ['id', 'path', 'sha256', 'mediaType', 'purpose'])) {
    return null
  }
  if (!isBoundedString(value.id, idPattern, PLUGIN_CONTRACT.limits.idCharacters) || !isContainedResourcePath(value.path)) {
    return null
  }
  if (typeof value.sha256 !== 'string' || !sha256Pattern.test(value.sha256)) {
    return null
  }
  if (typeof value.mediaType !== 'string' || !mediaTypes.has(value.mediaType)) {
    return null
  }
  if (typeof value.purpose !== 'string' || !resourcePurposes.has(value.purpose)) {
    return null
  }

  return {
    id: value.id,
    path: value.path,
    sha256: value.sha256,
    mediaType: value.mediaType as PluginManifestResource['mediaType'],
    purpose: value.purpose as PluginManifestResource['purpose'],
  }
}

function parseCapability(value: unknown): { capability: PluginManifestCapability | null; diagnostic: PluginDiagnostic | null } {
  if (!isRecord(value) || typeof value.family !== 'string') {
    return { capability: null, diagnostic: createDiagnostic('PLUGIN_INVALID_MANIFEST', 'capabilities') }
  }

  const familyContract = capabilityContractByFamily.get(value.family)
  if (!familyContract) {
    return { capability: null, diagnostic: createDiagnostic('PLUGIN_INVALID_MANIFEST', 'capabilities', `Unknown capability family: ${value.family}`) }
  }

  const commonKeys = ['id', 'family', 'contractVersion', 'permissions', 'resourceIds']
  if (!hasExactKeys(value, [...commonKeys, familyContract.payloadField])) {
    return { capability: null, diagnostic: createDiagnostic('PLUGIN_INVALID_MANIFEST', `capabilities.${value.family}`) }
  }
  if (!isBoundedString(value.id, idPattern, PLUGIN_CONTRACT.limits.idCharacters)) {
    return { capability: null, diagnostic: createDiagnostic('PLUGIN_INVALID_MANIFEST', `capabilities.${value.family}.id`) }
  }
  if (!Number.isInteger(value.contractVersion) || Number(value.contractVersion) !== familyContract.contractVersion) {
    return {
      capability: null,
      diagnostic: createDiagnostic(
        'PLUGIN_UNSUPPORTED_CAPABILITY_VERSION',
        `capabilities.${value.id}.contractVersion`,
        `Expected ${familyContract.family} contractVersion ${familyContract.contractVersion}.`,
      ),
    }
  }
  if (!Array.isArray(value.permissions) || value.permissions.length !== 0) {
    return { capability: null, diagnostic: createDiagnostic('PLUGIN_INVALID_MANIFEST', `capabilities.${value.id}.permissions`) }
  }
  if (!isStringList(value.resourceIds, { pattern: idPattern, allowEmpty: true })) {
    return { capability: null, diagnostic: createDiagnostic('PLUGIN_INVALID_MANIFEST', `capabilities.${value.id}.resourceIds`) }
  }

  const payload = value[familyContract.payloadField]
  let payloadItems: string[]
  if ('allowedItems' in familyContract) {
    if (!isStringList(payload, { allowed: familyContract.allowedItems })) {
      return { capability: null, diagnostic: createDiagnostic('PLUGIN_INVALID_MANIFEST', `capabilities.${value.id}.${familyContract.payloadField}`) }
    }
    payloadItems = payload
  } else {
    if (!isStringList(payload, { pattern: new RegExp(familyContract.itemPattern) })) {
      return { capability: null, diagnostic: createDiagnostic('PLUGIN_INVALID_MANIFEST', `capabilities.${value.id}.${familyContract.payloadField}`) }
    }
    payloadItems = payload
  }

  const base = {
    id: value.id,
    contractVersion: Number(value.contractVersion),
    permissions: [] as [],
    resourceIds: value.resourceIds,
  }

  if (value.family === 'codeblock') {
    return { capability: { ...base, family: 'codeblock', languages: payloadItems }, diagnostic: null }
  }
  if (value.family === 'text-rendering') {
    return { capability: { ...base, family: 'text-rendering', formats: ['markdown-text'] }, diagnostic: null }
  }
  return { capability: { ...base, family: 'llm-tool', toolNames: payloadItems }, diagnostic: null }
}

function parseSkill(value: unknown): PluginSkillContribution | null {
  if (!isRecord(value) || !hasExactKeys(value, ['id', 'displayName', 'version', 'instructionResourceId', 'resourceIds'])) {
    return null
  }
  if (!isBoundedString(value.id, idPattern, PLUGIN_CONTRACT.limits.idCharacters)
    || !isBoundedString(value.displayName)
    || !isBoundedString(value.version, versionPattern, PLUGIN_CONTRACT.limits.versionCharacters)
    || !isBoundedString(value.instructionResourceId, idPattern, PLUGIN_CONTRACT.limits.idCharacters)
    || !isStringList(value.resourceIds, { pattern: idPattern, allowEmpty: true })) {
    return null
  }

  return {
    id: value.id,
    displayName: value.displayName,
    version: value.version,
    instructionResourceId: value.instructionResourceId,
    resourceIds: value.resourceIds,
  }
}

function parseManifestValue(value: unknown): ParseResult {
  if (!isRecord(value)) {
    return { manifestFacts: null, diagnostics: [createDiagnostic('PLUGIN_INVALID_MANIFEST')] }
  }
  if (value.schemaVersion !== PLUGIN_CONTRACT.manifestSchemaVersion) {
    return {
      manifestFacts: null,
      diagnostics: [createDiagnostic('PLUGIN_UNKNOWN_SCHEMA_VERSION', 'schemaVersion')],
    }
  }
  const pathEscape = Array.isArray(value.resources)
    ? value.resources.find((resource) => isRecord(resource) && typeof resource.path === 'string' && !isContainedResourcePath(resource.path))
    : null
  if (pathEscape) {
    return { manifestFacts: null, diagnostics: [createDiagnostic('PLUGIN_PATH_ESCAPE', 'resources.path')] }
  }
  const unsupportedCapability = Array.isArray(value.capabilities)
    ? value.capabilities.find((capability) => {
        if (!isRecord(capability) || typeof capability.family !== 'string') {
          return false
        }
        const familyContract = capabilityContractByFamily.get(capability.family)
        return familyContract
          ? !Number.isInteger(capability.contractVersion) || Number(capability.contractVersion) !== familyContract.contractVersion
          : false
      })
    : null
  if (unsupportedCapability && isRecord(unsupportedCapability)) {
    return {
      manifestFacts: null,
      diagnostics: [createDiagnostic('PLUGIN_UNSUPPORTED_CAPABILITY_VERSION', 'capabilities.contractVersion')],
    }
  }
  if (!manifestSchemaValidator(value)) {
    const schemaDetail = (manifestSchemaValidator.errors ?? [])
      .slice(0, 3)
      .map((error) => `${error.instancePath || '/'} ${error.keyword}`)
      .join('; ')
    return {
      manifestFacts: null,
      diagnostics: [createDiagnostic('PLUGIN_INVALID_MANIFEST', null, schemaDetail || null)],
    }
  }
  if (!hasExactKeys(value, ['schemaVersion', 'id', 'displayName', 'version', 'compatibility', 'resources', 'capabilities', 'skills'])) {
    return { manifestFacts: null, diagnostics: [createDiagnostic('PLUGIN_INVALID_MANIFEST')] }
  }
  if (!isBoundedString(value.id, idPattern, PLUGIN_CONTRACT.limits.idCharacters)
    || !isBoundedString(value.displayName)
    || !isBoundedString(value.version, versionPattern, PLUGIN_CONTRACT.limits.versionCharacters)) {
    return { manifestFacts: null, diagnostics: [createDiagnostic('PLUGIN_INVALID_MANIFEST', 'identity')] }
  }

  const compatibility = parseCompatibility(value.compatibility)
  if (!compatibility) {
    return { manifestFacts: null, diagnostics: [createDiagnostic('PLUGIN_INVALID_MANIFEST', 'compatibility')] }
  }
  if (!Array.isArray(value.resources) || value.resources.length > PLUGIN_CONTRACT.limits.resources) {
    return { manifestFacts: null, diagnostics: [createDiagnostic('PLUGIN_INVALID_MANIFEST', 'resources')] }
  }
  if (!Array.isArray(value.capabilities) || value.capabilities.length > PLUGIN_CONTRACT.limits.capabilities) {
    return { manifestFacts: null, diagnostics: [createDiagnostic('PLUGIN_INVALID_MANIFEST', 'capabilities')] }
  }
  if (!Array.isArray(value.skills) || value.skills.length > PLUGIN_CONTRACT.limits.skills) {
    return { manifestFacts: null, diagnostics: [createDiagnostic('PLUGIN_INVALID_MANIFEST', 'skills')] }
  }

  const resources: PluginManifestResource[] = []
  for (const resourceValue of value.resources) {
    if (isRecord(resourceValue) && typeof resourceValue.path === 'string' && !isContainedResourcePath(resourceValue.path)) {
      return { manifestFacts: null, diagnostics: [createDiagnostic('PLUGIN_PATH_ESCAPE', 'resources.path')] }
    }
    const resource = parseResource(resourceValue)
    if (!resource) {
      return { manifestFacts: null, diagnostics: [createDiagnostic('PLUGIN_INVALID_MANIFEST', 'resources')] }
    }
    resources.push(resource)
  }

  const duplicateResourceId = resources.find((resource, index) => resources.findIndex((candidate) => candidate.id === resource.id) !== index)
  const duplicateResourcePath = resources.find((resource, index) => resources.findIndex((candidate) => candidate.path === resource.path) !== index)
  if (duplicateResourceId || duplicateResourcePath) {
    return { manifestFacts: null, diagnostics: [createDiagnostic('PLUGIN_INVALID_MANIFEST', 'resources', 'Resource IDs and paths must be unique within a manifest.')] }
  }

  const capabilities: PluginManifestCapability[] = []
  for (const capabilityValue of value.capabilities) {
    const parsed = parseCapability(capabilityValue)
    if (!parsed.capability) {
      return { manifestFacts: null, diagnostics: [parsed.diagnostic ?? createDiagnostic('PLUGIN_INVALID_MANIFEST', 'capabilities')] }
    }
    capabilities.push(parsed.capability)
  }

  const duplicateCapability = capabilities.find((capability, index) => capabilities.findIndex((candidate) => candidate.id === capability.id) !== index)
  if (duplicateCapability) {
    return { manifestFacts: null, diagnostics: [createDiagnostic('PLUGIN_DUPLICATE_CAPABILITY_ID', `capabilities.${duplicateCapability.id}`)] }
  }

  const skills: PluginSkillContribution[] = []
  for (const skillValue of value.skills) {
    const skill = parseSkill(skillValue)
    if (!skill) {
      return { manifestFacts: null, diagnostics: [createDiagnostic('PLUGIN_INVALID_MANIFEST', 'skills')] }
    }
    skills.push(skill)
  }

  const duplicateSkill = skills.find((skill, index) => skills.findIndex((candidate) => candidate.id === skill.id) !== index)
  if (duplicateSkill) {
    return { manifestFacts: null, diagnostics: [createDiagnostic('PLUGIN_DUPLICATE_SKILL_ID', `skills.${duplicateSkill.id}`)] }
  }

  const resourceIds = new Set(resources.map((resource) => resource.id))
  for (const capability of capabilities) {
    const unknownResourceId = capability.resourceIds.find((resourceId) => !resourceIds.has(resourceId))
    if (unknownResourceId) {
      return {
        manifestFacts: null,
        diagnostics: [createDiagnostic('PLUGIN_UNKNOWN_RESOURCE_REFERENCE', `capabilities.${capability.id}.resourceIds`, `Unknown resource ID: ${unknownResourceId}`)],
      }
    }
  }
  for (const skill of skills) {
    const referencedIds = [skill.instructionResourceId, ...skill.resourceIds]
    const unknownResourceId = referencedIds.find((resourceId) => !resourceIds.has(resourceId))
    if (unknownResourceId) {
      return {
        manifestFacts: null,
        diagnostics: [createDiagnostic('PLUGIN_UNKNOWN_RESOURCE_REFERENCE', `skills.${skill.id}`, `Unknown resource ID: ${unknownResourceId}`)],
      }
    }
  }

  return {
    manifestFacts: {
      schemaVersion: PLUGIN_CONTRACT.manifestSchemaVersion,
      id: value.id,
      displayName: value.displayName,
      version: value.version,
      compatibility,
      resources,
      capabilities,
      skills,
    },
    diagnostics: [],
  }
}

export function parsePluginManifestText(manifestText: string): ParseResult {
  if (Buffer.byteLength(manifestText, 'utf8') > PLUGIN_CONTRACT.limits.manifestBytes) {
    return {
      manifestFacts: null,
      diagnostics: [createDiagnostic('PLUGIN_INVALID_MANIFEST', null, `Manifest exceeds ${PLUGIN_CONTRACT.limits.manifestBytes} bytes.`)],
    }
  }

  let value: unknown
  try {
    value = JSON.parse(manifestText) as unknown
  } catch {
    return { manifestFacts: null, diagnostics: [createDiagnostic('PLUGIN_INVALID_JSON')] }
  }

  return parseManifestValue(value)
}

function parseVersion(version: string): [number, number, number] | null {
  if (!versionPattern.test(version)) {
    return null
  }
  const parts = version.split('.').map((part) => Number(part))
  return parts.length === 3 && parts.every(Number.isSafeInteger)
    ? [parts[0], parts[1], parts[2]]
    : null
}

function compareVersions(left: string, right: string): number | null {
  const leftParts = parseVersion(left)
  const rightParts = parseVersion(right)
  if (!leftParts || !rightParts) {
    return null
  }

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] < rightParts[index] ? -1 : 1
    }
  }
  return 0
}

function deriveLifecycleStatus(diagnostics: PluginDiagnostic[]): PluginLifecycleStatus {
  if (diagnostics.some((diagnostic) => diagnostic.code === 'PLUGIN_PACKAGE_READ_FAILED')) {
    return 'failed'
  }
  if (diagnostics.some((diagnostic) => diagnostic.code !== 'PLUGIN_INCOMPATIBLE_HOST_VERSION')) {
    return diagnostics.length > 0 ? 'invalid' : 'ready'
  }
  return diagnostics.length > 0 ? 'incompatible' : 'ready'
}

function isMissingFileError(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
}

export async function validatePluginPackageSource(
  source: PluginPackageSource,
  hostVersion: string,
): Promise<PluginPackageValidation> {
  let manifestBuffer: Buffer
  try {
    manifestBuffer = await source.readFile(source.manifestRelativePath)
  } catch (error) {
    return {
      catalogId: source.catalogId,
      manifestFacts: null,
      locatedFacts: null,
      status: 'failed',
      diagnostics: [createDiagnostic('PLUGIN_PACKAGE_READ_FAILED', source.manifestRelativePath, error instanceof Error ? error.message : String(error))],
    }
  }

  const manifestSha256 = createHash('sha256').update(manifestBuffer).digest('hex')
  const parsed = parsePluginManifestText(manifestBuffer.toString('utf8'))
  if (!parsed.manifestFacts) {
    return {
      catalogId: source.catalogId,
      manifestFacts: null,
      locatedFacts: {
        origin: source.origin,
        packageRoot: source.packageRoot,
        manifestRelativePath: source.manifestRelativePath,
        manifestSha256,
        packageDigestSha256: null,
        resources: [],
      },
      status: deriveLifecycleStatus(parsed.diagnostics),
      diagnostics: parsed.diagnostics,
    }
  }

  const manifestFacts = parsed.manifestFacts
  const diagnostics = [...parsed.diagnostics]
  const minComparison = compareVersions(hostVersion, manifestFacts.compatibility.mdv.minVersion)
  const maxComparison = compareVersions(hostVersion, manifestFacts.compatibility.mdv.maxVersionExclusive)
  if (manifestFacts.compatibility.pluginApiVersion !== PLUGIN_CONTRACT.pluginApiVersion
    || minComparison === null
    || maxComparison === null
    || minComparison < 0
    || maxComparison >= 0) {
    diagnostics.push(createDiagnostic(
      'PLUGIN_INCOMPATIBLE_HOST_VERSION',
      'compatibility',
      `Host ${hostVersion}; expected >=${manifestFacts.compatibility.mdv.minVersion} and <${manifestFacts.compatibility.mdv.maxVersionExclusive}; Plugin API ${manifestFacts.compatibility.pluginApiVersion}.`,
    ))
  }

  const packageHash = createHash('sha256')
  packageHash.update(source.manifestRelativePath, 'utf8')
  packageHash.update('\0')
  packageHash.update(manifestBuffer)
  packageHash.update('\0')
  const locatedResources: PluginLocatedResourceFacts[] = []

  for (const resource of [...manifestFacts.resources].sort((left, right) => left.path.localeCompare(right.path))) {
    if (!isContainedResourcePath(resource.path)) {
      diagnostics.push(createDiagnostic('PLUGIN_PATH_ESCAPE', `resources.${resource.id}.path`))
      locatedResources.push({
        id: resource.id,
        relativePath: resource.path,
        declaredSha256: resource.sha256,
        actualSha256: null,
        digestMatches: false,
      })
      continue
    }

    try {
      const resourceBuffer = await source.readFile(resource.path)
      const actualSha256 = createHash('sha256').update(resourceBuffer).digest('hex')
      const digestMatches = actualSha256 === resource.sha256
      locatedResources.push({
        id: resource.id,
        relativePath: resource.path,
        declaredSha256: resource.sha256,
        actualSha256,
        digestMatches,
      })
      packageHash.update(resource.path, 'utf8')
      packageHash.update('\0')
      packageHash.update(resourceBuffer)
      packageHash.update('\0')
      if (!digestMatches) {
        diagnostics.push(createDiagnostic('PLUGIN_DIGEST_MISMATCH', resource.path))
      }
    } catch (error) {
      locatedResources.push({
        id: resource.id,
        relativePath: resource.path,
        declaredSha256: resource.sha256,
        actualSha256: null,
        digestMatches: false,
      })
      diagnostics.push(createDiagnostic(
        isMissingFileError(error) ? 'PLUGIN_MISSING_RESOURCE' : 'PLUGIN_PACKAGE_READ_FAILED',
        resource.path,
        error instanceof Error ? error.message : String(error),
      ))
    }
  }

  const status = deriveLifecycleStatus(diagnostics)
  return {
    catalogId: source.catalogId,
    manifestFacts,
    locatedFacts: {
      origin: source.origin,
      packageRoot: source.packageRoot,
      manifestRelativePath: source.manifestRelativePath,
      manifestSha256,
      packageDigestSha256: status === 'ready' ? packageHash.digest('hex') : null,
      resources: locatedResources,
    },
    status,
    diagnostics,
  }
}

function createPluginPathError(message: string): Error {
  const error = new Error(message)
  Object.assign(error, { code: 'EPERM' })
  return error
}

function pathEscapesRoot(rootPath: string, targetPath: string): boolean {
  const relativePath = path.relative(rootPath, targetPath)
  return relativePath === '..'
    || relativePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativePath)
}

export async function createContainedFileReader(
  packageRoot: string,
  containmentRoot: string = packageRoot,
): Promise<(relativePath: string) => Promise<Buffer>> {
  const resolvedPackageRoot = path.resolve(packageRoot)
  const resolvedContainmentRoot = path.resolve(containmentRoot)
  if (pathEscapesRoot(resolvedContainmentRoot, resolvedPackageRoot)) {
    throw createPluginPathError('Plugin package root escapes its registered containment root')
  }

  const relativePackageRoot = path.relative(resolvedContainmentRoot, resolvedPackageRoot)
  if (relativePackageRoot === '') {
    const rootStat = await fsPromises.lstat(resolvedPackageRoot)
    if (rootStat.isSymbolicLink()) {
      throw createPluginPathError('Plugin package root must not be a symbolic link')
    }
  } else {
    let currentPath = resolvedContainmentRoot
    for (const segment of relativePackageRoot.split(path.sep)) {
      currentPath = path.join(currentPath, segment)
      const stat = await fsPromises.lstat(currentPath)
      if (stat.isSymbolicLink()) {
        throw createPluginPathError(`Plugin package root paths must not contain symbolic links: ${relativePackageRoot}`)
      }
    }
  }

  const realContainmentRoot = await fsPromises.realpath(resolvedContainmentRoot)
  const realPackageRoot = await fsPromises.realpath(resolvedPackageRoot)
  if (pathEscapesRoot(realContainmentRoot, realPackageRoot)) {
    throw createPluginPathError('Plugin package root escapes its registered real-path containment root')
  }

  return async (relativePath: string) => {
    if (!isContainedResourcePath(relativePath)) {
      throw createPluginPathError(`Plugin path is not a contained relative path: ${relativePath}`)
    }
    const targetPath = path.resolve(realPackageRoot, ...relativePath.split('/'))
    let currentPath = realPackageRoot
    for (const segment of relativePath.split('/')) {
      currentPath = path.join(currentPath, segment)
      const stat = await fsPromises.lstat(currentPath)
      if (stat.isSymbolicLink()) {
        throw createPluginPathError(`Plugin package paths must not contain symbolic links: ${relativePath}`)
      }
    }
    const realTargetPath = await fsPromises.realpath(targetPath)
    if (pathEscapesRoot(realPackageRoot, realTargetPath)) {
      throw createPluginPathError(`Plugin path escapes its package root: ${relativePath}`)
    }
    return fsPromises.readFile(realTargetPath)
  }
}

function markCatalogCollisions(packages: PluginPackageValidation[]): PluginPackageValidation[] {
  const collisions = new Map<number, PluginDiagnostic[]>()

  function addCollisions(
    entries: Array<{ packageIndex: number; id: string }>,
    code: 'PLUGIN_DUPLICATE_PACKAGE_ID' | 'PLUGIN_DUPLICATE_CAPABILITY_ID' | 'PLUGIN_DUPLICATE_SKILL_ID',
  ) {
    const byId = new Map<string, number[]>()
    for (const entry of entries) {
      const packageIndexes = byId.get(entry.id) ?? []
      packageIndexes.push(entry.packageIndex)
      byId.set(entry.id, packageIndexes)
    }
    for (const [id, packageIndexes] of byId) {
      if (packageIndexes.length < 2) {
        continue
      }
      for (const packageIndex of packageIndexes) {
        const diagnostics = collisions.get(packageIndex) ?? []
        diagnostics.push(createDiagnostic(code, id))
        collisions.set(packageIndex, diagnostics)
      }
    }
  }

  addCollisions(
    packages.flatMap((entry, packageIndex) => entry.manifestFacts ? [{ packageIndex, id: entry.manifestFacts.id }] : []),
    'PLUGIN_DUPLICATE_PACKAGE_ID',
  )
  addCollisions(
    packages.flatMap((entry, packageIndex) => entry.manifestFacts?.capabilities.map((capability) => ({ packageIndex, id: capability.id })) ?? []),
    'PLUGIN_DUPLICATE_CAPABILITY_ID',
  )
  addCollisions(
    packages.flatMap((entry, packageIndex) => entry.manifestFacts?.skills.map((skill) => ({ packageIndex, id: skill.id })) ?? []),
    'PLUGIN_DUPLICATE_SKILL_ID',
  )

  return packages.map((entry, packageIndex) => {
    const collisionDiagnostics = collisions.get(packageIndex) ?? []
    if (collisionDiagnostics.length === 0) {
      return entry
    }
    const diagnostics = [...entry.diagnostics, ...collisionDiagnostics]
    return {
      ...entry,
      status: deriveLifecycleStatus(diagnostics),
      diagnostics,
      locatedFacts: entry.locatedFacts
        ? { ...entry.locatedFacts, packageDigestSha256: null }
        : null,
    }
  })
}

export async function loadPluginCatalog(
  hostVersion: string,
  sources: readonly PluginPackageSource[],
): Promise<PluginCatalog> {
  const validatedPackages = await Promise.all(sources.map((source) => validatePluginPackageSource(source, hostVersion)))
  return {
    contractVersion: PLUGIN_CONTRACT.contractVersion,
    hostVersion,
    packages: markCatalogCollisions(validatedPackages).sort((left, right) => left.catalogId.localeCompare(right.catalogId)),
  }
}

export async function loadBundledPluginCatalogFromFileSystem(
  appRoot: string,
  hostVersion: string,
): Promise<PluginCatalog> {
  const sources = BUNDLED_PLUGIN_REGISTRATIONS.map((registration) => {
    if (!isContainedResourcePath(registration.manifestPath)) {
      throw new Error(`Bundled Plugin manifest path is not contained: ${registration.manifestPath}`)
    }
    const packageRootRelative = path.posix.dirname(registration.manifestPath)
    const manifestRelativePath = path.posix.basename(registration.manifestPath)
    const packageRoot = path.resolve(appRoot, ...packageRootRelative.split('/'))
    let readerPromise: Promise<(relativePath: string) => Promise<Buffer>> | null = null
    return {
      catalogId: registration.catalogId,
      origin: 'bundled' as const,
      packageRoot,
      manifestRelativePath,
      readFile: async (relativePath: string) => {
        readerPromise ??= createContainedFileReader(packageRoot, appRoot)
        return (await readerPromise)(relativePath)
      },
    }
  })

  return loadPluginCatalog(hostVersion, sources)
}

export function toPublicPluginDiagnostics(catalog: PluginCatalog): PluginPublicCatalogDiagnostics {
  return {
    contractVersion: catalog.contractVersion,
    hostVersion: catalog.hostVersion,
    packages: catalog.packages.map((entry) => {
      const available = entry.status === 'ready'
      return {
        catalogId: entry.catalogId,
        packageId: entry.manifestFacts?.id ?? null,
        displayName: entry.manifestFacts?.displayName ?? null,
        version: entry.manifestFacts?.version ?? null,
        origin: entry.locatedFacts?.origin ?? 'bundled',
        status: entry.status,
        packageDigestSha256: entry.locatedFacts?.packageDigestSha256 ?? null,
        capabilities: entry.manifestFacts?.capabilities.map((capability) => ({
          id: capability.id,
          family: capability.family,
          version: capability.contractVersion,
          availability: available ? 'declared' as const : 'unavailable' as const,
          executable: false as const,
          loaded: false as const,
        })) ?? [],
        skills: entry.manifestFacts?.skills.map((skill) => ({
          id: skill.id,
          family: 'skill' as const,
          version: skill.version,
          availability: available ? 'declared' as const : 'unavailable' as const,
          executable: false as const,
          loaded: false as const,
        })) ?? [],
        diagnostics: entry.diagnostics.map((diagnostic) => ({
          code: diagnostic.code,
          severity: diagnostic.severity,
          message: diagnostic.publicMessage,
        })),
      }
    }),
  }
}

export const INTERNAL_PLUGIN_CONTRACT = {
  contract: PLUGIN_CONTRACT,
  diagnostics: PLUGIN_DIAGNOSTICS,
  bundledRegistrations: BUNDLED_PLUGIN_REGISTRATIONS,
} as const
