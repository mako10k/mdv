# AI Chat Integration Design

## Summary

この文書は、MDV に AI assistant surface と editor 操作ツールを追加するための設計を定義する。

長期継続性と context window 制約を扱う memory subsystem の詳細設計は、current scaffold の次段階拡張として [docs/ai-impression-memory-design.md](docs/ai-impression-memory-design.md) を参照する。editor、memory、chat history を同じ参照面に載せる拡張案は [docs/ai-resource-target-unification-proposal.md](docs/ai-resource-target-unification-proposal.md) に分離する。

subagent orchestration tool の将来設計は [docs/ai-subagent-tools-design.md](docs/ai-subagent-tools-design.md) を参照する。

狙いは単なる OpenAI 呼び出しではなく、現在編集中の Markdown 文書や選択範囲に対して、安全に read、write、search を行える editor assistant を作ることにある。

以後の tool 契約は、直値の大量貼り付けを避けるため、EditorID と SPAN を基本単位にする。小さい文脈だけを直値で model input へ入れ、大きい文脈は参照ヒントを渡して read 系 tool で段階取得させる。

注記:

- 現在の実装は editor window 右 dock の assistant surface / settings 導線 / explicit context 添付 UI、OpenAI Responses API 経由の live reply、list_buffers / read_target / write_target / exact_search / semantic_search / stats_slice / web_search / fetch_url / dispose_buffer のモデル主導 tool orchestration を含む
- 現在の実装は latest turn 優先の budget-aware context reconstruction と、save_context_item / list_context_items / update_context_item / merge_context_items / delete_context_item による session-local protected context も含む
- tool help は専用の `get_tool_help` で取得し、action tool schema には help 分岐を混ぜない
- tool 引数エラーや実行エラーは構造化された tool result として返し、tool loop 自体は継続する
- guarded fetch は ACL、pending 確認、private-address 回避、timeout、temp-buffer spillover を main process で強制する

## Target Goals

- Ctrl+I またはメニューから AI assistant dock を開けること
- assistant surface は上部に Markdown 対応チャットバブル、下部に固定入力欄を持つこと
- AI が editor 文脈を read できること
- AI が editor 文脈を書き換えられること
- AI が新規 editor window に文書を書き出せること
- AI がワークスペース grep 相当の検索を行えること
- AI が Tavily を使った Web 検索を行えること
- AI が ACL 付き fetch を行い、大きい本文を temp buffer へ退避できること
- OpenAI API キーを renderer に露出しないこと

## Current Scaffold Scope

- Ctrl+I またはメニューから AI assistant dock を開けること
- assistant surface は上部に transcript、下部に固定入力欄を持つこと
- Current Editor / Whole Document / Selection の明示ボタンで editor context を transcript に添付できること
- OpenAI が settings で enabled かつ API key で configured されている環境では、下部入力欄から main process 経由で Responses API を呼び、assistant reply を transcript に描画できること
- list_buffers / read_target / write_target / exact_search / semantic_search / stats_slice を main process の tool loop から呼べること
- web_search / fetch_url / dispose_buffer を main process の tool loop から呼べること
- save_context_item / list_context_items / update_context_item / merge_context_items / delete_context_item を main process の tool loop から呼べること
- latest turn を優先し、古い履歴だけを bounded summary へ圧縮して OpenAI input を組み立てること
- editor window から Ctrl+, で settings window を開けること
- fetch ACL / timeout は dedicated auxiliary window から編集できること
- AI 応答バブルは Markdown を描画できること

## Non-Goals For Initial Scope

- 任意 shell 実行
- ワークスペース外のファイル操作
- 自動的な大規模リファクタリング
- 長期会話永続化
- 複数 editor tab 管理 UI の全面導入
- ACL 既定拒否を回避した任意 fetch

注記:

- topic memory や persisted impression memory は current scaffold の外側にある次段階拡張として扱う
- その詳細要件と設計は [docs/ai-impression-memory-design.md](docs/ai-impression-memory-design.md) に分離する

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

### 2. Assistant Surface

editor window に統合された AI 専用 dock。

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
- assistant session 管理
- tool schema 定義
- tool call 実行調停
- assistant session と editor window の紐付け
- 実行中状態管理
- エラー処理

### 4. Tool Bridge

