# AI Impression Memory Phase 1 Backlog

## Summary

この文書は [docs/ai-impression-memory-design.md](docs/ai-impression-memory-design.md) の Phase 1 を、MDV で着手可能な最小実装バックログへ落としたものである。

対象は subsystem 内の Phase 1 であり、親設計 [docs/ai-chat-design.md](docs/ai-chat-design.md) の Phase 6 前半に相当する。

## Phase 1 Goals

- rolling short context を導入する
- base summary を導入する
- lightweight な topic extraction を導入する
- topic summary を導入する
- context budget manager を導入する

この段階では impression memory の本格永続化や graph traversal は扱わない。

## Non-Goals For Phase 1

- long-term impression store の本格実装
- hybrid retrieval の完成
- associative graph
- resonance retrieval
- user-visible memory management UI
- external vector DB 導入

## Implementation Order

1. rolling short context
2. basic summarizer
3. topic extraction
4. topic summaries
5. budget manager

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
  - 再生成条件は context pressure または topic shift に限定する
- 受け入れ条件:
  - 100 から 300 token 程度の base summary を生成できる
  - topic 固有詳細を含みにくい
  - summary を active conversation layer とは別に保持できる

### IM-P1-003 Lightweight Topic Extractor

- 目的: 毎メッセージ実行を避けつつ topic 単位の切り分けを行う
- 内容:
  - message count threshold による extraction trigger を導入
  - keyword divergence と明示切替を使う軽量 topic shift 検出を導入
  - embedding distance は optional とし、小規模環境では無効化できるようにする
- 受け入れ条件:
  - 4 から 8 発話ごとに topic extraction を走らせられる
  - 話題切替時に新 topic を開始できる
  - 毎メッセージ再抽出は行わない

### IM-P1-004 Topic Summary Store

- 目的: topic ごとの圧縮記憶を mid-term layer として保持する
- 内容:
  - topic ごとの summary レコードを保存する
  - unresolved state、decision、constraint を保持する summary schema を定義する
  - topic ごとに lastUpdated と activeScore を持たせる
- 受け入れ条件:
  - 複数 topic の summary を区別して保持できる
  - topic summary を selective retrieval できる
  - resolved topic を active set から外せる

### IM-P1-005 Context Budget Manager

- 目的: layer 別 token 使用量を制御し、context pressure 時に段階削減する
- 内容:
  - Layer 0 から Layer 4 の budget 設定を導入
  - soft、medium、hard threshold を設定可能にする
  - Phase 1 で実在する layer だけを対象に、overflow -> old topic memory -> conversation compression -> system layer の削減順を実装する
  - impression layer と hybrid retrieval は Phase 2 以降の拡張点として interface だけ差し込める形にとどめる
- 受け入れ条件:
  - layer ごとの使用量を計測できる
  - threshold 超過時に圧縮または削減が発火する
  - overflow layer が最初に削られる
  - system layer が最後まで残る
  - Phase 1 では impression memory や retrieval candidate なしでも動作する

## Cross-Cutting Technical Decisions

### Storage

- 初期は SQLite を採用する
- tables は `conversation_buffers`, `base_summaries`, `topic_summaries`, `budget_profiles` を最小セットとする
- embeddings は Phase 1 では optional にする

### Runtime

- short context と summary 更新は main process 側で管理する
- background summarization は idle 時だけ実行する
- low-end profile では keyword と summary を優先し、embedding 依存を下げる

### Configuration

- budget profile は small, default, large の 3 プリセットを持てるようにする
- small profile は Layer 2 と Layer 4 を強く抑制する

## Suggested Validation

### Behavior Checks

- 長い会話で short context が押し出されても base summary が残る
- 話題切替後に旧 topic summary が mid-term layer へ退避する
- context pressure 時に overflow が先に落ちる
- small profile でも topic summary と budget manager が機能する

### Engineering Checks

- `npm run build`
- `npm run lint`
- topic extraction と budget manager のユニットテスト追加が可能なら追加する

## Risks For Phase 1

- topic extraction が粗すぎると summary が混線する
- budget 推定が甘いと layer 削減順が崩れる
- summarizer が topic 固有詳細を base summary に混ぜる可能性がある
- low-end profile では embedding 無効時の recall 低下が起こりうる

## Exit Criteria

- rolling short context、base summary、topic summaries、budget manager が接続されている
- current topic を切り替えながら summary を維持できる
- context pressure 時に compression policy が実際に発火する
- Phase 2 で impression memory を載せるための保存面と budget 面の基礎が整っている