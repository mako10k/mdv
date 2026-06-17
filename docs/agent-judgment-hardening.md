# Agent Judgment Hardening

この文書は、MDV で agent が判断を急ぎすぎたり、近くの diff だけで話を閉じたりしないための共通ルール集である。まず結論を急がず証拠を集め、次に原因と対策を比較し、最後に専門家目線と素人目線の両方で見直す。その順序を崩さないための基準をまとめる。

最初に読むときの要点:

- 近くの file や symptom だけで話を閉じない。
- 疑問、懸念、status check を実装や commit の明示指示として扱わない。
- 実装候補を探す前に、[decision governance](decision-governance.md) の implementation gate、evidence lookup order、decision state を確認する。
- 先に直接証拠を取り、その後で原因と対策を比べる。
- 重要な説明や判断は、専門家レビューと plain-eye review の両方を通す。

## Role In This Repo

- [AGENTS.md](../AGENTS.md) を常時読む入口とする。
- この文書を、判断順序、RCA の進め方、対策評価、review 観点の詳細正本とする。
- 個別事故や実装 slice の教訓は規範本体へ埋め込まず、retro、ADR、design doc、backlog に例として切り出す。

## Portable Core Rules

### User Utterance Intent Boundary

- user 発話は、少なくとも `明示的な作業指示`、`質問`、`疑問 / 懸念`、`status check`、`brainstorming` を分けて読む。
- `実装して`, `更新して`, `commit して`, `棚卸を進めて` のような明示的な作業指示は実行対象にできる。
- `これは実装済みでは?`, `やり直していない?`, `次は何?`, `どう思う?` のような質問や懸念は、確認・説明・再評価の要求であり、それ自体を実装、scope 変更、commit の許可に変換しない。
- user が懸念を出したら、まず衝突しうる実装や commit を止め、直接証拠を確認し、結果と次の選択肢を返す。既に別の明示指示があり、それが懸念解消後も明らかに有効な場合だけ、その指示の範囲で続ける。
- repo の default commit workflow は、明示的な作業指示で発生した変更を 1 logical commit にまとめるための運用であり、質問や懸念を commit 指示へ格上げするルールではない。

### Decision Authority Boundary

- 実装指示が明示的でも、current design / contract doc を暗黙に変更してよいという意味にはしない。
- ADR は decision record であり、現在の実装 contract は design / contract doc へ落ちている必要がある。ADR と design doc が衝突して見える場合は実装へ進まず整合更新を先に扱う。
- backlog は受理状態と優先順位の正本だが、design contract を上書きしない。
- `future_requires_acceptance`、`deprecated`、`decision_change_required` は実装可能な空き scope ではない。`compatibility_only` は新規 scope ではなく、設計 doc に明記された互換保守に限る。
- 「必要になった場合は別 slice として受理する」は未受理状態であり、実装前に user の明示受理、current-backlog 反映、必要な design / ADR 更新を要求する。

### 1. Broad-First Interpretation

- 要求、影響範囲、原因候補、対策候補、適用範囲は既定で広く取る。
- 明示文脈または直接証拠で否定できる範囲だけを縮める。
- 直近 diff、今開いている file、今触った helper、今見えている symptom だけで話を閉じない。
- 複数の妥当な解釈が残るなら、勝手に 1 つへ潰さず、広い読みのまま安全に進めるか、追加証拠か user 確認で縮める。

MDV での典型例:

- renderer symptom でも、原因が preload contract、main process dispatcher、design doc 上の mixed responsibility にある可能性を先に残す。
- AI tool contract の不具合では、schema、help surface、runtime validator、target normalization の責務分離不足を先に疑う。

### 2. Anti-Overcompression

- `短く答えること` と `正しく範囲を捉えること` を別に扱う。
- 簡潔さのために、前提、例外候補、代替解釈、未解消の曖昧さを落とさない。
- 要約してよいのは、範囲を保ったまま圧縮できる場合だけである。
- `今編集した文だけ見る`, `今回の修正対象 file だけ見る`, `直近差分に含まれた surface だけ追う` を失敗パターンとして警戒する。

### 3. Evidence-First Priority

- 優先順は `直接証拠 -> 原因深掘り -> 真因判断 -> 対策案導出 -> 証拠取得のための暫定措置 -> 根本対策` を既定とする。
- 真因が固まる前の修正は、既定では暫定措置か観測用 probe として扱う。
- memory、過去事例、既存 doc があっても、対象同一性を直接証拠で言えないなら再観測する。
- RCA では、少なくとも 1 つの「もし違っていたらすぐ崩せる仮説」と、それを確かめる簡単な確認手段を明示して進める。

MDV での適用:

- mixed payload や span mismatch を見たときは、受け側 helper を広げる前に、どの受け渡し境界で表現のずれが起きたかを追う。
- packaged build 専用 failure を見たときは、dev mode の説明だけで済ませず、packaged path で実際に何が起きたかの証拠を集める。

### 4. Root-Cause Discipline

