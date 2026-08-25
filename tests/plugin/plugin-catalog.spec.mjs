import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { createPackage } from '@electron/asar'

import {
  validatePluginPackageInAsar,
  validatePluginPackageRoot,
} from '../../scripts/plugin-conformance.mjs'
import { parsePluginValidatorArgs } from '../../scripts/validate-plugin.mjs'

const require = createRequire(import.meta.url)
const Ajv2020 = require('ajv/dist/2020').default
const {
  loadBundledPluginCatalogFromFileSystem,
  loadPluginCatalog,
  parsePluginManifestText,
  toPublicPluginDiagnostics,
} = require('../../electron/lib/main/plugin-catalog.cjs')

const rootDir = process.cwd()
const sampleRoot = path.join(rootDir, 'plugins', 'bundled', 'diagnostics-sample')

async function readSampleManifest() {
  return JSON.parse(await fs.readFile(path.join(sampleRoot, 'plugin.json'), 'utf8'))
}

async function readSampleResource() {
  return fs.readFile(path.join(sampleRoot, 'resources', 'sample-guide.md'))
}

function createMissingFileError(relativePath) {
  const error = new Error(`Missing fixture: ${relativePath}`)
  error.code = 'ENOENT'
  return error
}

function createMemorySource(manifest, options = {}) {
  const manifestText = typeof manifest === 'string' ? manifest : JSON.stringify(manifest)
  const resourceBytes = options.resourceBytes ?? new Map()
  return {
    catalogId: options.catalogId ?? 'fixture',
    origin: 'bundled',
    packageRoot: options.packageRoot ?? '/private/plugin-root',
    manifestRelativePath: 'plugin.json',
    async readFile(relativePath) {
      if (relativePath === 'plugin.json') {
        return Buffer.from(manifestText, 'utf8')
      }
      const bytes = resourceBytes.get(relativePath)
      if (!bytes) {
        throw createMissingFileError(relativePath)
      }
      return bytes
    },
  }
}

async function validateMemoryManifest(manifest, options = {}) {
  const catalog = await loadPluginCatalog(options.hostVersion ?? '0.2.3', [createMemorySource(manifest, options)])
  return {
    catalog,
    publicDiagnostics: toPublicPluginDiagnostics(catalog),
  }
}

test('bundled sample produces stable ready catalog metadata without execution authority', async () => {
  const catalog = await loadBundledPluginCatalogFromFileSystem(rootDir, '0.2.3')
  const diagnostics = toPublicPluginDiagnostics(catalog)

  assert.equal(diagnostics.contractVersion, 1)
  assert.equal(diagnostics.packages.length, 1)
  assert.equal(diagnostics.packages[0].packageId, 'dev.mdv.diagnostics-sample')
  assert.equal(diagnostics.packages[0].origin, 'bundled')
  assert.equal(diagnostics.packages[0].status, 'ready')
  assert.match(diagnostics.packages[0].packageDigestSha256, /^[0-9a-f]{64}$/)
  assert.deepEqual(
    diagnostics.packages[0].capabilities.map(({ family, availability, executable, loaded }) => ({ family, availability, executable, loaded })),
    [
      { family: 'codeblock', availability: 'declared', executable: false, loaded: false },
      { family: 'text-rendering', availability: 'declared', executable: false, loaded: false },
      { family: 'llm-tool', availability: 'declared', executable: false, loaded: false },
    ],
  )
  assert.deepEqual(diagnostics.packages[0].skills.map(({ availability, executable, loaded }) => ({ availability, executable, loaded })), [
    { availability: 'declared', executable: false, loaded: false },
  ])
  assert.doesNotMatch(JSON.stringify(diagnostics), /\/home\/|plugin\.json|sample-guide\.md/)
})

test('developer validator and main catalog share outcomes for the bundled sample', async () => {
  const mainCatalog = toPublicPluginDiagnostics(await loadBundledPluginCatalogFromFileSystem(rootDir, '0.2.3'))
  const developerResult = await validatePluginPackageRoot({
    packageRoot: sampleRoot,
    manifestRelativePath: 'plugin.json',
    hostVersion: '0.2.3',
  })

  assert.equal(developerResult.ok, true)
  assert.equal(developerResult.packages[0].packageId, mainCatalog.packages[0].packageId)
  assert.equal(developerResult.packages[0].status, mainCatalog.packages[0].status)
  assert.deepEqual(developerResult.packages[0].capabilities, mainCatalog.packages[0].capabilities)
  assert.deepEqual(developerResult.packages[0].skills, mainCatalog.packages[0].skills)
  assert.deepEqual(developerResult.packages[0].diagnostics, [])
})

