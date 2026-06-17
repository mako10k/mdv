# Local Asset Storage Design

## Status

Historical workspace / compatibility reference.

The current implementation contract for image storage is [Image Storage Design](image-storage-design.md). [ADR 0020 Inline Image Storage And Assets Deprecation](adr/0020-inline-image-storage-and-assets-deprecation.md) records the decision history and rationale behind that contract. The sections below describe the earlier `assets/` materialization model and remain useful for draft workspace identity, relative image compatibility, resolver cleanup, and AI asset-tool background. They are not the source of truth for the canonical storage model of newly inserted images.

## Why This Document Exists

この設計当時の仕様・前提には次があった。現行の [Image Storage Design](image-storage-design.md) では、新規 paste / drop 画像の保存正本には使わない。

- 保存済み Markdown の隣接 assets ディレクトリへ相対 asset を出力する要件
- ローカルファイルの同一性と snapshot-aware save を守る保存フロー
- AI 側の canonical target として editor/buffer resource を扱う方針

当時、次はまだ閉じていなかった。

- 未保存文書で paste / drag and drop / embed された画像をどこへ置くか
- relative local link と履歴保存をどう両立するか
- AI が local asset をどう参照し、copy や rename をどこまで実行できるか
- XDG / Electron / 既存ノートアプリの慣行に沿った保存先の切り方

この文書は、その当時の設計を一旦まとめた。

関連:

- [docs/markdown-editor-fit-gap-backlog.md](markdown-editor-fit-gap-backlog.md)
- [docs/adr/0006-local-file-sync-and-conflict-save.md](adr/0006-local-file-sync-and-conflict-save.md)
- [docs/adr/0010-local-asset-workspace-and-tool-boundary.md](adr/0010-local-asset-workspace-and-tool-boundary.md)
- [docs/adr/0020-inline-image-storage-and-assets-deprecation.md](adr/0020-inline-image-storage-and-assets-deprecation.md)
- [docs/ai-chat-design.md](ai-chat-design.md)
- [docs/ai-resource-target-unification-proposal.md](ai-resource-target-unification-proposal.md)

## Historical Design Summary

この節は現行の [Image Storage Design](image-storage-design.md) より前の historical materialization model である。新規 paste / drop 画像は inline image 表現を正本とし、この節の `assets/` 保存ルールは relative image 互換、draft workspace identity、resolver cleanup の背景として読む。ここにある `assets/` 保存、first-save materialization、assetId continuity の箇条書きは現行実装指示ではない。

当時の結論:

- relative local asset は常に「文書に紐づく workspace root」を基準に扱う
- 保存済み文書では workspace root は Markdown ファイルの親ディレクトリ
- 未保存文書では workspace root はアプリ管理の draft workspace ディレクトリ
- historical materialization model では、paste / drop / embed で入った画像をまずその workspace root 配下に保存する
- 履歴保存は本文 snapshot だけでなく asset manifest を伴う workspace-aware state として扱う
- AI は asset を editor resource に雑に混ぜず、専用の asset resource / asset mutation tool で扱う

この historical model では、保存済み文書も未保存文書も「相対リンクで資産を参照する」という表面契約を維持できる。未保存文書だけ特別扱いして broken path や一時 data URL を Markdown に残す必要がない、という判断だった。

## Historical Best-Practice Baseline

この設計は次の慣行に寄せる。

### 1. 文書ローカル配置を第一候補にする

Markdown 系ツールでは、保存済み文書の asset を文書近傍または設定済み添付フォルダへ置く運用が最も理解しやすい。Obsidian も attachment location を vault root / current file folder / subfolder から選べる形を採っている。

したがって MDV でも、保存済み文書の relative asset は文書の実ディレクトリ基準で扱う。

### 2. 未保存文書には app-managed staging area を持つ

貼り付け直後の asset を data URL やメモリだけで抱えると、再起動、履歴復元、AI 参照、rename/copy で破綻しやすい。そこで未保存文書にも永続的な draft workspace を与える。

### 3. XDG / OS 規約に従って data と state を分離する

XDG Base Directory Specification では、user data と state を分ける。

