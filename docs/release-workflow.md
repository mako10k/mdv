# Release Workflow

## Scope

この文書は、MDV の外向け binary release を切るときの詳細 runbook である。日常的な運用入口と要約手順は [../DEVELOPMENT.md](../DEVELOPMENT.md) を正本とし、この文書は release 実務の詳細、preview / publish の差分、内部 packaging refresh の扱いを補足する。

今回の現行方針では、`release/windows-host` の heavy artifact は local canonical cache であり、git 正本ではない。既存 clone を履歴書き換え後に修復する必要がある場合は [git-history-rewrite-recovery.md](git-history-rewrite-recovery.md) を参照する。

内部 packaging refresh と正式 release を混ぜないことを目的にする。

## Invariants

- 外向け release は 1 つの release commit、1 つの annotated tag `vX.Y.Z`、その commit から生成して GitHub Release へ publish する配布物の 1 組で扱う
- tag を先に切らない
- 既存 tag のまま binary だけ差し替えない
- 配布する Windows artifact は release commit と同じ source から生成した version 一致成果物だけを使う
- `release/windows-host` と、promote 対象になる full candidate の `release/windows-host-candidate` では local workspace 上に `artifact-metadata.json`、`installer/latest.yml`、`win-unpacked/resources/app-update.yml` を保持し、artifact file 名、updater manifest、updater config、`win-unpacked/resources/app.asar` の存在と整合を version と一緒に検証する
- Windows packaging の candidate 生成、local deploy、canonical release artifact 更新は別操作として扱う
- `release/windows-host` 配下の heavy artifact は local canonical cache であり、git 正本ではない

## Public Release Checklist

以下の `npm run ...:noadmin` は WSL / bash から Windows host を呼ぶ alias である。native Windows PowerShell では同じ action を `.\scripts\build-win-host.ps1 ...` で実行する。

1. `package.json` の `version` を bump する
2. `npm run lint && npm run build` を通す
3. `docs/release-work-memos/vX.Y.Z.md` を [release-work-memo-template.md](release-work-memo-template.md) から作成し、この release の作業メモ正本にする
4. MD-BL-005 / MD-BL-023 を同じ release で一緒に出す間は、まず `npm run build && npx playwright test tests/e2e/app-layout.spec.ts -g "WYSIWYG resolves saved relative images to actual image sources|preview resolves saved relative images to actual image sources|WYSIWYG resolves draft-workspace relative images for unsaved documents"` を通し、saved file / preview / draft workspace の browser 回帰を renderer 側 release gate として確認する。現時点では次リリースがこの条件に該当し、追加 gate を外す判定は [current-backlog.md](current-backlog.md) の P1 Editor Comfort からこの bundle の次リリース最小範囲が外れた時点を正本とする
5. 同じ release では、手順 2 の build 後に `npm start` などで起動した Electron 実行面を使って次の smoke を手動確認する
	- paste 画像が first save 後も見えたまま編集継続できる
	- saved relative image が preview と HTML export の両方で見える
	- broken / unresolved image が fallback 表示になる
	- editor 上で orphaned asset が状態として判別できる
	この 4 項目はすべて必須確認とする。この bundle の合格観点は「見える」「保存後も切れない」「壊れたら分かる」の 3 つで、手順 4 が「見える」、手順 5 の first save / export が「保存後も切れない」、手順 5 の fallback / orphaned asset 確認が「壊れたら分かる」に対応する。ADR 0020 に従い、`assets/` フォルダ生成や asset materialization 自体は release 合格条件に含めない。drag and drop は Windows shell 側の source metadata 差分を受けやすいため、この manual gate では画像登録手段の合否判定に使わない。手動 smoke の結果は `docs/release-work-memos/vX.Y.Z.md` に残し、最低でも command 名、確認した画面や出力断面、生成された export または配置先 path、失敗がなかったことを判別できる短い結果メモを含める。release notes には user-facing 要約だけを書く
6. `npm run win:host:generate:clean:noadmin` で candidate artifact を生成する
7. `npm run release:check:candidate` で candidate artifact の version metadata、updater manifest、updater config、必須成果物を確認する
8. model registry ベースの model picker を含む release line では、`npm run win:host:deploy:candidate:noadmin` で candidate の `win-unpacked` を Windows ローカルへ配置し、その配置物を対象に model registry preflight を実施する
9. MD-BL-005 / MD-BL-023 を同じ release で一緒に出す間は、`npm run win:host:deploy:candidate:noadmin` で candidate の `win-unpacked` を Windows ローカルへ配置し、手順 5 の 4 項目を packaged candidate でも再確認する。これは packaging や配置経路でだけ起きる画像 path 切れを拾うための再確認である。deploy が access denied で latest を更新できない場合は、MarkDownViewer 本体と `%LOCALAPPDATA%\MarkDownViewer\latest` 配下を開いている Explorer を閉じてから同じ deploy をやり直し、UNC 上の exe は起動に使わない
10. 手順 5 と 9 の saved relative image / broken fallback 確認は、次の固定 fixture を使う
	- [docs/assets/manual-smoke/saved-preview-image.md](docs/assets/manual-smoke/saved-preview-image.md) を開き、preview に緑の SVG が見えることを確認する
	- 同じ file を HTML export し、出力 HTML でも同じ SVG が見えることを確認する
	- [docs/assets/manual-smoke/missing-preview-image.md](docs/assets/manual-smoke/missing-preview-image.md) を開き、preview に Missing image: assets/missing-diagram.svg の fallback が出ることを確認する
	- first save continuity は新規 unsaved document で clipboard paste を使って確認し、drag and drop はこの gate の再現手順から外す
