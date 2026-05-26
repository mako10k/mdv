# 0001 Settings Store And Secret Boundary

Status: Proposed

## Context

MDV は現在、theme を renderer localStorage に保存し、外部リンク許可は main process 側の `allowed-link-rules.json` で別管理している。今後 AI chat を進めるにあたり、OpenAI、Tavily、tool permission、write mode など、window をまたいで共有すべき設定が増える。

同時に、API キーのような secret は renderer に返さない境界を維持する必要がある。

## Decision

- 設定の単一ソースオブトゥルースは main process に置く
- 非 secret 設定は `app.getPath('userData')/settings.json` に保存する
- ただし既存の `allowed-link-rules.json` は初期段階では移行せず、read-only 参照を許す
- secret は別 backend abstraction で扱い、renderer へ生値は返さない
- renderer は既存の `window.mdvDesktop` preload bridge 拡張を通じて sanitized settings と configured state だけを読む
- 設定画面は独立 window として実装し、editor / AI chat の両方から開ける
- settings store を provider 設定の正本とし、環境変数は bootstrap / fallback に限定する

## Consequences

- 複数 window で設定状態がズレにくくなる
- theme など既存 renderer ローカル設定は将来 migration が必要になる
- theme 移行には renderer 補助の一回限り handoff が必要になる
- preload API と `src/shims.d.ts` の更新が settings 実装の中心になる
- secret backend の具体実装は後から差し替え可能になる
