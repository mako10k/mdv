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
- `replace_structure` は既定では `maxReplacements=1` かつ `onMaxExceeded=error` の安全契約として扱う。
- `replace_structure` は必要な場合に限り `maxReplacements>1` を明示指定して batch replace を許可する。`onMaxExceeded` は overflow 時に失敗するか、上限で打ち切って成功するかを決める。
- `replace_structure` の結果では `effectiveMatched` と `maxExceeded` を見て、full success か cap-limited partial success かを判別できるようにする。`matched` は raw selector 件数、`changed` は実際に置換した件数として残す。
- 既定動作では 1 件だけ置換し、2 件目の effective match が見えた時点で error を返す。`onMaxExceeded=break` を明示したときだけ、上限で止まった partial success を success として返せる。
- `effectiveMatched` は overlap 正規化後の、実際に cap 判定へ使う件数を指す。成功時は `maxExceeded=false` が full success、`maxExceeded=true` が cap-limited partial success を意味する。

## Consequences

- AI は Markdown の構造を heading や listItem のような semantic node 単位で扱える。
- exact node targeting の follow-up は handle で安定化するが、handle は文書変更で意図的に無効化されるため、stale 時は query 再取得が必要になる。
- `replace_structure` の既定は単数 safe replace のままだが、複数件を触りうる query を使う場合は caller が上限と overflow 動作を理解して選ぶ責任を持つ。
- `onMaxExceeded=break` は success を返しうるため、caller は `maxExceeded` を見て全件適用ではなく上限打ち切りだったかを確認する必要がある。
- `SPAN` surface は引き続き文字列 slice 操作の canonical 契約として残り、structure work だけを別 contract に切り出せる。
- tool help と error guidance の面積が増えるため、OpenAI tool definition、help docs、runtime validation、error payload の同期が必要になる。
