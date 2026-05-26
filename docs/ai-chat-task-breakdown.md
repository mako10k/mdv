# AI Chat Task Breakdown

## Purpose

[docs/ai-chat-design.md](docs/ai-chat-design.md) を実装へ落とすための作業分解。

方針は、まず settings 基盤を main process 正本で固め、その上で最大の技術リスクである editor selection 操作を切り分け、chat window、OpenAI 接続、tool bridge を段階導入すること。

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

- chat window を生成する
- active editor window と紐づける
- 対象 editor ごとに 1 chat window を再利用できるようにする

完了条件:

- 対象 editor の chat window を開閉、再前面化できる

### T1-3 Session registry

- sessionId と windowId の対応表を main process に持つ
- target editor window を session に結びつける

完了条件:

- chat session と対象 editor の対応が追跡できる

## Track 2: Chat UI Foundation

### T2-1 Chat renderer scaffold

- chat window 用 entry file を追加する
- root component を用意する
- header、message list、composer を配置する

完了条件:

- 空の chat UI が起動する

### T2-2 Markdown bubble rendering

- assistant bubble を Markdown で描画する
- code block と数式を既存 preview と同等に扱えるようにする

完了条件:

- Markdown 応答が bubble に崩れず表示される

### T2-3 Status and tool event UI

- 実行中表示を出す
- tool-call と tool-result を別表示する
- error bubble を出せるようにする

完了条件:

- チャット進行状態を UI で追える

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
- assistant reply を chat window に返す

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
- chat 用 AI IPC bridge を追加する

完了条件:

- renderer 同士が直接通信せず main process 経由で会話できる

### T4-2 get_context tool

- filePath
- title
- text length
- dirty 状態
- selection 有無

完了条件:

- モデルが軽量な文脈確認をできる

### T4-3 read active:document

- editor 全文を取得する

完了条件:

- tool read source="active:document" が動作する

### T4-4 read active:selection

- 現在 selection を取得する

完了条件:

- tool read source="active:selection" が動作する

### T4-5 write active:document

- editor 全文を書き換える

完了条件:

- tool write destination="active:document" が動作する

### T4-6 write active:selection

- selection を置換する

完了条件:

- tool write destination="active:selection" が動作する

備考:

- feasibility が不十分なら Phase 2 では保留し、suggest mode か全文 rewrite に退避する

## Track 5: New Editor Output

### T5-1 New editor window creation path

- main process から空の editor window を作成できるようにする

完了条件:

- AI が新しい Untitled editor window を開ける

### T5-2 write destination=":new"

- 新規 window に content を流し込む
- title や status を初期化する

完了条件:

- AI の生成結果を新規 editor に書き出せる

## Track 6: Search Tool

### T6-1 Workspace grep wrapper

- main process で grep 相当を実行する
- dist、release、node_modules を既定除外する

完了条件:

- workspace 検索結果を配列で返せる

### T6-2 Active-file search

- 現在ファイル限定検索を追加する

完了条件:

- grep scope="active-file" を扱える

### T6-3 Search result UX

- 検索結果を tool-result bubble に出す
- 長い結果は maxResults で打ち切る

完了条件:

- 検索結果が会話を壊さず読める

### T6-4 Tavily web search wrapper

- main process で Tavily API を呼び出す
- query、maxResults、searchDepth を受け取る
- 結果を title、url、snippet、score へ正規化する

完了条件:

- web_search tool が外部検索結果を返せる

### T6-5 Tavily result UX

- Web 検索結果を tool-result bubble に出す
- URL と snippet を読みやすく整形する

完了条件:

- Web 検索結果が grep 結果と区別して読める

### T6-6 Fetch defer guardrail

- Web fetch は初期スコープ外であることを docs と実装境界で明示する
- HTML 本文取得や危険 URL 対策は別トラックへ分離する
- 既存の `allowed-link-rules.json` は legacy の read-only 参照として維持し、fetch 用 allowlist 統合は後段へ送る

完了条件:

- web_search が fetch を内包しないことが明確になる

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

成果:

- new editor、grep、Tavily web_search が成立する

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
