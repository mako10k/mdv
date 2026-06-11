# 0012 Draft Workspace Image Import

Status: Superseded by [0020 Inline Image Storage And Assets Deprecation](0020-inline-image-storage-and-assets-deprecation.md)

## Context

This ADR is superseded by [0020 Inline Image Storage And Assets Deprecation](0020-inline-image-storage-and-assets-deprecation.md) for the persisted storage model of newly inserted images.

MD-BL-005 では、画像 paste / drop を saved file と unsaved document の両方で relative path のまま扱う必要がある。

既存の MDV は relative image の export 読み出しは持っていたが、asset をどこへ保存するか、unsaved document の first save でどう materialize するか、renderer と main process がどの単位で workspace identity を共有するかは未確定だった。

今回の変更は main process、preload bridge、renderer state、autosave recovery snapshot、save flow にまたがって asset lifecycle を広げるため、一時的な UI 差分ではなく恒久的な desktop contract 変更になる。

## Decision

- unsaved document は `recoveryKey` を安定な draft workspace identity として使い、main process の `ensureDraftWorkspace` で app-managed draft workspace を確保する
- preload bridge は `ensureDraftWorkspace` と `importImageAsset` を公開し、renderer は current file path の代わりに draft workspace metadata を併せて保持する
- image paste / drop は main process の `importImageAsset` で workspace `assets/` 配下へ保存し、renderer には relative Markdown path だけを返す
- saved file では Markdown file の親ディレクトリ配下 `assets/` を使い、unsaved document では draft workspace `assets/` を使う
- first save では draft manifest を基に asset を保存先ディレクトリへ materialize し、必要な場合だけ Markdown 内の relative path を rewrite する
- draft workspace ensure は idempotent にし、同じ workspaceId への再入で manifest を破壊しない

## Consequences

- unsaved document でも pasted / dropped image を app-private absolute path や data URL に逃がさず relative path contract のまま扱える
- main process、preload、renderer typings、autosave recovery snapshot は draft workspace metadata を同期して保つ必要がある
- first save は本文保存だけではなく asset materialization を伴うため、saved-file と draft の保存経路差分を専用テストで維持する必要がある
- draft manifest と first-save rewrite は将来の asset GC、history / recovery、AI asset tools の基礎になる
