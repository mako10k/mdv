# MarkDownViewer

Windows で動作するシンプルな Markdown エディタです。Electron 上で動作し、WYSIWYG 編集、Markdown ソース編集、diff、patch、CodeBlock renderer 拡張を 1 つのアプリにまとめています。

## 特徴

- 最小 UI
- WYSIWYG / Markdown ソース切り替え
- diff 表示と unified patch 適用
- ドラッグアンドドロップでファイル読込
- Open / Save / Save As
- fenced code block の renderer 差し替え
- Windows 向け standalone 配布

## 画面構成

- Write: 編集画面
- Preview: Markdown プレビュー
- Diff: baseline と現在文書の差分、および patch 適用

上部ツールバーだけを残し、余白を削って編集領域を優先しています。

## 開発

前提:

- Node.js 22 系
- npm

起動:

```bash
npm install
npm run dev
```

AI chat の runtime 前提:

- OpenAI live chat は settings の OpenAI enabled が有効で、settings に保存した API key または `OPENAI_API_KEY` があるときに main process 経由で送信できます
- Tavily web search は settings の Tavily enabled が有効で、settings に保存した API key または `TAVILY_API_KEY` があるときに main process 経由で利用できます
- `fetch_url` は settings の fetch permission が有効で、fetch permissions window に保存した YAML ACL に従って main process で判定されます。ACL は origin / path ごとに method、header、forced header、pending を扱えます。pending に一致した場合は main process ダイアログで、許可して保存 / 拒否して保存 / 今回のみ実行 / 今回は実行しない、を選べます。大きいレスポンスを temp buffer へ退避した場合は auto-dispose が出力 lifecycle に適用されます
- `MDV_OPENAI_MODEL` は OpenAI model の初期値として使われ、`MDV_OPENAI_BASE_URL` は settings に base URL が無いときの fallback として使われます

ビルド:

```bash
npm run build
```

## Windows 配布

Linux / WSL での `electron-builder --win portable` や `electron-builder --win nsis` は Wine を要求します。確実に Windows 配布物を作る場合は、Windows ホスト側の Node.js で実行してください。

Windows ホスト build 補助スクリプト:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w ./scripts/build-win-host.ps1)"
```

`bash ./scripts/build-win-host.sh` 経由の host build は、packaged/unpacked を問わず UAC 昇格を要求します。PowerShell スクリプト直呼びと `noadmin` 系コマンドは昇格なしで実行します。Windows 側の一時ディレクトリへソースをコピーし、互換 Node.js を用意して native build します。成果物は `release/windows-host` へ戻します。
また、実行用コピーを Windows ローカルパス `%LOCALAPPDATA%\MarkDownViewer\latest` に配置します。`\\wsl.localhost\...` の UNC パスから直接 exe を起動しないでください。

Windows host build mode:

- `full`: 一時 workspace の作り直し、依存関係の再導入、成果物コピー先の作り直しを行う安全優先モード
- `diff`: 一時 workspace と依存関係を再利用し、stage 先へ差分同期したあと成功時だけ live 出力へ入れ替える高速化モード

`diff` は true binary patch ではありません。Electron / `app.asar` / `MarkDownViewer.exe` に対して部分パッチを当てるのではなく、Windows ホスト build の作業領域を再利用しつつ、出力は staged incremental sync のあと live ディレクトリへ swap するモードです。

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
npm run dist:win:host
```

既定の Windows host build は `win-unpacked` を作ったあと、その編集済み実行ファイルから portable と installer の両方を再パッケージします。

明示的に full rebuild する場合:

```bash
npm run dist:win:host:full
```

差分同期ベースの高速化モード:

```bash
npm run dist:win:host:diff
```

昇格なしで直接試す場合:

```bash
npm run dist:win:host:noadmin
```

昇格なしの明示モード:

```bash
npm run dist:win:host:noadmin:full
npm run dist:win:host:noadmin:diff
```

unpacked のみ欲しい場合:

```bash
npm run dist:win:host:unpacked
npm run dist:win:host:noadmin:unpacked
```

unpacked build:

```bash
npm run dist:win:dir
```

生成物:

- portable: `release/portable/*.exe`
- installer: `release/installer/*.exe`
- unpacked: `release/win-unpacked/MarkDownViewer.exe`
- Windows host portable: `release/windows-host/portable/*.exe`
- Windows host installer: `release/windows-host/installer/*.exe`
- Windows host recovered build: `release/windows-host/win-unpacked/MarkDownViewer.exe`
- local runnable copy: `%LOCALAPPDATA%\MarkDownViewer\latest\MarkDownViewer.exe`
- runtime log: `%APPDATA%\MarkDownViewer\logs\mdv.log`

