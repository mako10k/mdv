# AI Chat Feasibility Notes

## Scope

注記:

- この文書の T0-3 は separate chat window entry を評価した時点の feasibility record
- 現在の primary surface は editor window 内の assistant dock であり、別 entry の記述は履歴扱いとする
- 現在の shipped AI tool surface は [docs/ai-chat-design.md](docs/ai-chat-design.md) を正とし、mdast ベースの structure tool surface もそちらに含まれる

この文書は [docs/ai-chat-task-breakdown.md](docs/ai-chat-task-breakdown.md) の Track 0 を事実ベースで確認した結果をまとめる。

確認対象:

- T0-1 Toast UI selection read feasibility
- T0-2 Toast UI selection write feasibility
- T0-3 Chat renderer entry feasibility

## Result Summary

- T0-1: feasible
- T0-2: feasible with one important normalization rule
- T0-3: feasible

初期実装に進める上での結論は次の通り。

- editor selection の read/write に必要な API は Toast UI Editor 側に存在する
- ただし Markdown mode と WYSIWYG mode で selection の表現が異なるため、AI tool 向けには Markdown 座標へ正規化する必要がある
- 現在の [src/shims.d.ts](src/shims.d.ts) は必要 API を宣言していないため、実装時には shim 拡張が必要
- chat window は Vite の別 entry と Electron の別 HTML 読み込みで分離実装できる

注記:

- 現在の実装はこの feasibility record を踏まえて editor dock へ統合され、EditorID + SPAN surface に加えて mdast structure tools も main process から利用可能になっている

## T0-1 Toast UI Selection Read Feasibility

### Evidence

