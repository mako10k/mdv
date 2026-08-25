# Development

セットアップ、ビルド、テスト、packaging の正本と、release の運用入口です。release 実務の詳細 runbook は [docs/release-workflow.md](docs/release-workflow.md) を参照してください。手順に密接な contributor 向け拡張ポイントもこのページに集約します。AI customization は、まず [docs/ai-customization-layering-design.md](docs/ai-customization-layering-design.md) で使い分けを見てください。境界を固定した理由が必要なときだけ [docs/adr/0017-ai-customization-layer-boundaries.md](docs/adr/0017-ai-customization-layer-boundaries.md) を参照してください。

正式な 6 層モデルと置き場所の判断は [docs/ai-customization-layering-design.md](docs/ai-customization-layering-design.md) を参照してください。実装状況や今後の追加予定は [docs/current-backlog.md](docs/current-backlog.md) を参照してください。

現時点で MDV 本体トップレベルにある主な入口は 5 つです。repo-wide rule は [AGENTS.md](AGENTS.md)、Codex custom agent は [.codex/agents](.codex/agents)、Codex skill は [.agents/skills](.agents/skills)、Copilot 互換の prompt file は [.github/prompts](.github/prompts)、Copilot 互換の custom agent は [.github/agents](.github/agents) です。MDV 本体トップレベルの file-scoped instructions と hooks はまだ未配置です。

Plugin 開発はまだ runtime/SDK 未実装です。MDV maintainer と将来の bundled-package developer 向け contract preview は [docs/plugin-developer-guide.md](docs/plugin-developer-guide.md)、internal Developer Kit と Public SDK の段階契約は [docs/plugin-developer-kit-design.md](docs/plugin-developer-kit-design.md) を参照してください。現時点では Plugin の install、validate、run command は提供していません。

## 前提

- Node.js 22 系
- npm

## セットアップ

```bash
git submodule update --init --recursive vendor/mdast-control
npm install
```

`npm install` は submodule 未初期化でも完了しますが、`npm run mdast:build`、`npm run build`、Windows packaging は `vendor/mdast-control` 初期化済みが前提です。

`npm install` はあわせて TypeScript source から `electron/lib` の CommonJS runtime を再生成します。`src/electron/**/*.cts` を直接編集した場合は `npm run electron:build` を再実行してください。

`npm run electron:build` と `npm run electron:watch` は `tsc -b --force` を使います。`electron/lib` の生成物を消した直後や build info が残っている状態でも、CommonJS runtime を確実に再生成するためです。

submodule だけ後から入れた場合:

```bash
npm run mdast:install
```

## 起動

```bash
npm install
npm run mdast:build
npm run dev
```

初回起動前に `vendor/mdast-control/dist` と `electron/lib` が生成済みである前提です。

mdast も同時に watch しながら起動する場合:

```bash
npm run dev:with-mdast
```

## ビルド

```bash
npm run build
```

## 日常確認

```bash
npm run codex:map
npm run codex:validate
npm run lint
npm run build
```

`codex:map` は Codex / agent が作業開始時に読む入口、変更中の area、関連 docs、検証候補、review gate を 1 回で表示します。`codex:validate` は staged diff があればその subset、無ければ full worktree を基準に、最小の検証候補と commit 前 review gate を表示します。partial commit を切るときは、意図した subset を stage してから `npm run codex:validate` を実行してください。

dependency resolution、生成 bundle、cross-process contract、Windows packaging / distribution を変更する場合、`codex:validate` は broad regression や Windows candidate 生成より前に実施する early contract review も表示します。ここでは actual runtime / generated artifact の実行経路と evidence の限界を先に確認し、最終 exact-diff review は別 gate として維持します。詳細は [docs/release-workflow.md](docs/release-workflow.md) を参照してください。

commit 済み WIP の範囲を early review する場合は比較対象を明示します。

```bash
npm run codex:validate -- --phase early --base <base-ref> --head <reviewed-ref>
```

GitHub へアクセスする `git` / `gh` は `secdat` 経由で token を注入します。Codex sandbox で unlock session が見えない場合は `ptyterm` 経由で実行します。詳細と `secdat` / `ptyterm` の導入方法は [docs/codex-secure-github-access.md](docs/codex-secure-github-access.md) を参照してください。

## E2E 回帰テスト

```bash
npm test

# 既に browser を導入済みならこちらでも可
npm run test:e2e:install
npm run test:e2e

# Electron 統合面を直接見る
npm run test:e2e:electron

# release workflow の node test
npm run test:release

# Markdown insert command surface (MD-BL-004) の browser 回帰だけを見る
npm run build && npx playwright test tests/e2e/app-layout.spec.ts -g "markdown insert commands"

# 画像体験 bundle (MD-BL-005 / MD-BL-023) 変更時の browser 回帰だけを見る
npm run build && npx playwright test tests/e2e/app-layout.spec.ts -g "WYSIWYG resolves saved relative images to actual image sources|preview resolves saved relative images to actual image sources|WYSIWYG resolves draft-workspace relative images for unsaved documents"
```

