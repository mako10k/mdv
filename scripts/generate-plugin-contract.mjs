import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const EXPECTED_FAMILIES = [
  ['codeblock', 'languages'],
  ['text-rendering', 'formats'],
  ['llm-tool', 'toolNames'],
]

function json(value) {
  return JSON.stringify(value, null, 2)
}

function assertCanonicalContract(contract) {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    throw new Error('plugin-contract/contract.json must contain an object')
  }

  if (!Array.isArray(contract.capabilityFamilies) || contract.capabilityFamilies.length !== EXPECTED_FAMILIES.length) {
    throw new Error('Canonical Plugin contract must define the three capability families exactly once')
  }

  for (const [family, payloadField] of EXPECTED_FAMILIES) {
    const declaration = contract.capabilityFamilies.find((candidate) => candidate?.family === family)
    if (!declaration || declaration.payloadField !== payloadField) {
      throw new Error(`Canonical Plugin contract must define ${family}.${payloadField}`)
    }
  }

  if (!Array.isArray(contract.diagnostics) || contract.diagnostics.length === 0) {
    throw new Error('Canonical Plugin contract must define diagnostics')
  }

  const diagnosticCodes = contract.diagnostics.map((diagnostic) => diagnostic?.code)
  if (diagnosticCodes.some((code) => typeof code !== 'string') || new Set(diagnosticCodes).size !== diagnosticCodes.length) {
    throw new Error('Canonical Plugin diagnostic codes must be unique strings')
  }

  if (!Array.isArray(contract.bundledPackages) || contract.bundledPackages.length === 0) {
    throw new Error('Canonical Plugin contract must explicitly list bundled package manifests')
  }
}

function buildCapabilitySchemas(contract) {
  const idSchema = { type: 'string', pattern: contract.idPattern, maxLength: contract.limits.idCharacters }
  const commonProperties = {
    id: idSchema,
    contractVersion: { type: 'integer', minimum: 1 },
    permissions: { type: 'array', maxItems: 0 },
    resourceIds: {
      type: 'array',
      maxItems: contract.limits.stringListItems,
      uniqueItems: true,
      items: idSchema,
    },
  }

  return contract.capabilityFamilies.map((declaration) => {
    const itemSchema = declaration.allowedItems
      ? { type: 'string', enum: declaration.allowedItems }
      : { type: 'string', pattern: declaration.itemPattern }

    return {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'family', 'contractVersion', 'permissions', 'resourceIds', declaration.payloadField],
      properties: {
        ...commonProperties,
        family: { const: declaration.family },
        contractVersion: { const: declaration.contractVersion },
        [declaration.payloadField]: {
          type: 'array',
          minItems: 1,
          maxItems: contract.limits.stringListItems,
          uniqueItems: true,
          items: itemSchema,
        },
      },
    }
  })
}

