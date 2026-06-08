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
- autosave、crash recovery、復元提案、stale recovery cleanup を実装し、Electron E2E で固定

このため、以後のバックログは「assistant を成立させるための初期土台」ではなく、「製品として何を次に良くするか」で切る。

## Active Backlog

### P0 Editor Core

現時点で未着手の P0 はない。MD-BL-022 は 2026-06-04 に修正済みで、新規 draft editor の untitled placeholder を Toast UI の内部 placeholder widget から app 側 overlay へ退避し、WYSIWYG 編集開始時の renderer crash を解消した。

### P1 Editor Comfort

1. MD-BL-004 Markdown command surface 統合と挿入アンカー安定化
2. MD-BL-005 画像 / メディア asset workflow と参照管理
3. MD-BL-012 起動時 placeholder ちらつき抑制
4. MD-BL-017 同一ファイル再オープン時の editor focus dedupe
5. MD-BL-018 H3/H4 heading 表示崩れ修正
6. MD-BL-006 表編集補助
7. MD-BL-007 リスト継続と task list 操作補助

これらは P0 完了後にまとめて扱う。いずれも「Markdown を書く速度」と「資産投入の手間」を直接下げる項目である。

注記:

- MD-BL-004 には MDV topbar と Toast UI toolbar の責務重複整理、footnote を含む挿入コマンドの caret / selection anchor 安定化を含める
- MD-BL-005 には単なる挿入 UI だけでなく、draft workspace、asset manager、assetId continuity、base64 data URL の相対 asset 正規化を含む local asset foundation を含める
- MD-BL-017 は OS / second-instance launch と app 内 open dialog の両方で、同一 file が既に開いている場合は既存 editor window を focus して重複 open を避ける
- MD-BL-018 は editor / preview / assistant bubble の Markdown heading style 競合を含めて直す

### P2 Editor Expansion

1. MD-BL-019 workspace topbar / outline / typography density 整理
2. MD-BL-020 変更プレビューと merge UI 基盤
3. MD-BL-021 Span comment と orphan 管理
4. MD-BL-013 workspace topbar の grouping / overflow / command IA 整理
5. MD-BL-014 検索 surface の再設計
6. MD-BL-008 Preview 同期強化
7. MD-BL-009 スペルチェック
8. MD-BL-010 最近使った文書 / クイックオープン
9. MD-BL-011 PDF 出力

これらは価値は高いが、現時点では P0/P1 より緊急度が下がる。

注記:

- MD-BL-014 は現行の editor 内検索 surface を捨てる話ではなく、workspace-first を既定に保ったまま、必要なら detached search window を secondary mode として評価する
- MD-BL-019 には outline の行間見直し、editor / AI chat 別 font size、AI chat の padding / margin / 説明文削減を含める
- MD-BL-020 は save conflict preview だけでなく、AI 書き込みや将来の hunk apply/discard/edit を支える merge UI foundation として扱う
- MD-BL-021 は XDG 永続化、span 自動追従、orphaned comment 管理、AI tool CRUD surface をまとめて扱う

### Supporting Backlog

1. ENG-BL-001 Electron main の TypeScript 化と interface layer への縮退
2. REL-BL-001 アップデート基盤と version metadata surface の整備

これらは user-facing な editor comfort より後ろに置くが、公開情報整理と保守性改善として継続管理する。

注記:

