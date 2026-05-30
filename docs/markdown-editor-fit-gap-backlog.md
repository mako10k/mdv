# Markdown Editor Fit & Gap / Backlog

## 目的

MDV を「Markdown 編集用途のモダンなデスクトップエディタ」として見たときに、現状機能がどこまで満たせているかを整理し、Markdown 編集に本当に必要な追加・変更だけをバックログ化する。

この文書では AI 連携や fetch ACL のような周辺機能は主評価軸にしない。比較対象は、Typora、Obsidian、MarkText、VS Code + Markdown 拡張のような現代的 Markdown エディタ群の共通期待値とする。

## 評価スコープ

- 対象: Markdown の作成、編集、保存、レビュー、軽い出力
- 非対象: AI orchestration、ネットワーク権限、配布方式、Windows packaging
- 現状根拠: README、editor window 実装、保存同期・競合保存フロー

## 現状サマリ

MDV は次の点ですでに強い。

- WYSIWYG / Markdown ソース切替
- Preview 表示
- Open / Save / Save As / Drag and Drop
- dirty 表示、外部変更追従、競合保存、保守的 merge save
- 見出しアウトラインと見出しジャンプ
- exact search / semantic search の UI はある
- Mermaid、KaTeX、task list、footnote、container block の描画
- HTML export、印刷、文書コピー

一方で、Markdown エディタとして日常利用の快適さを決める「置換」「編集補助」「資産挿入」「復旧性」「構造ナビの追従性」はまだ薄い。

## 比較基準

モダンな Markdown エディタに最低限期待される能力を、次の 6 群に整理する。

1. 文書を安全に開いて保存できる
2. 長い Markdown を構造的に移動できる
3. Markdown 記法を素早く入力できる
4. 画像・リンク・表・リストをストレスなく扱える
5. 編集中の見え方と出力結果を確認しやすい
6. 事故時に作業を失いにくい

## Fit & Gap

| 領域 | 評価 | 現状 | Gap |
| --- | --- | --- | --- |
| 基本編集 | Fit | WYSIWYG / Markdown ソース切替、Undo/Redo、単一文書編集は成立 | なし |
| 基本保存安全性 | Fit | Save / Save As、dirty 表示、外部変更追従、競合保存、merge save あり | なし |
| ドラッグ&ドロップ読込 | Fit | ローカルファイルとして接続したまま読込できる | なし |
| プレビュー確認 | Partial Fit | Preview、印刷、HTML export はある | side-by-side 常時比較、スクロール同期、カーソル連動がない |
| 文内検索 | Partial Fit | exact search はある | replace、正規表現置換、複数置換がない。exact search 自体は editor ローカル機能として独立したが、日常編集に必要な replace 系と選択範囲・条件変更時の安定性を強化する余地がある |
| 長文ナビゲーション | Partial Fit | 見出しアウトラインと見出しジャンプはある | 現在カーソル位置に応じた active heading、TOC、さらに長文での追従強化が必要 |
| Markdown 入力補助 | Partial Fit | Toast UI Editor 標準 toolbar と基本コマンドはある | MDV として使う主要挿入操作の導線、選択 wrap、command palette 的な呼び出しが弱い |
| 画像・添付資産 | Gap | relative image の export は考慮されている | 画像貼り付け、ドラッグ投入、相対パス配置、添付ファイル管理がない |
| 表編集 | Partial Fit | Toast UI Editor 標準の表編集はある | Markdown 表の新規作成、整形、列行操作を MDV 観点で素早く扱う補助が弱い |
| リスト継続補助 | Partial Fit | 標準エディタの list 操作はある | 番号継続、インデント継続、checkbox toggle など Markdown 執筆向けの連続編集支援が弱い |
| スペルチェック / 校正 | Gap | なし | Markdown 本文の誤字検出がない |
| 復旧性 | Partial Fit | 明示保存と競合保護はある | autosave、crash recovery、session restore がない |
| マルチ文書作業 | Partial Fit | 複数 window は可能 | タブ、最近使った文書、クイックスイッチがない |
| 出力手段 | Partial Fit | 印刷、HTML export はある | PDF / copy as HTML など軽出力がない |

## 結論

Markdown 編集という観点での優先 gap は次の 5 つに集約される。

1. replace 不足
2. autosave / recovery 不足
3. Markdown 記法入力補助の導線不足
4. 画像・表・リストの編集補助の不足分
5. active heading と構造追従性の不足

見出しアウトラインとジャンプは今回の時点で一段前進しているため、以後は「長文構造ナビゲーションそのもの」ではなく「active heading と追従性の強化」として扱う。

逆に、AI 連携強化や高度な workspace 機能より先に、上の 5 つを埋めたほうが「モダンな Markdown エディタ」としての体感価値が上がる。

## バックログ

### P0

#### MD-BL-001 文内 Find & Replace

- 種別: 完了
- 目的: Markdown の日常編集で最低限必要な置換操作を提供する
- 内容:
  - 現在の exact search UI を拡張し、replace / replace all を追加
  - AI slice search 権限に依存しない editor 固有の find/replace 基盤へ寄せる
  - 大文字小文字、regexp、選択範囲内置換の基本オプションを持つ