`npm test` は必要な Chromium を確認してから、この suite を実行します。suite 自体は毎回 production build を作ってから preview server を起動し、その renderer に対して回帰確認を行います。

MD-BL-004 の first slice は完了済みです。Markdown insert command surface を変更する release line では、上の `markdown insert commands` targeted browser 回帰を renderer 側の release gate の最低線として扱います。特に WYSIWYG で保持できない Markdown 専用構文は source mode へ戻して正規 Markdown として挿入されることを確認してください。MD-BL-005 / MD-BL-023 の画像体験 bundle は v0.1.14 で first release slice 完了済みです。画像 continuity や fallback を変更した場合は、画像体験 bundle の targeted browser 回帰と Electron 実行面の first save / HTML export / broken image fallback / unresolved image visibility smoke を再確認してください。

ブラウザを開いて確認したいとき:

```bash
npm run test:e2e:headed
```

## mdast 単体確認

```bash
npm run electron:build
npm run mdast:check
npm run mdast:build
```

## AI chat / tool runtime 前提

- OpenAI live chat は settings の OpenAI enabled が有効で、settings に保存した API key または `OPENAI_API_KEY` があるときに main process 経由で送信できます
- Tavily web search は settings の Tavily enabled が有効で、settings に保存した API key または `TAVILY_API_KEY` があるときに main process 経由で利用できます
- `fetch_url` は settings の fetch permission が有効で、fetch permissions window に保存した YAML ACL に従って main process で判定されます。ACL は origin / path ごとに method、header、forced header、pending を扱えます。pending に一致した場合は main process ダイアログで、許可して保存 / 拒否して保存 / 今回のみ実行 / 今回は実行しない、を選べます。大きいレスポンスを temp buffer へ退避した場合は auto-dispose が出力 lifecycle に適用されます
- `MDV_OPENAI_MODEL` は settings 未設定時の bootstrap 用 fallback として使われます。model registry 導入後は registry 既知の modelId だけを受け付け、未知値は warning 扱いになります。`MDV_OPENAI_BASE_URL` は settings に base URL が無いときの fallback として使われます

## Windows 配布 / host build

Linux / WSL での `electron-builder --win portable` や `electron-builder --win nsis` は Wine を要求します。確実に Windows 配布物を作る場合は、Windows ホスト側の Node.js で実行してください。

Windows ホスト build 補助スクリプト:

WSL / bash から Windows ホスト PowerShell を呼ぶ場合:

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w ./scripts/build-win-host.ps1)"
```

ネイティブ Windows PowerShell から直接呼ぶ場合:

```powershell
.\scripts\build-win-host.ps1 -Action generate
```

`bash ./scripts/build-win-host.sh` 経由の host build は、packaged/unpacked を問わず UAC 昇格を要求します。PowerShell スクリプト直呼びと `noadmin` 系コマンドは昇格なしで実行します。Windows 側の一時ディレクトリへソースをコピーし、互換 Node.js を用意して native build します。`npm run win:host:*:noadmin` は WSL / bash から `powershell.exe` を呼ぶ入口なので、ネイティブ Windows シェルでは直接 `.ps1` を実行してください。

Windows host workflow は後方互換なしで次の 3 段階に分離しています。

- `generate`: 現在の source から candidate artifact を `release/windows-host-candidate` へ生成する。canonical release artifact は触らない。
- `deploy`: 指定した artifact source の `win-unpacked` を `%LOCALAPPDATA%\MarkDownViewer\latest` へ配置する。既存 canonical artifact をそのまま配る用途を含む。
- `promote`: candidate artifact を `release/windows-host` へ昇格する。canonical release artifact を更新できるのはこの操作だけ。

canonical release artifact と、promote 対象になる full candidate には `artifact-metadata.json`、`installer/latest.yml`、`win-unpacked/resources/app-update.yml` を保持します。`artifact-metadata.json` は generation ID と release build input の SHA-256 fingerprint を含み、`npm run release:check:candidate` と `npm run release:check` は current source fingerprint、file 名、version metadata、updater manifest / config に加えて、`app.asar` の `dist/index.html` と `dist/mermaid-viewer.html` が選ぶ各 renderer entry の sanitizer contract まで確認します。unpacked-only candidate は local validation 用なので、この metadata 契約の対象外です。

`generate` は開始時に既存 candidate を無効化します。失敗または中断後に同じ version の古い candidate を再利用せず、full generate をやり直してください。`promote` は内部で full candidate check を実行するため、stale source fingerprint や packaged renderer check failure がある candidate は canonical cache へ昇格できません。

`\\wsl.localhost\...` の UNC パスから直接 exe を起動しないでください。

Windows host actions:

- `generate`: candidate artifact を生成する
- `deploy`: candidate または canonical artifact から local runnable copy を更新する
- `promote`: candidate artifact を canonical release artifact に昇格する

`generate` は build 作業領域を再利用します。依存関係や temp workspace を作り直したいときは `generate:clean` を使います。

Portable build:

```bash
npm run dist:win:portable
```

Installer build:

```bash
npm run dist:win:installer
```

Portable + installer build:

```bash
npm run dist:win
```

Windows host build from WSL:

```bash
npm run win:host:generate
```

既定の Windows host generate は `win-unpacked` を作ったあと、その編集済み実行ファイルから portable と installer の両方を再パッケージし、candidate artifact として保持します。

安全側に temp workspace を作り直す場合:

```bash
npm run win:host:generate:clean
```

candidate を Windows ローカルへ配置して動作確認する場合:

```bash
npm run win:host:deploy:candidate
```

`generate:unpacked` 系で作った candidate は local validation 用です。`promote` は portable、installer、blockmap、win-unpacked がそろった candidate だけを受け付けます。

既存の canonical release artifact を Windows ローカルへ配置する場合:

```bash
npm run win:host:deploy
```

candidate を canonical release artifact に昇格する場合:

```bash
npm run win:host:promote
```

unpacked のみ欲しい場合:

```bash
npm run win:host:generate:unpacked
npm run win:host:generate:unpacked:noadmin
```

ネイティブ Windows PowerShell で unpacked のみ生成する場合:

```powershell
.\scripts\build-win-host.ps1 -Action generate -PackageTargets none
```

昇格なしの明示モード (WSL / bash から呼ぶ alias):

```bash
npm run win:host:generate:noadmin
npm run win:host:generate:clean:noadmin
npm run win:host:deploy:noadmin
npm run win:host:deploy:candidate:noadmin
npm run win:host:promote:noadmin
```

同等の操作をネイティブ Windows PowerShell から行う場合:

```powershell
.\scripts\build-win-host.ps1 -Action generate
.\scripts\build-win-host.ps1 -Action generate -Clean
.\scripts\build-win-host.ps1 -Action deploy -ArtifactSource release
.\scripts\build-win-host.ps1 -Action deploy -ArtifactSource candidate
.\scripts\build-win-host.ps1 -Action promote
```

unpacked build:

```bash
npm run dist:win:dir
```

生成物:

- portable: `release/portable/*.exe`
- installer: `release/installer/*.exe`
- unpacked: `release/win-unpacked/MarkDownViewer.exe`
- Windows host candidate portable: `release/windows-host-candidate/portable/*.exe`
- Windows host candidate installer: `release/windows-host-candidate/installer/*.exe`
- Windows host candidate unpacked: `release/windows-host-candidate/win-unpacked/MarkDownViewer.exe`
- Windows host canonical portable: `release/windows-host/portable/*.exe`
- Windows host canonical installer: `release/windows-host/installer/*.exe`
- Windows host canonical unpacked: `release/windows-host/win-unpacked/MarkDownViewer.exe`
- local runnable copy: `%LOCALAPPDATA%\MarkDownViewer\latest\MarkDownViewer.exe`
- runtime log: `%APPDATA%\MarkDownViewer\logs\mdv.log`

注意:

- portable の単一 EXE 化は、Windows 側で symlink 展開権限が無いと `winCodeSign` 展開時に失敗することがあります。
- NSIS installer も Windows 側のパッケージング環境に依存するため、配布物が欠けるときはまず `release/windows-host-candidate/installer` の生成有無を確認してください。
- その場合でも `win-unpacked` は生成されるため、standalone アプリとしては利用できます。
- `\\wsl.localhost\...` の UNC パス上の exe は GPU subprocess 起動に失敗することがあるため、Windows ローカルへコピーされた exe を起動してください。
- Windows の packaged binary は 2 回目以降の起動で既存 process を再利用しつつ、新しい editor window を追加で開きます。
- 白画面や起動失敗のときは `%APPDATA%\MarkDownViewer\logs\mdv.log` を確認してください。
- `generate:clean` は temp workspace と依存関係を作り直すので、Node.js バージョン変更、依存関係崩れ、成果物不整合が疑わしいときに使ってください。

## バージョン管理

- 正規のアプリバージョンは `package.json` の `version` だけを使います。Windows 配布物や実行ファイル名はここから派生させ、別管理のバージョン番号は持ちません。
- バージョニングは SemVer ベースですが、`1.0.0` までは `0.y.z` を使います。
- `0.y.0` は user-visible な機能追加、大きな UX 変更、互換性に影響しうる挙動変更、永続 workflow や契約変更に使います。
- `0.y.z` の patch はバグ修正、UI 調整、配布物再生成、packaging/runtime 修正など、同じ feature line の中で閉じる変更に使います。
- 同じ source commit 系列を再 packaging しただけで release artifact だけが更新された場合は、意図した配布ラインが変わらない限り version は据え置きにします。
- 外向けの binary release は、1 つの release commit、同じ version の annotated tag `vX.Y.Z`、その commit から生成した配布物を 1 組として扱います。
- tag だけを先に切ったり、既存 tag のまま配布物だけ差し替えたりしません。tag がない build は検証用または内部 packaging refresh であり、正式 release とは扱いません。
- `1.0.0` は、設定保存、ファイル入出力、AI tool contract など主要な互換性ルールを明示して守る段階に入るまで予約します。

リリースを切るときの手順:

1. `package.json` の `version` を bump する。
2. `npm run lint && npm run build` を通す。
3. `docs/release-work-memos/vX.Y.Z.md` を [docs/release-work-memo-template.md](docs/release-work-memo-template.md) から作り、この release の作業メモ正本にする。
4. Markdown insert command surface を変更した release では、`npm run build && npx playwright test tests/e2e/app-layout.spec.ts -g "markdown insert commands"` を通し、Markdown insert command の renderer 側 gate を確認する。
5. 画像 continuity や fallback を変更した release では、手順 2 の build 後に `npm start` などで起動した Electron 実行面で、first save / HTML export / broken image fallback / unresolved image visibility を手動 smoke する。必要な確認結果は `docs/release-work-memos/vX.Y.Z.md` に残す。release notes にはその user-facing 要約だけを反映する。
6. `npm run win:host:generate:clean:noadmin` で candidate を生成する。
7. `npm run release:check:candidate` で candidate の source fingerprint / generation ID、file 名、metadata、latest.yml、app-update.yml、app.asar の exact renderer entry を確認する。
8. model registry ベースの model picker を含む release line では、`npm run win:host:deploy:candidate:noadmin` で配置した candidate を対象に、[docs/release-workflow.md](docs/release-workflow.md) の model registry preflight を実施する。
9. 画像 continuity や fallback を変更した release では、`npm run win:host:deploy:candidate:noadmin` で candidate を Windows ローカルへ配置し、手順 5 の画像 smoke を packaged candidate でも再確認する。これは packaging や配置経路でだけ起きる画像切れを拾うためである。
10. 上記以外でも必要なら `npm run win:host:deploy:candidate:noadmin` で Windows ローカルへ配置して確認する。
11. 問題なければ `npm run win:host:promote:noadmin` で canonical artifact を更新する。
12. [docs/release-notes-template.md](docs/release-notes-template.md) から `docs/release-notes/vX.Y.Z.md` を作る。
13. version bump、release notes、release work memo、必要なら `release/windows-host/artifact-metadata.json` と `release/windows-host/installer/latest.yml` のような軽量 metadata 更新だけを同じ release slice として commit する。Windows binary 本体は git に commit しない。
14. tag 作成直前は `npm run release:check` を通す。
	ignored な `release/windows-host` binary cache は clean worktree 判定を汚さない。
15. その release commit を `secdat exec git push origin main` で `main` へ push したあと、同じ commit に annotated tag `vX.Y.Z` を作る。
16. 作成した tag を `secdat exec git push origin vX.Y.Z` で remote へ push する。
17. `npm run release:github -- --notes docs/release-notes/vX.Y.Z.md` で `release/.github-upload` にupload用ファイルをstageし、`secdat exec gh release create` の preview を確認する。
18. 問題なければ `npm run release:github -- --notes docs/release-notes/vX.Y.Z.md --execute` で `secdat exec gh` 経由で GitHub Release を publish する。
19. 配布する binary は必ずその tag が指す commit からローカル生成した成果物だけを使う。差し替えが必要なら patch か minor を上げて新しい tag を切る。

installer auto-update を GitHub Release asset で使う場合の feed URL は、通常 `https://github.com/<owner>/<repo>/releases/latest/download` を設定します。

通常の開発 commit やローカル確認用の packaging refresh は、配布対象として切り出さない限り version bump を必須にしません。詳細な判断理由は `docs/adr/0018-untracked-windows-release-artifacts-and-history-rewrite.md` と `docs/release-workflow.md` を参照してください。履歴書き換え後の既存 clone 修復が必要な場合は `docs/git-history-rewrite-recovery.md` を参照してください。

## CodeBlock 拡張

renderer registry は [src/App.tsx](src/App.tsx) にあります。言語名ごとに React コンポーネントを登録します。

```tsx
registry.set('mermaid', MermaidBlock)
```

同じ仕組みで `sql`, `plantuml`, `chart` などを追加できます。