- durable data は XDG_DATA_HOME
- history / recent / reusable app state は XDG_STATE_HOME
- cache は XDG_CACHE_HOME

Linux ではこの切り方をそのまま採る。

### 4. Electron の userData 直下を巨大 blob 置き場にしない

Electron の app.getPath('userData') は設定やアプリデータの標準場所だが、大きなファイルを直下へ雑に積むのは推奨されない。Chromium 自身の subdirectory と混ざるため、アプリ専用 subdirectory を切る。

### 5. 未参照 asset は参照関係ベースで GC する

Joplin は note に属さない resource を履歴ポリシーに従って削除する。MDV でも draft workspace や history から参照されなくなった asset を、retention policy に従って掃除する。

## Historical Workspace Model

この節は新規 paste / drop 画像の canonical storage model ではない。現行の [Image Storage Design](image-storage-design.md) では、relative image 互換、draft workspace identity、resolver cleanup、deprecated asset-workspace 整理を検討するときの historical workspace model として扱う。

### Document Workspace Root

各 editor は本文だけでなく、asset を含む workspace root を持つ。

```ts
type DocumentWorkspace = {
  workspaceId: string
  kind: 'saved-file' | 'draft'
  rootDir: string
  markdownFilePath: string
  assetDir: string
  manifestPath: string
}
```

ルール:

- saved-file では rootDir は Markdown ファイルの親ディレクトリ
- draft では rootDir は app-managed local directory
- asset 相対リンクは常に markdownFilePath から解決する
- assetDir は default attachment location の既定値として使うが、将来は設定で変更可能にする

### Asset Record

```ts
type LocalAssetRecord = {
  assetId: string
  workspaceId: string
  role: 'attachment' | 'embedded-resource'
  mediaKind: 'image' | 'audio' | 'video' | 'binary'
  storedFileName: string
  relativePath: string
  absolutePath: string
  originalSourceName: string | null
  mimeType: string | null
  byteSize: number
  createdAt: string
  createdBy: 'paste' | 'drop' | 'embed' | 'import' | 'ai-copy' | 'ai-rename'
  contentHash: string | null
}
```

注意点:

- canonical identity は path ではなく assetId
- Markdown に書くのは assetId ではなく relativePath
- rename は path 変更と Markdown link 更新を伴うが、assetId は維持する
- contentHash は dedupe と import optimization 用で、参照キーにはしない

## Historical Storage Layout

### Linux

Linux では XDG を正本にする。

```text
$XDG_DATA_HOME/mdv/
  assets/
    shared/                # 将来の cross-workspace reusable blob 用。Phase 1 では optional

$XDG_STATE_HOME/mdv/
  drafts/
    <workspaceId>/
      document.md
      assets/
      manifest.json
  history/
    recent-workspaces.json
    recovery/
```

fallback:

- XDG_DATA_HOME 未設定時は ~/.local/share/mdv
- XDG_STATE_HOME 未設定時は ~/.local/state/mdv

### Windows / macOS

Windows と macOS では Electron の userData を基準にしつつ、用途ごとに subdirectory を切る。

```text
<userData>/data/
  assets/

<userData>/state/
  drafts/
  history/
  recovery/

<logs>/mdv.log
```

ルール:

- settings / secrets の既存ファイルは userData 直下を継続してよい
- 新しい asset / history / draft は userData 直下へ増やさず、data と state に分ける
- logs は既存の app.getPath('logs') を継続する

## Historical Attachment Placement Policy

既定ポリシー:

1. 保存済み文書では Markdown ファイルの隣接 subfolder へ保存する
2. 未保存文書では draft workspace の assetDir へ保存する
3. Markdown には常に relative path を挿入する

初期既定値:

- assetDir name は assets
- collision 時は basename-2, basename-3 のように連番回避する
- user が貼ったファイル名を極力維持するが、安全でない文字は sanitize する

将来の設定候補:

- current file folder
- subfolder under current file folder
- fixed workspace subfolder

これは Obsidian 系の attachment location 運用に近いが、MDV ではまず assets を既定に固定して複雑さを抑える。

## Historical Lifecycle

### New Unsaved Document

新規文書を開いた時点で draft workspace を割り当てる。

