# Current Backlog

## Purpose

この文書は、現在の MDV で実際に追うべきバックログを 1 か所に集約するための正本である。

詳細設計や詳細タスク分解は個別文書に残すが、優先順位、着手順、保留理由はこの文書を基準に判断する。

user 要望メモ、個別 backlog 詳細、設計文書はこの文書を補助するが、PBI の正式登録、ID 付与、優先順位決定はこの文書でのみ行う。これは、usernote の整理番号誤読や、詳細文書ごとの優先順位 drift を防ぐためである。

## Backlog Source Rules

- product / workflow backlog の正式正本はこの文書とする
- implementation permission、design contract、ADR / backlog / usernote の強さは [docs/decision-governance.md](decision-governance.md) を正とする。current-backlog は優先順位と受理状態の正本だが、current design / contract doc を上書きしない
- Active Backlog と Active AI Backlog の numbered item は、明示的に `future_requires_acceptance`、`completed`、または historical と書かれていない限り `backlog_state: accepted_active` として扱う
- この rule 導入前に記録された `完了済み` / `完了` label は、明示的な矛盾がない限り `backlog_state: completed` として扱う。次に該当項目を触る、または再棚卸する時に `contract_state` / `backlog_state` tuple を補う
- `[棚卸待ち]` と `[残件棚卸待ち]` は `inventory_status` であり、backlog_state ではない。Active Backlog / Active AI Backlog 内では `backlog_state: accepted_active` + `inventory_status: inventory_pending` を意味し、棚卸結果を記録するまでは実装へ進まない
- docs/usernote.md は user 要望の intake / triage 用メモであり、PBI 正本ではない
- 個別 backlog 詳細文書は、この文書で受理済みの既存 backlog ID の受け入れ条件、詳細分解、補助設計だけを持つ subordinate 文書として扱う。新規 ID 付与や独自優先順位の確定は行わない
- 個別 backlog 詳細文書に完了済み ID や歴史的分解が残ることはあるが、それらは historical anchor であり、active priority や正式登録の正本にはしない
- usernote や設計文書に書かれただけでは backlog 登録完了とみなさない。正式化には、この文書へ backlog ID、配置、依存、優先順位を反映する
- usernote から取り込んだ項目は、この文書側に受理結果を残し、usernote 側は intake / discussion 履歴として維持する

## Planning Rules

- UI と編集体験の現行優先順位はこの current-backlog を正とし、UI reset の判断履歴は [ADR 0009](adr/0009-ui-information-architecture-reset.md) を参照する
- workspace-first へ寄せるが、viewer / editor の本来性を壊す常時多面表示は避ける
- AI 機能の拡張より先に、Markdown エディタとしての日常価値を底上げする
- separate chat window 前提の古い分解は履歴扱いとし、現行の assistant dock 前提へ読み替える

## Backlog Inventory Rules

`[棚卸待ち]` は、その backlog item または slice が未実装だという意味ではない。これは `inventory_status: inventory_pending` であり、現行実装、テスト、release memo、関連 docs と照合して、完了済み、一部完了・後続あり、未実装、scope 再定義、または `contract_state` / `backlog_state` を current-backlog 上で確定する必要があるという意味で使う。`[残件棚卸待ち]` は、完了済み slice の記録を残したまま、残 scope だけを棚卸対象にするという意味で使う。

棚卸では次の順で確認する。

1. current-backlog の該当 priority group と subordinate backlog detail の受け入れ条件を読む
2. 実装、テスト、release note / release memo、ADR / design doc の根拠を探す
3. 必要なら targeted validation を実行する
4. 結果を [docs/decision-governance.md](decision-governance.md) の `contract_state` / `backlog_state` と照合し、current-backlog に `inventory_status: inventory_confirmed` と `contract_state` / `backlog_state` の tuple を記録する。`完了済み`、`一部完了・後続あり`、`未実装`、`scope 再定義` は summary label として併記できるが、state tuple の代替にはしない
5. 完了済みなら active / recommended order から外し、後続があれば残 scope を独立 slice として残す

