# AI Chat Task Breakdown

## Purpose

注記:

- この文書には separate chat window 前提で切った初期タスク分解が含まれる
- 現在の primary surface は editor window 内の assistant dock であり、window 分離前提の項目は履歴的検討として読むこと

[docs/ai-chat-design.md](docs/ai-chat-design.md) を実装へ落とすための作業分解。

方針は、まず settings 基盤を main process 正本で固め、その上で最大の技術リスクである editor selection 操作を切り分け、chat window、OpenAI 接続、tool bridge を段階導入すること。

現時点の contract 方針は、active:document のような固定ソース名だけに依存せず、EditorID + SPAN を canonical tool surface にし、small inline / large hint + read の二段 transport を採る。

## Track 0: Feasibility Checks

### T0-1 Toast UI selection read feasibility

- Toast UI Editor から selection text を取得できるか確認する
- selection range を取得できるか確認する
- 行列ベースでの span 化が可能か確認する

完了条件:

- active:selection の read 可否が明確になる
- 必要なら初期 span を selection と document のみに制限する判断ができる

### T0-2 Toast UI selection write feasibility

- 現在 selection の replace 可否を確認する
- 部分書き換えの API 制約を把握する

完了条件:

- write active:selection の実装可否が分かる
- 難しい場合の代替案を確定する

### T0-3 Chat renderer entry feasibility

- 既存 Vite 構成で editor 用とは別の renderer entry を切れるか確認する
- Electron から chat window 用 URL をどう解決するか確認する

完了条件:

- chat window を独立 entry で実装する方針を確定する

## Track 1: Main Process Foundation

### T1-1 Menu and shortcut wiring

- main process menu に AI Chat を追加する
- CmdOrCtrl+I を追加する
- editor renderer の shortcut 判定にも Ctrl+I を追加する

完了条件:

- Ctrl+I とメニュー両方から AI Chat action が発火する

### T1-2 Chat window lifecycle

- assistant dock を開閉する
- active editor window の作業面として assistant surface を統合する
- 対象 editor ごとに 1 assistant session を再利用できるようにする

完了条件:

- 対象 editor の assistant dock を開閉、再前面化できる

### T1-3 Session registry

- sessionId と windowId の対応表を main process に持つ
- target editor window を session に結びつける
- session scoped temp buffer registry を持つ

完了条件:

- chat session と対象 editor の対応が追跡できる
- temp buffer を session 破棄で一括無効化できる

## Track 2: Chat UI Foundation

### T2-1 Chat renderer scaffold

- assistant dock 用 root component を用意する
- header、message list、composer を配置する
- editor window 内へ埋め込めることを確認する

完了条件:

- 空の assistant UI が dock として表示される

### T2-2 Markdown bubble rendering

- assistant bubble を Markdown で描画する
- code block と数式を既存 preview と同等に扱えるようにする

完了条件:

- Markdown 応答が bubble に崩れず表示される

### T2-3 Status and tool event UI

- 実行中表示を出す
- tool-call と tool-result を別表示する
- error bubble を出せるようにする
- pending attachment badge を表示する
- large context は compact hint として表示する

完了条件:

- チャット進行状態を UI で追える

### T2-4 Context transport policy UI hook

- explicit context button が attachment ref を pending 化する
- send 時に inline / hint 判定だけ main process へ渡す
- bubble では EditorID + SPAN の compact badge を表示する

完了条件:

- context が送信前に transcript へ垂れ流されない
- 送信後に compact attachment 表示で追跡できる

## Track 3: OpenAI Integration

### T3-1 OpenAI client wrapper

- main process に OpenAI client wrapper を追加する
- API キー未設定時のエラーを定義する
- settings store から model と base URL を読めるようにする
- 環境変数 fallback を補助経路として残す

完了条件:

- main process 単体で会話 API を呼べる

前提:

- settings window scaffold
- settings preload bridge
- provider configured state の取得経路

### T3-2 Non-tool chat flow

- chat message を OpenAI に送る
- assistant reply を dock 内 transcript に返す

