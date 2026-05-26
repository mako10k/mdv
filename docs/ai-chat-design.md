# AI Chat Integration Design

## Summary

この文書は、MDV に AI チャットウィンドウと editor 操作ツールを追加するための設計を定義する。

狙いは単なる OpenAI 呼び出しではなく、現在編集中の Markdown 文書や選択範囲に対して、安全に read、write、search を行える editor assistant を作ることにある。

注記:

- 現在の実装は chat window / settings 導線 / explicit context 添付 UI と、OpenAI Responses API 経由の live reply までを含む scaffold 段階である
- write / grep / web_search / list_editors のモデル主導 tool orchestration は後続フェーズで追加する

## Target Goals

- Ctrl+I またはメニューから AI チャットウィンドウを開けること
- チャットウィンドウは上部に Markdown 対応チャットバブル、下部に固定入力欄を持つこと
- AI が editor 文脈を read できること
- AI が editor 文脈を書き換えられること
- AI が新規 editor window に文書を書き出せること
- AI がワークスペース grep 相当の検索を行えること
- AI が Tavily を使った Web 検索を行えること
- OpenAI API キーを renderer に露出しないこと

## Current Scaffold Scope

- Ctrl+I またはメニューから AI チャットウィンドウを開けること
- chat window は上部に transcript、下部に固定入力欄を持つこと
- Current Editor / Whole Document / Selection の明示ボタンで editor context を transcript に添付できること
- OpenAI が settings で enabled かつ API key で configured されている環境では、下部入力欄から main process 経由で Responses API を呼び、assistant reply を transcript に描画できること
- chat / editor の両 window と Ctrl+, から settings window を開けること
- AI 応答バブルは Markdown を描画できること

## Non-Goals For Initial Scope

- 任意 shell 実行
- ワークスペース外のファイル操作
- 自動的な大規模リファクタリング
- 長期会話永続化
- 複数 editor tab 管理 UI の全面導入
- 任意 URL の fetch と本文抽出

## Current Constraints

- Electron main process は [electron/main.cjs](electron/main.cjs) で管理されている
- renderer への安全な API 公開は [electron/preload.cjs](electron/preload.cjs) で行っている
- editor UI は [src/App.tsx](src/App.tsx) に集中している
- editor は現在単一文書前提だが、Electron 側は multi-window を扱える
- Toast UI Editor の selection API が editor read/write 設計の制約になる可能性が高い

## High-Level Architecture

### 1. Editor Window

既存の Markdown editor window。

責務:

- 文書テキストの保持
- 選択範囲の取得
- 選択範囲または全文への書き込み
- main process からの AI tool request への応答

### 2. Chat Window

新規の AI 専用 window。

責務:

- チャット履歴の表示
- ユーザ入力の送信
- AI 応答の Markdown レンダリング
- ツール呼び出しログの表示
- 明示的に添付した editor context の表示

### 3. Main Process AI Orchestrator

新規に main process 側へ追加する AI 制御層。

責務:

- OpenAI API 呼び出し
- chat session 管理
- tool schema 定義
- tool call 実行調停
- chat window と editor window の紐付け
- 実行中状態管理
- エラー処理

### 4. Tool Bridge

AI が使う操作面。

最終的な tool surface:

- read
- write
- grep
- web_search
- list_editors
- get_context

現行 scaffold で UI から明示的に使えるのは次の 3 つだけ:

- get_context
- read active:document
- read active:selection

## Why Separate Chat Window

- editor UI と AI UI の責務が異なる
- 検索結果やツールログでチャット UI が肥大化しやすい
- 将来、複数 editor window に対して個別または共有 session を紐付けやすい
- API キーやツール実行状態を main process 側に隔離しやすい

## User Experience

### Entry Points

- Ctrl+I
- メニューの AI Chat
- Ctrl+, または各 window の Settings ボタンから settings window を開ける

### Window Behavior

- 現在 active な editor window に紐づく chat window を開く
- 既存の chat window が対象 editor に対して存在する場合は再利用して前面化する
- chat window header には AI Chat と実行状態を表示し、対象情報は必要時に tool result として transcript へ積む

### Chat Layout

