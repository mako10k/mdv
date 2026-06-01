# Find & Replace Retro 2026-05

## Scope

MD-BL-001 の local exact search / replace 実装中に、次の 2 件の退行が入った。

- 検索結果クリックで editor viewport へジャンプしない
- 選択範囲限定検索で、最初のジャンプ後に replace all が元の選択範囲ではなく現在ヒットだけを対象にしてしまう

## Root Cause

1. 検索結果ジャンプは `pendingSearchJump` で panel 切替と selection 適用をまたいでいたが、write panel へ切り替わる前の状態や result button の focus と競合する設計だった。
2. 選択範囲限定 exact search は live editor selection をその都度読み直していたため、検索結果ジャンプで selection 自体を書き換えた後に scope が壊れた。
3. 追加した回帰テストは replace all / match case / later-hit jump までは見ていたが、`inSelection + replace all` の経路を固定していなかった。

## What We Changed

- `pendingSearchJump` は write panel への切替後に apply する
- jump 時の focus は DOM 直操作ではなく Toast UI の `editor.focus()` を使う
- exact search の selection scope は search 実行時に snapshot し、replace current / replace all では live selection ではなく snapshot を使う
- Playwright に `inSelection + replace all` の回帰を追加する

## Prevention

1. editor selection を意味論的な入力値として使う機能では、UI フォーカス移動後に live selection を再読しない。最初に snapshot し、その操作列の間は同じ scope を使う。
2. result navigation を伴う検索機能では、少なくとも次の 4 経路を focused regression に含める。
   - later-hit jump
   - replace all
   - match case or regexp option
   - in-selection replace all
3. 検索や置換のように UI 状態と editor state をまたぐ変更では、実装直後の最初の検証を「狭い E2E 1 本」にする。scroll / selection / panel visibility のどれが壊れているかを UI で確認してから広い build や packaging に進む。
4. visible label を追加した toggle / button は、aria-label だけでなく見える文字列も i18n に揃える。

## Release Gate For This Slice

この slice を commit / push する前に満たすべき確認:

- `npm run build`
- find and replace の focused Playwright
- changed files への ESLint
- Windows host packaging diff の更新