棚卸順は priority group を優先する。まず P1 Editor Comfort、次に P2 Editor Expansion、Supporting Backlog、AI-P2、AI-P3、AI-CM、AI-P4 の順で確認する。これは全 backlog の棚卸完了まで実装を止めるという意味ではなく、次に実装対象にする priority group を先に棚卸し、確定した同 group の残 scope から実装へ進むという意味である。`[棚卸待ち]` または `[残件棚卸待ち]` が付いた項目は、実装着手前にこの確認を行う。

## Completed Baseline

現時点で、次の基盤は導入済みである。

- assistant dock を editor window に統合
- OpenAI live chat と tool orchestration を main process 経由で実装
- explicit context attachment、tool result bubble、fetch ACL、settings/fetch permissions 補助 window を実装
- preview 優先の panel semantics、outline 表示条件、assistant dock の重なり問題を修正
- Playwright による主要 UI レイアウト回帰テストを導入
- local exact find/replace、replace all、match case / regexp / 選択範囲オプション、検索結果ジャンプ回帰を実装
- autosave、crash recovery、復元提案、stale recovery cleanup を実装し、Electron E2E で固定
- Markdown insert command surface の first slice を実装し、見出し、リンク、画像、コードブロック、引用、水平線、脚注の selection / caret anchor を source と WYSIWYG の両方で回帰固定
- 画像体験 bundle を実装し、inline image storage、source view の data image abbreviation、saved / draft relative image 解決、HTML export、broken / unresolved image fallback を回帰で固定し、既存 close / recovery / renderer flow の app-managed draft workspace / imported-asset temporary cleanup を維持
- 起動時 placeholder ちらつき、同一ファイル再オープン時の focus dedupe、H3/H4 heading 表示崩れを修正済み

このため、以後のバックログは「assistant を成立させるための初期土台」ではなく、「製品として何を次に良くするか」で切る。

## Active Backlog

この節と Active AI Backlog にある `[棚卸待ち]` は `backlog_state: accepted_active` + `inventory_status: inventory_pending` であり、未実装断定ではない。実装前に現状確認と分類記録が必要な印である。既に完了済み slice が記録されている項目は `[残件棚卸待ち]` とし、既存の完了記録は維持したまま残 scope だけを確認する。

### P0 Editor Core

現時点で未着手の P0 はない。MD-BL-022 は 2026-06-04 に修正済みで、新規 draft editor の untitled placeholder を Toast UI の内部 placeholder widget から app 側 overlay へ退避し、WYSIWYG 編集開始時の renderer crash を解消した。

### P1 Editor Comfort

1. [棚卸待ち] MD-BL-006 表編集補助
2. [棚卸待ち] MD-BL-007 リスト継続と task list 操作補助

P0 が完了済みのため、これらを現在の editor comfort 候補として扱う。いずれも「Markdown を書く速度」と日常編集の手間を直接下げる項目である。

ここでいう inline image 表現は、Markdown 本文内の `![](data:image...)` を保存後も画像の正本として扱う方式である。editor-only widget や隠し app-managed blob を正本にする意味ではない。

MD-BL-004 は first slice 完了済みとして active P1 から外す。見出し、リンク、画像、コードブロック、引用、水平線、脚注の toolbar 挿入を実装し、selection / caret anchor、source / WYSIWYG の挙動、WYSIWYG で保持できない脚注挿入時の source mode fallback を Playwright の `markdown insert commands` 回帰で固定した。topbar / Toast UI toolbar の大きな IA 整理や grouping / overflow は MD-BL-013 に残す。

MD-BL-012、MD-BL-017、MD-BL-018 も完了済みとして active P1 から外す。起動時 placeholder ちらつきは fresh untitled document の blank start と placeholder-only surface の削除で閉じ、同一ファイル再オープン時の focus dedupe は OS second-instance と app 内 open dialog の Electron E2E で固定し、H3/H4 heading 表示崩れは preview / WYSIWYG / AI chat の CSS scope と Playwright 回帰で固定した。