- 上部はスクロール可能なメッセージ一覧
- 下部は固定の複数行入力欄
- 入力欄の直上に explicit context attachment 用のボタンを置く
- 初期 scaffold の explicit context は Current Editor / Whole Document / Selection の 3 ボタンに限定する
- Enter で送信、Shift+Enter で改行
- 実行中は Stop か Cancel を表示

### Message Types

- user
- assistant
- tool
- error

## Core Data Model

### EditorTarget

文字列記法:

- active:selection
- active:document
- uuid:selection
- uuid:col1:row1:col2:row2

内部表現:

```ts
type EditorTarget = {
  editorId: string
  span: SpanTarget
}

type SpanTarget =
  | { kind: 'selection' }
  | { kind: 'document' }
  | {
      kind: 'range'
      startColumn: number
      startLine: number
      endColumn: number
      endLine: number
    }
```

### Important API Adjustment

要件の source=":new" は write の destination として扱う。

理由:

- read に new という概念は存在しない
- source と destination の責務を分離できる
- tool API が自然になる

したがって新規文書生成は次のどちらかで扱う。

- destination=":new"
- destination="new-window"

初期実装では destination=":new" を新規 editor window 作成として解釈する。

### Session Model

```ts
type AiChatSession = {
  sessionId: string
  targetWindowId: number
  targetEditorId: string
  status: 'idle' | 'running' | 'awaiting-tool' | 'error'
  messages: ChatMessage[]
  createdAt: string
  updatedAt: string
}

type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  createdAt: string
  title?: string
  meta?: Record<string, unknown>
}
```

## Tool Design

### read

用途:

- 選択範囲の取得
- 文書全文の取得
- 将来の任意 range 取得

入力:

```json
{
  "source": "active:selection"
}
```

出力:

```json
{
  "editorId": "active",
  "resolvedTarget": { "kind": "selection" },
  "text": "..."
}
```

### write

ステータス:

- editor bridge には実装済み
- 現行 scaffold の chat UI からは露出していない

用途:

- 選択範囲の置換
- 全文置換
- 新規文書作成

入力:

```json
{
  "destination": "active:selection",
  "content": "...",
  "mode": "replace"
}
```

または

```json
{
  "destination": ":new",
  "content": "...",
  "mode": "replace",
  "title": "Translated Draft"
}
```

出力:

```json
{
  "editorId": "...",
  "resolvedTarget": { "kind": "selection" },
  "created": false
}
```

### grep

ステータス:

- 後続フェーズ

用途:

- ワークスペース検索
- 現在ファイル検索

入力:

```json
{
  "query": "TODO|FIXME",
  "scope": "workspace",
  "isRegexp": true,
  "caseSensitive": false,
  "maxResults": 20
}
```

出力:

```json
{
  "matches": [
    {
      "path": "src/App.tsx",
      "line": 120,
      "preview": "const editorRef = ..."
    }
  ]
}
```

### list_editors

ステータス:

- 後続フェーズ

用途:

- active の解決
- 将来の複数 editor 対応

### get_context

ステータス:

- 現行 scaffold で Current Editor ボタンから利用可能

用途:

- 現在の editor 状態を軽量に取得
- ファイル名、path、selection 有無、text length、dirty 状態をモデルに伝える

### web_search

ステータス:

- 後続フェーズ

用途:

- Tavily を使った Web 検索
- 外部情報の概要取得
- 用語、仕様、API の探索

入力:

```json
{
  "query": "toast ui editor selection api",
  "maxResults": 5,
  "searchDepth": "basic"
}
```

出力:

```json
{
  "results": [
    {
      "title": "...",
      "url": "https://...",
      "snippet": "...",
      "score": 0.91
    }
  ]
}
```

設計方針:

- Web 検索は Tavily API に限定する
- 初期スコープでは title、url、snippet、score のみ扱う
- URL fetch や本文抽出は別機能として後回しにする
- HTML サイズ制限、許可リスト、HTML タグ除去、危険 URL 回避などは fetch 機能側で別途設計する

## OpenAI Integration

### Security Model

- API キーは main process のみで保持する
- renderer へ API キーは公開しない
- OpenAI API 呼び出しは main process のみで行う
- tool 実行は allowlist 方式にする
- Tavily API 呼び出しも main process のみで行う

### Environment Variables

- OPENAI_API_KEY fallback
- MDV_OPENAI_MODEL fallback
- MDV_OPENAI_BASE_URL optional fallback
- TAVILY_API_KEY optional fallback