注意:

- portable の単一 EXE 化は、Windows 側で symlink 展開権限が無いと `winCodeSign` 展開時に失敗することがあります。
- NSIS installer も Windows 側のパッケージング環境に依存するため、配布物が欠けるときはまず `release/windows-host/installer` の生成有無を確認してください。
- その場合でも `win-unpacked` は生成されるため、standalone アプリとしては利用できます。
- `\\wsl.localhost\...` の UNC パス上の exe は GPU subprocess 起動に失敗することがあるため、Windows ローカルへコピーされた exe を起動してください。
- Windows の packaged binary は 2 回目以降の起動で既存 process を再利用しつつ、新しい editor window を追加で開きます。
- 白画面や起動失敗のときは `%APPDATA%\MarkDownViewer\logs\mdv.log` を確認してください。
- `diff` は staged incremental sync なので、Node.js バージョン変更、依存関係崩れ、成果物不整合が疑わしいときは `full` を使ってください。

## ファイル操作

- Open: ファイル選択ダイアログから読込
- Save: 現在のパスに保存
- Save As: 保存先を選んで保存
- Drag and Drop: `.md` / `.markdown` / `.txt` を直接読込

## CodeBlock 拡張

renderer registry は [src/App.tsx](src/App.tsx) にあります。言語名ごとに React コンポーネントを登録します。

```tsx
registry.set('mermaid', MermaidBlock)
```

同じ仕組みで `sql`, `plantuml`, `chart` などを追加できます。

## 設計メモ

- [docs/ai-chat-design.md](docs/ai-chat-design.md): AI チャット window、tool bridge、OpenAI 連携の設計
- [docs/ai-chat-task-breakdown.md](docs/ai-chat-task-breakdown.md): AI チャット実装タスクの分解と着手順
- [docs/settings-design.md](docs/settings-design.md): 設定画面、設定保存、秘密情報の扱いの設計

## 主要ファイル

- [src/App.tsx](src/App.tsx): UI、本体ロジック、renderer registry
- [electron/main.cjs](electron/main.cjs): Electron メインプロセス、ファイルダイアログ、保存処理
- [electron/preload.cjs](electron/preload.cjs): renderer へ公開する desktop API
- [server/mdv-server.cjs](server/mdv-server.cjs): MDV-Server。multi-window 母艦、client suspend/resume、server handoff の入口
- [build/icon.ico](build/icon.ico): Windows アプリ用アイコン

## MDV-Server

最近の定石として、更新対象プロセス自身に「自分を書き換えてそのまま生き続ける」責務を持たせるより、更新対象の前段に supervisor を置き、side-by-side copy と handoff で切り替えるほうが安全です。MDV-Server はその前提で追加しています。

今回の初期実装で入っているもの:

- 複数 client window/process の registry
- client の state snapshot 保存
- client update 向け suspend / resume command queue
- resume 要求時に停止済み client を再起動し、再接続後に state を復元
- server script 自身の copy 生成
- copy へ handoff する failover 基盤
- 更新済み script へ戻す failback 入口

起動:

```bash
npm run server:start
```

主な API:

- `GET /health`
- `GET /api/status`
- `POST /api/windows/open`
- `POST /api/updates/client/suspend`
- `POST /api/updates/client/resume`
- `POST /api/server/update/prepare-copy`
- `POST /api/server/update/failover`
- `POST /api/server/update/failback`

client を server 配下で起動する場合は、server が child process 起動時に `MDV_SERVER_URL`, `MDV_CLIENT_ID`, `MDV_WINDOW_ID`, `MDV_ALLOW_MULTI_INSTANCE=1` を設定します。client 側はこれを検知して register/poll し、suspend 時に編集中状態を保存して終了し、resume 時に状態を復元します。

`GET /api/status` の `clientUpdate` には、更新中フェーズに加えて `targetClientIds`、`completedClientIds`、`lastSuspendedClientIds` が含まれます。これで suspend / resume の進捗と、次回 resume の再起動対象を server 側から追跡できます。

補足:

- Electron の標準 `autoUpdater` は配布形式依存で、Windows でも Squirrel/MSIX の前提や制約があります。
- Windows の Restart Manager も更新中の graceful shutdown には有効ですが、アプリ本体の自己置換を単独で安全化するものではありません。
- そのため、このリポジトリでは外部 supervisor での handoff を先に採用しています。
