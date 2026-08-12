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
- `release/windows-host` と、promote 対象になる full candidate の `release/windows-host-candidate` では local workspace 上に `artifact-metadata.json`、`installer/latest.yml`、`win-unpacked/resources/app-update.yml` を保持し、artifact file 名、generation ID、release build input fingerprint、updater manifest / config、`app.asar` 内の exact renderer entry を version と一緒に検証する
- candidate generation は開始時に以前の candidate を無効化する。失敗・中断時は candidate 不在を正しい fail-closed state とし、古い同-version artifact を検証・deploy・promote に再利用しない
- Windows packaging の candidate 生成、local deploy、canonical release artifact 更新は別操作として扱う
- `release/windows-host` 配下の heavy artifact は local canonical cache であり、git 正本ではない

## Two-Checkpoint Review Contract

Release に dependency resolution、生成 bundle / vendored code、cross-process contract、Windows packaging / distribution の変更を含む場合は、最終 review だけに判断を集中させず、次の 2 checkpoint を分離する。

1. Early contract review
	- smallest buildable implementation と targeted evidence が揃った時点で、broad regression と Windows candidate 生成より前に実施する
	- `npm run codex:validate` の `Early contract review` routing を使い、actual runtime / generated artifact の実行経路、config / lockfile / audit evidence の証明範囲、反証確認、fail-closed regression を確認する
	- committed WIP を再開する場合は `npm run codex:validate -- --phase early --base <base-ref> --head <reviewed-ref>` で比較範囲を固定する。未コミット変更を対象にする場合は通常の staged diff / full worktree routing を使う
	- source representation と shipped representation が異なる場合、package metadata の一致だけを合格根拠にしない
	- consistency-review を基本とし、packaging / distribution 経路を含む場合は packaging-review を加える。重要な RCA や workflow 判断を同時に確定する場合は plain-eye-review も加える
	- blocker は actual contract mismatch、primary evidence の false / missing、または必要な fail-closed targeted check の欠落に限る。candidate、broad regression、release docs、exact-diff polish がまだ作られていないこと自体は early finding にしない
	- initial pass は 1 回、blocker 修正後の confirmation は最大 1 回で閉じる。non-blocking improvement は final review または backlog へ送る
	- release work memo に base / head または staged target、targeted evidence、verdict を記録する。review 済みの dependency、runtime / build wiring、cross-process contract、packaging-path file が変わった場合だけ pass を無効化する
2. Final exact-diff review
	- candidate evidence と release docs が揃った後、commit 対象の exact diff に対して AGENTS.md の consistency / plain-eye / packaging review を実施する
	- early contract review はこの最終 review の代替ではなく、最終 review も early checkpoint まで遅らせてよい理由にはならない
	- final review は candidate evidence、release docs、artifact metadata、commit exact diff の統合を主対象とする。early pass 済みの実行経路は、対象 file の変更または新しい反証 evidence が無い限り、探索を最初から繰り返さない

明示的な WIP closeout は release gate 完了指示ではない。WIP で終了するよう指示された場合は、進行中の重い処理を止め、不合格・未実施 gate と再開点を記録し、mandatory な commit review と WIP commit / push だけで閉じる。非重大 finding の改善、追加検証、candidate 生成、公開作業を続けない。

## Public Release Checklist

以下の `npm run ...:noadmin` は WSL / bash から Windows host を呼ぶ alias である。native Windows PowerShell では同じ action を `.\scripts\build-win-host.ps1 ...` で実行する。