Settings 実装後の優先順位:

1. settings store
2. environment variable fallback

環境変数は、settings UI 未設定時の bootstrap と managed deployment の補助経路として残す。

### System Prompt Policy

- Markdown 編集支援アシスタントとして振る舞う
- 書き換え前に必要な read を行う
- 変更は依頼に対応する最小差分を優先する
- grep は必要最小限に使う
- Web 情報が必要な場合だけ web_search を使う
- web_search は検索結果だけを返し、URL fetch は行わない
- 不明な対象は list_editors または get_context で確認する

## IPC Design

### Editor Window Bridge

main process から editor window へ要求する操作:

- getEditorContext
- readTarget
- writeTarget

### Chat Window Bridge

chat window から main process へ送る操作:

- sendChatMessage
- cancelChatRequest

main process から chat window へ送るイベント:

- chat-event
- chat-status

### Event Flow

1. editor window で Ctrl+I またはメニューから AI Chat を開く
2. main process が対象 editor window を解決する
3. main process が chat window を生成または再利用する
4. chat window がユーザ入力を送信する
5. main process が OpenAI へ問い合わせる
6. tool call が要求されたら main process が tool を実行する
7. editor tool の場合は editor window へ IPC を送る
8. 結果を OpenAI へ返し最終応答を得る
9. chat window に assistant message と tool log を流す

補足:

- settings window はこの editor/chat 対応関係には含めない auxiliary window として扱う
- settings window は AI target resolution や editor menu routing の対象外とする
- settings window は managed client の suspend/resume snapshot 対象からも外す

## Editor Responsibilities

editor renderer は AI 本体を持たず、ツール要求への応答だけを行う。

必要な editor capability:

- 現在テキストの取得
- selection text の取得
- selection range の取得
- selection または全文への書き込み
- destination=":new" 用の新規 window 生成連携

## Main Risks

### 1. Toast UI Editor Selection API

最大の技術リスク。

初期実装でまず確認する項目:

- selection text を正確に取得できるか
- selection range を行列ベースで取得できるか
- selection replace を安全に行えるか

このため初期の write 実装優先順位は次の通りにする。

- document read/write
- selection read
- selection write
- arbitrary range

### 2. Window Identity

chat session と editor window の 1 対 1 紐付けを main process 側で管理する必要がある。

### 3. Search Noise

grep は release、dist、node_modules などを既定除外する必要がある。

### 4. Unsafe Writes

将来の大規模書き換えには suggest mode を導入し、直書きだけに依存しない設計にする。

### 5. Web Fetch Scope Creep

fetch を同時に入れると、レスポンスサイズ制御、本文抽出、allowlist、危険 URL 回避、リダイレクト制御など論点が急増する。

既存の `allowed-link-rules.json` は初期段階では legacy の read-only 参照として維持し、fetch 用 allowlist の統合は後段に分離する。

そのため初期の Web 機能は Tavily による検索結果取得だけに限定する。

## Recommended Phases

### Phase 0

- settings window scaffold
- auxiliary settings window classification
- settings.json store
- preload settings bridge
- theme source-of-truth migration start
- provider configured state

### Phase 1

- Ctrl+I とメニュー追加
- chat window 作成
- chat UI 作成
- Markdown ChatBubble
- OpenAI 接続
- ツールなし会話

### Phase 2

- get_context
- read active:document
- read active:selection
- write active:document
- write active:selection

### Phase 3

- write destination=":new"
- 新規 editor window 作成
- basic tool log UI

### Phase 4

- grep
- Tavily web_search
- list_editors
- suggest mode の土台

## Recommended File Layout

- electron/main.cjs
  AI orchestrator、chat window、menu action、IPC routing
- electron/preload.cjs
  editor/chat 用 bridge 拡張
- src/App.tsx
  editor side tool response、Ctrl+I、menu action 受信
- src/ai-chat/*
  chat window renderer、bubble、composer、session UI
- src/markdown/* optional
  chat bubble と preview の共通 Markdown renderer 抽出先

## Acceptance Criteria For Design

- API キーが renderer に公開されない
- chat window が独立して開ける
- chat bubble が Markdown を描画できる
- tool API が read/write/grep/new editor を自然に表現できる
- tool API が read/write/grep/web_search/new editor を自然に表現できる
- initial implementation が段階的に進められる
