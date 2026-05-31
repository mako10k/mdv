# 0011 AI Chat Streamed IPC Contract

Status: Accepted

## Context

AI chat は assistant bubble を final reply 完成後にまとめて描画していたため、tool call を含む応答では待ち時間が長く見え、途中経過も表示できなかった。

今回の改善では main process、preload bridge、renderer の 3 者にまたがって AI chat の配送形を変える。これは一時的な UI 実装差分ではなく、assistant surface と desktop bridge の恒久的な契約変更になる。

## Decision

- `sendChatMessage` は final reply payload を直接返さず、`requestId` を含む dispatch ack を返す
- main process は同じ `requestId` を持つ `ai-chat-stream-event` を使い、`text-delta`、`tool-event`、`completed`、`failed` を段階配送する
- preload bridge は上記 event を renderer へ購読型 API として公開する
- renderer は streaming 中の assistant message を 1 つ保持し、`completed` 到着時に final reply / model 名で確定する
- final transcript に残す assistant reply は terminal no-tool iteration の output に限定し、tool call 前の暫定 prose は completed payload に持ち越さない

## Consequences

- AI chat は既存 Electron IPC のまま段階描画でき、tool call の途中経過も assistant surface に出せる
- main process、preload、renderer、型定義、設計ドキュメントを requestId 相関の stream 契約で同期して保つ必要がある
- 将来の cancel / retry / multi-request 並行処理は、この requestId ベース契約の上で拡張する
- 実行時の ordering と terminal iteration の扱いを崩すと transcript と次ターン入力がずれるため、今後は stream path の専用検証を追加する価値が高い