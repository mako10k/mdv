# Markdown Editor Fit & Gap / Backlog

## 目的

MDV を「Markdown 編集用途のモダンなデスクトップエディタ」として見たときに、現状機能がどこまで満たせているかを整理し、Markdown 編集に本当に必要な追加・変更だけをバックログ化する。

この文書は editor 領域の詳細定義と背景整理を持つ補助 backlog 文書であり、正式な backlog 登録と優先順位の正本は [docs/current-backlog.md](current-backlog.md) とする。実装許可、design contract、文書間の優先順位は [docs/decision-governance.md](decision-governance.md) と該当する current design / contract doc を正とする。ここに残る完了済み ID や過去の分解は履歴アンカーであり、backlog 登録や優先順位が食い違った場合は current-backlog を優先する。

この文書では AI 連携や fetch ACL のような周辺機能は主評価軸にしない。比較対象は、Typora、Obsidian、MarkText、VS Code + Markdown 拡張のような現代的 Markdown エディタ群の共通期待値とする。

## 評価スコープ

- 対象: Markdown の作成、編集、保存、レビュー、軽い出力
- 非対象: AI orchestration、ネットワーク権限、配布方式、Windows packaging
- 現状根拠: README、editor window 実装、保存同期・競合保存フロー

## 現状サマリ

MDV は次の点ですでに強い。

- WYSIWYG / Markdown ソース切替
- Preview 表示
- Open / Save / Save As / Drag and Drop
- dirty 表示、外部変更追従、競合保存、保守的 merge save
- 見出しアウトラインと見出しジャンプ
- exact search / semantic search の UI はある
- Mermaid、KaTeX、task list、footnote、container block の描画
- HTML export、印刷、文書コピー

一方で、Markdown エディタとして日常利用の快適さを決める「表 / リスト編集補助」「検索 surface」「preview 同期」「複数文書の往復」はまだ薄い。

## 比較基準

モダンな Markdown エディタに最低限期待される能力を、次の 6 群に整理する。

1. 文書を安全に開いて保存できる
2. 長い Markdown を構造的に移動できる
3. Markdown 記法を素早く入力できる
4. 画像・リンク・表・リストをストレスなく扱える
5. 編集中の見え方と出力結果を確認しやすい
6. 事故時に作業を失いにくい

## Fit & Gap

| 領域 | 評価 | 現状 | Gap |
| --- | --- | --- | --- |
| 基本編集 | Fit | WYSIWYG / Markdown ソース切替、Undo/Redo、単一文書編集は成立 | なし |
| 基本保存安全性 | Fit | Save / Save As、dirty 表示、外部変更追従、競合保存、merge save あり | なし |
| ドラッグ&ドロップ読込 | Fit | ローカルファイルとして接続したまま読込できる | なし |
| プレビュー確認 | Partial Fit | Preview、印刷、HTML export はある | side-by-side 常時比較、スクロール同期、カーソル連動がない |
| 文内検索 | Fit | core の exact search、replace、replace all、regexp、選択範囲置換はある | editor 内 search surface の情報密度、結果一覧の見やすさ、detached search を secondary mode として持つかは polish gap として未整理 |
| 長文ナビゲーション | Partial Fit | 見出しアウトライン、見出しジャンプ、active heading 追従はある | TOC、filter / collapse、さらに長文での補助導線は必要になりうる |
| Markdown 入力補助 | Fit | MDV topbar の主要挿入コマンドは selection / caret anchor を source / WYSIWYG で回帰固定済み。table command family は Table actions menu に集約済み | global command palette、shortcut overlay、全 command surface の再編が必要になった場合は ADR 0009 を前提に別 slice で受理する |
| 画像・添付資産 | Fit | pasted / dropped image は Markdown 本文内の `![](data:image...)` を正本にする inline image 表現で保存後も見え続け、source view では inline data URL を abbreviated widget として扱い、saved / draft の relative image も WYSIWYG / preview / export で解決できる | remaining accepted-scope gap はなし。asset manager、export-to-file、退避 / 変換 UI が必要になった場合は `backlog_state: future_requires_acceptance`、`contract_state: decision_change_required` として別 slice で受理する |
| 表編集 | Fit | Toast UI Editor 標準の表編集はあり、MDV Table actions menu からの Markdown table template 挿入、top-level rendered GFM table block の source 整形、current row 後ろへの空行追加、current column 後ろへの空列追加、current column alignment 変更は完了 | remaining accepted-scope gap はなし。delete row / column、insert-before、bulk table operations、またはその他の構造操作が必要になった場合は別 slice で受理する |
| リスト継続補助 | Fit | Toast UI 標準 editor で unordered / ordered / nested / task list の Enter 継続が自然に動き、MDV topbar から current line / selected lines の task checkbox toggle を実行できる | remaining accepted-scope gap はなし。追加の list outdent / indent 専用 UI、task list bulk operations、list style conversion が必要になった場合は別 slice で受理する |
| スペルチェック / 校正 | Gap | なし | Markdown 本文の誤字検出がない |
| 復旧性 | Fit | autosave、crash recovery、復元提案、stale recovery cleanup があり、既存の競合保存フローとも整合している | multi-document session restore は未対応だが、現時点では主要 gap ではない |
| 起動初期状態 | Fit | fresh untitled document は blank start になり、placeholder-only surface は回帰固定済み | なし |
| マルチ文書作業 | Partial Fit | 複数 window は可能 | タブ、最近使った文書、クイックスイッチがない |
| 出力手段 | Partial Fit | 印刷、HTML export はある | PDF / copy as HTML など軽出力がない |