- REL-BL-001 は [docs/adr/0008-version-source-and-release-numbering.md](docs/adr/0008-version-source-and-release-numbering.md) の「package.json version が正本」という決定を前提にする
- 範囲には one-click を目標とする自動 update 導線、release/candidate binary と app 内 version 表示の追従厳密化、help surface と AI metadata/introspection tool から共有できる version metadata 提供、model registry の release 前整合チェックを含める
- first slice は updater 導入そのものより先に、version metadata の単一取得口と consumer surface の統一を優先する
- ENG-BL-001 の 2026-06-06 時点の進捗:
  - 完了: `electron/main.cjs` を薄い wrapper へ縮退し、実体を `src/electron/main.cts` と `src/electron/main/*.cts` へ移した
  - 完了: runtime / dialogs / i18n / autosave recovery / lifecycle / main IPC / updater / settings / window / close / file / draft workspace / managed client の責務分解
  - 完了: controller 群の node-level unit tests を追加し、window close / launch dispatch / settings persistence / updater / debug channel / dialogs / recovery / runtime / i18n / managed client の基本回帰を固定した
  - 完了: controller 群の `@ts-nocheck` を概ね剥がし、依存注入境界の型を先に固定した
  - 完了: この slice で触った主要 docs / review guidance では、`electron/main.cjs` を wrapper として扱い、main process の実装参照先を `src/electron/main.cts` / controller 群へ統一した
  - 残件: `src/electron/main.cts` に残る tracked-file watcher / file snapshot / AI tool orchestration / semantic cache / fetch / structure mutation などの巨大責務をさらに controller 単位へ分解する
  - 残件: `src/electron/main.cts` の `@ts-nocheck` を外せる粒度まで main process 本体の責務面積を縮め、最終的に型付けする
  - 残件: repo-wide では、wrapper としての `electron/main.cjs` 説明を除く旧参照が周辺 docs / review guidance に残っていないか継続監査する

## Usernote Intake

2026-06-01 時点の usernote メモは、次の backlog へ反映した。

1. 起動時に placeholder 文書がちらつく: MD-BL-012
2. MDV topbar と Toast UI toolbar の責務重複: MD-BL-004, MD-BL-013
3. base64 埋め込みを避ける media link / asset manager: MD-BL-005
4. 検索ボックスの別 window 化検討: MD-BL-014
5. 最上位 toolbox の grouping / menu / overflow: MD-BL-013
6. footnote 挿入が caret とずれる: MD-BL-004
7. Ctrl/Cmd+N で editor mode の新規文書を開く: MD-BL-015
8. Save / 外部編集追従 / merge preview の polish: MD-BL-016
9. 公開 README と開発文書の責務分離: DOC-BL-001
10. iteration limit 到達時の継続 / 中断選択: AI-UX-004
11. 破損画像や末尾添付の削除・整理導線: MD-BL-005
12. Electron 側肥大化の解消と TS ライブラリ化: ENG-BL-001
13. Span comment / orphan comment / XDG 保存 / tool CRUD: MD-BL-021
14. 同一ファイル再オープン時は既存 editor を focus: MD-BL-017
15. アウトライン密度、AI chat / editor font size 分離、説明文削減: MD-BL-019
16. H3/H4 heading がインラインコード風に囲われる表示崩れ: MD-BL-018
17. 変更プレビューと merge UI 基盤: MD-BL-020
18. アップデート基盤とバージョンメタデータ基盤: REL-BL-001

補足:

- 10 は editor backlog ではなく、assistant interaction の product gap として AI-P2 に置く
- 11 は新しい独立 PBI を増やさず、MD-BL-005 の media reference manager / orphan cleanup / 削除導線 refinement として吸収する
- 12 は user-facing 機能ではないため Supporting Backlog の ENG-BL-001 に置く
- 13 は UI だけでなく AI tool surface と XDG 永続化を跨ぐため、単独 backlog として切り出す
- 15 は MDV topbar の grouping とは分け、読みやすさと表示密度の調整として MD-BL-019 へ置く
- 18 は version authority 自体の再議論ではなく、ADR 0008 を前提に release/update/help/AI metadata へ同じ version facts を配る implementation backlog として切り出す

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
- AI-RT-003 は first slice として段階反映を導入済みで、assistant bubble に preparing / tool / streaming phase を表示する
- AI-RT-004 は streaming 中の Markdown render を deferred に切り替え、応答長 / pending delta / transcript 量に応じた flush cadence と、既存 chat Markdown の再 render 抑制を導入済みである
- transport を SSE、WS、あるいは現行 main process 経路の streaming 再編で解くかは実装時に決めてよい
- UI と renderer 負荷の見合いが取れるなら、AI-RT-001 から AI-RT-004 をまとめて一気に進めてもよい

