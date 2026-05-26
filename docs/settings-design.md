# Settings Screen Design

## Summary

この文書は、MDV に追加する設定画面の設計を定義する。

今回の設定画面は単なる UI ではなく、AI 機能、外部リンク許可、renderer 表示設定、将来の provider 拡張を支える共通基盤として扱う。

## Goals

- editor window と AI chat window の両方から開ける設定画面を用意する
- theme のような既存のローカル設定を統合する
- OpenAI と Tavily の利用設定を UI から扱えるようにする
- API キーや秘密情報を renderer に露出しない
- 設定変更を main process 管理に寄せ、renderer ごとに状態がズレないようにする
- 将来 provider が増えても settings schema を破綻させない

## Non-Goals For Initial Scope

- 任意プラグインの導入 UI
- 複数 profile 切り替え
- 同期機能
- import / export
- 設定のクラウド保存

## Why Settings Are Needed Now

現状でも theme は [src/App.tsx](src/App.tsx) で localStorage に保持している。一方で AI 機能は次の設定を必要とする。

- OpenAI の有効化と model 指定
- Tavily の有効化
- AI tool の挙動
- 書き換えの安全モード
- 外部リンクと Web 検索の扱い

これらを各 renderer が勝手に保持すると、editor window、chat window、main process の間で状態が分岐する。そのため、設定は main process の単一ソースオブトゥルースに統合する必要がある。

## UX Recommendation

設定画面は独立 window とする。

理由:

- editor と chat のどちらからでも同じ画面を開ける
- AI chat と同様に責務を分離できる
- 後から設定カテゴリが増えても editor 本体を圧迫しない
- 秘密情報の保存、接続確認、provider 状態表示を専用 UI に集約できる

初期の起動導線:

- `CmdOrCtrl+,`
- メニューの `Settings`
- AI chat header の `Settings` ボタン
- editor toolbar の gear button optional

## Window Behavior

- 既に設定画面が開いている場合は再利用して前面化する
- 設定画面は modeless window とし、editor/chat と並行で参照できるようにする
- 設定保存は即時反映を基本とし、秘密情報だけは明示保存でもよい

## Window Classification

settings window は editor window や AI chat window とは別の auxiliary window として扱う。

ルール:

- editor 向け menu action の配送対象にはしない
- AI chat の owner/target window 解決には含めない
- managed client の suspend/resume snapshot 対象からは外す
- 単純な再利用と前面化だけを main process で扱う

## Information Architecture

左側をカテゴリナビゲーション、右側を内容ペインにする。

初期カテゴリ:

1. General
2. Editor
3. AI Providers
4. AI Behavior
5. Safety
6. Advanced

## Screen Layout

### Sidebar

- General
- Editor
- AI Providers
- AI Behavior
- Safety
- Advanced

### Main Pane

各カテゴリは section card 単位で構成する。

### Footer

- 保存状態
- schema version
- `Reset Section`
- `Reset All` optional

## Category Design

### 1. General

目的:

- アプリ全体の見た目と基本挙動を設定する

項目:

- Theme Mode
  - `system`
  - `light`
  - `dark`
- Default Start Panel
  - `write`
  - `preview`
- Open links behavior
  - `confirm-if-untrusted`
  - `block-untrusted`

備考:

- 既存の `mdv-theme-mode` localStorage はここへ統合し、将来は settings store から配布する

### 2. Editor

目的:

- editor 表示と保存挙動の既定を扱う

項目:

- Initial Edit Type
  - `markdown`
  - `wysiwyg`
- Show Mode Switch
- Preview Style
  - `tab`
  - `vertical`
- Auto-save optional future

### 3. AI Providers

目的:

- OpenAI と Tavily の利用設定をまとめる

#### OpenAI Section

- Enabled
- Base URL
- Model
- API Key
  - 画面上は masked 表示
  - renderer は実キーを再取得しない
- Temperature optional future
- Test Connection button

#### Tavily Section

- Enabled
- API Key
  - masked 表示
- Default Search Depth
  - `basic`
  - `advanced`
- Default Max Results
- Test Connection button optional

### 4. AI Behavior

目的:

- AI の既定挙動を決める

項目:

- Default write mode
  - `direct`
  - `suggest`
- Allow read active:document
- Allow read active:selection
- Allow write active:document
- Allow write active:selection
- Allow write destination `:new`
- Allow workspace grep
- Allow Tavily web_search

### 5. Safety

目的:

- 破壊的操作と外部アクセスの安全側既定を決める

項目:

- Confirm before full document overwrite
- Confirm before creating new editor from AI output
- Confirm before opening external URLs from AI responses
- Allowlist overview for external links read-only in initial scope
- Web search enabled while fetch disabled notice

### 6. Advanced

目的:

- 実装依存の詳細やデバッグ向け設定を隔離する

項目:

- Managed client mode info read-only
- Log path display
- Effective config preview
- Reset all local AI sessions optional future

## Data Model Recommendation

非 secret 設定と secret 設定を分離する。