## 結論

Markdown 編集という観点で、表編集補助の current accepted scope は完了済みである。残る優先 gap は次の workspace UX と周辺機能に移る。

1. 検索 surface polish / preview 同期など workspace UX の整理不足
2. スペルチェック、最近使った文書 / クイックオープン、PDF 出力などの周辺機能不足

画像 / media asset workflow は、[docs/image-storage-design.md](image-storage-design.md) の inline image storage contract を正本にする範囲では完了済みとして扱う。asset manager や export-to-file のような追加 UI が必要になった場合は、MD-BL-005 の未完了として再実装せず `backlog_state: future_requires_acceptance`、`contract_state: decision_change_required` として別 slice で受理する。

見出しアウトラインと jump に加えて active heading 追従も完了したため、以後は「長文構造ナビゲーションそのもの」ではなく、filter / collapse のような副次改善が必要になったときだけ別途扱う。

逆に、AI 連携強化や高度な workspace 機能より先に、上の残件を埋めたほうが「モダンな Markdown エディタ」としての体感価値が上がる。

## バックログ

### P0

#### MD-BL-001 文内 Find & Replace

- 種別: 完了
- 目的: Markdown の日常編集で最低限必要な置換操作を提供する
- 内容:
  - 現在の exact search UI を拡張し、replace / replace all を追加
  - AI slice search 権限に依存しない editor 固有の find/replace 基盤へ寄せる
  - 大文字小文字、regexp、選択範囲内置換の基本オプションを持つ
- 完了条件:
  - 単一置換、全置換、キャンセルが可能
  - Preview/Write のどちらからでも呼べる
  - later-hit jump、in-selection replace all、検索条件変更時の stale result 破棄が回帰テストで固定されている

#### MD-BL-002 見出しアウトライン追従強化

- 種別: 完了
- 目的: 既存の見出しアウトラインを長文編集中にさらに使いやすくする
- 完了内容:
  - 既存 outline pane に現在カーソル位置に応じた active heading 表示を追加
  - active heading を `aria-current="location"` と視覚強調の両方で示す
  - preview 側の該当見出しも同じ行基準でハイライトし、outline / preview の現在位置認知を揃える
  - Electron E2E で editor caret 追従を固定する
- 完了確認:
  - 現在位置が outline 側で追従表示される
  - 1000 行超の文書でも実用速度で動く

#### MD-BL-003 Autosave / Crash Recovery

- 種別: 完了
- 目的: 作業喪失を防ぐ
- 実装済み内容:
  - ローカルドラフト autosave
  - 異常終了後の復元提案
  - 明示保存済みファイルと draft の区別
  - stale recovery cleanup と close/save/discard/cancel 分岐
- 完了確認:
  - クラッシュや強制終了後に最新編集中内容を復元候補として提示できる
  - 既存の競合保存フローと矛盾しない
  - Electron E2E で recovery precedence、stale cleanup、close flow、復元画像 draft を固定済み

### P1

#### MD-BL-004 Markdown command surface 統合と挿入アンカー安定化

