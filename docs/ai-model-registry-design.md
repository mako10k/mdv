# AI Model Registry Design

## Summary

この文書は、AI model 選択を固定文字列設定から registry 正本ベースへ移行するための設計を定義する。

狙いは次の 3 つである。

- settings UI で意味のある model picker を提供する
- context window、価格、status などの facts を single source of truth に集約する
- release 前に cross-surface の整合性を検証できるようにする

## Goals

- main process に provider 非依存の model registry を持つ
- settings UI、app metadata、AI introspection surface が同じ registry facts を参照する
- model context window を registry から解決し、未知 model は conservative fallback へ落とす
- deprecated model を release と runtime の両方で検出できる
- 価格表示を settings UI に出せるようにする

## Non-Goals For First Slice

- 自動 price sync
- provider API からの動的 model discovery
- usage metering や monthly cost estimation
- provider ごとの高度な capability matrix 自動推定

## Ownership Boundary

- registry 正本は main process で管理する
- renderer は registry 全体を書き換えず、main process から配布された view model だけを見る
- secrets は registry に含めない。API key や base URL は settings / secret store の責務に残す

## Persistence Rule

first slice では既存の settings key `settingsState.ai.openai.model` を残し、その意味だけを「自由入力 model 文字列」から「registry 上の selected modelId」へ狭める。

ルール:

- 保存される選択値は registry に存在する `modelId` を基本とする
- 新規保存で任意の未登録 model ID は受け付けない
- 既存設定に未登録 model ID が残っている場合だけ legacy value として読み込み、warning と migration 導線を出す
- metadata、status、価格、context window は保存値からではなく registry 正本から解決する

## Canonical Data Model

```ts
type ModelProviderId = 'openai' | 'openai-compatible'

type ModelStatus = 'active' | 'preview' | 'deprecated' | 'unavailable'

type ModelCapability =
  | 'responses-api'
  | 'streaming'
  | 'tool-calling'
  | 'reasoning'

type TokenPrice = {
  per1M: number
  currency: 'USD'
}

type ModelPricing = {
  input: TokenPrice | null
  output: TokenPrice | null
  cachedInput?: TokenPrice | null
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
```

## Required Invariants

- `defaultModelId` は `entries` 内の active または preview model を指す
- `modelId` は registry 内で一意である
- `deprecated` と `unavailable` は既定選択候補にしない
- 価格不明の model は `null` を許すが、UI では unknown と明示する
- `contextWindowTokens` 不明時は runtime が conservative fallback を使う

## Runtime Resolution Rule

1. settings に保存された `modelId` が registry に存在すれば、その entry を使う
2. settings に有効な値がなく、environment fallback に registry 既知の `modelId` があれば bootstrap 値として使う
3. settings または environment fallback の `modelId` が registry に存在しなければ unknown-model warning を返す
4. warning 時は user に現在値を見せたうえで、registry default へ移行する導線を出す
5. context transport policy は resolved entry の `contextWindowTokens` を優先し、不明なら fallback を使う

## Settings View Model

settings UI は registry 全体ではなく、表示用に正規化した view model を受け取る。

```ts
type SettingsModelOption = {
  modelId: string
  displayName: string
  providerLabel: string
  contextWindowLabel: string
  pricingLabel: string
  status: ModelStatus
  statusLabel: string
  selected: boolean
  recommended: boolean
  selectable: boolean
  warning: string | null
}
```

### Settings Display Items

OpenAI provider card に最低限表示する項目は次の通り。

- Enabled
- Base URL
- Default Model picker
- 選択 model の display name
- model ID
- provider 名
- context window
- 価格表示
- status chip
- API Key configured state

### Picker Behavior

- 既定では `active` と `preview` だけを selectable にする
- `deprecated` は既存選択中のときだけ warning 付きで表示する
- `unavailable` は通常 picker に出さない
- 選択行で display name を主表示し、補助として model ID を出す
- context window と価格は候補比較がしやすい短い label にする

### Example Price Label

- `Input $5.00 / 1M, Output $15.00 / 1M`
- cached input がある場合は補助行で出す
- 不明なら `Pricing unavailable`

## App Metadata And Introspection Surface

`get_app_metadata` を canonical introspection surface とし、少なくとも次を返す。

```ts
type AppModelMetadata = {
  defaultModelId: string
  selectedModelId: string | null
  registryVersion: string
  models: Array<{
    modelId: string
    displayName: string
    providerId: string
    status: ModelStatus
    contextWindowTokens: number | null
    pricing: ModelPricing
    selectable: boolean
  }>
}
```

要件:

- settings UI と同じ source から生成する
- release preflight で cross-surface diff を取りやすい shape にする
- model context window 判定に使う facts を含める

## Release Preflight Relation

release 側では [docs/release-workflow.md](docs/release-workflow.md) の model registry preflight を通して、少なくとも次を確認する。

- settings UI の候補と `get_app_metadata` の候補が一致する
- default model が意図した release 既定値である
- registry 非掲載の legacy model 値が warning と migration 導線付きで扱われる
- deprecated model が通常選択肢へ残っていない
- 価格表示に必要な metadata 欠落がない

## Migration Notes

- 既存の単純な `settingsState.ai.openai.model` をすぐ消さず、移行期間は `selectedModelId` として読み替える
- first slice の保存キー名は既存互換のため維持するが、意味は registry `modelId` 参照へ変更する
- 既存値が registry 非掲載でも設定ロードで落とさず、warning を出して移行を促す
- `MDV_OPENAI_MODEL` などの environment fallback も registry 既知値だけを bootstrap 値として受け付け、未知値は warning 扱いにする
- provider 増加時も registry shape 自体は維持し、provider 固有表示は view model で吸収する