- 対策へ先に飛ばず、まず `何が壊れたか` ではなく `なぜその contract や state model で壊れたか` を言語化する。
- 真因は、 symptom の直前値ではなく、判断、抽象境界、責務分離、前提の置き方まで遡って定義する。
- `複数表現を 1 helper に押し込んだ`, `help と action を 1 schema に混ぜた`, `single-node mutation と batch semantics を 1 contract に混ぜた` のような責務混在は真因候補として優先的に点検する。

### 5. Objective Countermeasure Evaluation

- 対策は少なくとも次の軸で比較する。

1. 根本原因への近さ
2. 効き方の強さ
3. 前提条件と依存
4. 検証可能性
5. 副作用と適用コスト
6. 残留リスク

- 注意喚起、文書化、memory 追加だけの対策は、単独では高評価にしない。
- 人の善意、記憶、都度の丁寧さに依存する対策は弱い側に置く。
- 実装しやすさは評価軸の 1 つではあっても、既定の最優先軸にしない。
- 影響度と確実性は別軸で扱う。

### 6. Dual Review

- 重要な RCA、重要判断、対策比較、architecture / workflow policy 変更、user-facing explanation には `専門家レビュー` と `plain-eye review` の両方を入れる。迷ったら「読者が結論と根拠をすぐ追えない説明」は plain-eye review 対象とみなす。
- 典型例は、重要な障害説明、重要な設計判断、重要な対策比較、workflow policy 更新、ユーザー向け最終説明である。
- plain-eye review では次を重点確認する。

1. 結論が先に読めるか
2. 専門用語なしでも筋が追えるか
3. 証拠から結論への飛躍がないか
4. 読み手が自然に抱く違和感や反論を拾えているか
5. `それで結局どういうことか` に答えられているか

- 専門家レビューを通っても、plain-eye review で強い違和感が残るなら確定しない。

### 7. General Rule First, Example Second

- narrow な事故や domain 固有事象から rule を抽出するときは、先に general rule を書く。
- 具体事象は `典型例`, `sample`, `retro`, `ADR context` として分離する。
- 具体例を見て作った rule と、その適用範囲を混同しない。
- 1 件の事故から作った rule でも、その rule が別 domain や別 surface にも効くかを最後に点検する。

## Narrow Rule Detection Checklist

次のどれかに当てはまるなら、rule が狭すぎる可能性が高い。

- rule 本文に特定事故名、特定 file、特定 helper 名だけが規範として埋め込まれている
- `今回の件では` を外すと意味が崩れる
- AI tool 以外、renderer 以外、packaging 以外など、別 surface に当てはめられない
- 実質的に `今回やらかしたことを次はやるな` の言い換えになっている
- 具体例と規範文の境界が曖昧である

## Reflection Pattern For This Repo

### Layer 1: Always-On Rules

- [AGENTS.md](../AGENTS.md) に短い規範と入口リンクだけを置く。
- ここでは broad-first、anti-overcompression、evidence-first、root-cause discipline、dual review の存在だけを常時見せる。

### Layer 2: Detailed Evaluation Rules

- この文書で判断順序と対策評価軸を定義する。
- 既存の project-specific contract rules は [AGENTS.md](../AGENTS.md) に残し、その背景規範はここへ集約する。

### Layer 3: Review Entry Points

- 専門家レビューは Codex では [consistency-review.toml](../.codex/agents/consistency-review.toml)、Copilot 互換では [consistency-review.agent.md](../.github/agents/consistency-review.agent.md) を使う。
- plain-eye review は別 agent に分け、Codex では [plain-eye-review.toml](../.codex/agents/plain-eye-review.toml)、Copilot 互換では [plain-eye-review.agent.md](../.github/agents/plain-eye-review.agent.md) を使う。結論順、飛躍、読みやすさ、素人目線の違和感を点検する。
- packaging review は packaging / release / Windows host build の差分に限り、Codex では [packaging-review.toml](../.codex/agents/packaging-review.toml)、Copilot 互換では [packaging-review.agent.md](../.github/agents/packaging-review.agent.md) を使う。

### Layer 4: Examples And Retro

- 個別事故は retro や ADR に残す。
- 規範本体へ埋め込まず、どの general rule の sample かが分かる形で紐づける。

既存 sample の置き場:

- [docs/find-replace-retro-2026-05.md](./find-replace-retro-2026-05.md)
- [docs/ui-reset-and-html-safety-review.md](./ui-reset-and-html-safety-review.md)
- [docs/adr/0015-mdast-structure-tool-surface.md](./adr/0015-mdast-structure-tool-surface.md)

## Short Self-Review Checklist

- この rule は特定事故名を外しても成立するか
- この rule は別 domain の判断ミスにも効くか
- 具体例が規範文に混ざっていないか
- 疑問、懸念、status check を明示的な実装 / commit 指示に変換していないか
- `短く済ませたい` だけで scope を落としていないか
- 直接証拠より先に対策へ飛んでいないか
- 対策を実装しやすさ順で選んでいないか
- 専門家レビューだけで確定していないか