- 種別: 変更
- 状態: 完了
- 目的: 記法を覚えていなくても主要 Markdown を素早く書けるようにする
- 内容:
  - Toast UI Editor 標準 toolbar は非表示にし、MDV topbar の挿入コマンドを主要 command surface として固定する
  - 見出し、リンク、画像、コードブロック、引用、水平線、脚注の挿入コマンド
  - toolbar から呼び出し
  - caret / selection 起点の insert anchor を安定化し、footnote definition を含めて意図した位置に挿入する
- 完了条件:
  - 選択範囲 wrap とカーソル位置 insert の両方に対応
  - footnote を含む各 insert command が active caret / selection を起点に安定して動く
  - WYSIWYG / source どちらでも破綻しない
- 完了メモ:
  - WYSIWYG で保持できない footnote 挿入は source mode へ戻して正規 Markdown として残す
  - `tests/e2e/app-layout.spec.ts` の `markdown insert commands` 回帰で固定済み
  - command surface の current accepted grouping / overflow gate は MD-BL-013 で閉じ、broader UI reset は ADR 0009 の長期方針として扱う

#### MD-BL-005 画像 / メディア asset workflow と参照管理

- 種別: 追加
- 状態: 完了
- 目的: Markdown 執筆で最も頻出な画像挿入を簡単にする
- 内容:
  - [docs/image-storage-design.md](image-storage-design.md) に従い、新規 paste / drop 画像は inline image 表現を正本として扱う
  - 既存 relative image / `assets/...` Markdown は後方互換として open / preview / WYSIWYG / export で読めるようにする
  - Markdown に `![](...)` を自動挿入
  - source view では inline data URL を abbreviated widget として扱い、巨大な base64 文字列で編集体験を壊さない
  - draft workspace と imported asset の cleanup は既存 close / recovery / renderer flow の app-managed temporary cleanup として扱う
- 完了条件:
  - paste / drop 画像が first save 後も見え、編集を継続できる
  - 既存 relative image は saved / draft の両経路で preview / WYSIWYG / export と整合する
  - 既存 export 挙動と整合する
  - broken / unresolved image が silent failure せず fallback として判別できる

  v0.1.14 で完了した first release slice:

  - 貼り付け / drop 画像が inline image 表現として first save 後も見え、編集を継続できる
  - HTML export と WYSIWYG 表示が同じ base path 解決前提で動き、saved / draft の差で画像が見えなくならない
  - 破損 / 未解決画像の fallback と、editor 上で未解決画像状態が判別できる状態可視化を揃え、画像を入れたあとに「どこへ消えたか分からない」状態を避ける
  - `assets/` materialization は [docs/image-storage-design.md](image-storage-design.md) で deprecated として扱うため、新規挿入画像の正本モデルや release 合格条件に含めない

  2026-06-17 棚卸結果:

  - current accepted scope は `inventory_status: inventory_confirmed`、`backlog_state: completed` として扱う。`contract_state` は、新規 paste / drop の inline canonical storage が `active_contract`、既存 relative image の open / preview / WYSIWYG / export / fallback と app-managed temporary cleanup が `compatibility_only`、user-facing image management / export-to-file / conversion / repair-cleanup UI / user-managed asset deletion / new file mutation が `decision_change_required` である
  - relative image resolver、export、fallback は実装と回帰で確認済み
  - 根拠 anchor は [docs/release-work-memos/v0.1.14.md](release-work-memos/v0.1.14.md)、`tests/e2e/app-layout.spec.ts` の `editor source view abbreviates inline data image markdown` / `preview renders inline data image markdown as an image` / `WYSIWYG resolves saved relative images to actual image sources` / `WYSIWYG resolves draft-workspace relative images for unsaved documents`、`tests/e2e-electron/autosave-recovery.spec.ts` の `repeated pasted images into an unsaved document remain widgetized on first save` / `saved relative image export inlines image data` / `missing relative image shows a preview fallback when opening an existing file` / `repeated dropped images into a saved document do not leak inline image data` / `opening a file from a clean untitled buffer cleans up the proactive draft workspace` / `closing a clean untitled buffer cleans up the proactive draft workspace`、`tests/node/electron-main-close-controller.spec.mjs` の `confirmEditorWindowClose closes clean editor windows immediately` / `confirmEditorWindowClose removes unreferenced imported assets after saving dirty editor windows` である
  - deprecated asset workspace / materialization は新規画像の正本要件から外し、draft workspace と imported asset の cleanup は既存 close / recovery / renderer flow の app-managed temporary cleanup に限って扱う
  - asset manager、export-to-file、退避 / 変換 UI が必要になった場合は、MD-BL-005 の未完了として扱わず `backlog_state: future_requires_acceptance`、`contract_state: decision_change_required` として別 slice で受理する

