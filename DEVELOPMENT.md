# Development

セットアップ、ビルド、テスト、packaging の正本と、release の運用入口です。release 実務の詳細 runbook は [docs/release-workflow.md](docs/release-workflow.md) を参照してください。手順に密接な contributor 向け拡張ポイントもこのページに集約します。

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
```

`npm test` は必要な Chromium を確認してから、この suite を実行します。suite 自体は毎回 production build を作ってから preview server を起動し、その renderer に対して回帰確認を行います。

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
- `MDV_OPENAI_MODEL` は OpenAI model の初期値として使われ、`MDV_OPENAI_BASE_URL` は settings に base URL が無いときの fallback として使われます

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

canonical release artifact と、promote 対象になる full candidate には `artifact-metadata.json`、`installer/latest.yml`、`win-unpacked/resources/app-update.yml` を保持し、`npm run release:check:candidate` と `npm run release:check` が file 名、version metadata、updater manifest、updater config、`win-unpacked/resources/app.asar` の存在と整合を確認します。unpacked-only candidate は local validation 用なので、この metadata 契約の対象外です。

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
- 同じ source commit 系列を再 packaging しただけで tracked binary だけが更新された場合は、意図した配布ラインが変わらない限り version は据え置きにします。
- 外向けの binary release は、1 つの release commit、同じ version の annotated tag `vX.Y.Z`、その commit から生成した配布物を 1 組として扱います。
- tag だけを先に切ったり、既存 tag のまま配布物だけ差し替えたりしません。tag がない build は検証用または内部 packaging refresh であり、正式 release とは扱いません。
- `1.0.0` は、設定保存、ファイル入出力、AI tool contract など主要な互換性ルールを明示して守る段階に入るまで予約します。

リリースを切るときの手順:

1. `package.json` の `version` を bump する。
2. `npm run lint && npm run build` を通す。
3. `npm run win:host:generate:clean:noadmin` で candidate を生成する。
4. `npm run release:check:candidate` で candidate の file 名、metadata、latest.yml、app-update.yml、app.asar の存在と整合を確認する。
5. 必要なら `npm run win:host:deploy:candidate:noadmin` で Windows ローカルへ配置して確認する。
6. 問題なければ `npm run win:host:promote:noadmin` で canonical artifact を更新する。
7. [docs/release-notes-template.md](docs/release-notes-template.md) から `docs/release-notes/vX.Y.Z.md` を作る。
8. version bump、対応する Windows artifact、release notes を同じ release slice として commit する。
9. tag 作成直前は `npm run release:check` を通す。
10. その release commit を `secdat exec git push origin main` で `main` へ push したあと、同じ commit に annotated tag `vX.Y.Z` を作る。
11. 作成した tag を `secdat exec git push origin vX.Y.Z` で remote へ push する。
12. `npm run release:github -- --notes docs/release-notes/vX.Y.Z.md` で `release/.github-upload` にupload用ファイルをstageし、`secdat exec gh release create` の preview を確認する。
13. 問題なければ `npm run release:github -- --notes docs/release-notes/vX.Y.Z.md --execute` で `secdat exec gh` 経由で GitHub Release を publish する。
14. 配布する binary は必ずその tag が指す commit の生成物だけを使う。差し替えが必要なら patch か minor を上げて新しい tag を切る。

installer auto-update を GitHub Release asset で使う場合の feed URL は、通常 `https://github.com/<owner>/<repo>/releases/latest/download` を設定します。

通常の開発 commit やローカル確認用の packaging refresh は、配布対象として切り出さない限り version bump を必須にしません。詳細な判断理由は `docs/adr/0008-version-source-and-release-numbering.md` と `docs/release-workflow.md` を参照してください。

## CodeBlock 拡張

renderer registry は [src/App.tsx](src/App.tsx) にあります。言語名ごとに React コンポーネントを登録します。

```tsx
registry.set('mermaid', MermaidBlock)
```

同じ仕組みで `sql`, `plantuml`, `chart` などを追加できます。
