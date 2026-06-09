Status: Accepted

## Context

既存の AI tool surface は `EditorID + SPAN` を canonical target にしており、文字列 slice の read、write、search には十分だった。一方で、見出し、段落、listItem、table、blockquote、code block のような Markdown 構造に対しては、行 range や selection を AI が毎回推測する契約では不正確になりやすい。

また、structure targeting、query language help、handle lifecycle、実行時エラー回復導線を `write_target` のような既存 action tool に混ぜると、OpenAI-facing schema と runtime validation が責務過多になる。

加えて、旧 `replace_structure` は exact single replace に失敗した後でも broad query のまま再実行されうる契約だったため、2026-06-03 の Windows ホストアプリログで実際に multi-match の 79 ノード置換まで広がった失敗様式を tool surface 側で抑止する必要があった。

## Decision

- 既存の `EditorID + SPAN` surface とは別に、mdast ベースの structure tool surface を追加する。
- structure tool surface は `get_structure_help`、`list_structure_map`、`query_structure`、`get_structure_content`、`insert_structure`、`replace_structure`、`replace_all_structures`、`delete_structure`、`wrap_structure`、`unwrap_structure`、`move_structure`、`copy_structure` を持つ。
- mdast-control との library integration は引き続き `electron/mdast-adapter.cjs` に限定し、main process は adapter の高水準 helper だけを呼ぶ。
- structure node の exact follow-up には session-scoped な opaque handle を使う。handle は document fingerprint と path に束縛し、文書変更後は stale として扱う。
- Query 言語そのものの説明、handle の意味づけ、error recovery の導線は action tool ではなく `get_structure_help` に分離する。
- structure mutation は query または handle で対象を選び、renderer への適用は最終的に canonical な full-document write として main process から行う。
- `replace_structure` は単一 structure node のみを置換する専用 surface とし、handle を必須、query を禁止にする。
- `replace_all_structures` は query にマッチする複数 node の一括置換専用 surface とし、handle を禁止、`expectedMatchCount` を必須にする。
- `replace_structure` は handle が存在しない、または 1 node に一意解決しない場合は失敗する。
- `replace_all_structures` は実マッチ数が `expectedMatchCount` と一致しない場合は失敗する。
- 両 replace tool は `dryRun` を受け付け、書き込み前の planned result を返せるようにする。

## Consequences

- AI は Markdown の構造を heading や listItem のような semantic node 単位で扱える。
- exact node targeting の follow-up は handle で安定化するが、handle は文書変更で意図的に無効化されるため、stale 時は query 再取得が必要になる。
- exact node targeting と broad multi-node replace が別 tool になるため、caller は単一置換失敗を batch replace へ逃がせなくなる。
- multi-node replace は `expectedMatchCount` で事前確認を要求されるため、件数不一致を上限超過ではなく target-set mismatch として扱える。
- `SPAN` surface は引き続き文字列 slice 操作の canonical 契約として残り、structure work だけを別 contract に切り出せる。
- tool help と error guidance の面積が増えるため、OpenAI tool definition、help docs、runtime validation、error payload の同期が必要になる。