- workspaceId を採番する
- state/drafts/<workspaceId>/document.md を backing file とする
- editor はこの draft file identity に attach される
- paste / drop asset は同じ draft workspace 配下へ入る

これにより、未保存文書でも relative path をそのまま使える。

例:

```text
state/drafts/wrk_abc123/
  document.md
  assets/
    pasted-image.png
  manifest.json
```

document.md 内:

```md
![](assets/pasted-image.png)
```

### First Save / Save As

初回保存では draft workspace を実ディレクトリへ materialize する。

1. user が target markdown path を選ぶ
2. draft document.md を target path へ書く
3. draft assets を target 親ディレクトリ配下の assetDir へコピーまたは move する
4. asset path が変わる場合だけ Markdown 内 relative path を rewrite する
5. assetId continuity map を更新し、既存 history / recovery entry が同じ assetId で新しい absolute path を再解決できるようにする
6. workspace kind を saved-file に切り替える
7. 旧 draft workspace は retention policy に従って掃除候補に入れる

原則:

- save の結果、Markdown 内には app-private absolute path を残さない
- 保存後の正本は user の実ファイル側に移る
- first save 前後で assetId は維持し、path だけが更新される

### Reopen Saved Document

保存済み文書を再度開いた場合は、その親ディレクトリを workspace root として再構築する。

- 既存 relative link はそのまま解決する
- manifest は無くてもよい
- 必要なら open 時に asset index を遅延構築する

### History / Recovery

履歴保存は本文だけでなく workspace-aware metadata を持つ。

```ts
type WorkspaceHistoryEntry = {
  historyId: string
  workspaceId: string
  markdownSnapshotPath: string
  assetRefs: string[]
  createdAt: string
  reason: 'autosave' | 'crash-recovery' | 'manual-history'
}
```

方針:

- history は asset を丸ごと毎回複製しない
- history entry は assetId 参照でぶら下げる
- asset 実体は workspace root に残し、GC は history retention を見て行う

## Historical Relative Link Rules

relative local link は次だけを許可する。

- current workspace root 配下
- saved document の親ディレクトリ配下
- draft workspace root 配下

禁止:

- app-managed draft から外へ向く `../..` traversal
- 相対記法を装った absolute path escape
- AI が勝手に外部ディレクトリへ rename / copy すること

解決時ルール:

- link 解決は normalize 済み absolute path で判定する
- resolved path が workspace root を外れる場合は unsafe とみなす

## Historical AI Integration

### Principle

asset は editor text と混ぜず、resource kind を分ける。

これは [docs/ai-resource-target-unification-proposal.md](ai-resource-target-unification-proposal.md) の方針に沿う。asset は text span ではなく file object に近いため、editor locator を流用しない。

### Resource Shape

```ts
type AssetResourceRef = {
  kind: 'asset'
  assetId: string
  workspaceId: string
}
```

初期 locator:

- whole-item
- metadata-only

Phase 1 では binary 本文の直接 read はしない。モデルへ返すのは metadata と、安全に text 化できる範囲の情報だけに留める。

### Initial Tool Surface

This section and its approval / rename subsections are historical. The listed asset tools are not accepted current AI scope. Under the current [Image Storage Design](image-storage-design.md), user-facing asset / image-management tools are `backlog_state: future_requires_acceptance` and `contract_state: decision_change_required` until current-backlog accepts a new slice, the image storage design reclassifies the accepted user-facing surface as `active_contract`, and [AI Chat Design](ai-chat-design.md) accepts the AI tool schema, target rules, approval policy, and validation.

初期追加候補:

- list_assets
- read_asset_metadata
- copy_asset
- rename_asset

意味:

- list_assets: workspace に属する asset 一覧を返す
- read_asset_metadata: path、mime、size、参照中の Markdown link、origin を返す
- copy_asset: 同一 workspace 内または user 指定 export 先へ複製する
- rename_asset: basename 更新と参照 Markdown の link rewrite を一括で行う

Phase 1 でやらないこと:

- delete_asset
- arbitrary move outside workspace
- executable attachment の open / run
- raw binary dump の model 返却

### Historical Approval Policy

AI からの asset mutation は destructive class を分ける。

