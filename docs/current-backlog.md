# Current Backlog

## Purpose

この文書は、現在の MDV で実際に追うべきバックログを 1 か所に集約するための正本である。

詳細設計や詳細タスク分解は個別文書に残すが、優先順位、着手順、保留理由はこの文書を基準に判断する。

## Planning Rules

- UI と編集体験の優先順位は [docs/adr/0009-ui-information-architecture-reset.md](docs/adr/0009-ui-information-architecture-reset.md) を正とする
- workspace-first へ寄せるが、viewer / editor の本来性を壊す常時多面表示は避ける
- AI 機能の拡張より先に、Markdown エディタとしての日常価値を底上げする
- separate chat window 前提の古い分解は履歴扱いとし、現行の assistant dock 前提へ読み替える

## Completed Baseline

現時点で、次の基盤は導入済みである。

- assistant dock を editor window に統合
- OpenAI live chat と tool orchestration を main process 経由で実装
- explicit context attachment、tool result bubble、fetch ACL、settings/fetch permissions 補助 window を実装
- preview 優先の panel semantics、outline 表示条件、assistant dock の重なり問題を修正
- Playwright による主要 UI レイアウト回帰テストを導入
- local exact find/replace、replace all、match case / regexp / 選択範囲オプション、検索結果ジャンプ回帰を実装

このため、以後のバックログは「assistant を成立させるための初期土台」ではなく、「製品として何を次に良くするか」で切る。

## Active Backlog

### P0 Editor Core

1. MD-BL-003 Autosave / Crash Recovery
2. MD-BL-002 見出しアウトライン追従強化

理由:

- Markdown エディタとしての日常使用に直結する
- AI 依存なしに価値が伝わる
- 現在の viewer-first UI と矛盾しない

詳細は [docs/markdown-editor-fit-gap-backlog.md](docs/markdown-editor-fit-gap-backlog.md) を参照する。

### P1 Editor Comfort

1. MD-BL-004 Markdown 挿入コマンド群
2. MD-BL-005 画像貼り付け / 画像ドロップの相対配置
3. MD-BL-006 表編集補助
4. MD-BL-007 リスト継続と task list 操作補助

これらは P0 完了後にまとめて扱う。いずれも「Markdown を書く速度」と「資産投入の手間」を直接下げる項目である。

注記:

- MD-BL-005 には単なる挿入 UI だけでなく、draft workspace、asset manager、assetId continuity を含む local asset foundation を含める

### P2 Editor Expansion

1. MD-BL-008 Preview 同期強化
2. MD-BL-009 スペルチェック
3. MD-BL-010 最近使った文書 / クイックオープン
4. MD-BL-011 PDF 出力

これらは価値は高いが、現時点では P0/P1 より緊急度が下がる。

## Active AI Backlog

### AI-P1 Response UX

1. AI-RT-001 応答ストリーミング基盤の整理
2. AI-RT-002 チャットバブル単位のリアルタイム連携
3. AI-RT-003 OpenAI 差分 chunk の段階反映
4. AI-RT-004 負荷制御つきリアルタイム Markdown レンダリング

理由:

- 現在の「しばらく待ってから一気に返る」体験は、assistant の能力不足より先に知覚される product gap である
- tool surface を増やしても、応答体験が blocking に見える限り使用感が伸びにくい
- bubble 単位、text chunk 単位、Markdown render 単位で更新境界を分けておくと、リアルタイム性と renderer 負荷の trade-off を調整しやすい

実装メモ:

- 上の 4 項目は望ましい分解であり、厳密な waterfall ではない
- transport を SSE、WS、あるいは現行 main process 経路の streaming 再編で解くかは実装時に決めてよい
- UI と renderer 負荷の見合いが取れるなら、AI-RT-001 から AI-RT-004 をまとめて一気に進めてもよい

### AI-P2 Current Product Gaps

1. dock 前提の現行 AI バックログへ再分解する
2. workspace grep を assistant tool surface に追加する
3. slice 加工系 `nl` / `cut` / `sort` を追加する
4. suggest mode と audit trail を追加する

この束は「assistant をもっと賢くする」前に、「現行 dock assistant の操作面を完成させる」ための backlog である。ただし、まずは AI-P1 で応答の見え方自体を改善してから着手する。

asset tool 群は [docs/local-asset-storage-design.md](docs/local-asset-storage-design.md) の workspace / asset foundation を前提にするため、MD-BL-005 とその後続 implementation phase に従属させ、AI-P2 の一部として foundation 完了後に扱う。

### AI-P3 Context Management

1. IM-P1-001 Rolling Short Context Buffer
2. IM-P1-002 Base Summary Generator
3. IM-P1-003 Protected Context Area
4. IM-P1-004 Context Budget Manager
5. IM-P1-005 Protected Context Tools

詳細は [docs/ai-impression-memory-phase1-backlog.md](docs/ai-impression-memory-phase1-backlog.md) を参照する。

ただしこれは、editor core の P0、AI-P1、AI-P2 の後に着手する。理由は、長期文脈改善は重要だが、現時点では editor 本体の不足、assistant 応答体験の重さ、tool surface の未完了が先に効くためである。

### AI-P4 Subagent Orchestration

1. AI-SA-001 Subagent session model と main chat 対称 contract を定義する
2. AI-SA-002 サブエージェント依頼、分岐、専用 state branch を定義する
3. AI-SA-003 join、wait-all、呼び出し元への context 差し戻し規則を定義する
4. AI-SA-004 specialist / evaluator の role model と objective review flow を定義する
5. AI-SA-005 subagent lifecycle、cancel、timeout、garbage collection を定義する

詳細は [docs/ai-subagent-orchestration-design.md](docs/ai-subagent-orchestration-design.md) を参照する。

目的:

- タスク実行の並列化
- 独立したコンテキストによる専門的作業
- 独立したコンテキストによる客観的評価
- agent 実装の実験

この束は AI-P3 の後に置く。理由は、subagent orchestration は単なる chat UI 拡張ではなく、branch context、summary handoff、budget 制御、session lifecycle をまたぐため、rolling context / summary / protected area の基盤が先に必要だからである。

## Historical Documents

- [docs/ai-chat-task-breakdown.md](docs/ai-chat-task-breakdown.md) は separate chat window 前提を含む初期分解であり、履歴資料として保持する
- [docs/markdown-editor-fit-gap-backlog.md](docs/markdown-editor-fit-gap-backlog.md) は editor backlog の詳細定義として使う
- [docs/ai-impression-memory-phase1-backlog.md](docs/ai-impression-memory-phase1-backlog.md) は context management Phase 1 の詳細定義として使う

## Recommended Execution Order

1. MD-BL-003 Autosave / Crash Recovery
2. MD-BL-002 見出しアウトライン追従強化
3. AI-P1 Response UX
4. MD-BL-004 以降の editor comfort 項目
5. AI-P2 の再分解と tool surface 残件の整理
6. AI-P3 context management
7. AI-P4 subagent orchestration

注記:

- AI-P1 は新機能拡張というより、現行 assistant の待ち時間知覚を改善する response UX 修正として editor comfort より前に扱う
- それ以外の AI 拡張は、引き続き editor core / editor comfort の後に置く

## Release Framing

次の release line では、次を中核メッセージとして扱う。

- viewer-first workspace の安定化
- assistant dock と editor workspace の共存改善
- assistant 応答のリアルタイム性改善
- Playwright による主要 UI 回帰の固定化
- 今後の実装順を editor core 優先へ再整理