test('strict parser rejects invalid JSON, unknown schema, extra fields, and mixed family payloads', async () => {
  assert.equal(parsePluginManifestText('{').diagnostics[0].code, 'PLUGIN_INVALID_JSON')

  const unknownSchema = await readSampleManifest()
  unknownSchema.schemaVersion = 2
  assert.equal(parsePluginManifestText(JSON.stringify(unknownSchema)).diagnostics[0].code, 'PLUGIN_UNKNOWN_SCHEMA_VERSION')

  const extraField = await readSampleManifest()
  extraField.dynamicEntry = './driver.js'
  assert.equal(parsePluginManifestText(JSON.stringify(extraField)).diagnostics[0].code, 'PLUGIN_INVALID_MANIFEST')

  const mixedFamily = await readSampleManifest()
  mixedFamily.capabilities[0].toolNames = ['not_allowed_on_codeblock']
  assert.equal(parsePluginManifestText(JSON.stringify(mixedFamily)).diagnostics[0].code, 'PLUGIN_INVALID_MANIFEST')

  const unknownCapabilityVersion = await readSampleManifest()
  unknownCapabilityVersion.capabilities[0].contractVersion = 2
  assert.equal(parsePluginManifestText(JSON.stringify(unknownCapabilityVersion)).diagnostics[0].code, 'PLUGIN_UNSUPPORTED_CAPABILITY_VERSION')
})

test('canonical JSON Schema and runtime parser agree on the shared shape corpus', async () => {
  const schema = JSON.parse(await fs.readFile(path.join(rootDir, 'plugin-contract', 'manifest.schema.json'), 'utf8'))
  const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema)
  const valid = await readSampleManifest()
  const extraField = structuredClone(valid)
  extraField.dynamicEntry = './driver.js'
  const dotSegment = structuredClone(valid)
  dotSegment.resources[0].path = 'resources/./sample-guide.md'
  const emptySegment = structuredClone(valid)
  emptySegment.resources[0].path = 'resources//sample-guide.md'
  const longId = structuredClone(valid)
  longId.id = `a${'b'.repeat(120)}`
  const mixedFamily = structuredClone(valid)
  mixedFamily.capabilities[0].toolNames = ['wrong_family_payload']
  const unknownCapabilityVersion = structuredClone(valid)
  unknownCapabilityVersion.capabilities[0].contractVersion = 2

  for (const fixture of [valid, extraField, dotSegment, emptySegment, longId, mixedFamily, unknownCapabilityVersion]) {
    const schemaAccepted = validateSchema(fixture)
    const parserAccepted = Boolean(parsePluginManifestText(JSON.stringify(fixture)).manifestFacts)
    assert.equal(parserAccepted, schemaAccepted, JSON.stringify(validateSchema.errors))
  }
})

test('path traversal fails closed before a resource reader can be invoked', async () => {
  const manifest = await readSampleManifest()
  manifest.resources[0].path = '../outside.md'
  let resourceReads = 0
  const source = createMemorySource(manifest)
  const originalRead = source.readFile
  source.readFile = async (relativePath) => {
    if (relativePath !== 'plugin.json') {
      resourceReads += 1
    }
    return originalRead(relativePath)
  }

  const catalog = await loadPluginCatalog('0.2.3', [source])

  assert.equal(catalog.packages[0].status, 'invalid')
  assert.equal(catalog.packages[0].diagnostics[0].code, 'PLUGIN_PATH_ESCAPE')
  assert.equal(resourceReads, 0)
})