注記:

- 新規 paste / drop 画像の正本保存モデルは [docs/image-storage-design.md](image-storage-design.md) を正とする。[docs/adr/0020-inline-image-storage-and-assets-deprecation.md](adr/0020-inline-image-storage-and-assets-deprecation.md) は判断履歴として参照する
- [docs/local-asset-storage-design.md](local-asset-storage-design.md) は relative image 互換、draft workspace identity、resolver cleanup、deprecated asset-workspace 整理の履歴補助資料としてだけ参照する。両者が衝突する場合は [docs/image-storage-design.md](image-storage-design.md) を優先する

#### MD-BL-023 WYSIWYG 画像ウィジェットの実画像優先表示

- 種別: 変更
- 状態: 完了
- 目的: WYSIWYG でも preview に近い感覚で画像を扱えるようにする
- 内容:
  - 解決可能な画像参照は、WYSIWYG 上で badge 風 widget より実画像表示を優先する
  - 破損画像、未解決参照、旧 draft asset 参照、読み込み不能画像では fallback widget または error 表示へ退避する
  - 画像選択、caret 移動、削除、alt 編集など editor 操作が実画像表示で破綻しないようにする
  - preview / source / WYSIWYG の見え方差を減らしつつ、編集 affordance が必要な箇所だけ最小限の chrome を残す
- 完了条件:
  - 正常なローカル画像や相対参照画像は WYSIWYG で実画像として見える
  - 破損 / 未解決画像は silent failure せず、fallback 表示で状態を判別できる
  - WYSIWYG 上の基本編集操作が実画像表示によって壊れない

  v0.1.14 first release slice での扱い:

  - MD-BL-023 は単独 polish ではなく、MD-BL-005 の first release slice とセットで「画像体験 bundle」として出した
  - release readiness は saved file 経路だけでなく、untitled draft workspace 経路と browser 回帰まで含めて判断した
  - 画像管理 UI 全体を先に完成させるのではなく、まず「見える」「保存後も切れない」「壊れたら分かる」を優先した
  - 追加の画像管理 UI は現時点の active backlog には含めない

#### MD-BL-006 表編集補助

- 種別: 変更
- 目的: Markdown 表の作成・保守の負荷を下げる
- 内容:
  - Toast UI Editor 標準の表 UI を補完する
  - first slice 完了済み: 表テンプレート挿入、source 上の整形コマンド
  - row add slice 完了済み: current row 後ろへの空行追加
  - column add slice 完了済み: current column 後ろへの空列追加
  - column alignment selector 完了済み: 既存 table の列に対して default / left / center / right の alignment marker を選んで変更する UI
- first slice 完了条件:
  - 少なくとも表の新規作成と整形が UI から実行できる
- 2026-06-17 first slice:
  - 実装済み: topbar の挿入操作から 3 列 Markdown table template を挿入できる
  - 実装済み: caret / selection が top-level の rendered GFM table block と交差している場合、その table block だけを alignment row に従って source 上で整形できる。blockquote / list / fenced code 内の table-like text は対象外
  - 回帰: `tests/e2e/app-layout.spec.ts` の `table command inserts a Markdown table template and updates the preview`、`format table command aligns the current Markdown table block`、`format table command preserves adjacent non-table pipe blocks`、`format table command accepts GFM tables with short delimiters and pipe-less uneven body cells`
  - first slice 時点の残 scope: 列追加、行追加、column alignment selector は未実装だった。これは first slice の未完了ではなく、MD-BL-006 の残 scope として `accepted_active + inventory_pending` に残した
- 2026-06-17 row add slice:
  - 実装済み: caret / selection が top-level の rendered GFM table block と交差している場合、caret 行、または selection end が属する行の後ろへ空の body row を追加できる。header / separator 上では separator の後ろへ追加する
  - 実装判断: 行追加は既存の table block 検出と source command surface だけで閉じ、既存 table command group へ単一の row action を足す範囲に留めるため、この slice では Toast UI 標準表 UI や MD-BL-013 の broader command IA と競合させない。ただし、列追加と column alignment selector は column semantics / alignment UI / topbar density の影響が大きいため、row add slice 時点では棚卸待ちとした
  - 回帰: `tests/e2e/app-layout.spec.ts` の `add table row command inserts an empty row after the current table row`、`add table row command reports no target outside rendered table blocks`
  - row add slice 時点の残 scope: 列追加、column alignment selector は未実装だった。これは row add slice の未完了ではなく、MD-BL-006 の残 scope として `accepted_active + inventory_pending` に残した