完了条件:

- tool なしの AI 会話が成立する

### T3-3 Cancellation and failure handling

- リクエスト中断を扱う
- API エラーや timeout を error bubble に変換する

完了条件:

- 失敗時に UI が固まらない

## Track 4: Editor Tool Bridge

### T4-1 Preload bridge expansion

- editor 用 AI IPC bridge を追加する
- assistant 用 AI IPC bridge を追加する

完了条件:

- renderer 同士が直接通信せず main process 経由で会話できる

### T4-2 get_context tool

- filePath
- title
- text length
- dirty 状態
- selection 有無
- token estimate
- active editor の stable editorId

完了条件:

- モデルが軽量な文脈確認をできる
- inline/hint 判定に必要な情報が取れる

### T4-3 Span normalization

- selection、document、point、line、line-range、from-start、to-end、range を canonical Markdown span に正規化する
- WYSIWYG mode との差を renderer 側で吸収する

完了条件:

- EditorID + SPAN を renderer へ安全に渡せる

### T4-4 read tool

- bounded read を実装する
- target は EditorID + SPAN とする
- `cursor` を返して再取得できるようにする

完了条件:

- tool read target={editorId, span} が動作する
- 1 回の結果が inline budget を超えない

### T4-5 write tool

- destination は EditorID + SPAN とする
- source は literal と slice-ref の複数指定を受ける
- replace と insert を扱えるようにする

完了条件:

- tool write destination={editorId, span} が動作する
- source oversize 時に追加 read を促す validation が返せる

### T4-6 Temp buffer materialization

- read / grep / transform 結果を temp buffer として保持できるようにする
- temp buffer を後続 tool の editorId に使えるようにする

完了条件:

- session 内で temp buffer を再利用できる

### T4-7 list_buffers tool

- active editor と temp buffer の一覧を返せるようにする
- title、capabilities、createdAt、updatedAt を返す

完了条件:

- model が再利用可能な buffer を列挙できる

### T4-8 Active document compatibility aliases

- scaffold 互換の `active:document`、`active:selection` を canonical target へ変換する

完了条件:

- 既存 UI からの呼び出しが新 contract 上でも壊れない

備考:

- feasibility が不十分なら Phase 2 では保留し、suggest mode か全文 rewrite に退避する

## Track 5: New Editor Output

### T5-1 New editor window creation path

- main process から空の editor window を作成できるようにする

完了条件:

- AI が新しい Untitled editor window を開ける

### T5-2 write destination=":new"

- 新規 window に content を流し込む
- title は `destination.editorId = ":new"` のときだけ初期表示へ反映する

完了条件:

- AI の生成結果を新規 editor に書き出せる

## Track 6: Search Tool

実装状況:

- T6-1 は `exact_search` と `semantic_search` として実装済み
- T6-2 は `stats_slice` のみ実装済みで、`nl` / `cut` / `sort` は未実装
- T6-3 の workspace grep は未実装

### T6-1 Slice grep wrapper

- main process で EditorID + SPAN 内 grep 相当を実行する
- maxResults と buffer 化を扱う
- permission は slice search 用に独立管理する

完了条件:

- slice 内検索結果を bounded に返せる

### T6-2 nl / cut / sort / stats wrapper

- EditorID + SPAN に対する簡易加工を行う
- 行番号付与、列抽出、行ソート、unique、基本統計を扱う

完了条件:

- model が大きい本文を全文再読せずに局所加工できる

### T6-3 Workspace grep wrapper

- main process で grep 相当を実行する
- dist、release、node_modules を既定除外する

完了条件:

- workspace 検索結果を配列で返せる

### T6-4 Search result UX

- 検索結果を tool-result bubble に出す
- 長い結果は maxResults で打ち切る
- 必要なら temp buffer ID を返す

完了条件:

- 検索結果が会話を壊さず読める

### T6-5 Tavily web search wrapper

- main process で Tavily API を呼び出す
- query、maxResults、searchDepth を受け取る
- 結果を answer、title、url、content、score へ正規化する
- 必要に応じて follow-up 読み出し用の temp buffer と target を返す

