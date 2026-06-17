# Decision Governance

この文書は、MDV で「何を実装してよいか」を判定するための正本、優先順位、変更 workflow を定義する。

## Implementation Gate

実装してよいのは、次の両方を満たす場合だけである。

- Contract gate: current design / contract doc の `active_contract` 内、または明記された `compatibility_only` の保守範囲内である。
- Backlog gate: current-backlog で `backlog_state: accepted_active` として受理済みで、実装前 inventory が残っていない。または、明示的な bugfix / maintenance request が既存 contract の保守として扱える。maintenance request は、documented behavior の復旧や内部 cleanup に限る。new command、new settings、user-facing repair / cleanup flow、新しい file write / mutation、保存モデル変更は maintenance exception に含めない。

明示的な user 指示でも current design / contract doc と衝突する場合は、実装へ進まず `decision_change_required` として扱い、先に Change Workflow で contract と backlog を更新する。user 指示は作業開始の入力として最優先に読むが、既存 contract を自動で上書きしない。

新規 feature request が current-backlog で `accepted_active` として受理されていない場合、agent 判断だけで同じ turn に current-backlog へ登録して実装してはいけない。たとえ current design contract と矛盾しないように見えても、まず scope statement、allowed / blocked scope、必要な design / backlog 更新を提示し、次の user message で明示受理を得てから docs 更新と実装へ進む。例外は、既存 contract 内の明示的な bugfix / maintenance request だけである。

既に `future_requires_acceptance` または `decision_change_required` と分類されている scope は、初回にその状態を確認した turn では実装しない。agent は scope statement、allowed / blocked scope、必要な design / backlog 更新を提示して止める。次の user message でその新規 scope が明示的に受理された場合だけ、docs 更新後に実装へ進む。単なる「実装して」は、既に future と記録された scope の明示受理として扱わない。

明示受理として扱える文言は、提案 scope を受理する意思が読み取れるものに限る。例: `この scope を受理して実装して`、`提案された <slice> を current-backlog に追加して進めて`、`allowed / blocked scope の内容で実装して`。`実装して`、`進めて`、`やって`、`それで`、`はい` のように scope 受理を明示しない返答は、future / decision change scope の受理として扱わず、確認する。

user 受理が質問・懸念・status check なのか明示的な作業指示なのか曖昧な場合は、実装せず確認する。

## Evidence Lookup Order

これは証拠を探す順序であり、実装許可の優先順位ではない。Implementation Gate が常に優先する。

判断材料は次の順に確認する。

1. Active instruction hierarchy: system / developer / user の明示指示。ただし user 指示は既存 design contract を暗黙に変更しない。衝突する実装指示は decision change の依頼として扱う。
2. Repo operating rules: [AGENTS.md](../AGENTS.md) と、そこから参照される workflow / validation rule。
3. Current design / contract docs: 現在守るべき product behavior、architecture boundary、IPC / tool contract、storage model、release contract。
4. ADRs: decision の履歴、理由、supersession 関係。ADR は現在仕様の背景記録であり、恒久的な決定結果は該当 design / contract doc へ反映する。
5. [docs/current-backlog.md](current-backlog.md): 正式 backlog、優先順位、受理状態の正本。backlog は design contract を上書きしない。
6. Subordinate backlog / detail docs: current-backlog で受理済み item の詳細、根拠、履歴。
7. Release memos / test evidence: 完了判断の証拠。現在仕様や優先順位を単独では変更しない。
8. [docs/usernote.md](usernote.md): intake / discussion メモ。正式 PBI、優先順位、実装許可ではない。

同じ主題で文書が衝突する場合、まず current design / contract doc を見る。design doc と ADR が衝突して見える場合は、実装へ進まず、design doc と ADR の整合更新を先に行う。

## Decision States

実装対象は、実装前に `contract_state` と `backlog_state` の二軸で分類する。`contract_state` は design / contract doc が定義する「現在守る境界」で、`backlog_state` は current-backlog が定義する「今実装してよい work item」である。

### Contract States

- `active_contract`: 現在の設計 contract。実装はこの範囲内でなければならない。
- `compatibility_only`: 後方互換のために維持する current contract。設計 doc に明記された read / render / export / fallback / cleanup などの保守・bugfix は、その compatibility scope の中で扱える。新規正本、新規 UX 期待値、新規保存モデルへ広げてはいけない。
- `deprecated`: 新規実装の前提にしてはいけない。復活には design decision が必要。
- `decision_change_required`: 実装すると current design / contract または ADR の決定を変える状態。実装前に user 承認と design / ADR 更新が必要。
- `historical`: 背景情報。現在の実装指示ではない。