v0.1.14 では、MD-BL-005 と MD-BL-023 を 1 つの「画像体験 bundle」としてまとめた first release slice を出した。これは backlog 上の 2 PBI を 1 件へ統合する意味ではなく、同じ体験面として一緒に出したという意味である。

bundle の狙い:

- preview では見えている画像が、WYSIWYG でも見える
- pasted / dropped image が、inline image 表現として保存後も見え続ける
- 既存の relative image は saved file と untitled draft の両方で後方互換として見える
- 破損画像や未解決参照が silent failure せず状態として判別できる

v0.1.14 で閉じた最小範囲:

- MD-BL-023 の WYSIWYG 実画像優先表示を saved file と draft workspace の両経路で安定化し、browser 回帰を release gate として固定した
- MD-BL-005 の first release slice として、paste / drop / first save / export の画像 continuity を release-ready にした。[docs/image-storage-design.md](image-storage-design.md) に従い、`assets/` materialization は新規挿入画像の正本モデルや release 合格条件に含めない
- broken / unresolved image の fallback と、editor 上で未解決画像状態が判別できる状態可視化を揃え、「画像を扱うと壊れる」印象を残さない

2026-06-17 棚卸結果:

- MD-BL-005 の current accepted scope は `inventory_status: inventory_confirmed`、`backlog_state: completed` として active P1 から外す。`contract_state` は、新規 paste / drop の inline canonical storage が `active_contract`、既存 relative image の open / preview / WYSIWYG / export / fallback と app-managed temporary cleanup が `compatibility_only`、user-facing image management / export-to-file / conversion / repair-cleanup UI / user-managed asset deletion / new file mutation が `decision_change_required` である
- paste / drop の正本 inline storage、source view の data image abbreviation、saved / draft relative image resolver、HTML export、broken / unresolved image fallback は実装と回帰で確認済み
- 根拠 anchor は [docs/release-work-memos/v0.1.14.md](release-work-memos/v0.1.14.md)、`tests/e2e/app-layout.spec.ts` の `editor source view abbreviates inline data image markdown` / `preview renders inline data image markdown as an image` / `WYSIWYG resolves saved relative images to actual image sources` / `WYSIWYG resolves draft-workspace relative images for unsaved documents`、`tests/e2e-electron/autosave-recovery.spec.ts` の `repeated pasted images into an unsaved document remain widgetized on first save` / `saved relative image export inlines image data` / `missing relative image shows a preview fallback when opening an existing file` / `repeated dropped images into a saved document do not leak inline image data` / `opening a file from a clean untitled buffer cleans up the proactive draft workspace` / `closing a clean untitled buffer cleans up the proactive draft workspace`、`tests/node/electron-main-close-controller.spec.mjs` の `confirmEditorWindowClose closes clean editor windows immediately` / `confirmEditorWindowClose removes unreferenced imported assets after saving dirty editor windows` である
- deprecated asset workspace / materialization は、新規画像の正本要件から外した。draft workspace と imported asset の cleanup は既存 close / recovery / renderer flow の app-managed temporary cleanup に限って維持し、user-facing な削除 / 整理 / repair UI、user-managed `assets/` 削除、Markdown rewrite、変換 / extraction flow の前提として残さない
- inline image の export-to-file、asset manager、退避 / 変換 UI が必要になった場合は、MD-BL-005 の未完了として再実装せず、`backlog_state: future_requires_acceptance`、`contract_state: decision_change_required` として [docs/image-storage-design.md](image-storage-design.md) の inline storage contract を前提にした新しい backlog slice で受理する

次に扱う最小範囲:

- 表編集補助とリスト継続補助を、次の editor comfort 候補として棚卸する
- topbar / Toast UI toolbar の大きな IA 整理は、挿入 contract 完了後の MD-BL-013 として扱う

注記:

- MD-BL-005 は [docs/image-storage-design.md](image-storage-design.md) を前提にし、新規 paste / drop 画像は inline image 表現を正本とする。既存 relative image の互換表示、export、fallback は維持するが、`assets/` materialization や assetId continuity を新規挿入画像の正本要件として扱わない
- MD-BL-023 は WYSIWYG 上の画像表現 fidelity を主対象にし、v0.1.14 first release slice で完了済み。追加の画像管理 UI は現時点の active backlog には含めない