完了条件:

- web_search tool が外部検索結果を返せる

### T6-6 Tavily result UX

- Web 検索結果を tool-result bubble に出す
- answer、URL、content を読みやすく整形する
- temp buffer が返った場合は follow-up 読み出しの導線を維持する

完了条件:

- Web 検索結果が grep 結果と区別して読める

### T6-7 Fetch defer guardrail

- web_search は検索要約に留め、本文取得は fetch_url に分離する
- HTML 本文取得、allowlist、危険 URL 対策、timeout は fetch_url 側で main process 強制とする
- 既存の `allowed-link-rules.json` は legacy の read-only 参照として維持し、fetch allowlist 管理は dedicated settings 導線で扱う

完了条件:

- web_search が fetch を内包しないことが明確になる

### T6-8 Guarded fetch tool contract

- main process で fetch_url の allowlist、method/header 制約、timeout、redirect 再検証を強制する
- 小さいレスポンスは inline 返却し、大きいレスポンスは temp buffer と target へ退避する
- fetch permissions window から allowlist、allowed methods、allowed headers、timeout 群、auto-dispose、max response bytes を編集できる

完了条件:

- fetch_url tool が安全制約つきで本文取得を返せる

### T6-9 Temp buffer lifecycle UX

- web_search と fetch_url が返す temp buffer を follow-up read/write の入力として再利用できる
- network 由来の temp buffer には autoDisposeAt が付き、自動破棄期限を返せる
- 不要になった temp buffer を dispose_buffer で明示破棄できる
- tool-result bubble 上でも buffer follow-up の前提が読み取れる

完了条件:

- 外部検索と fetch の結果が会話を壊さず段階利用できる

## Track 7: Safety and UX

### T7-1 Suggest mode foundation

- 即時書き換えと提案モードを切り替えられる内部 API を用意する

完了条件:

- 将来の承認 UI に繋がる write model ができる

### T7-2 Tool audit trail

- どの tool を何に対して実行したか UI から追えるようにする

完了条件:

- 変更の説明責任が持てる

### T7-3 Prompt and guardrails tuning

- 不要な全文書き換えを避ける prompt を調整する
- 曖昧な対象には get_context や read を先に使わせる

完了条件:

- 典型操作で過剰変更が減る

## Milestone Proposal

### Milestone S

- settings window scaffold
- auxiliary settings window classification
- settings.json store
- preload settings bridge
- theme source-of-truth migration start
- provider configured state
- legacy allowed-link-rules.json read-only 参照
- fetch permissions window 導線

成果:

- AI 実装の前提となる settings 基盤が成立する

### Milestone A

- T0-1
- T0-2
- T0-3
- T1-1
- T1-2
- T2-1

成果:

- 空の chat window が Ctrl+I で開く

### Milestone B

- T1-3
- T2-2
- T2-3
- T3-1
- T3-2
- T3-3

成果:

- ツールなし AI 会話が成立する

### Milestone C

- T4-1
- T4-2
- T4-3
- T4-4
- T4-5
- T4-6

成果:

- active editor の read/write が成立する

### Milestone D

- T5-1
- T5-2
- T6-1
- T6-2
- T6-3
- T6-4
- T6-5
- T6-6
- T6-7
- T6-8
- T6-9

成果:

- new editor、grep、Tavily web_search、guarded fetch、buffer disposal が成立する

## Recommended First Engineering Slice

最初の実装スライスは次にする。

- settings window scaffold
- auxiliary settings window classification
- settings.json store
- preload settings bridge
- theme の source-of-truth 移行開始
- provider configured state

settings 導入後の次スライスは次にする。

- Toast UI の selection 可否調査
- Ctrl+I とメニュー action 追加
- chat window の空 UI 作成

理由:

- provider 設定の正本を先に固められる
- 複数 window で共有する theme と configured state を先に安定化できる
- その後の selection 調査と chat window 実装を手戻り少なく進められる
