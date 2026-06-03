Status: Accepted

## Context

既存の AI tool surface は `EditorID + SPAN` を canonical target にしており、文字列 slice の read、write、search には十分だった。一方で、見出し、段落、listItem、table、blockquote、code block のような Markdown 構造に対しては、行 range や selection を AI が毎回推測する契約では不正確になりやすい。

また、structure targeting、query language help、handle lifecycle、実行時エラー回復導線を `write_target` のような既存 action tool に混ぜると、OpenAI-facing schema と runtime validation が責務過多になる。

## Decision

- 既存の `EditorID + SPAN` surface とは別に、mdast ベースの structure tool surface を追加する。
- structure tool surface は `get_structure_help`、`list_structure_map`、`query_structure`、`get_structure_content`、`insert_structure`、`replace_structure`、`delete_structure`、`wrap_structure`、`unwrap_structure`、`move_structure`、`copy_structure` を持つ。
- mdast-control との library integration は引き続き `electron/mdast-adapter.cjs` に限定し、main process は adapter の高水準 helper だけを呼ぶ。
- structure node の exact follow-up には session-scoped な opaque handle を使う。handle は document fingerprint と path に束縛し、文書変更後は stale として扱う。
- Query 言語そのものの説明、handle の意味づけ、error recovery の導線は action tool ではなく `get_structure_help` に分離する。
- structure mutation は query または handle で対象を選び、renderer への適用は最終的に canonical な full-document write として main process から行う。

## Consequences

- AI は Markdown の構造を heading や listItem のような semantic node 単位で扱える。
- exact node targeting の follow-up は handle で安定化するが、handle は文書変更で意図的に無効化されるため、stale 時は query 再取得が必要になる。
- `SPAN` surface は引き続き文字列 slice 操作の canonical 契約として残り、structure work だけを別 contract に切り出せる。
- tool help と error guidance の面積が増えるため、OpenAI tool definition、help docs、runtime validation、error payload の同期が必要になる。