function buildManifestSchema(contract) {
  const idSchema = { type: 'string', pattern: contract.idPattern, maxLength: contract.limits.idCharacters }
  const versionSchema = { type: 'string', pattern: contract.versionPattern, maxLength: contract.limits.versionCharacters }

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: contract.schemaId,
    title: 'MDV Internal Plugin Manifest',
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'id', 'displayName', 'version', 'compatibility', 'resources', 'capabilities', 'skills'],
    properties: {
      schemaVersion: { const: contract.manifestSchemaVersion },
      id: idSchema,
      displayName: { type: 'string', minLength: 1, maxLength: contract.limits.displayNameCharacters },
      version: versionSchema,
      compatibility: {
        type: 'object',
        additionalProperties: false,
        required: ['mdv', 'pluginApiVersion'],
        properties: {
          mdv: {
            type: 'object',
            additionalProperties: false,
            required: ['minVersion', 'maxVersionExclusive'],
            properties: {
              minVersion: versionSchema,
              maxVersionExclusive: versionSchema,
            },
          },
          pluginApiVersion: { type: 'integer', minimum: 1 },
        },
      },
      resources: {
        type: 'array',
        maxItems: contract.limits.resources,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'path', 'sha256', 'mediaType', 'purpose'],
          properties: {
            id: idSchema,
            path: { type: 'string', pattern: contract.resourcePathPattern },
            sha256: { type: 'string', pattern: contract.sha256Pattern },
            mediaType: { type: 'string', enum: contract.mediaTypes },
            purpose: { type: 'string', enum: contract.resourcePurposes },
          },
        },
      },
      capabilities: {
        type: 'array',
        maxItems: contract.limits.capabilities,
        items: { oneOf: buildCapabilitySchemas(contract) },
      },
      skills: {
        type: 'array',
        maxItems: contract.limits.skills,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'displayName', 'version', 'instructionResourceId', 'resourceIds'],
          properties: {
            id: idSchema,
            displayName: { type: 'string', minLength: 1, maxLength: contract.limits.displayNameCharacters },
            version: versionSchema,
            instructionResourceId: idSchema,
            resourceIds: {
              type: 'array',
              maxItems: contract.limits.stringListItems,
              uniqueItems: true,
              items: idSchema,
            },
          },
        },
      },
    },
  }
}

function buildGeneratedTypes(contract) {
  const familyUnion = contract.capabilityFamilies.map(({ family }) => `'${family}'`).join(' | ')
  const diagnosticUnion = contract.diagnostics.map(({ code }) => `'${code}'`).join(' | ')
  const purposeUnion = contract.resourcePurposes.map((value) => `'${value}'`).join(' | ')
  const mediaTypeUnion = contract.mediaTypes.map((value) => `'${value}'`).join(' | ')
  const capabilityContractUnion = contract.capabilityFamilies.map((declaration) => {
    const itemConstraint = declaration.allowedItems
      ? 'allowedItems: readonly string[]'
      : 'itemPattern: string'
    return `{ family: '${declaration.family}'; contractVersion: number; payloadField: '${declaration.payloadField}'; ${itemConstraint} }`
  }).join('\n  | ')

  return `// Generated by scripts/generate-plugin-contract.mjs. Do not edit directly.

export type PluginCapabilityFamily = ${familyUnion}
export type PluginDiagnosticCode = ${diagnosticUnion}
export type PluginDiagnosticSeverity = 'error' | 'warning' | 'info'
export type PluginOrigin = 'bundled'
export type PluginLifecycleStatus = 'ready' | 'invalid' | 'incompatible' | 'failed'
export type PluginResourcePurpose = ${purposeUnion}
export type PluginResourceMediaType = ${mediaTypeUnion}

export type PluginManifestCompatibility = {
  mdv: {
    minVersion: string
    maxVersionExclusive: string
  }
  pluginApiVersion: number
}

export type PluginManifestResource = {
  id: string
  path: string
  sha256: string
  mediaType: PluginResourceMediaType
  purpose: PluginResourcePurpose
}

export type PluginManifestCapabilityBase = {
  id: string
  contractVersion: number
  permissions: []
  resourceIds: string[]
}

export type PluginCodeblockCapability = PluginManifestCapabilityBase & {
  family: 'codeblock'
  languages: string[]
}

export type PluginTextRenderingCapability = PluginManifestCapabilityBase & {
  family: 'text-rendering'
  formats: ['markdown-text']
}

export type PluginLlmToolCapability = PluginManifestCapabilityBase & {
  family: 'llm-tool'
  toolNames: string[]
}

export type PluginManifestCapability = PluginCodeblockCapability | PluginTextRenderingCapability | PluginLlmToolCapability

export type PluginSkillContribution = {
  id: string
  displayName: string
  version: string
  instructionResourceId: string
  resourceIds: string[]
}

export type PluginManifestFacts = {
  schemaVersion: number
  id: string
  displayName: string
  version: string
  compatibility: PluginManifestCompatibility
  resources: PluginManifestResource[]
  capabilities: PluginManifestCapability[]
  skills: PluginSkillContribution[]
}

export type PluginDiagnosticDefinition = {
  code: PluginDiagnosticCode
  severity: PluginDiagnosticSeverity
  publicMessage: string
  developerDetail: string
  remediation: string
}

export type BundledPluginRegistration = {
  catalogId: string
  manifestPath: string
}

export type PluginCapabilityContract =
  | ${capabilityContractUnion}

export type PluginRuntimeContract = {
  PLUGIN_CONTRACT: {
    contractVersion: number
    manifestSchemaVersion: number
    pluginApiVersion: number
    idPattern: string
    versionPattern: string
    resourcePathPattern: string
    sha256Pattern: string
    limits: {
      manifestBytes: number
      displayNameCharacters: number
      idCharacters: number
      versionCharacters: number
      resources: number
      capabilities: number
      skills: number
      stringListItems: number
    }
    resourcePurposes: readonly PluginResourcePurpose[]
    mediaTypes: readonly PluginResourceMediaType[]
    capabilityFamilies: readonly PluginCapabilityContract[]
  }
  PLUGIN_MANIFEST_SCHEMA: object
  PLUGIN_DIAGNOSTICS: readonly PluginDiagnosticDefinition[]
  BUNDLED_PLUGIN_REGISTRATIONS: readonly BundledPluginRegistration[]
}

export type PluginPublicContribution = {
  id: string
  family: PluginCapabilityFamily | 'skill'
  version: number | string
  availability: 'declared' | 'unavailable'
  executable: false
  loaded: false
}

export type PluginPublicDiagnostic = {
  code: PluginDiagnosticCode
  severity: PluginDiagnosticSeverity
  message: string
}

export type PluginPublicPackageDiagnostics = {
  catalogId: string
  packageId: string | null
  displayName: string | null
  version: string | null
  origin: PluginOrigin
  status: PluginLifecycleStatus
  packageDigestSha256: string | null
  capabilities: PluginPublicContribution[]
  skills: PluginPublicContribution[]
  diagnostics: PluginPublicDiagnostic[]
}

export type PluginPublicCatalogDiagnostics = {
  contractVersion: number
  hostVersion: string
  packages: PluginPublicPackageDiagnostics[]
}
`
}

