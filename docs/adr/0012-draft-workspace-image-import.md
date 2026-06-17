# 0012 Draft Workspace Image Import

Status: Superseded by [0020 Inline Image Storage And Assets Deprecation](0020-inline-image-storage-and-assets-deprecation.md)

## Context

This ADR is historical for newly inserted images. [0020 Inline Image Storage And Assets Deprecation](0020-inline-image-storage-and-assets-deprecation.md) supersedes the draft-workspace `assets/` import and first-save materialization model for new paste / drop storage. Current implementation authority for image storage is [Image Storage Design](../image-storage-design.md), and decision / backlog acceptance is governed by [0022 Design Contract Authority And Change Workflow](0022-design-contract-authority-and-change-workflow.md) and [Decision Governance](../decision-governance.md).

MD-BL-005 では、画像 paste / drop を saved file と unsaved document の両方で relative path のまま扱う必要がある。

既存の MDV は relative image の export 読み出しは持っていたが、asset をどこへ保存するか、unsaved document の first save でどう materialize するか、renderer と main process がどの単位で workspace identity を共有するかは未確定だった。

今回の変更は main process、preload bridge、renderer state、autosave recovery snapshot、save flow にまたがって asset lifecycle を広げるため、一時的な UI 差分ではなく恒久的な desktop contract 変更になる。

## Decision

The following decisions are superseded for new paste / drop images and remain only as historical context for app-managed temporary cleanup, recovery migration, and old documents:

- Historical: unsaved document は `recoveryKey` を安定な draft workspace identity として使い、main process の `ensureDraftWorkspace` で app-managed draft workspace を確保する
- Superseded for new paste / drop storage: preload bridge は `ensureDraftWorkspace` と `importImageAsset` を公開し、renderer は current file path の代わりに draft workspace metadata を併せて保持する
- Superseded for new paste / drop storage: image paste / drop は main process の `importImageAsset` で workspace `assets/` 配下へ保存し、renderer には relative Markdown path だけを返す
- Superseded for new paste / drop storage: saved file では Markdown file の親ディレクトリ配下 `assets/` を使い、unsaved document では draft workspace `assets/` を使う
- Superseded for new paste / drop storage: first save では draft manifest を基に asset を保存先ディレクトリへ materialize し、必要な場合だけ Markdown 内の relative path を rewrite する
- Historical compatibility behavior: draft workspace ensure は idempotent にし、同じ workspaceId への再入で manifest を破壊しない

## Consequences

- Historical model では、unsaved document でも pasted / dropped image を app-private absolute path や data URL に逃がさず relative path contract のまま扱える
- Historical model では、main process、preload、renderer typings、autosave recovery snapshot は draft workspace metadata を同期して保つ必要がある
- Historical model では、first save は本文保存だけではなく asset materialization を伴うため、saved-file と draft の保存経路差分を専用テストで維持する必要がある
- App-managed draft workspace temporary cleanup and recovery migration can remain compatibility / maintenance behavior, but they do not reopen `assets/` materialization for new paste / drop images.
- Asset GC, asset history / recovery UI, and AI asset tools are not accepted by this ADR. They are `backlog_state: future_requires_acceptance` and `contract_state: decision_change_required` until current-backlog accepts a new slice, the relevant current design contract reclassifies the accepted user-facing surface as `active_contract`, and [AI Chat Design](../ai-chat-design.md) accepts any AI tool schema, target rules, approval policy, and validation.
