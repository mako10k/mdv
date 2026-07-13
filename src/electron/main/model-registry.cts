type ModelProviderId = 'openai' | 'openai-compatible'
type ModelStatus = 'active' | 'preview' | 'deprecated' | 'unavailable'
type ModelCapability = 'responses-api' | 'streaming' | 'tool-calling' | 'reasoning'

type TokenPrice = {
  per1M: number
  currency: 'USD'
}

type ModelPricing = {
  input: TokenPrice | null
  output: TokenPrice | null
  cachedInput: TokenPrice | null
  longContext: {
    aboveInputTokens: number
    inputMultiplier: number
    outputMultiplier: number
  } | null
}

type ModelRegistryEntry = {
  modelId: string
  displayName: string
  providerId: ModelProviderId
  family: string
  contextWindowTokens: number | null
  outputTokenLimit: number | null
  status: ModelStatus
  capabilities: ModelCapability[]
  pricing: ModelPricing
  releaseStageLabel: string | null
  isDefaultCandidate: boolean
  enabledByDefault: boolean
  deprecationNote: string | null
  docsUrl: string | null
  sortOrder: number
}

type ModelRegistry = {
  version: string
  updatedAt: string
  defaultModelId: string
  entries: ModelRegistryEntry[]
}

const GPT_5_6_CONTEXT_WINDOW_TOKENS = 1_050_000
const GPT_5_6_OUTPUT_TOKEN_LIMIT = 128_000
const GPT_5_6_LONG_CONTEXT_PRICING = {
  aboveInputTokens: 272_000,
  inputMultiplier: 2,
  outputMultiplier: 1.5,
}
const GPT_5_6_CAPABILITIES: ModelCapability[] = [
  'responses-api',
  'streaming',
  'tool-calling',
  'reasoning',
]

const OPENAI_MODEL_REGISTRY: ModelRegistry = {
  version: '2026-07-13',
  updatedAt: '2026-07-13',
  defaultModelId: 'gpt-5.6-terra',
  entries: [
    {
      modelId: 'gpt-5.6-sol',
      displayName: 'GPT-5.6 Sol',
      providerId: 'openai',
      family: 'gpt-5.6',
      contextWindowTokens: GPT_5_6_CONTEXT_WINDOW_TOKENS,
      outputTokenLimit: GPT_5_6_OUTPUT_TOKEN_LIMIT,
      status: 'active',
      capabilities: [...GPT_5_6_CAPABILITIES],
      pricing: {
        input: { per1M: 5, currency: 'USD' },
        cachedInput: { per1M: 0.5, currency: 'USD' },
        output: { per1M: 30, currency: 'USD' },
        longContext: { ...GPT_5_6_LONG_CONTEXT_PRICING },
      },
      releaseStageLabel: 'Latest',
      isDefaultCandidate: false,
      enabledByDefault: true,
      deprecationNote: null,
      docsUrl: 'https://developers.openai.com/api/docs/models/gpt-5.6-sol',
      sortOrder: 10,
    },
    {
      modelId: 'gpt-5.6-terra',
      displayName: 'GPT-5.6 Terra',
      providerId: 'openai',
      family: 'gpt-5.6',
      contextWindowTokens: GPT_5_6_CONTEXT_WINDOW_TOKENS,
      outputTokenLimit: GPT_5_6_OUTPUT_TOKEN_LIMIT,
      status: 'active',
      capabilities: [...GPT_5_6_CAPABILITIES],
      pricing: {
        input: { per1M: 2.5, currency: 'USD' },
        cachedInput: { per1M: 0.25, currency: 'USD' },
        output: { per1M: 15, currency: 'USD' },
        longContext: { ...GPT_5_6_LONG_CONTEXT_PRICING },
      },
      releaseStageLabel: 'Latest',
      isDefaultCandidate: true,
      enabledByDefault: true,
      deprecationNote: null,
      docsUrl: 'https://developers.openai.com/api/docs/models/gpt-5.6-terra',
      sortOrder: 20,
    },
    {
      modelId: 'gpt-5.6-luna',
      displayName: 'GPT-5.6 Luna',
      providerId: 'openai',
      family: 'gpt-5.6',
      contextWindowTokens: GPT_5_6_CONTEXT_WINDOW_TOKENS,
      outputTokenLimit: GPT_5_6_OUTPUT_TOKEN_LIMIT,
      status: 'active',
      capabilities: [...GPT_5_6_CAPABILITIES],
      pricing: {
        input: { per1M: 1, currency: 'USD' },
        cachedInput: { per1M: 0.1, currency: 'USD' },
        output: { per1M: 6, currency: 'USD' },
        longContext: { ...GPT_5_6_LONG_CONTEXT_PRICING },
      },
      releaseStageLabel: 'Latest',
      isDefaultCandidate: false,
      enabledByDefault: true,
      deprecationNote: null,
      docsUrl: 'https://developers.openai.com/api/docs/models/gpt-5.6-luna',
      sortOrder: 30,
    },
  ],
}

function copyPrice(price: TokenPrice | null): TokenPrice | null {
  return price ? { ...price } : null
}

function copyEntry(entry: ModelRegistryEntry): ModelRegistryEntry {
  return {
    ...entry,
    capabilities: [...entry.capabilities],
    pricing: {
      input: copyPrice(entry.pricing.input),
      cachedInput: copyPrice(entry.pricing.cachedInput),
      output: copyPrice(entry.pricing.output),
      longContext: entry.pricing.longContext ? { ...entry.pricing.longContext } : null,
    },
  }
}

function getModelRegistryEntry(modelId: unknown): ModelRegistryEntry | null {
  if (typeof modelId !== 'string') {
    return null
  }

  const entry = OPENAI_MODEL_REGISTRY.entries.find((candidate) => candidate.modelId === modelId.trim())
  return entry ? copyEntry(entry) : null
}

function isSelectableModelId(modelId: unknown) {
  const entry = getModelRegistryEntry(modelId)
  return Boolean(entry && entry.enabledByDefault && (entry.status === 'active' || entry.status === 'preview'))
}

function getModelContextWindowTokens(modelId: unknown, fallbackTokens: number) {
  return getModelRegistryEntry(modelId)?.contextWindowTokens ?? fallbackTokens
}

function getModelRuntimeReasoningEffort(modelId: unknown): 'none' | null {
  return getModelRegistryEntry(modelId)?.family === 'gpt-5.6' ? 'none' : null
}

function getModelRegistryMetadata(selectedModelId: unknown, registry: ModelRegistry = OPENAI_MODEL_REGISTRY) {
  const normalizedSelectedModelId = typeof selectedModelId === 'string' && selectedModelId.trim().length > 0
    ? selectedModelId.trim()
    : null

  return {
    defaultModelId: registry.defaultModelId,
    selectedModelId: normalizedSelectedModelId,
    registryVersion: registry.version,
    updatedAt: registry.updatedAt,
    selectedModelKnown: normalizedSelectedModelId !== null
      && registry.entries.some((entry) => entry.modelId === normalizedSelectedModelId),
    models: registry.entries
      .slice()
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((entry) => ({
        ...copyEntry(entry),
        selectable: entry.enabledByDefault && (entry.status === 'active' || entry.status === 'preview'),
        recommended: entry.modelId === registry.defaultModelId,
      })),
  }
}

export {
  OPENAI_MODEL_REGISTRY,
  getModelContextWindowTokens,
  getModelRegistryEntry,
  getModelRegistryMetadata,
  getModelRuntimeReasoningEffort,
  isSelectableModelId,
}