function buildGeneratedRuntime(contract, manifestSchema) {
  return `// Generated by scripts/generate-plugin-contract.mjs. Do not edit directly.

import type { PluginRuntimeContract } from './plugin-manifest-contract-types.generated.cjs'

const PLUGIN_CONTRACT = ${json({
    contractVersion: contract.contractVersion,
    manifestSchemaVersion: contract.manifestSchemaVersion,
    pluginApiVersion: contract.pluginApiVersion,
    idPattern: contract.idPattern,
    versionPattern: contract.versionPattern,
    resourcePathPattern: contract.resourcePathPattern,
    sha256Pattern: contract.sha256Pattern,
    limits: contract.limits,
    resourcePurposes: contract.resourcePurposes,
    mediaTypes: contract.mediaTypes,
    capabilityFamilies: contract.capabilityFamilies,
  })} as const

const PLUGIN_MANIFEST_SCHEMA = ${json(manifestSchema)} as const

const PLUGIN_DIAGNOSTICS = ${json(contract.diagnostics)} as const

const BUNDLED_PLUGIN_REGISTRATIONS = ${json(contract.bundledPackages)} as const

const generatedPluginContract = {
  PLUGIN_CONTRACT,
  PLUGIN_MANIFEST_SCHEMA,
  PLUGIN_DIAGNOSTICS,
  BUNDLED_PLUGIN_REGISTRATIONS,
} satisfies PluginRuntimeContract

module.exports = generatedPluginContract
`
}

