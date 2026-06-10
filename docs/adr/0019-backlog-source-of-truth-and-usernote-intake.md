# ADR 0019: Backlog Source Of Truth And Usernote Intake

## Status

Accepted

## Context

MDV では docs/current-backlog.md が実質的な backlog の正本として使われていたが、docs/usernote.md にも backlog 候補が並び、実運用では usernote の番号が PBI のように読める状態が残っていた。

この曖昧さがあると、次の drift が起きやすい。

- usernote の整理番号を正式 backlog ID と誤認する
- 個別 backlog 詳細文書や設計文書に項目を足しただけで正式登録したつもりになる
- 優先順位、依存、受理結果が current-backlog と別の場所で分岐する
- refinement のたびに「どれが正本か」を再確認する手戻りが発生する

今回必要なのは、新しい backlog 文書を増やすことではなく、既存文書の役割境界を固定し、user 要望 intake から正式 PBI 登録までの運用を明文化することである。

## Decision

- product / workflow backlog の正式な正本は docs/current-backlog.md とする
- 正式な PBI 登録、backlog ID 付与、優先順位、依存関係、受理結果は docs/current-backlog.md でのみ管理する
- docs/usernote.md は user 要望、違和感、未整理アイデアの intake / triage メモとして扱い、正式 PBI 正本にはしない
- docs/usernote.md の番号は usernote 内の整理番号であり、正式 backlog ID として扱わない
- docs/markdown-editor-fit-gap-backlog.md を含む個別 backlog 詳細文書は、current-backlog で受理済みの backlog ID に対する詳細定義と受け入れ条件を持つ subordinate 文書として扱う
- usernote や設計文書に要望を書いただけでは backlog 登録完了とみなさず、current-backlog へ受理結果を反映してはじめて正式 backlog とする
- usernote から取り込んだ項目は current-backlog の Usernote Intake 節で対応関係を記録する
- repo-wide の routing guidance として AGENTS.md にも同じルールを記載する

## Consequences

- 今後の refinement は docs/current-backlog.md を基準に実施し、usernote は intake と discussion 履歴の保持に専念する
- user 要望の取り込み履歴は残るが、正式 PBI と受け入れ順は current-backlog 側で一意に追える
- 個別 backlog 詳細文書は優先順位の正本ではなくなるため、詳細は増やせても優先度の最終判断は current-backlog へ戻す必要がある
- 新しい usernote 項目を実装候補に上げるときは、まず current-backlog に正式 ID と依存関係を追加する運用になる