10. 上記以外でも Windows ローカル検証が必要なら `npm run win:host:deploy:candidate:noadmin` で candidate の `win-unpacked` を配置して確認する
11. 問題なければ `npm run win:host:promote:noadmin` で candidate artifact を `release/windows-host` に昇格する
12. release notes を [release-notes-template.md](release-notes-template.md) から `docs/release-notes/vX.Y.Z.md` として作成する
13. version bump と release notes と release work memo と、必要なら `release/windows-host/artifact-metadata.json` と `release/windows-host/installer/latest.yml` のような軽量 metadata だけを同じ release commit として commit する。`release/windows-host` の binary 本体は commit しない
14. `npm run release:check` を実行し、version 一致 artifact と clean worktree を確認する
	clean worktree は git status 基準であり、ignored な local heavy artifact cache は dirty 扱いしない
15. `secdat exec git push origin main` で `main` へ push する
16. `git tag -a vX.Y.Z -m "Release vX.Y.Z"` を release commit に作成する
17. `secdat exec git push origin vX.Y.Z` を実行する
18. `npm run release:github -- --notes docs/release-notes/vX.Y.Z.md` で `secdat exec gh release create` の dry-run command を確認する
19. 問題なければ `npm run release:github -- --notes docs/release-notes/vX.Y.Z.md --execute` を実行する

model registry preflight の観点例:

- settings UI の選択肢が registry 正本と一致している
- default として表示される model が意図した release 既定値になっている
- UI 表示している価格 metadata が registry と一致している
- deprecated / unavailable 扱いの model が通常選択肢に残っていない
- registry 非掲載の legacy model 値が warning と migration 導線付きで扱われる
- `get_app_metadata` が settings UI と同じ registry facts を返す

first slice ではこの確認は手動でよいが、確認に使った画面、`get_app_metadata` の取得結果、または出力断面を release 作業メモへ残す。

settings UI と `get_app_metadata` が食い違った場合は、main process の model registry 正本を基準に差分原因を解消してから release を進める。

## Internal Packaging Refresh

次は正式 release ではない。

- local validation のための build
- recovery 用の artifact refresh
- 同じ version のままの内部 packaging rerun

これらは tag を切らず、GitHub Release も作らない。
canonical path の `release/windows-host` を直接更新せず、candidate 生成か既存 artifact の local deploy に分離する。

## Commands

release check:

```bash
npm run release:check
```

candidate artifact check (promote 対象の full candidate 用):

```bash
npm run release:check:candidate
```

candidate artifact generate:

```bash
npm run win:host:generate:clean:noadmin
```

candidate artifact generate (native Windows PowerShell):

```powershell
.\scripts\build-win-host.ps1 -Action generate -Clean
```

candidate local deploy:

```bash
npm run win:host:deploy:candidate:noadmin
```

candidate local deploy (native Windows PowerShell):

```powershell
.\scripts\build-win-host.ps1 -Action deploy -ArtifactSource candidate
```

canonical artifact promote:

```bash
npm run win:host:promote:noadmin
```

canonical artifact promote (native Windows PowerShell):

```powershell
.\scripts\build-win-host.ps1 -Action promote
```

GitHub Release command preview. This stages ignored upload files under `release/.github-upload` and prints a runnable command routed through `secdat exec gh`:

```bash
npm run release:github -- --notes docs/release-notes/vX.Y.Z.md
```

GitHub Release actual publish. This executes `secdat exec gh ...`:

```bash
npm run release:github -- --notes docs/release-notes/vX.Y.Z.md --execute
```

installer auto-update feed URL の既定例:

```text
https://github.com/<owner>/<repo>/releases/latest/download
```

この URL 配下に公開される `latest.yml` と installer asset を electron-updater が参照する。

## Repository Policy

- `release/windows-host` は local validation と GitHub Release publish のための canonical cache として使うが、heavy artifact は git に commit しない
- current clone で `release/windows-host` に binary が残っていても、それは local generated state として扱う
- release artifact を配布・再取得したい場合は GitHub Release asset を正本とする
- `npm run release:check` の clean worktree は git status 基準であり、ignored な local heavy artifact cache は dirty 扱いしない
