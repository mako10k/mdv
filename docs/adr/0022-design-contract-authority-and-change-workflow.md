# 0022 Design Contract Authority And Change Workflow

Status: Accepted

## Context

MDV には backlog、ADR、design docs、release memos、usernote があり、それぞれが違う役割を持つ。これまで current-backlog は backlog 正本、ADR は決定記録として使ってきたが、実装時に「現在の product / architecture contract はどの文書を正とするか」と「ADR と backlog の強さの順序」が明文化されていなかった。

その結果、完了済み、deprecated、compatibility-only、future scope の自由文を、その場で実装候補として再解釈できてしまう余地が残っていた。

具体例として、画像保存では ADR 0020 が新規 `assets/` materialization を deprecated にしていた一方、backlog detail や historical asset design に future / compatibility の記述が残り、未受理の image-management scope を実装可能な残件のように読める余地があった。

## Decision

- 現在守るべき product behavior、architecture boundary、storage model、IPC / tool contract、release contract は、該当する current design / contract doc を正本とする。
- ADR は decision record として、理由、背景、supersession 関係を保持する。ADR の決定結果は、実装が参照する current design / contract doc へ反映する。
- current-backlog は正式 backlog、優先順位、受理状態の正本だが、design contract を上書きしない。
- usernote は intake / discussion メモであり、実装許可や PBI ID の正本ではない。
- `deprecated`、`future_requires_acceptance`、`decision_change_required` を実装可能な空き scope として扱わない。`compatibility_only` は新規 scope ではなく、明記された互換保守に限る。
- 詳細な implementation gate、evidence lookup order、contract / backlog state、change workflow は [docs/decision-governance.md](../decision-governance.md) を正本とする。

## Consequences

- 実装前に governing design / contract doc と backlog state を確認する必要がある。
- ADR だけを編集して実装 contract を変えたことにはできない。長く残る decision change では design / contract doc と ADR を同じ turn で整合させる。
- Backlog の「必要なら別 slice」は未受理の `future_requires_acceptance` と読み、明示受理、current-backlog 反映、必要な design contract 更新まで実装しない。
- Review は局所的な差分整合だけでなく、実装対象が existing decision state に許可されているかを確認する。