test('missing and digest-mismatched resources fail closed with structured diagnostics', async () => {
  const manifest = await readSampleManifest()
  const missing = await validateMemoryManifest(manifest)
  assert.equal(missing.catalog.packages[0].status, 'invalid')
  assert.equal(missing.catalog.packages[0].diagnostics[0].code, 'PLUGIN_MISSING_RESOURCE')

  const mismatch = await validateMemoryManifest(manifest, {
    resourceBytes: new Map([['resources/sample-guide.md', Buffer.from('tampered')]]),
  })
  assert.equal(mismatch.catalog.packages[0].status, 'invalid')
  assert.equal(mismatch.catalog.packages[0].diagnostics[0].code, 'PLUGIN_DIGEST_MISMATCH')
  assert.equal(mismatch.publicDiagnostics.packages[0].capabilities.every((item) => item.availability === 'unavailable'), true)
  assert.equal(mismatch.publicDiagnostics.packages[0].skills.every((item) => item.availability === 'unavailable'), true)
})

test('host and Plugin API incompatibility derive incompatible state', async () => {
  const manifest = await readSampleManifest()
  const resource = await readSampleResource()
  const outsideRange = await validateMemoryManifest(manifest, {
    hostVersion: '2.0.0',
    resourceBytes: new Map([['resources/sample-guide.md', resource]]),
  })
  assert.equal(outsideRange.catalog.packages[0].status, 'incompatible')
  assert.equal(outsideRange.catalog.packages[0].diagnostics[0].code, 'PLUGIN_INCOMPATIBLE_HOST_VERSION')

  manifest.compatibility.pluginApiVersion = 2
  const unsupportedApi = await validateMemoryManifest(manifest, {
    resourceBytes: new Map([['resources/sample-guide.md', resource]]),
  })
  assert.equal(unsupportedApi.catalog.packages[0].status, 'incompatible')
})

test('package, capability, and Skill ID collisions fail every affected package closed', async () => {
  const first = await readSampleManifest()
  const second = structuredClone(first)
  first.id = 'dev.mdv.first'
  second.id = 'dev.mdv.second'
  const resource = await readSampleResource()
  const resourceBytes = new Map([['resources/sample-guide.md', resource]])

  const capabilityCollision = await loadPluginCatalog('0.2.3', [
    createMemorySource(first, { catalogId: 'first', resourceBytes }),
    createMemorySource(second, { catalogId: 'second', resourceBytes }),
  ])
  assert.deepEqual(capabilityCollision.packages.map((entry) => entry.status), ['invalid', 'invalid'])
  assert.equal(capabilityCollision.packages.every((entry) => entry.diagnostics.some((diagnostic) => diagnostic.code === 'PLUGIN_DUPLICATE_CAPABILITY_ID')), true)
  assert.equal(capabilityCollision.packages.every((entry) => entry.diagnostics.some((diagnostic) => diagnostic.code === 'PLUGIN_DUPLICATE_SKILL_ID')), true)

  second.id = first.id
  const packageCollision = await loadPluginCatalog('0.2.3', [
    createMemorySource(first, { catalogId: 'first', resourceBytes }),
    createMemorySource(second, { catalogId: 'second', resourceBytes }),
  ])
  assert.equal(packageCollision.packages.every((entry) => entry.diagnostics.some((diagnostic) => diagnostic.code === 'PLUGIN_DUPLICATE_PACKAGE_ID')), true)
})