- Toast UI Editor の型定義には `getSelectedText(start?, end?)`、`getSelection()`、`convertPosToMatchEditorMode(start, end, mode)` がある
- [node_modules/@toast-ui/editor/types/editor.d.ts](node_modules/@toast-ui/editor/types/editor.d.ts#L239)
- [node_modules/@toast-ui/editor/types/editor.d.ts](node_modules/@toast-ui/editor/types/editor.d.ts#L245)
- [node_modules/@toast-ui/editor/types/editor.d.ts](node_modules/@toast-ui/editor/types/editor.d.ts#L283)
- [node_modules/@toast-ui/editor/types/editor.d.ts](node_modules/@toast-ui/editor/types/editor.d.ts#L289)

### Important Finding

Toast UI 実装コメントでは `getSelection()` の返却形が mode で異なる。

- Markdown mode: `[[startLineOffset, startCurorOffset], [endLineOffset, endCurorOffset]]`
- WYSIWYG mode: `[startCursorOffset, endCursorOffset]`

根拠:

- [node_modules/@toast-ui/editor/dist/toastui-editor.js](node_modules/@toast-ui/editor/dist/toastui-editor.js#L24484)

### Implication

AI tool に対してそのまま current mode の selection を露出すると、Markdown mode と WYSIWYG mode で span 表現が分岐して扱いづらい。

したがって、AI tool 境界では次を標準化する。

- 内部 canonical span は Markdown 座標にする
- WYSIWYG mode から取得した selection は `convertPosToMatchEditorMode(..., 'markdown')` で Markdown 座標へ正規化する

### Decision

- `read source="active:selection"` は feasible
- `read source="active:document"` は既存 `getMarkdown()` で容易

## T0-2 Toast UI Selection Write Feasibility

### Evidence

- Toast UI Editor の型定義には `replaceSelection(text, start?, end?)`、`setSelection(start, end?)`、`deleteSelection(start?, end?)` がある
- [node_modules/@toast-ui/editor/types/editor.d.ts](node_modules/@toast-ui/editor/types/editor.d.ts#L239)
- [node_modules/@toast-ui/editor/types/editor.d.ts](node_modules/@toast-ui/editor/types/editor.d.ts#L241)
- [node_modules/@toast-ui/editor/types/editor.d.ts](node_modules/@toast-ui/editor/types/editor.d.ts#L243)

### Important Finding

`convertPosToMatchEditorMode(start, end, mode)` があり、Markdown 座標と WYSIWYG offset の間を相互変換できる。

根拠:

- [node_modules/@toast-ui/editor/dist/toastui-editor.js](node_modules/@toast-ui/editor/dist/toastui-editor.js#L24526)

### Implication

write tool の canonical destination を Markdown 座標で持ち、実行直前に current mode へ変換する方針が取れる。

推奨フロー:

1. AI tool は Markdown 座標の target を返す
2. renderer 側で current mode を確認する
3. WYSIWYG mode なら `convertPosToMatchEditorMode(..., 'wysiwyg')` で offset へ変換する
4. `replaceSelection()` を実行する

### Decision

- `write destination="active:selection"` は feasible
- `write destination="active:document"` は既存 `setMarkdown()` で容易
- 任意 range は初期スコープで保留してよいが、API 的には拡張余地がある

## T0-2 Additional Constraint

現在の [src/shims.d.ts](src/shims.d.ts#L1) では Toast UI Editor の公開型が極端に絞られており、selection read/write に必要なメソッドが宣言されていない。

実装前に少なくとも次を shim へ追加する必要がある。

- `getSelection()`
- `getSelectedText()`
- `replaceSelection()`
- `setSelection()`
- `deleteSelection()`
- `changeMode()` optional
- `isMarkdownMode()`
- `isWysiwygMode()`
- `convertPosToMatchEditorMode()`

## T0-3 Chat Renderer Entry Feasibility

注記:

- この節は独立 chat renderer entry を初期 scaffold として評価した時点の記録
- 現在の実装既定は editor window 内の assistant dock であり、独立 window は primary surface ではない

### Evidence

- 現在の Vite 設定は [vite.config.ts](vite.config.ts#L1) の最小構成で、multi-entry を妨げる独自 build 制約はない
- 現在の renderer entry は [index.html](index.html#L10) から [src/main.tsx](src/main.tsx) を読む単一構成
- Electron main process は現在 [src/electron/main/window-controller.cts](src/electron/main/window-controller.cts) の `loadRendererWindow()` を renderer window の共通 loader として使い、dev 時に URL を、prod 時に HTML を開いている

### Implication

独立 chat window は当時の scaffold 候補としては実装可能だった。

- `chat.html` を追加する
- `src/ai-chat/main.tsx` を追加する
- Vite build を multi-entry 化する
- Electron では editor window は `index.html`、chat window は `chat.html` を読み分ける

ただし current architecture ではこの分離 entry は採用せず、assistant surface は editor window 内の dock として統合した。

### Decision

- separate chat renderer entry は feasibility 上は問題なかった
- current implementation では dock 統合を優先し、この分離 entry は採用しない

## Recommended Adjustments Before Implementation

### 1. Canonical Span Format

AI tool へ返す span は Markdown 座標に統一する。

理由:

- 現在 editor は Markdown / WYSIWYG の mode 切替を許している
- selection 表現を current mode 依存にすると tool contract が不安定になる

### 2. Initial Scope Boundary

初期の editor tool 実装は次の順に限定する。

- `read active:document`
- `read active:selection`
- `write active:document`
- `write active:selection`

`editor_id:col1:row1:col2:row2` の一般化は後段でよい。

### 3. Shim Expansion Is Mandatory

実装着手前に [src/shims.d.ts](src/shims.d.ts) を拡張しないと、renderer 側で selection API を安全に使えない。

## Recommended Next Slice

注記:

- 次の分解は separate chat window を初期 scaffold 候補にしていた時点の履歴である
- 現在の実装順と backlog 優先順位は [docs/current-backlog.md](docs/current-backlog.md) を正とする

Track 0 の結果を踏まえた当時の最小実装スライス:

1. Toast UI shim を拡張する
2. Ctrl+I と menu action を追加する
3. chat window 用の空 renderer entry を作る
4. editor renderer から `get_context` と `read active:document` だけ先に出せるようにする
