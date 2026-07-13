# AI Model Registry Design

## Summary

この文書は、AI model 選択を固定文字列設定から registry 正本ベースへ移行するための設計を定義する。

`contract_state: active_contract`

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
- reasoning effort / pro mode / prompt caching / programmatic tool calling / multi-agent の設定面追加

## Active OpenAI Registry

2026-07-13 時点の first slice は、OpenAI 公式の [latest model guidance](https://developers.openai.com/api/docs/guides/latest-model) と [pricing](https://developers.openai.com/api/docs/pricing) を根拠に次を登録する。

| Model ID | Role | Context | Max output | Standard input / cached / output per 1M tokens |
| --- | --- | ---: | ---: | ---: |
| `gpt-5.6-sol` | frontier capability | 1,050,000 | 128,000 | $5.00 / $0.50 / $30.00 |
| `gpt-5.6-terra` | intelligence / cost balance, default | 1,050,000 | 128,000 | $2.50 / $0.25 / $15.00 |
| `gpt-5.6-luna` | cost-sensitive high volume | 1,050,000 | 128,000 | $1.00 / $0.10 / $6.00 |

`gpt-5.6` alias は Sol へ route されるが、同一候補を重複表示しないため picker は canonical tier ID だけを扱う。旧 `gpt-5.4-mini` に対応する移行先として、公式に mini 相当と説明される Terra を default とする。

表の価格は基準単価である。3 model とも入力が 272K tokens を超えるリクエストでは、リクエスト全体の入力単価が 2 倍、出力単価が 1.5 倍になる。この条件も registry の structured pricing metadata と Settings の選択中 model facts に表示し、固定見積りと誤認させない。

GPT-5.6 は reasoning effort 省略時に `medium` となる一方、移行元の GPT-5.4 mini は実効値が通常 `none` だった。first migration は latency、cost、tool behavior を暗黙に変えないため、GPT-5.6 registry model の Responses request に `reasoning.effort: none` を明示する。reasoning effort の user-facing 設定追加は引き続き blocked scope とする。

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
- legacy value は読込時に自動置換しない。DropDownList 上では disabled な現在値として表示し、registry 候補を選ぶまで保存しない
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

## Settings Metadata Contract

Settings UI は mutable な registry 正本へ直接アクセスせず、`get_app_metadata` と同じ main-generated typed facts を受け取る。main は model ID、provider ID、context / output limit、structured pricing、status、`selectable`、`recommended`、selected model の known 状態を決定する。renderer は locale-aware な token / price / status label と migration warning だけを組み立て、model facts や選択可否を再定義しない。

この境界により、release preflight と renderer は同じ raw facts を比較でき、表示言語は renderer の i18n に従える。Settings 専用の表示済み label shape は IPC contract に追加しない。

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
- native DropDownList の各選択行で display name、model ID、context window、基準の input / output 価格、status を短い label として出す
- 選択中 model の summary では cached input 価格と長文入力時の価格倍率も含む詳細を出す

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
- provider 増加時も registry shape 自体は維持し、provider ID から表示名への変換など locale / presentation 固有処理は renderer で吸収する