- 完了条件:
  - 単一置換、全置換、キャンセルが可能
  - Preview/Write のどちらからでも呼べる
  - later-hit jump、in-selection replace all、検索条件変更時の stale result 破棄が回帰テストで固定されている

#### MD-BL-002 見出しアウトライン追従強化

- 種別: 変更
- 目的: 既存の見出しアウトラインを長文編集中にさらに使いやすくする
- 内容:
  - 既存 outline pane に現在カーソル位置に応じた active heading 表示を追加
  - 必要なら outline filter / collapse を追加
- 完了条件:
  - 現在位置が outline 側で追従表示される
  - 1000 行超の文書でも実用速度で動く

#### MD-BL-003 Autosave / Crash Recovery

- 種別: 追加
- 目的: 作業喪失を防ぐ
- 内容:
  - ローカルドラフト autosave
  - 異常終了後の復元提案
  - 明示保存済みファイルと draft を区別して扱う
- 完了条件:
  - クラッシュや強制終了後に最新編集中内容を復元候補として提示できる
  - 既存の競合保存フローと矛盾しない

### P1

#### MD-BL-004 Markdown 挿入コマンド群

- 種別: 変更
- 目的: 記法を覚えていなくても主要 Markdown を素早く書けるようにする
- 内容:
  - Toast UI Editor 標準 toolbar だけでは弱い主要操作を MDV 側で補強する
  - 見出し、リンク、画像、コードブロック、引用、水平線、脚注の挿入コマンド
  - toolbar または command palette から呼び出し
- 完了条件:
  - 選択範囲 wrap とカーソル位置 insert の両方に対応
  - WYSIWYG / source どちらでも破綻しない

#### MD-BL-005 画像貼り付け / 画像ドロップの相対配置

- 種別: 追加
- 目的: Markdown 執筆で最も頻出な画像挿入を簡単にする
- 内容:
  - クリップボード画像、ファイル drop を相対 asset として保存
  - Markdown に `![](...)` を自動挿入
  - 保存先未確定文書では方針を選ばせる
- 完了条件:
  - 保存済み Markdown の隣接 assets ディレクトリへ出力できる
  - 既存 export 挙動と整合する

#### MD-BL-006 表編集補助

- 種別: 変更
- 目的: Markdown 表の作成・保守の負荷を下げる
- 内容:
  - Toast UI Editor 標準の表 UI を補完する
  - 表テンプレート挿入
  - 列追加、行追加、alignment row 補助
  - source 上の整形コマンド
- 完了条件:
  - 少なくとも表の新規作成と整形が UI から実行できる

#### MD-BL-007 リスト継続と task list 操作補助

- 種別: 変更
- 目的: 箇条書き主体の Markdown 編集を快適にする
- 内容:
  - Enter 時の番号継続
  - ネスト継続
  - checkbox toggle 操作
- 完了条件:
  - ordered / unordered / task list の継続が自然に動く

### P2

#### MD-BL-008 Preview 同期強化

- 種別: 変更
- 目的: 編集結果の確認コストを下げる
- 内容:
  - preview scroll sync
  - カーソル近傍の preview highlight
  - side-by-side 表示の再導入またはオプション化
- 完了条件:
  - 長文で「今どこを編集しているか」が preview 側でも追える

#### MD-BL-009 スペルチェック

- 種別: 追加
- 目的: Markdown 本文の誤字を早期に検出する
- 内容:
  - prose 領域中心の spellcheck
  - code block / URL の誤検出を抑制
- 完了条件:
  - 英文中心でも過剰ノイズなく使える

#### MD-BL-010 最近使った文書 / クイックオープン

- 種別: 追加
- 目的: 複数 Markdown をまたぐ作業の往復コストを下げる
- 内容:
  - recent files
  - quick open
  - 必要ならタブではなく window 間切替を優先
- 完了条件:
  - キーボード中心で最近触った文書へ戻れる

#### MD-BL-011 PDF 出力

- 種別: 追加
- 目的: Markdown の軽配布をしやすくする
- 内容:
  - print to PDF ではなく明示的 PDF export を提供
  - HTML export / print と整合する体裁を使う
- 完了条件:
  - 1 アクションで PDF を生成できる

## 実装順の推奨

1. MD-BL-001 Find & Replace
2. MD-BL-003 Autosave / Crash Recovery
3. MD-BL-004 Markdown 挿入コマンド群
4. MD-BL-002 見出しアウトライン追従強化
5. MD-BL-005 画像貼り付け / 画像ドロップの相対配置
6. MD-BL-006 表編集補助
7. MD-BL-007 リスト継続と task list 操作補助
8. MD-BL-008 Preview 同期強化
9. MD-BL-009 スペルチェック
10. MD-BL-010 最近使った文書 / クイックオープン
11. MD-BL-011 PDF 出力

## 補足

README にある diff / patch 系機能は編集基盤として有用だが、Markdown エディタとしての第一優先ではない。この文書では「Markdown を日常的に書く人の体感価値」に効くかで優先度を決めている。