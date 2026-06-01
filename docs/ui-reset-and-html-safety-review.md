# UI Reset And HTML Safety Review

## Summary

この文書は、現行 MDV の HTML 安全境界を実装ベースで棚卸しし、その結果を踏まえて UI 全体を後方互換なしで再設計するためのたたき台をまとめる。永続方針として採用した情報設計リセットの判断は [docs/adr/0009-ui-information-architecture-reset.md](docs/adr/0009-ui-information-architecture-reset.md) を正とする。

前提:

- 現行 editor renderer は [src/App.tsx](src/App.tsx#L40) で `markdown-it` の `html: true` を有効化している
- 現行 AI chat renderer は [src/ai-chat/ChatMarkdown.tsx](src/ai-chat/ChatMarkdown.tsx#L21) で `html: false` を使っている
- ただし両方の renderer は React 側で `dangerouslySetInnerHTML` を使って HTML 文字列を DOM に挿入している
- 外部リンク遷移は renderer 直開きではなく main process 側の許可フローに送っている

結論だけ先に言うと、現行の HTML 安全性は「全面的に安全」ではない。editor preview は user Markdown に含まれる raw HTML を描画できる設計であり、AI chat は通常の raw HTML を抑止しているが、Mermaid SVG と Markdown render 結果を明示的に DOM へ挿入している。エクスポート時だけ別系統のサニタイズがあるため、実行時描画と export の安全境界も一致していない。

## HTML Safety Audit

### 1. Editor preview は raw HTML を許可している

- [src/App.tsx](src/App.tsx#L40) の `markdownParser` は `html: true`
- preview 描画は [src/App.tsx](src/App.tsx#L2602) で `renderMarkdownSegment()` の戻り値を `dangerouslySetInnerHTML` に渡している

影響:

- Markdown 本文に埋めた HTML は preview DOM に到達する
- React の escaping はここでは効かない
- 安全性は `markdown-it` と埋め込まれた downstream renderer の振る舞いに依存する

制限されている点:

- 外部リンクは [src/App.tsx](src/App.tsx#L2273) の document click hook で横取りし、[electron/main.cjs](electron/main.cjs#L4662) の `openExternalLink()` に送っている
- `http:` / `https:` 以外の protocol は [src/App.tsx](src/App.tsx#L612) で弾かれる

不足している点:

- preview 描画前の包括サニタイズはない
- export 用のサニタイズ関数は runtime preview には適用されない
- renderer 内で許可する HTML 要素・属性の明示ポリシーがコード上に一元化されていない

### 2. Export HTML には限定的なサニタイズがある

- export は [src/App.tsx](src/App.tsx#L1659) から入り、[src/App.tsx](src/App.tsx#L983) の `sanitizeExportHtmlFragment()` を通す
- この処理は `script`、`iframe`、`object`、`embed`、`form`、`meta refresh`、非 SVG の `style`、`on*` 属性などを除去する
- `href` と `src` も scheme 制限している

評価:

- export 経路だけを見ると、かなり意識的に危険要素を落としている
- ただしあくまで export 向けであり、runtime preview の防御ではない
- つまり「画面上では通る HTML」が「export では落とされる」非対称がある

### 3. AI chat は raw HTML を禁止しているが、完全に text-only ではない

- [src/ai-chat/ChatMarkdown.tsx](src/ai-chat/ChatMarkdown.tsx#L21) の `markdown-it` は `html: false`
- 通常の assistant reply / tool markdown では raw HTML をそのまま解釈しない
- しかし [src/ai-chat/ChatMarkdown.tsx](src/ai-chat/ChatMarkdown.tsx#L114) で Mermaid の SVG を `dangerouslySetInnerHTML` で挿入している
- さらに [src/ai-chat/ChatMarkdown.tsx](src/ai-chat/ChatMarkdown.tsx#L141) で Markdown render 結果も `dangerouslySetInnerHTML` に渡している

評価:

- editor preview よりは安全寄り
- ただし「`html: false` だから安全」と言い切れる構造ではない
- Mermaid 由来 SVG と Markdown renderer 出力の trust boundary は明示すべき

### 4. 外部リンク遷移は main process で制御される

- editor は [src/App.tsx](src/App.tsx#L2273)、AI chat は [src/ai-chat/ChatApp.tsx](src/ai-chat/ChatApp.tsx#L474) でクリックを横取りする
- 実際の遷移は [electron/main.cjs](electron/main.cjs#L4662) で扱う
- `block-untrusted` 設定や confirmation dialog があり、許可済みルールも管理する

これは良い境界だが、HTML 自体のサニタイズと混同してはいけない。リンク遷移制御は「クリック後の防御」であり、DOM 注入面の防御ではない。

## Current UI Inventory

### Window inventory

1. Editor window
2. Assistant dock in the editor window
3. Settings window
4. Fetch permissions auxiliary window

### Current entry points and shortcuts

実装上のショートカットは [src/App.tsx](src/App.tsx#L574) と [electron/main.cjs](electron/main.cjs#L5283) に分散している。

現在の主なショートカット:

1. `Ctrl/Cmd+O`: Open
2. `Ctrl/Cmd+S`: Save
3. `Ctrl/Cmd+Shift+S`: Save As
4. `Ctrl/Cmd+F`: Editor search に focus
5. `Ctrl/Cmd+,`: Settings
6. `Ctrl/Cmd+I`: AI Chat
7. `Ctrl/Cmd+1`: Editor panel
8. `Ctrl/Cmd+2`: Preview panel
9. `Ctrl/Cmd+Y`: Redo

不足:

- Outline へ直接移動する shortcut がない
- preview 内検索 shortcut がない
- command palette 相当の横断入口がない
- AI chat で context attach 操作に keyboard 導線がない
- 画面ごとの shortcut 一覧を UI から discover しにくい

### Current editor window structure

現行 editor UI は [src/App.tsx](src/App.tsx#L2350) 以降で構成される。

現状の構造:

1. 上部 topbar
2. editor search row
3. write のときだけ outline + editor の 2 カラム
4. preview のときは outline + preview
5. 下部 statusbar

良い点:

- 上部に主要アクションが集約されている
- outline が editor/preview の両 panel から使える
- assistant dock は必要時だけ開ける

問題:

- 検索、view switch、保存、設定、AI chat、theme が同じ topbar に詰め込まれていて情報密度が高い
- topbar の情報密度はまだ高く、command grouping も未導入
- statusbar に説明文を載せすぎており、状態通知とヘルプが競合している
- write と preview が排他的なため、比較は panel 切替前提になる
- 現在地、dirty 状態、mode、文書操作、AI 操作が視覚的にグルーピングされていない

### Current AI chat structure

現行 AI chat は [src/ai-chat/ChatApp.tsx](src/ai-chat/ChatApp.tsx#L690) 以降。

現状の構造:

1. header
2. transcript
3. pending context row
4. textarea composer
5. footer hint + send button

問題:

- 「何を添付して送るか」が footer 側に寄りすぎていて、message drafting と context planning が分離されていない
- tool output は transcript に混在するが、操作ログとしての見通しが弱い
- 実行中状態、対象 editor、pending context 数の把握が弱い
- attach actions が記号ボタン中心で、発見しづらい

### Current settings structure

現行 settings は [src/settings/SettingsApp.tsx](src/settings/SettingsApp.tsx#L297) 以降。

良い点:

- category navigation がある
- secret 保存は main process 経由
- fetch permissions を別 window に逃がしている

問題:

- 「General / AI Providers / Safety / Advanced」が user tasks ではなく設定実装都合の分類に近い
- read-only facts と editable form が混在している
- save 粒度が section と secret 単位で揺れている
- 安全設定と AI capability 設定の関係が見えにくい

## Design Problems To Solve

1. HTML trust boundary が runtime preview、AI chat、export で不一致
2. editor の主要導線が topbar に過密配置されている
3. 読む、書く、探す、AI に委ねる、設定する、のタスク切り替えコストが高い
4. shortcut が「ある」だけで discoverability が低い
5. 状態表示が statusbar、toast、header に散っている
6. 補助 window が増えたのに、全体の情報設計が window 横断で統一されていない

## Reset Design Proposal

後方互換は切る前提で、UI を「Document workspace」と「Assistant workspace」の二面構成に整理する。

### Design principles

1. 操作対象を常に明示する
2. 文書操作と AI 操作を同列に置かず、協調面として接続する
3. shortcut は first-class UI にする
4. 状態は一箇所、操作は文脈ごとに集約する
5. HTML 安全境界を renderer 単位でなく pipeline 単位で定義する

### New window model

1. Workspace window
2. Command palette / Quick actions surface
3. Assistant dock
4. Settings window
5. Fetch policy window

AI chat を独立 window に固定せず、既定では workspace 右 dock とする。必要なら detach 可能にする。これにより editor と chat を往復するモード切り替えコストを減らす。

### Workspace window layout

新レイアウト:

1. Title rail
2. Primary command bar
3. Main work area
4. Contextual inspector / assistant dock
5. Unified activity strip

#### 1. Title rail

表示要素:

1. 文書タイトル
2. dirty 状態
3. current file path
4. panel mode
5. sync / conflict / external-change 状態

#### 2. Primary command bar

ここには task switch だけを置く。

1. File
2. Edit
3. Search
4. Structure
5. Assist
6. View

個別アイコンを並べるのではなく、command group を押すと右側の command strip が文脈更新される構造にする。

#### 3. Main work area

既定は workspace-first だが、main surface は viewer semantics を優先する:

1. Outline / search / references sidebar
2. Main panel は write か preview のどちらか一方を前面表示する
3. Editor state は panel 切り替えで失わない

write と preview の二者択一自体は維持するが、assistant は別 dock として同じ workspace に統合する。

#### 4. Assistant dock

assistant を右 dock に統合し、次を一画面で扱う。

1. Conversation
2. Pending context
3. Tool activity
4. Suggested edits
5. Apply / reject actions

#### 5. Unified activity strip

現在の statusbar と toast を統合する。

表示階層:

1. persistent state chips
2. latest action result
3. background tasks
4. keyboard hint on demand

## New Shortcut System

shortcut は単なる hidden feature ではなく、command palette と cheatsheet overlay の両方から辿れるようにする。

### Global shortcuts

1. `Ctrl/Cmd+P`: Quick open / recent documents
2. `Ctrl/Cmd+Shift+P`: Command palette
3. `Ctrl/Cmd+S`: Save
4. `Ctrl/Cmd+Shift+S`: Save As
5. `Ctrl/Cmd+,`: Settings
6. `Ctrl/Cmd+K`: Focus assistant prompt
7. `Ctrl/Cmd+Shift+K`: Toggle assistant dock
8. `Ctrl/Cmd+F`: In-pane search
9. `Alt+1`: Focus outline
10. `Alt+2`: Focus editor
11. `Alt+3`: Focus preview
12. `Alt+4`: Focus assistant
13. `?`: Shortcut overlay

### Editor shortcuts

1. `Ctrl/Cmd+Shift+F`: Workspace search
2. `Ctrl/Cmd+G`: Next match
3. `Ctrl/Cmd+Shift+G`: Previous match
4. `Ctrl/Cmd+L`: Select current block / line
5. `Ctrl/Cmd+Enter`: Ask assistant about current selection

### Assistant shortcuts

1. `Enter`: Send
2. `Shift+Enter`: New line
3. `Ctrl/Cmd+1`: Attach current selection
4. `Ctrl/Cmd+2`: Attach current section
5. `Ctrl/Cmd+3`: Attach whole document
6. `Esc`: Clear pending context or move focus back to editor

## HTML Safety Reset Proposal

UI 再設計と同時に HTML trust model も作り直す。

### Policy

1. renderer-facing HTML は single sanitizer pipeline を通す
2. editor preview、AI chat、export で許可ポリシーを共通化し、差分は mode ごとの追加ルールとして管理する
3. raw HTML を許す場合でも allowlist をコード上で明示する
4. Mermaid SVG は sanitizer 後の DOM だけを注入する
5. export sanitizer を runtime sanitizer の派生にする

### Concrete reset

1. preview 用 `html: true` は維持する場合でも、render 後に sanitizer を通す
2. AI chat は引き続き `html: false` を基本とし、Mermaid 出力だけ別 sanitizer を通す
3. `dangerouslySetInnerHTML` の入口を utility 1 箇所に閉じる
4. sanitizer policy は `href`、`src`、SVG、MathML、code highlighting の扱いを明文化する

## Migration Cut

後方互換不要なら、次は段階移行ではなく明確な UI reset release として扱うべき。

順序:

1. HTML sanitizer pipeline を共通化する
2. assistant を dock 化する
3. viewer semantics を保つ main panel 切り替えへ再編する
4. status/toast/help を unified activity strip に統合する
5. shortcut overlay と command palette を入れる
6. settings IA を tasks 基準に組み替える

## Recommended next implementation slices

1. `rendered HTML` の共通 sanitizer utility 導入
2. viewer-priority な main panel 切り替えの整理
3. assistant dock の統合
4. shortcut registry と overlay 実装
5. settings taxonomy の再編