### Backlog States

- `accepted_active`: current-backlog で受理され、active priority に置かれた scope。これ単独では実装許可ではない。`inventory_status: inventory_pending` が残っていないことと、contract gate を満たすことが必要。
- `completed`: 完了済み。再実装しない。追加要望は新規 scope として扱う。
- `future_requires_acceptance`: 将来必要なら受理する、という未受理状態。実装禁止。

`future_requires_acceptance`、`deprecated`、`decision_change_required` を、実装可能な空き scope として扱ってはいけない。`compatibility_only` は新規 scope ではなく、既存互換 contract を壊さないための限定保守としてだけ扱う。

## Implementation Intake Workflow

実装に入る前に、次を順に確認する。

1. User request を、明示指示、質問、懸念、status check、brainstorming に分類する。
2. 対象領域の current design / contract doc を特定する。小さな editor backlog では、subordinate backlog detail が allowed scope / blocked scope / acceptance を具体的に定義している場合に限り、その節を design contract として扱える。architecture、cross-process contract、storage model、IPC / tool contract、release workflow、persistent workflow は dedicated design / contract doc を必要とする。どちらも存在しない場合は、current-backlog と ADR だけで実装せず、必要な design contract を先に作る。
3. 対象の `contract_state` と `backlog_state` を別々に分類する。
4. Contract gate と backlog gate の両方を満たすなら実装へ進む。
5. `compatibility_only` は、設計 doc に明記された互換 path の read / render / export / fallback / internal cleanup 保守・bugfix であり、新規 command、new settings、new file-writing behavior、user-facing repair / cleanup flow、新規保存モデル、product expectation を作らない場合だけ contract gate を満たす。大きめの互換改善や user-facing 変更は backlog gate も別途満たす必要がある。
6. `future_requires_acceptance` なら、実装せず「未受理の新規 scope」として user に確認する。その turn では scope statement と必要更新の提示までに留める。次の user message で明示受理された場合だけ、先に design contract と current-backlog を更新してから実装する。
7. `deprecated` または `compatibility_only` を新規 UX / 保存モデル / product expectation へ戻す場合は、実装せず `decision_change_required` として扱う。
8. ADR 変更が必要な場合は、先に current design / contract doc の変更案を作り、ADR はその理由と履歴を記録する。
9. 実装後の review では、局所整合性だけでなく「そもそも実装許可された state だったか」を確認する。

## Change Workflow

現在の decision を変更する場合は、次の順に更新する。

1. Scope statement: 変更したい current contract と、変更後に許可される / 禁止される scope を明示する。
2. Design contract update: 該当 design / contract doc を更新し、decision state を明示する。
3. ADR update: 長く残る判断、supersession、重要な trade-off がある場合は ADR を追加または更新する。ADR だけを変更して implementation contract を変えたことにしない。
4. Backlog update: current-backlog に受理状態、優先順位、依存 design contract、非範囲を反映する。
5. Implementation: design contract と backlog の範囲内でコードを変更する。
6. Validation and review: `npm run codex:validate` の推奨 validation と required review を実行し、review prompt には「前提が既存 decision と衝突しないか」を含める。

## Backlog Requirements

新規または再定義する backlog item は、可能な限り次を持つ。

- `design_contract`: 参照する current design / contract doc。小さな editor backlog では allowed / blocked scope を明記した subordinate backlog detail でもよい。architecture / storage / IPC / tool / release / persistent workflow では dedicated design / contract doc を使う。
- `contract_state`: `active_contract`、`compatibility_only`、`deprecated`、`decision_change_required` など。
- `backlog_state`: `accepted_active`、`completed`、`future_requires_acceptance` など。
- `inventory_status`: `inventory_pending`、`inventory_confirmed` など。`[棚卸待ち]` や `[残件棚卸待ち]` は backlog_state ではなく inventory_status である。
- `allowed_scope`: 実装してよい範囲。
- `blocked_scope`: 実装してはいけない範囲、または design decision が必要な範囲。
- `evidence`: 完了判断に使う release memo、test、コード anchor。

backlog の「必要になった場合は別 slice として受理する」は、`future_requires_acceptance` である。明示的な受理、current-backlog への反映、design contract 更新がない限り、実装してはいけない。
