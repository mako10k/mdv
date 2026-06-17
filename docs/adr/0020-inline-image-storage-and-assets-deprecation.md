# 0020 Inline Image Storage And Assets Deprecation

Status: Accepted

Current implementation contract: [Image Storage Design](../image-storage-design.md). This ADR records the decision history and rationale.

## Context

ADR 0010 と ADR 0012 では、paste / drop 画像を workspace の `assets/` 配下へ保存し、first save でその asset を materialize する方針を採っていた。

今回の ADR が置き換えるのは、そのうち「新規挿入画像の正本保存モデル」と「first save 成功条件を asset materialization で判定する部分」である。draft workspace identity、workspace attach、互換読み取りのための resolver のような周辺判断まで一括で捨てるものではない。

現在のプロダクト判断では、この `assets/` 保存モデルを新規挿入画像の正本として維持しない。editor 上の inline `data:image...` badge は一時表示ではなく、ユーザーに見せる正規の保存モデルへ寄せる。これにより、release gate や手動確認で `assets/` ディレクトリ生成を成功条件にすると、現行の意図と判断基準がずれる。

一方で、既存 Markdown に残っている relative image や、過去 slice の `assets/...` 参照は直ちに読めなくしてよいわけではない。deprecation の対象は新規正本モデルであり、既存文書の互換性ではない。

## Decision

- 新規に paste / drop された画像の正本保存モデルとして、Markdown 隣接の `assets/` ディレクトリへ materialize する方式は deprecated とする。
- 今後の正規 contract は、新規挿入画像を Markdown 上の inline image 表現で保持し、editor でも保存済み文書でもその表現を正本として扱うことを基準にする。
- `assets/` 生成は release 合格条件や UX の期待値に含めない。
- 既存の relative image / `assets/...` Markdown は後方互換の対象として残し、open、preview、WYSIWYG 表示、fallback、export では読み取り互換を維持する。user-facing な export-to-file、asset manager、conversion UI はこの互換判断だけでは受理済み scope にならず、別途 backlog と design contract の受理を必要とする。
- first save continuity の判定は「画像が保存後も見えること」と「editor 上で通常の画像として編集継続できること」を基準にし、asset materialization の有無を基準にしない。
- 本 ADR は ADR 0010 および ADR 0012 のうち、新規挿入画像の正本保存モデルと first-save materialization 前提の判断を supersede する。

## Consequences

- release workflow、release work memo、手動 smoke 手順、関連テストは `assets/` フォルダ生成を必須成功条件として扱えない。
- 既存の `importImageAsset`、draft workspace materialization、relative image resolver は、直ちに削除対象ではなく、互換読み取りまたは移行期間の実装として整理し直す必要がある。
- ADR 0012 はこの判断により superseded とし、ADR 0010 は workspace boundary 自体は維持しつつ、保存モデルに関する部分だけをこの ADR で置き換える。
- relative path を前提にした既存 ADR や design doc は、今後の実装変更と同じターンまたは段階的な follow-up で更新が必要になる。
