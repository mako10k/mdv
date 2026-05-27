# 0002 Editor Handle And Span Tool Contract

Status: Accepted

## Context

既存の AI chat scaffold は `active:document` と `active:selection` を前提にした単純な read/write bridge を持つ。一方で、実際の chat tool orchestration では次の要求がある。

- 小さい文脈だけを直値で model input に入れたい
- 大きい文脈は transcript に貼らず、後続 `read` で段階取得させたい
- editor 本体だけでなく、tool が生成した一時結果も後続 tool の入力として再利用したい
- write の source は直値だけでなく、既存の editor slice や tool 結果 slice を混在させたい
- SPAN は selection と document だけでは足りず、point、line、range、from-start、to-end を表現したい

固定文字列の source / destination 名だけでは、この要求を増やすたびに契約が肥大化しやすい。

## Decision

- AI tool 契約の canonical target は `EditorID + SPAN` とする
- `EditorID` は editor window と session-scoped temp buffer の両方を参照できる
- `SPAN` は selection、document、point、line、line-range、from-start、to-end、range を表せる union にする
- `SPAN` の line-range は順不同入力を受けても start/end を正規化して扱う
- `selection` は live editor window にだけ意味を持つ span とし、temp buffer では `document` に正規化する
- 実行前にすべての SPAN を Markdown 座標ベースの normalized span へ解決する
- read 系の返却では、継続 pagination 用の `target` と、そのページ自体を再利用するための `pageTarget` を分けて返す
- write の `slice-ref` source は legacy な `editorId + span` と canonical な `target` の両方を受ける
- explicit context attachment は送信前 pending reference として保持し、送信時に only-if-small で inline、超過時は `EditorID + SPAN + preview` の hint に落とす
- `read` の返却上限は inline transport と同程度の token budget に制限し、続きを取るための cursor を返す
- `write` は複数 source を受けられるようにし、source は `literal` と `slice-ref` を混在可能にする
- `active:document` や `active:selection` は compatibility alias として残し、main process で canonical target へ変換する

## Consequences

- transcript が大きい本文で膨らみにくくなり、model input の token 制御がしやすくなる
- tool 結果を temp buffer としてつなげることで、`grep`、`nl`、`cut`、`sort` のような加工系 tool を自然に追加できる
- main process に editor registry、buffer registry、span normalization、token budget policy が必要になる
- OpenAI system prompt には「hint を見たら必要箇所だけ read する」方針を明示する必要がある
- OpenAI system prompt と tool descriptions には、`target` は follow-up 用、`pageTarget` は返却ページ再利用用という使い分けを明示する必要がある
- write source が複合化するため、oversize source と破壊的 destination の validation を強化する必要がある