### P2 Editor Expansion

1. [棚卸待ち] MD-BL-019 workspace topbar / outline / typography density 整理
2. [棚卸待ち] MD-BL-020 変更プレビューと merge UI 基盤
3. [棚卸待ち] MD-BL-021 Span comment と orphan 管理
4. [棚卸待ち] MD-BL-013 workspace topbar の grouping / overflow / command IA 整理
5. [棚卸待ち] MD-BL-014 検索 surface の再設計
6. [棚卸待ち] MD-BL-008 Preview 同期強化
7. [棚卸待ち] MD-BL-009 スペルチェック
8. [棚卸待ち] MD-BL-010 最近使った文書 / クイックオープン
9. [棚卸待ち] MD-BL-011 PDF 出力

これらは価値は高いが、現時点では P0/P1 より緊急度が下がる。

注記:

- MD-BL-014 は現行の editor 内検索 surface を捨てる話ではなく、workspace-first を既定に保ったまま、必要なら detached search window を secondary mode として評価する
- MD-BL-019 には outline の行間見直し、editor / AI chat 別 font size、AI chat の padding / margin / 説明文削減を含める
- MD-BL-020 は save conflict preview だけでなく、AI 書き込みや将来の hunk apply/discard/edit を支える merge UI foundation として扱う
- MD-BL-021 は XDG 永続化、span 自動追従、orphaned comment 管理、AI tool CRUD surface をまとめて扱う

### Supporting Backlog

1. [残件棚卸待ち] ENG-BL-001 Electron main の TypeScript 化と interface layer への縮退
2. [棚卸待ち] REL-BL-001 アップデート基盤と version metadata surface の整備

これらは user-facing な editor comfort より後ろに置くが、公開情報整理と保守性改善として継続管理する。

注記:

- REL-BL-001 は [docs/adr/0008-version-source-and-release-numbering.md](adr/0008-version-source-and-release-numbering.md) の「package.json version が正本」という決定を前提にする
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

docs/usernote.md は user 要望の整理と取り込み前メモを置く intake 文書であり、ここに書かれた番号は backlog ID ではない。

usernote から backlog へ受理した項目は、この節で backlog ID への対応関係を記録する。PBI の正本はこの文書であり、usernote 側は discussion / intake 履歴として残す。

2026-06-01 時点の usernote スナップショット番号は、次の backlog へ反映した。以下の番号は当時の intake snapshot に対する対応であり、現行 usernote の番号とは一致しない場合がある。

1. 起動時に placeholder 文書がちらつく: MD-BL-012
2. MDV topbar と Toast UI toolbar の責務重複: MD-BL-004, MD-BL-013
3. inline image 管理と relative image 互換: MD-BL-005 の current accepted scope で完了。当時 intake に含まれていた user-facing な退避 / 変換導線は current accepted scope では受理していない。asset manager、export-to-file、conversion UI が必要になった場合は `backlog_state: future_requires_acceptance`、`contract_state: decision_change_required` として別 slice で改めて受理する
4. 検索ボックスの別 window 化検討: MD-BL-014
5. 最上位 toolbox の grouping / menu / overflow: MD-BL-013
6. footnote 挿入が caret とずれる: MD-BL-004
7. Ctrl/Cmd+N で editor mode の新規文書を開く: MD-BL-015
8. Save / 外部編集追従 / merge preview の polish: MD-BL-016
9. 公開 README と開発文書の責務分離: DOC-BL-001
10. iteration limit 到達時の継続 / 中断選択: AI-UX-004
11. 破損画像 fallback と未解決状態の可視化: MD-BL-005 の current accepted scope で完了。当時 intake に含まれていた user-facing な削除 / 整理導線は current accepted scope では受理していない。追加の整理 UI、user-managed asset deletion、repair / cleanup UI が必要になった場合は `backlog_state: future_requires_acceptance`、`contract_state: decision_change_required` として別 slice で改めて受理する
12. Electron 側肥大化の解消と TS ライブラリ化: ENG-BL-001
13. Span comment / orphan comment / XDG 保存 / tool CRUD: MD-BL-021
14. 同一ファイル再オープン時は既存 editor を focus: MD-BL-017
15. アウトライン密度、AI chat / editor font size 分離、説明文削減: MD-BL-019
16. H3/H4 heading がインラインコード風に囲われる表示崩れ: MD-BL-018
17. 変更プレビューと merge UI 基盤: MD-BL-020
18. アップデート基盤とバージョンメタデータ基盤: REL-BL-001