- 2026-06-17 column add slice:
  - 実装済み: caret / selection が top-level の rendered GFM table block と交差している場合、caret または selection end が属する cell の後ろへ default alignment の空列を追加できる
  - 実装判断: 列追加は既存の table block 検出と source command surface だけで閉じ、既存 table command group へ単一の column action を足す範囲に留めるため、この slice では Toast UI 標準表 UI や MD-BL-013 の broader command IA と競合させない。accepted scope の add-after row / add-after column はこの slice で閉じる。delete row / column、insert-before、bulk table operations、またはその他の構造操作はこの slice の完了範囲ではなく、必要なら MD-BL-013 の結果または別 backlog slice で受理する
  - 回帰: `tests/e2e/app-layout.spec.ts` の `add table column command inserts an empty column after the current table column`、`add table column command preserves existing alignment and adjacent non-table pipe blocks`、`add table column command uses the selection end column as the insertion anchor`、`add table column command reports no target outside rendered table blocks`
  - column add slice 時点の残 scope: column alignment selector は未実装だった。これは column add slice の未完了ではなく、MD-BL-006 の残 scope として `accepted_active + inventory_pending` に残した。実装可否は MD-BL-013 command IA / overflow の棚卸で確定するものとした
- 2026-06-17 MD-BL-013 gate / column alignment selector slice:
  - 実装済み: table command family を Table actions menu に集約し、topbar 直置き button を増やさずに table option set を menu item として扱う
  - 実装済み: caret / selection が top-level の rendered GFM table block と交差している場合、current column の alignment marker を default / left / center / right に変更できる
  - 実装判断: MD-BL-013 の current accepted gate は table command overflow と table option-set placement で閉じる。global command palette、shortcut overlay、全 command surface の再編は ADR 0009 の長期方針として残すが、この current backlog slice には含めない
  - 回帰: `tests/e2e/app-layout.spec.ts` の `editor mode groups topbar commands and hides the Toast UI toolbar`、`table column alignment command updates the current column marker`、`table column alignment command reports no target outside rendered table blocks`
  - 残 scope: remaining accepted-scope gap はなし。delete row / column、insert-before、bulk table operations、またはその他の構造操作が必要になった場合は `future_requires_acceptance` として別 slice で受理する

#### MD-BL-007 リスト継続と task list 操作補助

- 種別: 変更
- 状態: 完了
- 目的: 箇条書き主体の Markdown 編集を快適にする
- 内容:
  - 実装済み / 確認済み: Enter 時の番号継続
  - 実装済み / 確認済み: ネスト継続
  - 実装済み: checkbox toggle 操作
- 完了条件:
  - ordered / unordered / task list の継続が自然に動く
- 2026-06-17 棚卸 / 実装結果:
  - Toast UI 標準 editor で unordered / ordered / nested / task list の Enter 継続が自然に動くことを browser 回帰で確認した
  - MDV topbar から current line / selected lines の task checkbox toggle を実行できる。既存 task item は `[ ]` / `[x]` を切り替え、通常の unordered / ordered list item は unchecked task item に変換する
  - 回帰: `tests/e2e/app-layout.spec.ts` の `standard editor continues ordered, unordered, nested, and task list items`、`task checkbox command toggles the current task item and updates the preview`、`task checkbox command converts selected list items and toggles existing tasks`
  - 追加の list outdent / indent 専用 UI、task list bulk operations、list style conversion は current accepted scope に含めない。必要になった場合は別 slice で受理する

#### MD-BL-012 起動時 placeholder ちらつき抑制

- 種別: 変更
- 状態: 完了
- 目的: 起動直後に placeholder 文書や初期 panel state が一瞬見える違和感をなくす
- 内容:
  - initial document と実ファイル open / recovery 解決の間に見える placeholder surface を抑制する
  - bootstrap 完了前は skeleton または前回状態に寄せ、誤った本文が見えないようにする
- 完了条件:
  - 起動時に placeholder 文書がちらつかない
  - 初回 open、recovery restore、clean untitled の各経路で挙動がぶれない