function buildReference(contract) {
  const capabilityRows = contract.capabilityFamilies
    .map((family) => `| \`${family.family}\` | \`${family.contractVersion}\` | \`${family.payloadField}\` |`)
    .join('\n')
  const diagnosticRows = contract.diagnostics
    .map((diagnostic) => `| \`${diagnostic.code}\` | \`${diagnostic.severity}\` | ${diagnostic.publicMessage} | ${diagnostic.remediation} |`)
    .join('\n')

  return `# Plugin Manifest Reference

> Generated by \`scripts/generate-plugin-contract.mjs\` from \`plugin-contract/contract.json\`. Do not edit directly.

## Availability

This is an internal/experimental metadata contract for MDV maintainers and bundled-package developers. Validation does not authorize Driver execution or Skill loading, and this is not a Public SDK compatibility promise.

## Manifest

- schema version: \`${contract.manifestSchemaVersion}\`
- Plugin API version: \`${contract.pluginApiVersion}\`
- exact object shapes: additional properties are rejected
- package, capability, resource, and Skill IDs: \`${contract.idPattern}\`
- versions: strict \`major.minor.patch\` without prerelease/build metadata
- resource paths: contained bundle-relative POSIX paths only
- resource digest: lowercase SHA-256
- capability permissions: an empty array in ENG-BL-005; validation grants no authority

The required top-level fields are \`schemaVersion\`, \`id\`, \`displayName\`, \`version\`, \`compatibility\`, \`resources\`, \`capabilities\`, and \`skills\`. See [the generated JSON Schema](../plugin-contract/manifest.schema.json) for exact nested fields and limits.

## Capability Families

| Family | Contract version | Family-specific field |
| --- | ---: | --- |
${capabilityRows}

These shapes are mutually exclusive. A common permissive payload object is not accepted.

## Diagnostics

| Code | Severity | Public message | Remediation |
| --- | --- | --- | --- |
${diagnosticRows}

Public diagnostics contain only bounded catalog facts, contribution state, codes, severity, and public messages. Developer validator output may additionally contain bundle-relative locations, developer detail, and remediation. Absolute package paths and raw manifests are excluded.
`
}

async function writeOrCheck(targetPath, expectedText, check) {
  if (check) {
    let actualText
    try {
      actualText = await fs.readFile(targetPath, 'utf8')
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') {
        throw new Error(`Generated Plugin contract file is missing: ${targetPath}`, { cause: error })
      }
      throw error
    }

    if (actualText !== expectedText) {
      throw new Error(`Generated Plugin contract file is stale: ${targetPath}`)
    }
    return
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  await fs.writeFile(targetPath, expectedText, 'utf8')
}

export async function generatePluginContract(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? process.cwd())
  const contractPath = path.join(rootDir, 'plugin-contract', 'contract.json')
  const contract = JSON.parse(await fs.readFile(contractPath, 'utf8'))
  assertCanonicalContract(contract)
  const manifestSchema = buildManifestSchema(contract)

  const outputs = [
    [path.join(rootDir, 'plugin-contract', 'manifest.schema.json'), `${json(manifestSchema)}\n`],
    [path.join(rootDir, 'src', 'electron', 'main', 'plugin-manifest-contract-types.generated.d.cts'), buildGeneratedTypes(contract)],
    [path.join(rootDir, 'src', 'electron', 'main', 'plugin-manifest-contract.generated.cts'), buildGeneratedRuntime(contract, manifestSchema)],
    [path.join(rootDir, 'docs', 'plugin-manifest-reference.md'), buildReference(contract)],
  ]

  for (const [targetPath, expectedText] of outputs) {
    await writeOrCheck(targetPath, expectedText, options.check === true)
  }

  return outputs.map(([targetPath]) => targetPath)
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) {
  const check = process.argv.includes('--check')
  const outputs = await generatePluginContract({ check })
  process.stdout.write(`${check ? 'Checked' : 'Generated'} Plugin contract outputs:\n${outputs.map((output) => `- ${output}`).join('\n')}\n`)
}