2026-06-10 時点の追加 intake は、次の backlog へ反映した。

19. 変更プレビュー / マージ UI 基盤: MD-BL-020
20. アップデート基盤とバージョンメタデータ基盤: REL-BL-001
21. エディタ下部の細かい説明を削除する: done in shipped UI slice, backlog 追加なし
22. ヘルプ導線を追加する: done in shipped UI slice, backlog 追加なし
23. AI tool 向け snapshot handle ベース Undo/Redo: AI-ED-001, AI-ED-002, AI-ED-003
24. WYSIWYG の画像ウィジェットを実画像優先にする: MD-BL-023

補足:

- 10 は editor backlog ではなく、assistant interaction の product gap として AI-P2 に置く
- 11 は broken / unresolved image fallback と app-managed temporary cleanup の範囲では新しい独立 PBI を増やさず、MD-BL-005 の current accepted scope で閉じる。user-facing な asset manager、export-to-file、conversion UI、repair / cleanup UI、user-managed asset deletion が必要になった場合は `backlog_state: future_requires_acceptance`、`contract_state: decision_change_required` として別 slice で改めて受理する
- 12 は user-facing 機能ではないため Supporting Backlog の ENG-BL-001 に置く
- 13 は UI だけでなく AI tool surface と XDG 永続化を跨ぐため、単独 backlog として切り出す
- 15 は MDV topbar の grouping とは分け、読みやすさと表示密度の調整として MD-BL-019 へ置く
- 18 は version authority 自体の再議論ではなく、ADR 0008 を前提に release/update/help/AI metadata へ同じ version facts を配る implementation backlog として切り出す
- 21 と 22 は個別 PBI を追加せず、実装済み変更として intake をクローズする
- 23 は inspection foundation、apply / resolve、一般化評価へ分割し、一括 undo / redo 実装ではなく依存の強い slice から AI-P2 へ置く
- 24 は MD-BL-005 の画像管理課題とは分け、WYSIWYG で画像が画像として見える editor fidelity の課題として独立 PBI にする

## Active AI Backlog

### AI-P1 Response UX

完了済み。

完了範囲:

- AI-RT-001 応答ストリーミング基盤の整理
- AI-RT-002 チャットバブル単位のリアルタイム連携
- AI-RT-003 OpenAI 差分 chunk の段階反映
- AI-RT-004 負荷制御つきリアルタイム Markdown レンダリング

優先理由:

- 現在の「しばらく待ってから一気に返る」体験は、assistant の能力不足より先に知覚される product gap である
- tool surface を増やしても、応答体験が blocking に見える限り使用感が伸びにくい
- bubble 単位、text chunk 単位、Markdown render 単位で更新境界を分けておくと、リアルタイム性と renderer 負荷の trade-off を調整しやすい

完了メモ:

- 現行実装は OpenAI response stream を main process で受け、`requestId` 付き dispatch ack の後に `ai-chat-stream-event` で `text-delta` / `tool-event` / `completed` / `failed` を assistant surface へ段階配送する
- renderer は active `requestId` だけを受け入れ、assistant placeholder bubble を先行生成し、text delta を同じ bubble へ追記し、tool call / result を途中表示する
- streaming 中の Markdown render は deferred に切り替え、応答長 / pending delta / transcript 量に応じた flush cadence と、既存 chat Markdown の再 render 抑制を導入済みである
- stream contract の正本は [docs/adr/0011-ai-chat-streamed-ipc-contract.md](adr/0011-ai-chat-streamed-ipc-contract.md) と [docs/ai-chat-design.md](ai-chat-design.md) の IPC Design とする。実装確認先は `src/electron/main/main-ipc.cts`、`src/electron/main.cts`、`electron/preload.cjs`、`src/shims.d.ts`、`src/ai-chat/ChatApp.tsx`、`src/ai-chat/ChatMarkdown.tsx`、回帰確認先は `tests/e2e/app-layout.spec.ts` の `AI chat streaming` である
- `cancelChatRequest` は現時点では未実装だが、AI-P1 が閉じる streaming / perceived-wait / rendering responsiveness ではなく、stream contract の上に載る request abort lifecycle の将来拡張として扱う