AI が使う操作面。

現行実装と後続設計を合わせた tool surface 全体像:

- get_tool_help
- get_context
- list_buffers
- read_target
- write_target
- exact_search
- stats_slice
- semantic_search
- web_search
- fetch_url
- list_assets
- read_asset_metadata
- copy_asset
- rename_asset
- dispose_buffer
- save_context_item
- list_context_items
- update_context_item
- merge_context_items
- delete_context_item

注記:

- 現行で実装済みの contract は文書冒頭の Summary と Current Scaffold Scope を正とする
- この節より下に出てくる `grep_slice` / `nl` / `cut` / `sort` / `stats` は旧分解を含む後続候補であり、現行 shipped tool 名ではない
- asset は editor text と異なる file semantics を持つため、`read` / `write` に雑に混ぜず、read 系参照と mutation 系 tool を分ける
- local asset の詳細方針は [docs/local-asset-storage-design.md](docs/local-asset-storage-design.md) を参照する

現行 scaffold で UI から明示的に使えるのは次の 3 つだけ:

- get_context
- read active:document
- read active:selection

## Why Default Dock

- editor と assistant の往復コストを減らせる
- outline、editor、preview、assistant を同じ workspace で扱える
- context 添付と編集結果の適用を一続きの導線にできる
- API キーやツール実行状態の main process 隔離は、dock 化しても維持できる

## User Experience

### Entry Points

- Ctrl+I
- メニューの AI Chat
- Ctrl+, から settings window を開ける

### Surface Behavior

- 現在 active な editor window の assistant dock を開く
- Ctrl+I やメニューは dock を前面状態にし、入力欄へ focus を送る
- assistant header には AI Chat と実行状態を表示し、対象情報は必要時に tool result として transcript へ積む
- dock を閉じても会話状態と temp buffer は editor window が閉じるまで保持し、再度開くと同じ session を継続する
- ただし managed suspend/resume や renderer 再生成をまたぐ永続化は現時点では行わず、その場合の assistant session は再初期化される

### Assistant Layout

- 上部はスクロール可能なメッセージ一覧
- 下部は固定の複数行入力欄
- 入力欄の直上に explicit context attachment 用の小型ボタンを置く
- explicit context は送信前 pending attachment として保持し、送信時にだけ model input へ反映する
- attachment は bubble 上では compact badge 表示にとどめ、本文を常時 transcript へ垂れ流さない
- Enter で送信、Shift+Enter で改行
- 実行中は Stop か Cancel を表示

### Message Types

- user
- assistant
- tool
- error

## Core Data Model

### EditorHandle

`editorId` は model が参照する論理対象を表す。

```ts
type EditorId = string

type EditorHandle = {
  editorId: EditorId
  kind: 'editor-window' | 'temp-buffer'
  title: string
  currentFilePath: string | null
  isDirty: boolean
  capabilities: {
    read: boolean
    write: boolean
    sliceOps: boolean
  }
  createdAt: string
  updatedAt: string
}
```

設計方針:

- editor window は main process が session 内で安定 ID を採番する
- tool が生成した一時結果は `buffer:*` 形式の temp buffer として採番する
- temp buffer は session 内だけ有効で、window が閉じるか session が破棄されたら無効化する

### SpanRef

文字列記法:

- active:selection
- active:document
- uuid:selection
- uuid:col1:row1:col2:row2

内部表現:

```ts
type EditorTarget = {
  editorId: string
  span: SpanRef
}

type MarkdownPos = {
  line: number
  column: number
}

type SpanRef =
  | { kind: 'selection' }
  | { kind: 'document' }
  | { kind: 'point'; at: MarkdownPos }
  | { kind: 'line'; line: number }
  | { kind: 'line-range'; startLine: number; endLine: number }
  | { kind: 'from-start'; end: MarkdownPos }
  | { kind: 'to-end'; start: MarkdownPos }
  | {
      kind: 'range'
      start: MarkdownPos
      end: MarkdownPos
    }

type NormalizedSpan = {
  start: MarkdownPos
  end: MarkdownPos
  isEmpty: boolean
}
```

方針:

- SPAN は user 要件どおり、開始位置、終了位置、選択範囲、ファイル全体、ファイル開始位置、ファイル終了位置、行番号だけを表現できる union にする
- `point` は insert 系 write の destination に使う
- 実行時はすべて `NormalizedSpan` へ正規化してから renderer へ渡す
- canonical 座標は Markdown 座標とし、WYSIWYG mode では renderer 側で current mode に変換する

### AttachmentRef

チャット UI の explicit context は直接 transcript 文字列へ展開せず、まず attachment reference として保持する。

```ts
type AttachmentRef = {
  attachmentId: string
  editorId: string
  span: SpanRef
  origin: 'editor-context' | 'document' | 'selection' | 'tool-result'
  estimatedTokens: number
  inlineEligible: boolean
  previewLabel: string
}
```

### Context Transport Policy

小さい文脈と大きい文脈で model への渡し方を分ける。

```ts
type ContextTransportPolicy = {
  inlineTokenBudget: number
  readTokenBudget: number
  hintPreviewChars: number
}
```

既定方針:

- inline できるのは model context window の約 5% まで
- `read` 1 回で返す上限も inline と同程度にそろえる
- 5% を超える attachment は本文を直貼りせず、`EditorID + SPAN + 概要` の hint だけを送る
- hint を受けた model は必要箇所だけ `read` を繰り返して取得する

model context window は model ごとの既知値を settings または model registry で管理し、未知モデルでは保守的な fallback を使う。

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

- 任意 EditorID + SPAN の本文取得
- 大きい範囲のページング取得
- hint で渡された大きい attachment の実体取得

入力:

```json
{
  "target": {
    "editorId": "editor:active",
    "span": { "kind": "selection" }
  },
  "maxTokens": 4000,
  "cursor": null
}
```

出力:

```json
{
  "editorId": "editor:active",
  "target": {
    "editorId": "editor:active",
    "span": { "kind": "document" }
  },
  "pageTarget": {
    "editorId": "editor:active",
    "span": {
      "kind": "range",
      "start": { "line": 12, "column": 1 },
      "end": { "line": 38, "column": 1 }
    }
  },
  "span": {
    "start": { "line": 12, "column": 1 },
    "end": { "line": 38, "column": 1 },
    "isEmpty": false
  },
  "text": "...",
  "truncated": true,
  "nextCursor": {
    "after": { "line": 38, "column": 1 }
  },
  "estimatedTokens": 3820
}
```

補足:

- `read_target` の follow-up pagination では `target` と `nextCursor` をそのまま再利用する
- 今回返したページそのものを次の input に使いたい場合は `pageTarget` を使う
- `span` は表示・説明用の resolved metadata であり、次の tool input schema ではない
- `selection` は live editor にしか意味を持たない。temp buffer では `document`、`pageTarget`、または明示 `range` を使う

設計方針:

- `read` は常に bounded response にする
- 返却上限は inline と同程度に抑える
- 全量取得が必要でも `cursor` を進めて取り直せるようにする
- `cursor` は `point` と同じ Markdown 座標で表現し、renderer に特殊オフセット型を漏らさない

### write

ステータス:

- editor bridge には実装済み
- 現行 scaffold の chat UI からは露出していない

用途:

- 任意 EditorID + SPAN への書き込み
- temp buffer や既存 editor slice の合成書き込み
- 全文置換、新規文書作成、範囲置換、point insert、span end への append

入力:

```json
{
  "destination": {
    "editorId": "editor:active",
    "span": { "kind": "selection" }
  },
  "sources": [
    { "type": "literal", "text": "# Summary\n" },
    {
      "type": "slice-ref",
      "target": {
        "editorId": "buffer:grep-1",
        "span": { "kind": "document" }
      }
    }
  ],
  "mode": "replace"
}
```

または

```json
{
  "destination": {
    "editorId": ":new",
    "span": { "kind": "document" }
  },
  "sources": [
    { "type": "literal", "text": "..." }
  ],
  "mode": "replace",
  "title": "Translated Draft"
}
```

または insert:

```json
{
  "destination": {
    "editorId": "editor:active",
    "span": {
      "kind": "point",
      "at": { "line": 40, "column": 1 }
    }
  },
  "sources": [
    { "type": "literal", "text": "Inserted block\n" }
  ],
  "mode": "insert"
}
```

または append:

```json
{
  "destination": {
    "editorId": "editor:active",
    "span": {
      "kind": "document"
    }
  },
  "sources": [
    { "type": "literal", "text": "\n## Follow-up\n" }
  ],
  "mode": "append"
}
```

補足:

- 任意位置 insert は `mode: "insert"` と `destination.span.kind: "point"` を組み合わせる
- `append` は destination span の end へ追加する sugar として扱う

出力:

```json
{
  "editorId": "editor:active",
  "target": {
    "editorId": "editor:active",
    "span": {
      "kind": "range",
      "start": { "line": 12, "column": 1 },
      "end": { "line": 18, "column": 1 }
    }
  },
  "span": {
    "start": { "line": 12, "column": 1 },
    "end": { "line": 18, "column": 1 },
    "isEmpty": false
  },
  "created": false,
  "bytesWritten": 120
}
```

`sources` の型:

```ts
type WriteSource =
  | { type: 'literal'; text: string }
  | { type: 'slice-ref'; target: { editorId: string; span: SpanRef } }
  | { type: 'slice-ref'; editorId: string; span: SpanRef }
```

設計方針:

- write は source を複数受けられるようにして、直値と EditorID+SPAN の混在を許す
- 返却された `target` は destination だけでなく `slice-ref` source にもそのまま再利用できるようにする
- temp buffer で `selection` が来た場合は live selection が存在しないため `document` として正規化する
- 実行前に main process がすべての `slice-ref` を bounded に resolve し、必要なら追加 `read` を促す
- source が大きすぎるときは失敗ではなく validation error として返し、model に再取得方針を促す

### Historical Candidate: grep_slice

ステータス:

- 実装済み

用途:

- EditorID + SPAN 内の検索
- 行フィルタ、簡易統計、候補抽出

補足:

- 現行実装の tool 名は `exact_search` と `semantic_search` で、どちらも EditorID + SPAN を対象にする
- workspace grep は別 permission / 別 tool として後続フェーズに残す

入力:

```json
{
  "target": {
    "editorId": "editor:active",
    "span": { "kind": "line-range", "startLine": 1, "endLine": 300 }
  },
  "query": "TODO|FIXME",
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
      "editorId": "editor:active",
      "line": 120,
      "preview": "const editorRef = ..."
    }
  ],
  "bufferId": "buffer:grep-1"
}
```

設計方針:

- workspace 全体検索は別 tool に分けてもよいが、editor slice 検索と混ぜると token 制御しやすい
- 結果全文が長い場合は `bufferId` を発行し、後続の `read` や `sort` に渡せるようにする

### Historical Candidate: nl

ステータス:

- 後続フェーズ

用途:

- 指定 SPAN に行番号を付与する
- write 前の anchoring を安定させる

入力:

```json
{
  "target": {
    "editorId": "editor:active",
    "span": { "kind": "selection" }
  },
  "startLineNumber": 1
}
```

### Historical Candidate: cut

用途:

- 指定列、区切り、行範囲で slice を簡易加工する
- model が全文を再解釈せず必要列だけ抜く

### Historical Candidate: sort

用途:

- 行単位で簡易ソート、unique、件数確認を行う
- ログや箇条書きの重複整理に使う

### Historical Candidate: stats

用途:

- 指定 SPAN の行数、文字数、空行数、最大行長、重複行数などを返す
- model が全文を再読せずに規模感と偏りを把握する

### list_buffers

用途:

- active editor と temp buffer の一覧取得
- model が temp buffer を再利用できるようにする

### get_context

ステータス:

- 現行 scaffold で Current Editor ボタンから利用可能

用途:

- 現在の editor 状態を軽量に取得
- ファイル名、path、selection 有無、text length、dirty 状態をモデルに伝える
- inline する前に、attachment を直貼りすべきか hint にすべきか判断する材料を返す

### web_search

ステータス:

- 現行実装済み

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
  "query": "toast ui editor selection api",
  "answer": "...",
  "results": [
    {
      "title": "...",
      "url": "https://...",
      "content": "...",
      "score": 0.91
    }
  ],
  "responseTime": 0.42,
  "bufferId": "buffer:...",
  "target": {
    "editorId": "buffer:...",
    "span": {
      "kind": "document"
    }
  },
  "autoDisposeAt": "2026-05-28T12:34:56.000Z"
}
```

設計方針:

- Web 検索は Tavily API に限定する
- 現行実装では answer と ranked result を返し、必要に応じて follow-up 読み出し用 temp buffer と autoDisposeAt も返せる
- URL fetch や本文抽出本体は `fetch_url` 側で扱い、web_search 自体は検索要約に留める
- HTML サイズ制限、許可リスト、危険 URL 回避、redirect 再検証、timeout は `fetch_url` 側で main process 強制にする

### fetch_url

ステータス:

- 現行実装済み

用途:

- ACL で許可された URL の本文取得
- 大きいレスポンスの temp buffer 退避
- web_search 後の follow-up 読み出し

入力:

```json
{
  "url": "https://example.com/docs",
  "method": "GET",
  "headers": {
    "accept": "text/html"
  }
}
```

出力:

```json
{
  "url": "https://example.com/docs",
  "method": "GET",
  "status": 200,
  "ok": true,
  "statusText": "OK",
  "contentType": "text/html; charset=utf-8",
  "estimatedTokens": 1200,
  "redirectTrail": [],
  "responseHeaders": {
    "content-type": "text/html; charset=utf-8"
  },
  "delivery": "inline",
  "content": "..."
}
```

大きいレスポンスでは次のように temp buffer へ退避する。

```json
{
  "url": "https://example.com/docs",
  "method": "GET",
  "status": 200,
  "ok": true,
  "statusText": "OK",
  "contentType": "text/html; charset=utf-8",
  "estimatedTokens": 1200,
  "redirectTrail": [],
  "responseHeaders": {
    "content-type": "text/html; charset=utf-8"
  },
  "delivery": "buffer",
  "bufferId": "buffer:...",
  "target": {
    "editorId": "buffer:...",
    "span": {
      "kind": "document"
    }
  },
  "preview": "...",
  "autoDisposeAt": "2026-05-28T12:34:56.000Z"
}
```

設計方針:

- fetch ACL、request timeout、idle timeout、auto-dispose、max response bytes は fetch permissions window と main process の両方で制御する
- redirect は各 hop で再検証し、private address、embedded credentials、危険 URL は block する
- 小さい本文は inline 返却し、大きい本文は temp buffer へ退避する

### dispose_buffer

ステータス:

- 現行実装済み

用途:

- 不要になった temp buffer の明示破棄
- web_search / fetch_url の follow-up 後片付け

入力:

```json
{
  "editorId": "buffer:..."
}
```

出力:

```json
{
  "editorId": "buffer:...",
  "disposed": true
}
```

設計方針:

- dispose_buffer は temp buffer のみを受け付け、live editor target には使わない
- network 由来 buffer は autoDisposeAt でも期限切れになるが、不要時は明示破棄も許可する

## OpenAI Integration

### Security Model

- API キーは main process のみで保持する
- renderer へ API キーは公開しない
- OpenAI API 呼び出しは main process のみで行う
- tool 実行は ACL の既定拒否方式にする
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
- attachment hint が届いたら、必要な箇所だけ read を行う
- 書き換え前に必要な read を行う
- 変更は依頼に対応する最小差分を優先する
- grep_slice、nl、cut、sort は必要最小限に使う
- Web 情報が必要な場合だけ web_search を使う
- web_search は検索結果だけを返し、URL fetch は行わない
- 不明な対象は list_buffers または get_context で確認する

## IPC Design

### Editor Window Bridge

main process から editor window へ要求する操作:

- getEditorContext
- readTarget
- writeTarget

### Assistant Surface Bridge

assistant surface から main process へ送る操作:

- sendChatMessage

main process から assistant surface へ送るイベント:

- ai-chat-stream-event

注記:

- 現行実装の `sendChatMessage` は `requestId` 付き dispatch ack を返した後に `ai-chat-stream-event` で text delta / tool event / completed / failed を段階配送する
- これにより、assistant bubble 単位の先行生成、text chunk 単位の追記、tool event の途中表示を既存 Electron IPC 上で扱う
- `cancelChatRequest` は現時点では未実装であり、上記 stream 契約に対する将来拡張として扱う

### Event Flow

1. editor window で Ctrl+I またはメニューから AI Chat を開く
2. main process が対象 editor window を解決する
3. main process が editor window 内の assistant dock を開く
4. assistant surface がユーザ入力を送信する
5. main process が OpenAI へ問い合わせる
6. tool call が要求されたら main process が tool を実行する
7. editor tool の場合は editor window へ IPC を送る
8. 結果を OpenAI へ返し最終応答を得る
9. assistant surface に assistant message と tool log を流す

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
- Markdown 座標と現在 mode の相互変換
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

slice tool と workspace grep の境界を分けないと、広い検索がそのまま transcript を埋める。

対策:

- EditorID + SPAN 内加工を既定とする
- workspace grep は別 tool とし、既定除外を強くかける
- 長い結果は temp buffer に逃がす

### 4. Unsafe Writes

将来の大規模書き換えには suggest mode を導入し、直書きだけに依存しない設計にする。

加えて、`write.sources` に large slice をそのまま混ぜられると token と破壊範囲が読みにくくなる。

対策:

- source resolve 時にサイズ上限をかける
- 大きすぎる場合は追加 read を促す
- destination span は常に normalized して監査ログへ残す

### 5. Token Budget Drift

model の context window を実測なしで過信すると、小さいつもりの inline attachment が急に大きくなる。

対策:

- model ごとに conservative な token budget registry を持つ
- tokenizer 不在時は char-based fallback でさらに安全側に倒す
- inline と read の上限を同じオーダーにそろえる

### 6. Web Fetch Scope Creep

fetch を同時に入れると、レスポンスサイズ制御、本文抽出、ACL、pending 確認、危険 URL 回避、リダイレクト制御など論点が急増する。

既存の `allowed-link-rules.json` は legacy の read-only 参照として維持しつつ、fetch 用 ACL、timeout、auto-dispose、max response bytes は dedicated settings 導線で main process 強制にする。

そのため `web_search` は Tavily による検索結果取得だけに限定し、本文取得や follow-up 読み出しは `fetch_url` と temp buffer 経路へ分離する。network 由来 buffer は autoDisposeAt を持ち、自動破棄期限を返せる。

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
- assistant dock 作成
- chat UI 作成
- Markdown ChatBubble
- OpenAI 接続
- ツールなし会話

注記:

- 次の phase 分解は separate chat window 初期案から積み上げた履歴であり、現行の優先順位そのものではない
- 現在の着手順は [docs/current-backlog.md](docs/current-backlog.md) を正とする

### Historical Phase 2

- get_context
- EditorID 採番
- pending attachment UI
- inline vs hint の transport policy

### Historical Phase 3

- read target
- write target
- temp buffer registry
- basic tool log UI

### Historical Phase 4

- grep_slice
- nl / cut / sort
- write destination=":new"
- 新規 editor window 作成

### Historical Phase 5

- workspace grep
- Tavily web_search
- list_buffers
- suggest mode の土台

### Historical Phase 6

- rolling short context
- base summary
- protected context area and tools
- budget manager
- first slice keeps the latest chat turn verbatim when it fits, compresses older turns into a bounded summary, and drops protected context behind the latest turn when total input budget is tight
- protected context tools: save_context_item, list_context_items, update_context_item, merge_context_items, delete_context_item

### Historical Phase 7

- topic memory and base summary expansion
- impression memory store
- unresolved loop persistence
- hybrid retrieval
- associative graph
- resonance retrieval
- system-level memory rotation

### Historical Phase 8

- agent runtime abstraction
- root agent と subagent の分離
- subagent lifecycle tools
- subagent wait / stop / context release
- custom agent profile 拡張余地の設計

## Recommended File Layout

- electron/main.cjs
  AI orchestrator、assistant dock routing、menu action、IPC routing
- electron/preload.cjs
  editor/assistant 用 bridge 拡張
- src/App.tsx
  editor side tool response、Ctrl+I、menu action 受信
- src/ai-chat/*
  assistant surface renderer、bubble、composer、session UI
- src/markdown/* optional
  chat bubble と preview の共通 Markdown renderer 抽出先

## Acceptance Criteria For Design

- API キーが renderer に公開されない
- assistant dock が editor window 内で開ける
- chat bubble が Markdown を描画できる
- tool API が EditorID + SPAN で read/write/slice-ops/new editor を自然に表現できる
- 小さい文脈は inline、大きい文脈は hint + read で運べる
- initial implementation が段階的に進められる