### AI-P2 Current Product Gaps

1. dock 前提の AI-P2 残件整理と優先順位再評価を続ける
2. AI-TL-001 GH Issue の閲覧 / 発行 tool surface を追加する
3. workspace grep を assistant tool surface に追加する
4. slice 加工系 `nl` / `cut` / `sort` を追加する
5. AI-UX-001 AI chat で default target editor を常に明示し、切替を迷わせない
6. AI-UX-002 複数 editor window 起動時の chat context binding と cross-window policy を定義する
7. AI-UX-003 accepted layering policy を各 AI backlog と diagnostics surface へ適用する
8. AI-CFG-001 Prompt File を編集・切替できる customization surface を追加する
9. AI-CFG-002 SKILL を登録・有効化・切替できる runtime surface を追加する
10. AI-CFG-003 model registry ベースの model picker を導入し、価格と主要 metadata を settings / app metadata へ表示する
11. suggest mode と audit trail を追加する
12. AI-UX-004 iteration limit 到達時に継続 / 中断を選べるようにする

この束は「assistant をもっと賢くする」前に、「現行 dock assistant の操作面を完成させる」ための backlog である。ただし、まずは AI-P1 で応答の見え方自体を改善してから着手する。

asset tool 群は [docs/local-asset-storage-design.md](docs/local-asset-storage-design.md) の workspace / asset foundation を前提にするため、MD-BL-005 とその後続 implementation phase に従属させ、AI-P2 の一部として foundation 完了後に扱う。

AI-TL-001、AI-CFG-001、AI-CFG-002、AI-CFG-003 の詳細な受け入れ条件は [docs/ai-tool-customization-backlog.md](docs/ai-tool-customization-backlog.md) を参照する。AI-UX-003 の explainer は [docs/ai-customization-layering-design.md](docs/ai-customization-layering-design.md)、決定記録は [docs/adr/0017-ai-customization-layer-boundaries.md](docs/adr/0017-ai-customization-layer-boundaries.md) を正とする。release 前チェックは [docs/release-workflow.md](docs/release-workflow.md) で扱う。

注記:

- AI-TL-001 は issue 一覧、個票取得、新規 Issue 作成を first slice とし、追加 mutation は後続で評価する
- AI-CFG-001 と AI-CFG-002 は user-facing 機能として別 backlog にするが、accepted した AI-UX-003 layering policy を前提に実装する
- AI-UX-003 の quick mental model は「AGENTS.md など always-on instructions は repo baseline、`*.instructions.md` は path-specific refinement、prompt は task entrypoint、agent は role mode、skill は capability package、hook は deterministic enforcement」である
- AI-CFG-001 は prompt file 編集面として扱い、適用範囲、差分確認、rollback、次回 invocation からの反映 policy を含める
- AI-CFG-002 は SKILL の自動注入条件、ownership boundary、可視化、失敗時診断を含め、単なる prompt 断片管理にしない
- AI-CFG-003 は固定 model 選択を置き換える product backlog とし、model ID、provider、context window、価格、deprecation 状態、default 推奨を registry 正本で管理する
- AI-CFG-003 の release completeness は REL-BL-001 と release workflow 側で管理し、ここでは user-facing picker と metadata surface の整備を主対象にする

### AI-P3 Context Management

1. IM-P1-001 Rolling Short Context Buffer
2. IM-P1-002 Base Summary Generator
3. IM-P1-003 Protected Context Area
4. IM-P1-004 Context Budget Manager
5. IM-P1-005 Protected Context Tools

詳細は [docs/ai-impression-memory-phase1-backlog.md](docs/ai-impression-memory-phase1-backlog.md) を参照する。

