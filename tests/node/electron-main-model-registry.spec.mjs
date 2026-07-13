import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  OPENAI_MODEL_REGISTRY,
  getModelContextWindowTokens,
  getModelRegistryMetadata,
  getModelRuntimeReasoningEffort,
  isSelectableModelId,
} = require('../../electron/lib/main/model-registry.cjs')

test('GPT-5.6 registry exposes the official canonical candidates and Terra default', () => {
  assert.equal(OPENAI_MODEL_REGISTRY.defaultModelId, 'gpt-5.6-terra')
  assert.deepEqual(
    OPENAI_MODEL_REGISTRY.entries.map((entry) => entry.modelId),
    ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
  )
  assert.ok(OPENAI_MODEL_REGISTRY.entries.every((entry) => entry.contextWindowTokens === 1_050_000))
  assert.ok(OPENAI_MODEL_REGISTRY.entries.every((entry) => entry.outputTokenLimit === 128_000))
  assert.equal(getModelContextWindowTokens('gpt-5.6-sol', 16_000), 1_050_000)
  assert.equal(getModelContextWindowTokens('legacy-model', 16_000), 16_000)
  assert.equal(getModelRuntimeReasoningEffort('gpt-5.6-terra'), 'none')
  assert.equal(getModelRuntimeReasoningEffort('legacy-model'), null)
  assert.deepEqual(OPENAI_MODEL_REGISTRY.entries[1].pricing.longContext, {
    aboveInputTokens: 272_000,
    inputMultiplier: 2,
    outputMultiplier: 1.5,
  })
})

test('registry metadata is defensive, selectable, and marks legacy selections', () => {
  const metadata = getModelRegistryMetadata('gpt-5.6-terra')

  assert.equal(metadata.selectedModelKnown, true)
  assert.equal(metadata.models.find((entry) => entry.modelId === 'gpt-5.6-terra')?.recommended, true)
  assert.ok(metadata.models.every((entry) => entry.selectable))
  metadata.models[0].capabilities.push('mutated')
  assert.equal(OPENAI_MODEL_REGISTRY.entries[0].capabilities.includes('mutated'), false)

  assert.equal(getModelRegistryMetadata('gpt-5.4-mini').selectedModelKnown, false)
  assert.equal(isSelectableModelId('gpt-5.6-luna'), true)
  assert.equal(isSelectableModelId('gpt-5.6'), false)
})

test('registry metadata distinguishes a known deprecated selection from an unknown legacy value', () => {
  const registry = {
    ...OPENAI_MODEL_REGISTRY,
    defaultModelId: 'gpt-5.6-sol',
    entries: OPENAI_MODEL_REGISTRY.entries.map((entry) => entry.modelId === 'gpt-5.6-terra'
      ? { ...entry, status: 'deprecated', enabledByDefault: false, deprecationNote: 'Migrate to Sol' }
      : entry),
  }
  const metadata = getModelRegistryMetadata('gpt-5.6-terra', registry)
  const selectedEntry = metadata.models.find((entry) => entry.modelId === 'gpt-5.6-terra')

  assert.equal(metadata.selectedModelKnown, true)
  assert.equal(selectedEntry?.status, 'deprecated')
  assert.equal(selectedEntry?.selectable, false)
  assert.equal(getModelRegistryMetadata('unknown-model', registry).selectedModelKnown, false)
})
