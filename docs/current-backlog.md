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

### P2 Editor Expansion

1. MD-BL-008 Preview 同期強化
2. MD-BL-009 スペルチェック
3. MD-BL-010 最近使った文書 / クイックオープン
4. MD-BL-011 PDF 出力

これらは価値は高いが、現時点では P0/P1 より緊急度が下がる。

## Active AI Backlog

### AI-P1 Current Product Gaps

1. dock 前提の現行 AI バックログへ再分解する
2. workspace grep を assistant tool surface に追加する
3. slice 加工系 `nl` / `cut` / `sort` を追加する
4. suggest mode と audit trail を追加する

この束は「assistant をもっと賢くする」前に、「現行 dock assistant の操作面を完成させる」ための backlog である。

### AI-P2 Context Management

1. IM-P1-001 Rolling Short Context Buffer
2. IM-P1-002 Base Summary Generator
3. IM-P1-003 Protected Context Area
4. IM-P1-004 Context Budget Manager
5. IM-P1-005 Protected Context Tools

詳細は [docs/ai-impression-memory-phase1-backlog.md](docs/ai-impression-memory-phase1-backlog.md) を参照する。

ただしこれは、editor core の P0 と AI-P1 の後に着手する。理由は、長期文脈改善は重要だが、現時点では editor 本体の不足と assistant tool surface の未完了が先に効くためである。

## Historical Documents

- [docs/ai-chat-task-breakdown.md](docs/ai-chat-task-breakdown.md) は separate chat window 前提を含む初期分解であり、履歴資料として保持する
- [docs/markdown-editor-fit-gap-backlog.md](docs/markdown-editor-fit-gap-backlog.md) は editor backlog の詳細定義として使う
- [docs/ai-impression-memory-phase1-backlog.md](docs/ai-impression-memory-phase1-backlog.md) は context management Phase 1 の詳細定義として使う

## Recommended Execution Order

1. MD-BL-001 Find & Replace
2. MD-BL-003 Autosave / Crash Recovery
3. MD-BL-002 見出しアウトライン追従強化
4. AI-P1 の再分解と tool surface 残件の整理
5. MD-BL-004 以降の editor comfort 項目
6. IM-P1 context management

## Release Framing

次の release line では、次を中核メッセージとして扱う。

- viewer-first workspace の安定化
- assistant dock と editor workspace の共存改善
- Playwright による主要 UI 回帰の固定化
- 今後の実装順を editor core 優先へ再整理