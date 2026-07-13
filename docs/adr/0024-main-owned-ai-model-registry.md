# ADR 0024: Main-Owned AI Model Registry

## Status

Accepted

## Context

OpenAI model ID、context window、価格、status、既定候補を renderer と main process の複数箇所へ直接記述すると、Settings、context budgeting、AI introspection、release preflight が別々の事実を表示する。自由入力 model field は未知値を新規保存でき、release 時に意図した候補と runtime 選択が一致する保証もない。

現在の契約は [AI Model Registry Design](../ai-model-registry-design.md) と [Settings Design](../settings-design.md) に定義する。

## Decision

- provider model facts は main process の静的 registry を正本とし、Settings renderer と `get_app_metadata` は typed metadata view だけを受け取る。
- first slice は canonical GPT-5.6 tier ID の Sol、Terra、Lunaを selectable とし、mini 相当の移行先である Terra をdefaultにする。aliasや動的 discoveryを重複候補として追加しない。
- Settings は自由入力ではなくDropDownListを使い、新規保存はselectable registry IDだけを受け付ける。既存の未知値はlegacyとして読込・表示を維持するが、自動置換せず、候補選択による明示移行を要求する。
- main process とrendererのcontext budget、Settingsのfacts、AI introspectionは同じregistry metadataを使う。価格は公式標準APIのper-1M-token factsであり、usage meterや請求見積りには拡張しない。
- 基準単価に加えて長文入力の価格 threshold / multiplier を structured metadata として保持し、Settings で条件を明示する。
- GPT-5.4 mini からの first migration では実効 reasoning を変えないよう、GPT-5.6 の Responses request に `reasoning.effort: none` を明示する。reasoning 設定 UI はこの slice に追加しない。

## Consequences

- model更新時の変更点とrelease preflightの比較対象が一つになり、Settingsとruntimeのdriftを検出できる。
- 既存のcustom/legacy model設定は失われないが、最新候補へ移行するまでwarningとconservative fallback budgetを使う。
- 動的model取得、自動価格同期、reasoning/pro/cache/PTC/multi-agent設定、provider別catalogは別の受理済みsliceを必要とする。
