# AI Resource Target Unification Proposal

## Summary

この文書は、現行の `EditorID + SPAN` 契約を、memory と chat history を含むより一般的な参照面へ拡張するための提案を定義する。

狙いは、editor、temp buffer、protected context、summary、conversation history を「AI が読む対象」「AI が write source として再利用する対象」としてできるだけ同じ作法で扱えるようにすることにある。

ただし、この提案は `editorId` の値空間を雑に広げるものではない。異なる resource 種別を同じ ID や同じ locator に押し込むと、editor 座標、message range、memory semantics が再び混線するためである。

そのため、拡張の軸は `EditorID + SPAN` の直接拡張ではなく、`resourceRef + locator` への抽象化とする。

## Problem

現行契約は editor と temp buffer の text slice を扱うには十分だが、次の対象を自然には表現しにくい。

- protected context item
- base summary
- impression memory item
- conversation transcript
- conversation 内の一部 message range

これらを今の `editorId` にそのまま混ぜると、少なくとも次の問題が起きる。

- `selection` や Markdown 座標のような editor 専用 semantics が transcript や memory に漏れる
- memory の保存や pin のような意味操作と text write が混線する
- conversation history の provenance と時系列構造を text replacement で壊しやすくなる
- helper が複数の target 表現を吸収し始め、以前の contract drift と同種の問題を再発させる

## Design Direction

### 1. Canonical Reference Shape

canonical target は `resourceRef + locator` とする。

例:

```json
{
  "resource": {
    "kind": "editor",
    "id": "editor:active"
  },
  "locator": {
    "kind": "markdown-span",
    "span": { "kind": "document" }
  }
}
```

`resource.kind` の初期候補は次とする。

- `editor`
- `buffer`
- `asset`
- `protected-context-item`
- `base-summary`
- `impression-memory-item`
- `conversation`
- `message`

### 2. Locator Is Resource-Kind Specific

locator は resource kind ごとに許される shape を分ける。

editor/buffer にだけ現在の SPAN 系を適用する。

初期候補:

- `markdown-span`
- `whole-item`
- `metadata-only`
- `text-range`
- `turn-range`
- `message-range`

原則:

- `selection` は live editor 専用
- `asset` は locator と read surface には載せられるが、rename/copy/delete のような mutation は text write に混ぜない
- conversation 全体には `turn-range` / `message-range` を使う
- memory item は基本 `whole-item`、必要なら限定的な `text-range` だけを許可する
- resource kind ごとに valid locator matrix を明示し、暗黙拡張しない

### 3. Read Is The First Unification Surface

最初に統一するのは read surface と write source surface である。

つまり AI は次を同じ read contract で読めるようにする。

- editor slice
- temp buffer slice
- asset metadata or safe text projection
- protected context item
- summary text
- conversation message range

また、`write_target.sources` は次のような slice-ref を受けられるようにする。

- editor/buffer source
- memory item source
- conversation excerpt source

この段階で「引用」「要約元」「別 editor への転記」は一貫して扱いやすくなる。

### 4. Mutation Stays Kind-Specific

write destination まで全面統一しない。

理由:

- editor は text replacement / insert / append が自然
- asset は file rename / copy / export のような file-semantics mutation が自然
- protected context は save / list / delete / replace-item が自然
- impression memory は merge / decay / pin / demote のような意味操作が主になる
- conversation transcript は provenance 保護のため原則 read-only にすべきである

従って初期方針は次とする。

- `write_target.destination` は当面 `editor` / `buffer` に限定する
- `asset` は read/source 側の参照面には載せても、mutation は `rename_asset` や `copy_asset` のような専用 tool に分ける
- memory は専用 tool で mutate する
- conversation transcript は read-only resource とし、必要なら summary や save 系の意味操作を専用 tool で追加する

## Proposed Tool Policy

### Read Policy

- `read_target` は `resourceRef + locator` を受ける
- `stats_slice` と `exact_search` も text projection を返せる resource に限って同じ参照面を使う
- `semantic_search` は resource kind ごとの index 可用性に応じて段階導入する

### Write Policy

- `write_target.destination` は Phase 1 では editor/buffer 限定
- `write_target.sources` は editor/buffer 以外の readable resource も参照できるようにする
- memory mutation は `save_context_item`、`list_context_items`、`delete_context_item` などの専用 tool を維持する

### Conversation Policy

- conversation は原則 read-only
- conversation 参照は `message-range` または `turn-range` を使う
- 会話を書き換える tool は導入しない
- conversation 由来の断片を memory へ保存する操作は、明示的 save tool として切り出す

## Valid Locator Matrix

初期 matrix は次を基準にする。

| resource kind | allowed locator |
| --- | --- |
| editor | markdown-span |
| buffer | markdown-span |
| asset | whole-item, metadata-only |
| protected-context-item | whole-item, text-range |
| base-summary | whole-item, text-range |
| impression-memory-item | whole-item, text-range |
| conversation | turn-range, message-range |
| message | whole-item, text-range |

注記:

- `text-range` は plain text projection 上の range とし、Markdown 座標とは区別する
- `selection` は `editor` にだけ許可する
- `metadata-only` は asset のような非 text resource で、本文投影ではなく lightweight metadata projection を返すために使う
- resource kind ごとの locator 変換は共通 helper で吸収せず、kind ごとに明示分岐する

## Migration Strategy

1. 現行 `EditorID + SPAN` を compatibility layer として残す
2. 内部 canonical contract を `resourceRef + locator` に切り替える
3. Phase 1 は read と source だけを一般化する
4. protected context item と asset metadata を最初の non-editor resource として載せる
5. 次に conversation excerpt read を追加する
6. memory mutation と asset mutation は専用 tool のまま維持する
7. 必要なら Phase 2 以降で write destination の拡張可能性を再評価する

## Why This Is Better Than Expanding EditorID

- editor, memory, transcript の semantics を混ぜない
- それでも read / source reuse は統一できる
- contract drift を helper の permissive 化で隠さずに済む
- resource kind ごとの validity rules を明文化できる
- conversation history の真正性を保ったまま引用・保存・要約ができる

## Open Questions

- `message` を独立 resource にするか、常に `conversation + message-range` に寄せるか
- memory item に `text-range` を許す範囲をどこまで広げるか
- `semantic_search` を conversation と memory にどう段階展開するか
- summary / impression を plain text projection としてどの程度正規化して返すか