### AI-P2 Current Product Gaps

1. [棚卸待ち] dock 前提の AI-P2 残件整理と優先順位再評価を続ける
2. [棚卸待ち] AI-TL-001 GH Issue の閲覧 / 発行 tool surface を追加する
3. [棚卸待ち] workspace grep を assistant tool surface に追加する
4. [棚卸待ち] slice 加工系 `nl` / `cut` / `sort` を追加する
5. [棚卸待ち] AI-UX-001 AI chat で default target editor を常に明示し、切替を迷わせない
6. [棚卸待ち] AI-UX-002 複数 editor window 起動時の chat context binding と cross-window policy を定義する
7. [棚卸待ち] AI-UX-003 accepted layering policy を各 AI backlog と diagnostics surface へ適用する
8. [棚卸待ち] AI-CFG-001 Prompt File を編集・切替できる customization surface を追加する
9. [棚卸待ち] AI-CFG-002 SKILL を登録・有効化・切替できる runtime surface を追加する
10. [棚卸待ち] AI-CFG-003 model registry ベースの model picker を導入し、価格と主要 metadata を settings / app metadata へ表示する
11. [棚卸待ち] suggest mode と audit trail を追加する
12. [棚卸待ち] AI-UX-004 iteration limit 到達時に継続 / 中断を選べるようにする
13. [棚卸待ち] AI-ED-001 snapshot restore inspection foundation を追加する
14. [棚卸待ち] AI-ED-002 snapshot restore apply / resolve action を追加する
15. [棚卸待ち] AI-ED-003 snapshot history source / destination 一般化を評価する

この束は「assistant をもっと賢くする」前に、「現行 dock assistant の操作面を完成させる」ための backlog である。AI-P1 Response UX は完了済みなので、次の AI 作業ではこの束の優先順位再評価から着手できる。

asset / image tool 群は、MD-BL-005 の current accepted scope が完了済みになったため AI-P2 の即時範囲から外す。将来、画像管理 / export-to-file / conversion surface を受理する場合は、`backlog_state: future_requires_acceptance`、`contract_state: decision_change_required` として [docs/image-storage-design.md](image-storage-design.md) の inline image storage contract を前提に editor backlog で scope 化し、同 design doc が具体的な accepted surface を `active_contract` へ再分類した後に AI tool surface を派生させる。AI tool を追加するには、さらに [docs/ai-chat-design.md](ai-chat-design.md) で schema、target rules、approval policy、validation を受理してから実装する。[docs/local-asset-storage-design.md](local-asset-storage-design.md) は relative image 互換、draft workspace identity、resolver cleanup、deprecated asset-workspace 整理の履歴補助資料として参照する。

AI-TL-001、AI-CFG-001、AI-CFG-002、AI-CFG-003 の詳細な受け入れ条件は [docs/ai-tool-customization-backlog.md](ai-tool-customization-backlog.md) を参照する。AI-UX-003 の explainer は [docs/ai-customization-layering-design.md](ai-customization-layering-design.md)、決定記録は [docs/adr/0017-ai-customization-layer-boundaries.md](adr/0017-ai-customization-layer-boundaries.md) を正とする。release 前チェックは [docs/release-workflow.md](release-workflow.md) で扱う。

注記:

- AI-TL-001 は issue 一覧、個票取得、新規 Issue 作成を first slice とし、追加 mutation は後続で評価する
- AI-CFG-001 と AI-CFG-002 は user-facing 機能として別 backlog にするが、accepted した AI-UX-003 layering policy を前提に実装する
- AI-UX-003 の quick mental model は「AGENTS.md など always-on instructions は repo baseline、`*.instructions.md` は path-specific refinement、prompt は task entrypoint、agent は role mode、skill は capability package、hook は deterministic enforcement」である
- AI-CFG-001 は prompt file 編集面として扱い、適用範囲、差分確認、rollback、次回 invocation からの反映 policy を含める
- AI-CFG-002 は SKILL の自動注入条件、ownership boundary、可視化、失敗時診断を含め、単なる prompt 断片管理にしない
- AI-CFG-003 は固定 model 選択を置き換える product backlog とし、model ID、provider、context window、価格、deprecation 状態、default 推奨を registry 正本で管理する
- AI-CFG-003 の release completeness は REL-BL-001 と release workflow 側で管理し、ここでは user-facing picker と metadata surface の整備を主対象にする
- AI-ED-001 は AI tool 向け snapshot handle ベース undo / redo 要望を正式 backlog へ受理した first slice であり、current buffer、AI write 前 snapshot、AI write 後 snapshot、disk snapshot を比較する inspection contract を主対象にする
- AI-ED-001 は MD-BL-020 の preview / merge foundation と [docs/adr/0006-local-file-sync-and-conflict-save.md](adr/0006-local-file-sync-and-conflict-save.md) の snapshot-aware save contract に依存する
- AI-ED-002 は AI-ED-001 の inspection 結果を受けて restore / merge / discard / cancel を選べる apply / resolve action を扱う
- AI-ED-003 は deferred item とし、snapshot restore 以外の concrete need が出るまで一般化 surface を前提にしない

### AI-P3 Context Management

1. [棚卸待ち] IM-P1-001 Rolling Short Context Buffer
2. [棚卸待ち] IM-P1-002 Base Summary Generator
3. [棚卸待ち] IM-P1-003 Protected Context Area
4. [棚卸待ち] IM-P1-004 Context Budget Manager
5. [棚卸待ち] IM-P1-005 Protected Context Tools

詳細は [docs/ai-impression-memory-phase1-backlog.md](ai-impression-memory-phase1-backlog.md) を参照する。

ただしこれは、editor core の P0、完了済みの AI-P1、AI-P2 の後に着手する。理由は、長期文脈改善は重要だが、現時点では editor 本体の不足と tool surface の未完了が先に効くためである。

### AI-CM Context Lifecycle

1. [棚卸待ち] AI-CM-001 thread 一覧、resume、active context 切替 surface を定義する
2. [棚卸待ち] AI-CM-002 context 継続の永続化と復元 policy を定義し、customization provenance summary を保持する
3. [棚卸待ち] AI-CM-003 古い context の archive / delete / retention / GC policy を定義する

詳細は [docs/ai-context-lifecycle-design.md](ai-context-lifecycle-design.md) を参照する。

AI-CM では durable / resumed thread に selected agent、invoked prompt、loaded skills、hook decision、instruction provenance を説明できる状態を残す。

これらは [docs/ai-impression-memory-phase1-backlog.md](ai-impression-memory-phase1-backlog.md) の Phase 1 範囲外であり、Phase 1 完了後の context lifecycle 拡張として扱う。

### AI-P4 Subagent Orchestration

1. [棚卸待ち] AI-SA-001 Subagent session model と main chat 対称 contract を定義する
2. [棚卸待ち] AI-SA-002 サブエージェント依頼、分岐、専用 state branch を定義する
3. [棚卸待ち] AI-SA-003 join、wait-all、呼び出し元への context 差し戻し規則を定義する
4. [棚卸待ち] AI-SA-004 specialist / evaluator の role model と objective review flow を定義する
5. [棚卸待ち] AI-SA-005 subagent lifecycle、cancel、timeout、garbage collection を定義する

