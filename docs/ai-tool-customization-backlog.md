# AI Tool And Customization Backlog Detail

## Purpose

この文書は [docs/current-backlog.md](docs/current-backlog.md) の AI-P2 に追加した次の項目について、受け入れ条件と実装順の前提を詳細化する。

- AI-TL-001 GH Issue の閲覧 / 発行 tool surface
- AI-CFG-001 Prompt File 編集 / 切替
- AI-CFG-002 SKILL 登録 / 有効化 / 切替
- AI-CFG-003 model registry ベースの model picker

ここでは backlog 項目の完了条件を定義する。最終的な shared contract や cross-process boundary は必要に応じて個別 design または ADR へ分離する。

この文書が対象にするのは今回追加した 4 項目だけである。AI-P2 に残る workspace grep、slice 加工系、suggest mode / audit trail は引き続き [docs/current-backlog.md](docs/current-backlog.md) で管理する。release 前チェックは [docs/release-workflow.md](docs/release-workflow.md) と REL-BL-001 側で扱う。

## Ordering

着手順の前提は次の通り。

1. accepted した AI-UX-003 layering policy の rollout / propagation を前提にする
2. AI-CFG-001 と AI-CFG-002 は accepted した AI-UX-003 layering policy を前提に実装する
3. AI-CFG-003 の release completeness は REL-BL-001 と [docs/release-workflow.md](docs/release-workflow.md) で扱い、本項目は product surface に集中する

AI-UX-003 の explainer は [docs/ai-customization-layering-design.md](docs/ai-customization-layering-design.md)、決定記録は [docs/adr/0017-ai-customization-layer-boundaries.md](docs/adr/0017-ai-customization-layer-boundaries.md) を参照する。

## AI-TL-001 GH Issue Tool Surface

### Goal

assistant から GitHub Issue を安全に閲覧し、最小限の作成操作まで行えるようにする。

### First Slice Scope

- Issue 一覧取得
- 単一 Issue 取得
- 新規 Issue 作成
- 最低限の repository / owner / state / label 条件での絞り込み

### Out Of Scope For First Slice

- Project、Milestone、Pull Request、Discussion 操作
- 任意コメント編集、Issue close / reopen、bulk mutation
- GitHub 以外の issue tracker 共通 abstraction

### Acceptance Criteria

- main process から GitHub へアクセスし、renderer に token や secret を露出しない
- 認証経路は既存の `secdat exec gh ...` または同等の secure bridge 原則と整合する
- assistant は repository を明示したうえで Issue 一覧を取得できる
- assistant は Issue 番号または URL を指定して単一 Issue を取得できる
- assistant は title と body を指定して新規 Issue を作成でき、作成結果として issue number、URL、repository を返せる
- 一覧と詳細の結果は model 入力へ過剰展開せず、必要なら temp buffer または compact result に退避できる
- 失敗時は auth failure、repository not found、validation error を区別した構造化結果を返す
- dry-run 相当の help / introspection で必要パラメータを確認できる

### Done Signal

- assistant からの実運用で「既存 Issue を見て状況把握する」「新しい Issue を 1 件起票する」が追加の手作業なしで成立する

## AI-CFG-001 Prompt File Editing

### Goal

prompt file を UI から編集し、どの task entrypoint がどの workflow を実行するかを user が追跡できるようにする。

### First Slice Scope

- Prompt file 一覧
- 1 件の編集
- 有効 / 無効切替
- rollback または前回保存版への復帰

first slice では manual invocation される prompt file 管理を対象にし、always-on instructions や per-thread prompt profile は扱わない。

### Out Of Scope For First Slice

- collaborative editing
- Git merge UI のような高度な conflict resolution
- profile marketplace や外部配布

### Acceptance Criteria

- prompt file は workspace または user customization として管理され、renderer ごとに一覧と enabled 状態がズレない
- user は prompt 名、説明、保存場所、最終更新時刻を一覧で確認できる
- user は prompt 文面を編集する前に現行内容を確認できる
- 保存前に差分または変更要約を確認できる
- 保存後、変更は次回の prompt invocation から有効になり、進行中 turn や過去 turn を再構成しないことを UI で明示する
- 有効 / 無効の切替結果が slash command と prompt recommendation surface に反映される
- assistant 実行時に、どの prompt file が invocation されたかを turn または thread diagnostics で確認できる
- rollback 操作で少なくとも直前の保存版に戻せる
- frontmatter や参照不正など prompt file の syntax / validation error は保存時に診断される

### Done Signal

- user がファイル手編集なしに prompt file を変更し、次回 invocation から反映できる

## AI-CFG-002 SKILL Runtime Surface

### Goal

SKILL を UI から管理し、どの条件で自動注入されたか、なぜ使われなかったかを user が追跡できるようにする。

### First Slice Scope

- SKILL 一覧
- 有効 / 無効切替
- 適用条件の表示
- 注入結果または未注入理由の可視化

first slice では app-global な enabled 状態と、turn 単位の注入診断を対象にする。

### Out Of Scope For First Slice

- remote skill marketplace
- third-party unsigned skill installation
- 複雑な優先度式言語

### Acceptance Criteria

- SKILL の metadata、適用条件、enabled 状態を一覧で確認できる
- user は SKILL を app-global に有効 / 無効にでき、その変更は次の turn から効く
- assistant 実行時に、どの SKILL が注入されたかを turn 単位の transcript または diagnostics surface で確認できる
- 注入されなかった場合は、条件不一致、disabled、load failure など理由を区別して示せる
- SKILL の実体参照と UI 上の表示名が一貫し、設定だけ残って壊れた参照にならない
- AI-UX-003 で整理した ownership boundary に従い、SKILL は instruction / prompt / agent / hook と責務衝突しない形で適用結果と理由を示せる

### Done Signal

- user が「この会話でどの SKILL が効いたか」を UI 上で追跡でき、手作業で設定ファイルを読まなくても原因を切り分けられる

## AI-CFG-003 Model Registry Picker

### Goal

固定 model ID 直入力ではなく、registry 正本に基づく選択 UI と metadata 表示へ移行する。

### First Slice Scope

- registry 正本の導入
- settings 上の model picker
- 価格と主要 metadata の表示
- app metadata / introspection への同一 facts 配布

first slice では OpenAI provider を主対象にしつつ、registry shape 自体は provider 拡張に耐える形にする。

### Out Of Scope For First Slice

- provider 横断の自動ベンチマーク
- 利用量トラッキングと課金予測
- user 任意の未登録 model の常時自由入力

### Acceptance Criteria

- settings UI の model 選択肢が registry 正本から生成される
- 各 model について label、model ID、provider、context window、価格、status を表示できる
- deprecated model は通常選択肢から除外するか、明確な警告付き表示にする
- 既存設定に registry 非掲載 model が入っている場合は、壊れずに warning と migration 導線を出せる
- `get_app_metadata` が settings UI と同じ registry facts を返す
- context transport policy の model context window 判定が registry 正本を参照できる
- default model の切替が settings 保存と実行時 model 解決の両方へ反映される

### Done Signal

- user が model ID を暗記せずに settings から選択でき、assistant 側と metadata 側で同じ model 情報を参照できる