- list / metadata read は自動許可
- copy は同一 workspace 内なら自動許可候補、外部 export は承認対象
- rename は affected links の preview を返したうえで承認対象
- delete / move outside workspace は後続フェーズまで未実装

### Historical Rename Tool Rationale

rename を単純な file-system rename にすると、Markdown link rewrite、history の asset reference、open editor state が壊れる。したがって rename は asset manager が ownership を持つ。

## Historical Manifest

draft workspace では manifest を持つ。

```json
{
  "workspaceId": "wrk_abc123",
  "kind": "draft",
  "markdownFile": "document.md",
  "assetDir": "assets",
  "assets": [
    {
      "assetId": "ast_001",
      "relativePath": "assets/pasted-image.png",
      "mimeType": "image/png",
      "byteSize": 182044,
      "createdBy": "paste"
    }
  ]
}
```

saved-file workspace では manifest は optional にする。

理由:

- user 管理の実ディレクトリを勝手に sidecar 必須化したくない
- draft では recovery と AI 操作のために index が有益
- saved-file は遅延 index または app state cache で補える

追加ルール:

- draft から saved-file へ materialize した assetId と absolute path の対応は app state cache に保持する
- history / recovery は assetId を正本にし、実体 path は live workspace または app state cache から再解決する
- sidecar manifest が無い saved-file でも、open 時の遅延 index 構築で assetId continuity map を補修できるようにする

## Historical Garbage Collection And Retention

掃除対象:

- どの live workspace にも属さない draft asset
- history retention を過ぎた recovery entry だけが参照していた asset
- crash で取り残された orphan draft workspace

ポリシー:

- live editor が参照する workspace は削除しない
- recent history から参照される asset は削除しない
- asset GC は startup 時即実行ではなく、idle 時または一定間隔で実行する
- first implementation は conservative に残し、漏れより誤削除回避を優先する

## Historical Security And Safety

- asset path は workspace root confinement を必須にする
- mime type と拡張子の両方を記録する
- executable と script 系拡張子は AI の open / execute 対象にしない
- HTML export や preview inline 時も、既存 relative image read の safety check を流用する
- symlink は初期フェーズでは非対応または解決後に workspace confinement を再検証する

## Historical Implementation Plan

この plan は現行の [Image Storage Design](image-storage-design.md) より前の実装順であり、新規 paste / drop 画像の現行実装指示ではない。今後この節を参照する場合は、互換読み取り、draft workspace cleanup、deprecated asset materialization 経路の整理に限り、Image Storage Design の inline image storage contract と衝突しない範囲で扱う。

### Phase 1

- DocumentWorkspace abstraction を main process に追加
- draft workspace allocation を新規文書に導入
- paste / drop image 保存を draft/saved workspace に接続
- first save で draft から saved-file workspace へ materialize
- asset manifest を draft だけに導入

### Phase 2

- recent/history/recovery を workspace-aware にする
- orphan cleanup と retention policy を導入
- settings で attachment location policy を expose する

### Phase 3

- AI asset tools を追加
- rename preview と approval UI を追加
- copy/export policy を追加

## Historical Decisions

この設計では次を明示的に採る。

- relative link を捨てて assetId 埋め込みへ寄せる案は採らない
- 未保存文書だけ data URL 埋め込みに逃がす案は採らない
- AI asset 操作を read_target / write_target に押し込む案は採らない
- saved-file workspace に sidecar manifest を必須化する案は採らない

## Historical Open Questions

- 保存済み文書で assetDir の既定を assets 固定にするか、ファイル横直置きを許すか
- first save 時の asset move を atomic rename 優先にするか copy+verify 優先にするか
- image 以外の binary attachment を Phase 1 から同じ経路に乗せるか
- AI rename を常時承認制にするか、同一 workspace 内の低リスク rename は policy で自動化するか

## Historical Next Step

当時の recommended next step は「editor が file ではなく workspace に attach される」境界を最初に入れることだった。現行の [Image Storage Design](image-storage-design.md) では、これは新規 paste / drop 画像の保存モデルとしては採らない。必要になった場合だけ、relative image 互換、draft workspace identity、resolver cleanup、deprecated asset-workspace 整理のための historical guidance として参照する。