詳細は [docs/ai-subagent-orchestration-design.md](ai-subagent-orchestration-design.md) を参照する。

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
- MD-BL-004 Markdown command surface の first slice は完了。主要 Markdown insert command の selection / caret anchor を source / WYSIWYG で固定し、脚注挿入時の source mode fallback と Playwright 回帰を追加した。
- MD-BL-012 起動時 placeholder ちらつき抑制は完了。fresh untitled document を blank start に寄せ、placeholder-only surface が新規文書で見えないことを browser / Electron E2E で固定した。
- MD-BL-017 同一ファイル再オープン時の editor focus dedupe は完了。OS second-instance launch と app 内 open dialog の両方で既存 editor window を focus し、重複 window を作らないことを Electron E2E で固定した。
- MD-BL-018 H3/H4 heading 表示崩れ修正は完了。preview / WYSIWYG / AI chat の Markdown heading と inline code style の競合を scoped CSS と Playwright 回帰で固定した。
- MD-BL-005 / MD-BL-023 の画像体験は完了。saved / draft の WYSIWYG 実画像表示、paste / drop / first save / export の continuity、broken / unresolved image fallback を release gate として固定し、2026-06-17 棚卸で MD-BL-005 の current accepted scope を active P1 から外した。
- AI-RT-001 / AI-RT-002 / AI-RT-003 / AI-RT-004 は完了。main process から request-scoped stream event を配送し、renderer は assistant bubble の先行生成、text delta 追記、tool event 途中表示、deferred Markdown render、flush cadence 制御を行う。

## Historical Documents

- [docs/ai-chat-task-breakdown.md](ai-chat-task-breakdown.md) は separate chat window 前提を含む初期分解であり、履歴資料として保持する
- [docs/markdown-editor-fit-gap-backlog.md](markdown-editor-fit-gap-backlog.md) は editor backlog の詳細定義として使う
- [docs/ai-impression-memory-phase1-backlog.md](ai-impression-memory-phase1-backlog.md) は context management Phase 1 の詳細定義として使う

## Recommended Execution Order

1. P1 Editor Comfort の棚卸: MD-BL-006、MD-BL-007
2. P2 Editor Expansion の棚卸: MD-BL-019、MD-BL-020、MD-BL-021、MD-BL-013、MD-BL-014、MD-BL-008、MD-BL-009、MD-BL-010、MD-BL-011
3. Supporting Backlog の棚卸: ENG-BL-001、REL-BL-001
4. AI-P2 の棚卸: tool surface、UX、customization、snapshot restore 系の完了記録と残 scope を確認する
5. AI-P3 context management の棚卸
6. AI-CM context lifecycle の棚卸
7. AI-P4 subagent orchestration の棚卸
8. 各 priority group の棚卸が終わった時点で、その group 内の `未実装` または `一部完了・後続あり` と確定し、かつ [docs/decision-governance.md](decision-governance.md) の contract gate / backlog gate を満たす項目から実装に入る。下位 group の棚卸は、上位 group に実装可能な残 scope がない場合、または user が明示的に切り替えた場合に進める

注記:

- AI-P1 は完了済み。現行 assistant の待ち時間知覚を改善する response UX 修正は、streaming IPC、bubble-level realtime update、delta rendering、Markdown render tuning まで閉じた
- MD-BL-005 / MD-BL-023 は完了済み。recommended order で次に扱う P1 は表編集とリスト継続であり、画像管理 UI は現時点の active P1 に含めない
- REL-BL-001 は package.json version を正本とする既存 release rule を、実際の binary/update/help/AI metadata surface に接続する基盤として AI-P2 より前に置く
- AI-CM は thread / persistence / retention の運用面を扱うため、Phase 1 context 管理の直後に置く
- AI-P4 は AI-CM を含む context lifecycle 基盤の後に置く

## Release Framing

次の release line では、次を中核メッセージ候補として扱う。

- P1 Editor Comfort の次 slice として、表編集補助とリスト継続補助を棚卸結果に沿って扱う
- viewer-first workspace の安定化
- assistant dock と editor workspace の共存改善
- assistant 応答のリアルタイム性改善
- Playwright による主要 UI 回帰の固定化
- 今後の実装順を、priority group ごとの棚卸結果に基づいて再整理