- 完了メモ:
  - fresh untitled document は blank start に寄せ、placeholder-only surface が新規文書で見えないことを browser / Electron E2E で固定済み

### P2

#### MD-BL-013 workspace topbar grouping / overflow 再設計

- 種別: 変更
- 状態: current accepted gate 完了
- 目的: topbar の情報密度を下げ、主要操作の discoverability を上げる
- 内容:
  - open/save、insert、copy/export、AI、settings を command group と overflow に再整理する
  - 狭い横幅での省略規則と shortcut discoverability を定義する
- 完了条件:
  - topbar が command group 単位で読める
  - 狭い幅でも主要操作が壊れず、overflow 先が一貫する
- 2026-06-17 current accepted gate:
  - 既存の file / insert / output / workspace group を維持し、table command family を Table actions menu に集約した
  - column alignment selector のような table option set は topbar 直置き button ではなく menu item として扱う
  - この gate の完了条件は、table command family が command group 内の menu で読め、狭い幅でも table command / option set が到達可能であることに限定する
  - broader UI reset、open/save / insert / copy/export / AI / settings 全体の再編、global command palette、shortcut overlay、全 command surface の再設計は [docs/adr/0009-ui-information-architecture-reset.md](adr/0009-ui-information-architecture-reset.md) の長期方針として残し、必要になった場合に別 slice で受理する

#### MD-BL-015 新規ドキュメント作成導線

- 種別: 完了
- 目的: 既存文書を壊さずに新規メモ作成へすぐ入れるようにする
- 内容:
  - Ctrl/Cmd+N で新規 untitled document を開く
  - 新規作成時は editor mode を既定にする
  - topbar または menu に discoverable な導線を追加する
- 完了内容:
  - Ctrl/Cmd+N shortcut を追加
  - File menu に新規文書導線を追加
  - topbar file actions に新規文書ボタンを追加
  - unsaved-changes 確認、draft workspace cleanup、pending asset cleanup を維持したまま untitled editor document へ reset する
- 完了条件:
  - keyboard shortcut から新規文書を開ける
  - 既存の unsaved-changes 確認と矛盾しない
  - 新規文書では editor panel が primary で開く

#### MD-BL-016 保存同期と外部変更追従の polish

- 種別: 完了
- 目的: 保存まわりと外部編集追従の理解コストを下げる
- 内容:
  - conflict save 時の merge preview を改善する
  - clean 状態で外部変更されたファイルを画面へ明示的に追従反映する
  - status 表示と confirmation copy を整理する
- 完了内容:
  - save conflict dialog に各 action の説明を追加
  - merge save 前に結果 preview を確認し、そこから Save As へ分岐できるようにした
  - clean buffer の on-disk change は editor へ自動反映し、status で明示するようにした
  - dirty buffer の on-disk change は保存時に競合確認が入ることを status で維持した
- 完了条件:
  - clean buffer の外部変更が自然に画面へ反映される
  - merge save 経路で何が起きるかを user が判別できる
  - 既存の保守的 conflict save policy を壊さない

#### MD-BL-014 検索 surface の再設計

- 種別: 変更
- 目的: 現行の editor 内検索を保ちながら、長文時の検索体験を改善する
- 内容:
  - inline search surface の結果密度、ショートカット導線、replace 併設を見直す
  - detached search window を secondary mode として持つかを比較検討する
- 完了条件:
  - 既定は workspace-first のまま、長文でも検索結果の把握と移動がしやすい
  - detached mode を採る場合も primary flow を壊さない

#### MD-BL-008 Preview 同期強化

- 種別: 変更
- 目的: 編集結果の確認コストを下げる
- 内容:
  - preview scroll sync
  - カーソル近傍の preview highlight
  - side-by-side 表示の再導入またはオプション化
- 完了条件:
  - 長文で「今どこを編集しているか」が preview 側でも追える

#### MD-BL-009 スペルチェック

- 種別: 追加
- 目的: Markdown 本文の誤字を早期に検出する
- 内容:
  - prose 領域中心の spellcheck
  - code block / URL の誤検出を抑制
- 完了条件:
  - 英文中心でも過剰ノイズなく使える

#### MD-BL-010 最近使った文書 / クイックオープン

- 種別: 追加
- 目的: 複数 Markdown をまたぐ作業の往復コストを下げる
- 内容:
  - recent files
  - quick open
  - 必要ならタブではなく window 間切替を優先