ただしこれは、editor core の P0、AI-P1、AI-P2 の後に着手する。理由は、長期文脈改善は重要だが、現時点では editor 本体の不足、assistant 応答体験の重さ、tool surface の未完了が先に効くためである。

### AI-CM Context Lifecycle

1. AI-CM-001 thread 一覧、resume、active context 切替 surface を定義する
2. AI-CM-002 context 継続の永続化と復元 policy を定義し、customization provenance summary を保持する
3. AI-CM-003 古い context の archive / delete / retention / GC policy を定義する

詳細は [docs/ai-context-lifecycle-design.md](docs/ai-context-lifecycle-design.md) を参照する。

AI-CM では durable / resumed thread に selected agent、invoked prompt、loaded skills、hook decision、instruction provenance を説明できる状態を残す。

これらは [docs/ai-impression-memory-phase1-backlog.md](docs/ai-impression-memory-phase1-backlog.md) の Phase 1 範囲外であり、Phase 1 完了後の context lifecycle 拡張として扱う。

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

## Recent Progress

- DOC-BL-001 README と開発文書の責務分離は完了。README を project overview と関連資料リンクへ絞り、セットアップ、build、test、packaging の正本と、release の運用入口を DEVELOPMENT.md へ移した。
- MD-BL-002 見出しアウトライン追従強化は完了。outline pane に active heading 表示を追加し、editor caret に追従して現在位置の見出しを強調できるようにした。
- MD-BL-016 保存同期と外部変更追従の polish は完了。save conflict の action copy と merge preview を整理し、clean buffer の外部更新は editor に自動反映しつつ status で明示するようにした。
- MD-BL-015 新規ドキュメント作成導線は完了。Ctrl/Cmd+N、File menu、topbar から untitled document を editor mode で開けるようにし、既存の unsaved-changes 確認と cleanup を維持した。
- AI-RT-004 streaming Markdown render tuning は完了。assistant delta の flush cadence を応答長と transcript 量に合わせて調整し、過去 chat bubble の Markdown 再レンダリングを抑制した。

## Historical Documents

- [docs/ai-chat-task-breakdown.md](docs/ai-chat-task-breakdown.md) は separate chat window 前提を含む初期分解であり、履歴資料として保持する
- [docs/markdown-editor-fit-gap-backlog.md](docs/markdown-editor-fit-gap-backlog.md) は editor backlog の詳細定義として使う
- [docs/ai-impression-memory-phase1-backlog.md](docs/ai-impression-memory-phase1-backlog.md) は context management Phase 1 の詳細定義として使う

## Recommended Execution Order

1. AI-P1 Response UX
2. MD-BL-004, MD-BL-005, MD-BL-012, MD-BL-017, MD-BL-018
3. MD-BL-006, MD-BL-007
4. MD-BL-019, MD-BL-020, MD-BL-021, MD-BL-013, MD-BL-014, MD-BL-008
5. REL-BL-001 update foundation と version metadata surface
6. AI-P2 の残件整理と tool surface 残件の優先順位見直し
7. AI-P3 context management
8. AI-CM context lifecycle
9. AI-P4 subagent orchestration

注記:

- AI-P1 は新機能拡張というより、現行 assistant の待ち時間知覚を改善する response UX 修正として editor comfort より前に扱う
- REL-BL-001 は package.json version を正本とする既存 release rule を、実際の binary/update/help/AI metadata surface に接続する基盤として AI-P2 より前に置く
- AI-CM は thread / persistence / retention の運用面を扱うため、Phase 1 context 管理の直後に置く
- AI-P4 は AI-CM を含む context lifecycle 基盤の後に置く

## Release Framing

次の release line では、次を中核メッセージとして扱う。

- viewer-first workspace の安定化
- assistant dock と editor workspace の共存改善
- assistant 応答のリアルタイム性改善
- Playwright による主要 UI 回帰の固定化
- 今後の実装順を editor core 優先へ再整理