1. `package.json` の `version` を bump する
2. dependency / generated runtime / cross-process / packaging contract を変更する release では、smallest buildable diff で上記 Early contract review を通す。version metadata だけの変更では不要
3. `npm run lint && npm run build` を通す
4. `docs/release-work-memos/vX.Y.Z.md` を [release-work-memo-template.md](release-work-memo-template.md) から作成し、この release の作業メモ正本にする
5. Markdown insert command surface を変更した release では、まず `npm run build && npx playwright test tests/e2e/app-layout.spec.ts -g "markdown insert commands"` を通し、Markdown insert command の browser 回帰を renderer 側 release gate として確認する。特に WYSIWYG で保持できない Markdown 専用構文が source mode へ戻り、正規 Markdown として残ることを確認する
6. 画像 continuity や fallback を変更した release では、手順 3 の build 後に `npm start` などで起動した Electron 実行面を使って次の smoke を手動確認する
	- paste 画像が first save 後も見えたまま編集継続できる
	- saved relative image が preview と HTML export の両方で見える
	- broken / unresolved image が fallback 表示になる
	- editor 上で未解決画像状態が silent ではなく判別できる
	この bundle の合格観点は「見える」「保存後も切れない」「壊れたら分かる」の 3 つで、first save / export が「保存後も切れない」、fallback / unresolved image visibility が「壊れたら分かる」に対応する。`broken image fallback` と `unresolved image visibility` は別 fixture を要求するものではなく、通常は missing-image fallback が表示される同じ確認結果を、fallback 表示そのものと未解決状態の可視性の両面で記録する。[docs/image-storage-design.md](image-storage-design.md) に従い、`assets/` フォルダ生成や asset materialization 自体は release 合格条件に含めない。drag and drop は Windows shell 側の source metadata 差分を受けやすいため、この manual gate では画像登録手段の合否判定に使わない。手動 smoke の結果は `docs/release-work-memos/vX.Y.Z.md` に残し、最低でも command 名、確認した画面や出力断面、生成された export または配置先 path、失敗がなかったことを判別できる短い結果メモを含める。release notes には user-facing 要約だけを書く
7. `npm run win:host:generate:clean:noadmin` で candidate artifact を生成する
8. `npm run release:check:candidate` で candidate artifact の source fingerprint / generation ID、version metadata、updater manifest / config、必須成果物、`app.asar` の exact renderer entry を確認する
9. model registry ベースの model picker を含む release line では、`npm run win:host:deploy:candidate:noadmin` で candidate の `win-unpacked` を Windows ローカルへ配置し、その配置物を対象に model registry preflight を実施する
10. 画像 continuity や fallback を変更した release では、`npm run win:host:deploy:candidate:noadmin` で candidate の `win-unpacked` を Windows ローカルへ配置し、手順 6 の画像 smoke を packaged candidate でも再確認する。これは packaging や配置経路でだけ起きる画像切れを拾うための再確認である。deploy が access denied で latest を更新できない場合は、MarkDownViewer 本体と `%LOCALAPPDATA%\MarkDownViewer\latest` 配下を開いている Explorer を閉じてから同じ deploy をやり直し、UNC 上の exe は起動に使わない
11. 画像 smoke を実施する場合、手順 6 と 10 の saved relative image / broken fallback 確認は、次の固定 fixture を使う
	- [docs/assets/manual-smoke/saved-preview-image.md](assets/manual-smoke/saved-preview-image.md) を開き、preview に緑の SVG が見えることを確認する
	- 同じ file を HTML export し、出力 HTML でも同じ SVG が見えることを確認する
	- [docs/assets/manual-smoke/missing-preview-image.md](assets/manual-smoke/missing-preview-image.md) を開き、preview に Missing image: assets/missing-diagram.svg の fallback が出ることを確認する
	- first save continuity は新規 unsaved document で clipboard paste を使って確認し、drag and drop はこの gate の再現手順から外す
12. 上記以外でも Windows ローカル検証が必要なら `npm run win:host:deploy:candidate:noadmin` で candidate の `win-unpacked` を配置して確認する
13. 問題なければ `npm run win:host:promote:noadmin` で candidate artifact を `release/windows-host` に昇格する
14. release notes を [release-notes-template.md](release-notes-template.md) から `docs/release-notes/vX.Y.Z.md` として作成する
15. version bump と release notes と release work memo と、必要なら `release/windows-host/artifact-metadata.json` と `release/windows-host/installer/latest.yml` のような軽量 metadata だけを同じ release commit として commit する。`release/windows-host` の binary 本体は commit しない
16. `npm run release:check` を実行し、version 一致 artifact と clean worktree を確認する
	clean worktree は git status 基準であり、ignored な local heavy artifact cache は dirty 扱いしない
17. `secdat exec git push origin main` で `main` へ push する
18. `git tag -a vX.Y.Z -m "Release vX.Y.Z"` を release commit に作成する
19. `secdat exec git push origin vX.Y.Z` を実行する
20. `npm run release:github -- --notes docs/release-notes/vX.Y.Z.md` で `secdat exec gh release create` の dry-run command を確認する
21. 問題なければ `npm run release:github -- --notes docs/release-notes/vX.Y.Z.md --execute` を実行する

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

この check は current source fingerprint と candidate metadata を照合し、packaged `dist/index.html` と `dist/mermaid-viewer.html` が参照する各 renderer entry に exact DOMPurify implementation が1つだけ存在し、legacy implementation が無いことも fail-closed で確認する。`promote` も同じ check を内部で実行する。

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
