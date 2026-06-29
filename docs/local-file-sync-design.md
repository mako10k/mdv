# Local File Sync Design

この文書は、MDV の保存済み Markdown file と editor buffer の同期 contract を定義する。

## Decision State

- `contract_state: active_contract`
- 対象は renderer window に attached された現在の保存済み local Markdown file である。
- 背景 decision は [docs/adr/0006-local-file-sync-and-conflict-save.md](adr/0006-local-file-sync-and-conflict-save.md) に記録する。

## Snapshot Contract

- Electron main process は file I/O、snapshot 作成、save conflict 判定を所有する。
- Renderer は editor content、dirty state、最後に同期した snapshot baseline を所有する。
- `open-file` と `read-file` は Markdown text と file snapshot を返す。snapshot は少なくとも path、content hash、size、mtime を含む。
- Renderer は snapshot baseline と live editor Markdown を比較して dirty state を判定する。

## External Change Contract

- Main process は現在 attached された file path だけを watch し、renderer へ lightweight change notification を送る。
- Watch notification は content push ではない。Renderer は clean buffer のときだけ既存 `read-file` path で本文と snapshot を読み直し、baseline を更新する。
- Dirty buffer で外部変更が起きた場合、renderer は editor content を自動置換しない。保存時に snapshot-aware conflict flow で user choice を求める。

## Manual Reload Contract

- Renderer は F5、file action toolbar、File menu から current-file manual reload を提供する。
- Manual reload は watcher notification に依存しない user-triggered fallback であり、現在 attached された保存済み file だけを既存 `read-file` path で読み直す。
- Manual reload は新しい preload IPC を追加しない。Menu action は既存 menu-action bridge を使い、file content read は既存 `read-file` bridge を使う。
- Manual reload は clean-buffer-only である。Dirty buffer では editor content を破棄せず、reload skip status を表示する。
- 読み直した snapshot の content hash が現在 baseline と同じ場合でも、renderer は snapshot metadata を更新して「最新」と表示できる。

## Non-Goals

- UNC/network filesystem の watcher 実装修正や backend-specific 動作保証はこの contract に含めない。
- Polling、watcher replacement、reload interval setting は含めない。
- Dirty buffer の強制破棄 reload、file write / mutation、save conflict policy の変更は含めない。
