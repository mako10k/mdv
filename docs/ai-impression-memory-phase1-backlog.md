# AI Impression Memory Phase 1 Backlog

## Summary

この文書は [docs/ai-impression-memory-design.md](docs/ai-impression-memory-design.md) の Phase 1 を、MDV で着手可能な最小実装バックログへ落としたものである。

対象は subsystem 内の Phase 1 であり、親設計 [docs/ai-chat-design.md](docs/ai-chat-design.md) の Phase 6 前半に相当する。

## Phase 1 Goals

- context compression を最優先で導入する
- 圧縮時に劣化しない protected context area を導入する
- rolling short context を導入する
- base summary を導入する
- context budget manager を導入する
- protected context を保存する最小ツールを導入する

この段階では topic memory、impression memory の本格永続化や graph traversal は扱わない。

## Non-Goals For Phase 1

- topic extraction の本格導入
- topic summary の本格導入
- long-term impression store の本格実装
- hybrid retrieval の完成
- associative graph
- resonance retrieval
- user-visible memory management UI
- external vector DB 導入

## Implementation Order

1. rolling short context
2. basic summarizer
3. protected context area
4. budget manager
5. protected context tools

topic extraction と topic summary は次段階へ送る。

## Backlog

### IM-P1-001 Rolling Short Context Buffer

- 目的: 直近会話を固定 token budget 内で保持する
- 内容:
  - recent messages を message count と概算 token 数で管理する ring buffer を導入
  - tool result は通常メッセージと分離して保持し、必要時だけ注入可能にする
  - short context buffer の現在使用量を取得できるようにする
- 受け入れ条件:
  - 直近会話が順序を保って取得できる
  - budget 超過時に古い message から押し出される
  - buffer 使用量を budget manager へ渡せる

### IM-P1-002 Base Summary Generator

- 目的: topic 非依存の共通前提を圧縮保持する
- 内容:
  - 共通要約 prompt を固定化する
  - 会話全体の前提、制約、ユーザー意図だけを残す summarizer を導入
  - 再生成条件は context pressure または message count threshold に限定する
- 受け入れ条件:
  - 100 から 300 token 程度の base summary を生成できる
  - topic 固有詳細を含みにくい
  - summary を active conversation layer とは別に保持できる

### IM-P1-003 Protected Context Area

- 目的: 圧縮で劣化させない小容量の保護領域を導入する
- 内容:
  - protected context item schema を定義する
  - 小さな token budget と item 数上限を設定する
  - item は明示 save のみで追加する
- 受け入れ条件:
  - protected item を別領域として保持できる
  - compression 時に protected item が summary 化されない
  - 予算超過時に追加拒否または削除候補提示ができる

### IM-P1-004 Context Budget Manager

- 目的: layer 別 token 使用量を制御し、context pressure 時に段階削減する
- 内容:
  - first slice で使う short context、base summary、protected context、overflow の budget 設定を導入
  - soft、medium、hard threshold を設定可能にする
  - overflow -> conversation compression -> protected context -> system layer の削減順を実装する
  - topic memory、impression layer、hybrid retrieval は次段階の拡張点として interface だけ差し込める形にとどめる
- 受け入れ条件:
  - layer ごとの使用量を計測できる
  - threshold 超過時に圧縮または削減が発火する
  - overflow layer が最初に削られる
  - system layer が最後まで残る
  - protected context area は圧縮対象外として扱える
  - Phase 1 では topic memory、impression memory、retrieval candidate なしでも動作する

### IM-P1-005 Protected Context Tools

- 目的: 保護領域へ重要情報を明示保存できるようにする
- 内容:
  - `save_context_item` を導入する
  - `list_context_items` を導入する
  - `update_context_item` を導入する
  - `merge_context_items` を導入する
  - `delete_context_item` を導入する
  - save / update / merge 実行時に injected prompt text 基準の budget check を行う
- 受け入れ条件:
  - ツール経由で短い item を保存できる
  - 保存済み item を一覧できる
  - 保存済み item をその場で修正できる
  - 複数 item を 1 件へ統合できる
  - 不要な item を削除できる
  - 長文や予算超過 item を拒否できる

## Cross-Cutting Technical Decisions

### Storage

- 初期は SQLite を採用する
- tables は `conversation_buffers`, `base_summaries`, `protected_context_items`, `budget_profiles` を最小セットとする
- embeddings は Phase 1 では optional にする

### Runtime

- short context と summary 更新は main process 側で管理する
- background summarization は idle 時だけ実行する
- low-end profile では keyword と summary を優先し、embedding 依存を下げる
- protected context item は main process 側で保存と budget check を完結できるようにする

### Configuration

- budget profile は small, default, large の 3 プリセットを持てるようにする
- small profile は protected context area の件数と short context budget をより強く制限する

## Suggested Validation

### Behavior Checks

- 長い会話で short context が押し出されても base summary が残る
- context pressure 時に overflow が先に落ちる
- protected context item が compression で壊れない
- small profile でも protected context と budget manager が機能する

### Engineering Checks

- `npm run build`
- `npm run lint`
- budget manager と protected context tool のユニットテスト追加が可能なら追加する

## Risks For Phase 1

- budget 推定が甘いと layer 削減順が崩れる
- summarizer が topic 固有詳細を base summary に混ぜる可能性がある
- protected context area を肥大化させると短期会話を圧迫する
- low-end profile では budget 上限が厳しすぎると保存拒否が増える

## Exit Criteria

- rolling short context、base summary、protected context area、budget manager が接続されている
- context pressure 時に compression policy が実際に発火する
- protected context tool で保存した item が compression 後も保持される
- Phase 2 で topic memory と impression memory を載せるための保存面と budget 面の基礎が整っている