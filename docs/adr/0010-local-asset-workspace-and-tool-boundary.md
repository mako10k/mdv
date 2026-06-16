# 0010 Local Asset Workspace And Tool Boundary

Status: Partially superseded by [0020 Inline Image Storage And Assets Deprecation](0020-inline-image-storage-and-assets-deprecation.md)

## Context

The storage-model portions of this ADR are partially superseded by [0020 Inline Image Storage And Assets Deprecation](0020-inline-image-storage-and-assets-deprecation.md). The workspace boundary and asset-identity reasoning remain historical context until separately replaced.

MDV は relative image の export や local file sync は持っているが、paste、drag and drop、embed で入る local asset の正本保存先はまだ固定されていなかった。

特に次が未整理だった。

- 未保存文書に貼り付けた画像をどこへ置くか
- first save 後に draft 上の relative asset をどう materialize するか
- history / recovery が asset identity をどう引き継ぐか
- AI が asset を read/write text contract に混ぜずにどう参照、copy、rename するか

このまま個別機能から入ると、unsaved document、autosave / recovery、AI asset operation がそれぞれ別の一時しのぎの保存モデルを持ちやすい。

## Decision

Storage-model decisions about paste / drop asset placement, first-save materialization, and assetId continuity are historical for newly inserted images. ADR 0020 supersedes them for new paste / drop storage; keep the superseded bullets as compatibility, workspace-boundary, and migration-cleanup context only. The only still-current decision here is the boundary principle that asset-like resources must not be folded into the editor text tool contract without an explicit resource/tool surface.

- Historical: editor は単なる current file path ではなく、asset を含む DocumentWorkspace に attach される
- Historical: 保存済み文書では DocumentWorkspace の root は Markdown ファイルの親ディレクトリとする
- Superseded for new paste / drop storage: 未保存文書では app-managed draft workspace を割り当て、paste / drop / embed asset はそこへ保存する
- Superseded for new paste / drop storage: first save では draft workspace を saved-file workspace へ materialize し、Markdown 内の relative path だけを user-facing contract として残す
- Superseded for new paste / drop storage: asset identity は path ではなく assetId を正本にし、first save 前後では assetId を維持して path だけを更新する
- Superseded for new paste / drop storage: draft から saved-file への materialize 後も history / recovery が assetId を再解決できるよう、assetId continuity map を app state cache に保持する
- Historical: saved-file workspace に sidecar manifest は必須化しない。必要な index は live workspace または app state cache で補う
- Current boundary principle: AI では asset を独立 resource kind として扱うが、mutation は text write contract に混ぜない
- Current boundary principle: asset mutation は `list_assets`、`read_asset_metadata`、`copy_asset`、`rename_asset` のような専用 tool へ分離する

## Consequences

- Historical workspace model では、未保存文書でも relative path を維持したまま paste / drop / recovery / first save を一貫したモデルで扱える
- MD-BL-005 は当時、単なる画像挿入 UI ではなく、draft workspace、asset manager、assetId continuity を含む foundation work として扱っていた
- AI asset operation は editor text tool contract を汚さずに拡張できる
- Historical workspace model では、first save、history、recovery、AI rename/copy が shared asset identity に依存するため、main process の workspace / asset registry が必要になる
- user 管理ディレクトリへの sidecar 強制は避けられるが、saved-file reopen 時の遅延 index 補修が必要になる
