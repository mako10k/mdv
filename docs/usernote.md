# ユーザノート

## バックログ候補

- [ ] 1. 起動時のプレースフォルダ表示を抑止する
  起動直後にプレースフォルダ内容が一瞬見える問題を解消する。初期表示の描画順やローディング手順を見直す。

- [ ] 2. 上部UIの責務を整理する
  ToastUI の上部ツールボックスと上部ボタンの役割重複を解消する。上部領域の煩雑さを減らし、操作導線を統一する。

- [ ] 3. メディアリンク管理機能を追加する
  source view での BASE64 埋め込み画像の重い本文省略は実装済み。表示コメントとして使う alt テキスト編集も維持した。残課題は、ペースト時の画像・メディア管理導線の整理と、LLM 読み出し時のメディア参照方針の明確化。

- [ ] 4. 検索ボックスの表示方法を見直す
  検索ボックスを必要に応じて別ウインドウ化する。常設配置か分離表示かの設計を検討する。

- [ ] 5. 最上位ツールボックスを改善する

グループ化を導入する。メニューとの併用を検討する。画面幅が狭い場合は省略表示にする。

- [ ] 6. 挿入位置をカーソル位置に統一する
  FootNote などの挿入時に、カーソル位置以外へ入る問題を修正する。最上位ボタンからの挿入処理を見直す。

- [x] 7. 新規ドキュメント作成導線を追加する
  Ctrl + N で新規ドキュメントを開けるようにする。この操作ではエディタモードで開く。ボタン配置が必要かも検討する。

- [ ] 8. 保存・外部編集の追従表示を改善する
  非 dirty 状態で外部編集された場合の自動追従は実装済み。残課題は、保存時のマージプレビュー表示と競合解決 UI の明示化。

- [ ] 9. README と開発文書の責務を分離する
  README.md は公開用の案内に絞る。ツールの特徴、使い方、ダウンロードリンクなどを中心にする。開発用ドキュメントは別ファイルへ移す。

- [ ] 10. イテレーションリミット到達時の継続可否を選べるようにする
  イテレーションリミットに達した際、継続するか中断するかを選択できるようにする。処理の自動停止ではなく、ユーザーが次のアクションを決められるようにする。

- [ ] 11. 画像添付の削除・整理を容易にする
  破損した画像添付を安全に削除できるようにする。画像や注釈を本文から切り離して管理しやすくする。末尾に残った添付の整理をしやすい編集導線を用意する。

- [x] 12. ソースコードの構造化と TypeScript 化
  Electron 側のソースコードの肥大化を解消する。大半のロジックを TypeScript でライブラリ化する。CommonJS の型安全性の課題を改善する。Electron 配下の CJS ソースコードは薄い起動、描画やイベント仲介など、インターフェース層のみに限定する。

- [x] 13. バグ: replace structure call で複数位置の情報が入れ替わる
  2026-06-03 13:16 JST 頃の Windows ホストアプリログでは、`replace_structure` が `query="paragraph"` で実行され、`matched=79 changed=79` で完了している。直前には `query="line[25]"` の selector エラーと、`query + handle` 同時指定エラーも出ている。少なくともこの時点では、単一ノードの exact replace ではなく broad query による multi-match replace が実行されている。
  対策として、`replace_structure` は handle 必須の exact single replace に絞り、query ベースの batch replace は `replace_all_structures` に分離した。`replace_all_structures` は `expectedMatchCount` 必須にして、query_structure などで確認した件数と一致した場合にのみ実行する。これにより、単一置換の失敗をその場で多件置換へ広げる逃げ道を tool surface から除去した。