test('explicit package-root validation does not enumerate sibling Plugin directories', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-plugin-conformance-'))
  const explicitRoot = path.join(tempRoot, 'explicit')
  await fs.cp(sampleRoot, explicitRoot, { recursive: true })
  await fs.mkdir(path.join(tempRoot, 'sibling'), { recursive: true })
  await fs.writeFile(path.join(tempRoot, 'sibling', 'plugin.json'), '{not-json')

  try {
    const result = await validatePluginPackageRoot({
      packageRoot: explicitRoot,
      manifestRelativePath: 'plugin.json',
      hostVersion: '0.2.3',
    })
    assert.equal(result.ok, true)
    assert.equal(result.packages.length, 1)
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('missing registered bundled package returns a bounded failed catalog entry', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-plugin-missing-root-'))

  try {
    const catalog = await loadBundledPluginCatalogFromFileSystem(tempRoot, '0.2.3')
    const diagnostics = toPublicPluginDiagnostics(catalog)
    assert.equal(diagnostics.packages.length, 1)
    assert.equal(diagnostics.packages[0].status, 'failed')
    assert.equal(diagnostics.packages[0].diagnostics[0].code, 'PLUGIN_PACKAGE_READ_FAILED')
    assert.doesNotMatch(JSON.stringify(diagnostics), new RegExp(tempRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('explicit package-root validation rejects a symlinked package root', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-plugin-root-symlink-'))
  const realRoot = path.join(tempRoot, 'real-package')
  const linkedRoot = path.join(tempRoot, 'linked-package')
  await fs.cp(sampleRoot, realRoot, { recursive: true })
  await fs.symlink(realRoot, linkedRoot)

  try {
    const result = await validatePluginPackageRoot({
      packageRoot: linkedRoot,
      manifestRelativePath: 'plugin.json',
      hostVersion: '0.2.3',
    })
    assert.equal(result.ok, false)
    assert.equal(result.packages[0].status, 'failed')
    assert.equal(result.packages[0].diagnostics[0].code, 'PLUGIN_PACKAGE_READ_FAILED')
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('bundled catalog rejects a symlinked directory below the app root', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-plugin-bundled-symlink-'))
  const externalPlugins = path.join(tempRoot, 'external-plugins')
  await fs.mkdir(path.join(externalPlugins, 'bundled'), { recursive: true })
  await fs.cp(sampleRoot, path.join(externalPlugins, 'bundled', 'diagnostics-sample'), { recursive: true })
  await fs.symlink(externalPlugins, path.join(tempRoot, 'plugins'))

  try {
    const catalog = await loadBundledPluginCatalogFromFileSystem(tempRoot, '0.2.3')
    assert.equal(catalog.packages[0].status, 'failed')
    assert.equal(catalog.packages[0].diagnostics[0].code, 'PLUGIN_PACKAGE_READ_FAILED')
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('packaged validator accepts an explicitly supplied root-level manifest', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-plugin-root-asar-'))
  const inputRoot = path.join(tempRoot, 'input')
  const asarPath = path.join(tempRoot, 'app.asar')
  await fs.cp(sampleRoot, inputRoot, { recursive: true })
  await createPackage(inputRoot, asarPath)

  try {
    const result = await validatePluginPackageInAsar({
      asarPath,
      manifestPath: 'plugin.json',
      hostVersion: '0.2.3',
    })
    assert.equal(result.ok, true)
    assert.equal(result.packages[0].status, 'ready')
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('explicit package-root validation rejects a declared resource symlink that escapes the root', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-plugin-symlink-'))
  const explicitRoot = path.join(tempRoot, 'explicit')
  const outsidePath = path.join(tempRoot, 'outside.md')
  await fs.cp(sampleRoot, explicitRoot, { recursive: true })
  await fs.copyFile(path.join(sampleRoot, 'resources', 'sample-guide.md'), outsidePath)
  const resourcePath = path.join(explicitRoot, 'resources', 'sample-guide.md')
  await fs.rm(resourcePath)
  await fs.symlink(outsidePath, resourcePath)

  try {
    const result = await validatePluginPackageRoot({
      packageRoot: explicitRoot,
      manifestRelativePath: 'plugin.json',
      hostVersion: '0.2.3',
    })
    assert.equal(result.ok, false)
    assert.equal(result.packages[0].status, 'failed')
    assert.equal(result.packages[0].diagnostics[0].code, 'PLUGIN_PACKAGE_READ_FAILED')
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('validator CLI rejects missing option values instead of resolving the current directory', () => {
  assert.throws(() => parsePluginValidatorArgs(['--root']), /--root requires a value/)
  assert.throws(() => parsePluginValidatorArgs(['--root', '--json']), /--root requires a value/)
  assert.throws(() => parsePluginValidatorArgs(['--asar', 'candidate.asar', '--manifest']), /--manifest requires a value/)
})

test('preload and main use the same bounded read-only Plugin diagnostics IPC channel', async () => {
  const [preloadSource, mainIpcSource] = await Promise.all([
    fs.readFile(path.join(rootDir, 'electron', 'preload.cjs'), 'utf8'),
    fs.readFile(path.join(rootDir, 'src', 'electron', 'main', 'main-ipc.cts'), 'utf8'),
  ])

  assert.match(preloadSource, /plugins:\s*\{\s*getDiagnostics: \(\) => ipcRenderer\.invoke\('mdv:plugins-get-diagnostics'\)/)
  assert.match(mainIpcSource, /ipcMain\.handle\('mdv:plugins-get-diagnostics', async \(\) => getPluginDiagnostics\(\)\)/)
  assert.doesNotMatch(preloadSource, /plugin.*packageRoot|plugin.*manifestFacts/is)
})