```ts
type MdvSettings = {
  version: 1
  general: {
    themeMode: 'system' | 'light' | 'dark'
    defaultStartPanel: 'write' | 'preview'
    openLinksBehavior: 'confirm-if-untrusted' | 'block-untrusted'
  }
  editor: {
    initialEditType: 'markdown' | 'wysiwyg'
    showModeSwitch: boolean
    previewStyle: 'tab' | 'vertical'
  }
  ai: {
    defaultWriteMode: 'direct' | 'suggest'
    toolPermissions: {
      readActiveDocument: boolean
      readActiveSelection: boolean
      writeActiveDocument: boolean
      writeActiveSelection: boolean
      writeNewDocument: boolean
      workspaceGrep: boolean
      tavilyWebSearch: boolean
    }
    openai: {
      enabled: boolean
      baseUrl: string | null
      model: string
    }
    tavily: {
      enabled: boolean
      defaultSearchDepth: 'basic' | 'advanced'
      defaultMaxResults: number
    }
  }
  safety: {
    confirmBeforeFullDocumentOverwrite: boolean
    confirmBeforeNewDocumentFromAi: boolean
    confirmBeforeExternalUrlOpen: boolean
  }
}
```

secret は別レイヤに置く。

```ts
type MdvSecrets = {
  openaiApiKey?: string
  tavilyApiKey?: string
}
```

## Storage Design

### Single Source Of Truth

設定の真値は main process が持つ。

renderer は次だけを行う。

- 現在値の取得
- 値変更リクエスト送信
- 変更イベント購読

### Non-Secret Storage

保存先:

- `app.getPath('userData')/settings.json`

理由:

- Electron main から一貫管理できる
- localStorage より window ごとの差分が出ない
- schema version を持ちやすい

### Secret Storage

推奨:

- OS credential store abstraction

初期設計では実装層を抽象化する。

- 第1候補: OS keychain wrapper
- 代替: 環境変数のみ read-only 利用

初期実装では、秘密情報の保存がまだ無い場合でも UI は対応済みにして、保存 backend は抽象越しに差し替え可能にする。

## Preload / IPC Design

### Main Process Responsibilities

- settings store の読込
- schema migration
- secret backend の読込と保存
- renderer への sanitized settings 配布
- validation

### Preload API

既存の preload 命名規約に合わせ、別 global の `window.mdvSettings` は作らず、`window.mdvDesktop` の拡張として扱う。

想定 API:

```ts
window.mdvDesktop.settings = {
  getSettings(): Promise<MdvSettings>
  updateSettings(patch: DeepPartial<MdvSettings>): Promise<MdvSettings>
  getProviderStatus(): Promise<{
    openaiConfigured: boolean
    tavilyConfigured: boolean
  }>
  saveSecret(input: { provider: 'openai' | 'tavily'; value: string }): Promise<void>
  clearSecret(input: { provider: 'openai' | 'tavily' }): Promise<void>
  onSettingsChanged(callback): () => void
}
```

### Secret Handling Rule

- renderer は secret の生値を取得しない
- renderer は `configured / not configured` だけを受け取る
- secret の保存は main process 経由で一方向に送る

## Validation Rules

- `defaultMaxResults` は 1 以上 20 以下
- `baseUrl` は空文字なら null に正規化
- provider が disabled のときも secret は保持可能
- `writeActiveDocument` が false なら confirm 設定は UI で disabled にする

## Migration Plan

### Theme Migration

- main process が `settings.json` に theme 未設定を検出した場合、最初に起動した editor renderer へ一回限り legacy theme 値の問い合わせを行う
- renderer が `localStorage['mdv-theme-mode']` を返せた場合だけ `settings.json` へ移す
- renderer が未応答または未設定なら `system` を既定にする
- 移行後は main process が settings を配布し、renderer は localStorage を正本にしない

### Allowed Link Rules Migration

- 現在の `allowed-link-rules.json` は safety 設定の一部として扱える
- 初期段階では既存ファイルを維持し、設定画面からは read-only 参照のみにする
- 後段で `settings.json` に統合してもよいが、今回の初期設計では急がない

## Recommended Implementation Order

1. settings window scaffold
2. `settings.json` store と preload bridge
3. General の theme 統合
4. AI Providers の表示と masked state
5. AI Behavior と Safety の権限制御
6. secret backend 導入

## Relation To AI Chat

AI chat 実装前に最低限必要な設定は次の通り。

- OpenAI enabled
- OpenAI model
- OpenAI configured state
- Tavily enabled
- Tavily configured state
- default write mode
- tool permissions

したがって設定画面は AI chat の後付けではなく、AI 実装の基盤として先に入れる価値が高い。

AI provider 設定の優先順位:

1. settings store
2. 環境変数 fallback

環境変数は次の用途に限定する。

- 開発時の簡易起動
- secret backend 未実装時の暫定利用
- managed deployment の初期注入

## Acceptance Criteria

- editor / chat のどちらからでも開ける
- theme を main process 管理へ移せる
- OpenAI / Tavily の設定 UI がある
- secret が renderer に露出しない
- 設定変更が複数 window に反映される
- 設定 schema が今後の AI tool 拡張に耐えられる