- [x] 14. バグ: write target=":new" の時にコンテンツがプレースフォルダ内容のまま
  2026-06-03 13:17-13:19 JST 頃の Windows ホストアプリログでは、`write_target` の `destination.editorId=":new"` は複数回 `created=true` かつ `bytesWritten>0` で完了している。したがって main process の tool write 自体は成功している。コード上でも `createNewEditorWindowFromContent -> requestEditorContext -> requestEditorWindowData(type="write")` の順で write は投げられている。一方 renderer 側は editor instance 未生成の段階でも write request を受けられるが、`EditorSurface` は初回 render の `initialValue` を固定して editor を作るため、pre-mount write が placeholder 初期値に負ける競合があり得た。対策として pre-mount の最新 value を editor 初期化へ反映し、untitled の既定 state も空文書へ変更して、プレースホルダ注入は前提値ではなく最終フォールバック寄りに後退させた。

- [ ] 15. Span Comment 機能を追加する
  指定 Span への comment 追加、編集、削除を行えるようにする。コメント作成者と編集者が user / AI のどちらかを判別できるようにし、hover で内容を見せる。本文編集に追従して span を自動補正し、追従不能になった orphaned comment の閲覧・整理も行えるようにする。保存先は XDG 配下に置き、tool surface から span 内 comment と orphaned comment の一覧取得、CRUD を行えるようにする。

- [x] 16. 同一ファイル再オープン時は既存エディタをフォーカスする
  すでに同じファイルを開いている場合、新しい window や重複読込を行わず、既存 editor window を前面へ出してフォーカスする。OS からの再オープンと app 内 open dialog の両方で重複を避ける。

- [ ] 17. アウトラインと文字組の表示密度を上げる
  見出しアウトラインの行間が広すぎるため、同じ高さでより多くの情報を読めるようにする。editor / AI chat のフォントサイズを別々に調整できるようにし、AI chat は padding・margin・補助説明を減らして密度を上げる。

- [ ] 18. H3/H4 がインラインコード風に囲われる表示バグを直す
  文書冒頭付近の H3/H4 heading がインラインコードのような枠で囲われる表示崩れを修正する。Markdown preview、editor、AI chat の Markdown fragment で CSS 競合がないか確認する。

- [ ] 19. 変更プレビュー / マージ UI 基盤を追加する
  保存前や AI 変更適用前に、byte 数だけでなく diff を見ながら確認できるようにする。inline diff や merge UI を使って hunk 単位の適用・破棄・編集を行える基盤を先に整備し、その上に変更プレビューを載せる。

- [ ] 20. アップデート基盤とバージョンメタデータ基盤を整備する
  バージョンメタデータ取得と About/Help 画面への表示、インストール済み Windows release build 向けの auto-update 基盤は実装済み。残課題は、ワンクリック更新体験の仕上げと、AI 含む複数 surface へのメタデータ露出の統一。

- [x] 21. エディタ下部の細かい説明を削除する
  下部バーの常設説明テキストは削除し、状態表示とヘルプ導線に役割を絞った。

- [x] 22. ヘルプ導線を追加する
  下部バーから Help ウィンドウを開けるようにした。Help ウィンドウには基本操作、画像の扱い、AI チャット導線、更新状態をまとめて表示する。

- [ ] 23. AI tool 向け snapshot handle ベース Undo/Redo を追加する
  任意の editor undo/redo をそのまま許可するのではなく、AI tool が編集したタイミングで before / after の snapshot handle を発行し、その handle 間を戻す / 進める操作として公開する。既存 renderer には live snapshot の build / apply と file snapshot 比較があるため、まずは generic な Src / Dst 転送 surface へ広げず、snapshot handle 専用の tool contract として切る。
  Dirty 状態や file 差分が絡む場合は、現在 buffer、snapshot handle 側の before / after、必要なら disk file snapshot を並べて見せ、user 編集をつぶす結果になるときは merge / discard / undo-redo cancel を選べるようにする。少なくとも AI 側の restore 実行前に、「handle 生成時から現在までの user 編集有無」と「disk file snapshot との差分有無」を main / renderer 境界で判定できる必要がある。
  代替案として、EditorID に対して編集時発行 handle、before / after snapshot、disk file data などを source / destination として各 tool から参照できる一般化 surface も考えられる。ただし read / write / temp-buffer / structure handle と責務が混ざりやすいので、第一段階では snapshot history 専用 request と restore request を分け、必要になってから source / destination 一般化へ拡張する方が安全。