- 完了条件:
  - キーボード中心で最近触った文書へ戻れる

#### MD-BL-011 PDF 出力

- 種別: 追加
- 目的: Markdown の軽配布をしやすくする
- 内容:
  - print to PDF ではなく明示的 PDF export を提供
  - HTML export / print と整合する体裁を使う
- 完了条件:
  - 1 アクションで PDF を生成できる

## Historical Execution Notes

ここでの順序は editor fit/gap 観点の分析メモであり、正式な着手順と優先順位は [docs/current-backlog.md](current-backlog.md) を正とする。ここで bundle と書く箇所は、PBI を統合せずに同じ release で一緒に出すという意味である。

完了済み:

- MD-BL-004 Markdown command surface 統合と挿入アンカー安定化
- MD-BL-005 画像 / メディア asset workflow と参照管理
- MD-BL-006 表編集補助
- MD-BL-007 リスト継続と task list 操作補助
- MD-BL-012 起動時 placeholder ちらつき抑制
- MD-BL-013 workspace topbar grouping / overflow current accepted gate
- MD-BL-017 同一ファイル再オープン時の editor focus dedupe
- MD-BL-018 H3/H4 heading 表示崩れ修正
- MD-BL-023 WYSIWYG 画像ウィジェットの実画像優先表示

残りの分析順:

1. MD-BL-014 検索 surface の再設計
2. MD-BL-008 Preview 同期強化
3. MD-BL-009 スペルチェック
4. MD-BL-010 最近使った文書 / クイックオープン
5. MD-BL-011 PDF 出力

## Usernote Mapping

この文書は editor backlog の詳細定義であり、優先順位と正式 backlog 登録の正本は [docs/current-backlog.md](current-backlog.md) とする。

2026-06-01 の usernote メモは次のように intake され、正式 backlog への受理結果は [docs/current-backlog.md](current-backlog.md) 側で管理する。

1. 起動時 placeholder のちらつき: MD-BL-012
2. topbar と Toast UI toolbar の責務重複: MD-BL-004, MD-BL-013
3. inline image 管理と relative image 互換: MD-BL-005 の current accepted scope で完了。当時 intake に含まれていた user-facing な退避 / 変換導線は current accepted scope では受理していない。asset manager、export-to-file、conversion UI が必要になった場合は `backlog_state: future_requires_acceptance`、`contract_state: decision_change_required` として別 slice で改めて受理する
4. 検索ボックスの別 window 検討: MD-BL-014
5. topbar の grouping / menu / overflow: MD-BL-013
6. footnote 挿入位置ずれ: MD-BL-004
7. Ctrl/Cmd+N で editor mode の新規文書を開く: MD-BL-015
8. Save / 外部編集追従 / merge preview の polish: MD-BL-016
9. 破損画像 fallback と未解決状態の可視化: MD-BL-005 の current accepted scope で完了。当時 intake に含まれていた user-facing な削除 / 整理導線は current accepted scope では受理していない。追加の整理 UI、user-managed asset deletion、repair / cleanup UI が必要になった場合は `backlog_state: future_requires_acceptance`、`contract_state: decision_change_required` として別 slice で改めて受理する

2026-06-10 の追加 intake のうち editor 関連でこの文書に接続する項目:

1. 変更プレビュー / マージ UI 基盤: MD-BL-020
2. エディタ下部の細かい説明の削除: shipped UI slice としてクローズ
3. ヘルプ導線の追加: shipped UI slice としてクローズ
4. WYSIWYG の画像ウィジェットを実画像優先にする: MD-BL-023

非 editor-fit-gap 項目:

1. 公開 README と開発文書の責務分離は [docs/current-backlog.md](current-backlog.md) の DOC-BL-001 で扱う
2. iteration limit 到達時の継続 / 中断選択は [docs/current-backlog.md](current-backlog.md) の AI-UX-004 で扱う
3. Electron 側肥大化の解消と TypeScript 化は [docs/current-backlog.md](current-backlog.md) の ENG-BL-001 で扱う

## 補足

README にある diff / patch 系機能は編集基盤として有用だが、Markdown エディタとしての第一優先ではない。この文書の並び順は「Markdown を日常的に書く人の体感価値」で見た分析メモであり、正式な優先度確定は [docs/current-backlog.md](current-backlog.md) で行う。
