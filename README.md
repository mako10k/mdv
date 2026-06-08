# MarkDownViewer

Windows で動作する Markdown ワークスペースです。Electron 上で動作し、文書編集、レンダリングプレビュー、見出しアウトライン、assistant dock、設定管理、HTML export を 1 つのアプリにまとめています。

## 特徴

- Markdown 編集とレンダリングプレビュー
- 見出しアウトラインとエディタ内検索
- assistant dock と editor context 添付
- ドラッグアンドドロップでファイル読込
- 新規文書、Open / Save / Save As / Print / HTML Export
- fenced code block の renderer 差し替え
- Windows 向け standalone 配布

## 画面構成

- Editor window: 見出しアウトライン、エディタ、プレビュー、assistant dock をまとめた主画面
- Assistant dock: editor context を添付して assistant とやり取りする統合面
- Settings window: theme、locale、AI provider、安全設定を管理する補助画面
- Fetch permissions window: guarded fetch の ACL と timeout を管理する補助画面

現行 UI の棚卸しと、後方互換なしの再設計案は [docs/ui-reset-and-html-safety-review.md](docs/ui-reset-and-html-safety-review.md) を参照してください。

## はじめて使うとき

セットアップ、起動、ビルド、E2E 回帰確認、AI runtime 前提、Windows packaging の正本と、release の運用入口は [DEVELOPMENT.md](DEVELOPMENT.md) にまとめています。release 実務の詳細 runbook は [docs/release-workflow.md](docs/release-workflow.md) を参照してください。すでに古い clone を持っていて履歴書き換え後の修復が必要な場合だけ [docs/git-history-rewrite-recovery.md](docs/git-history-rewrite-recovery.md) を参照してください。

初回セットアップ後に参照することが多い設計・補足資料は、この README の後半から辿れます。AI customization は、まず [docs/ai-customization-layering-design.md](docs/ai-customization-layering-design.md) で使い分けを見てください。境界を固定した理由が必要なときだけ [docs/adr/0017-ai-customization-layer-boundaries.md](docs/adr/0017-ai-customization-layer-boundaries.md) を見れば足ります。

正式な 6 層モデルと置き場所の判断は [docs/ai-customization-layering-design.md](docs/ai-customization-layering-design.md) を参照してください。実装状況や今後の追加予定は [docs/current-backlog.md](docs/current-backlog.md) を参照してください。

現時点で MDV 本体トップレベルにある主な入口は 5 つです。repo-wide rule は [AGENTS.md](AGENTS.md)、Codex custom agent は [.codex/agents](.codex/agents)、Codex skill は [.agents/skills](.agents/skills)、Copilot 互換の prompt file は [.github/prompts](.github/prompts)、Copilot 互換の custom agent は [.github/agents](.github/agents) です。MDV 本体トップレベルの file-scoped instructions と hooks はまだ未配置です。

## もっと知る

- [DEVELOPMENT.md](DEVELOPMENT.md): セットアップ、起動、ビルド、E2E、Windows packaging、release の運用入口
- [docs/ai-chat-design.md](docs/ai-chat-design.md): assistant dock、tool bridge、OpenAI 連携の設計
- [docs/ai-customization-layering-design.md](docs/ai-customization-layering-design.md): どの customization をどこに置くかを説明する explainer
- [docs/adr/0017-ai-customization-layer-boundaries.md](docs/adr/0017-ai-customization-layer-boundaries.md): customization layer 境界の決定記録
- [docs/current-backlog.md](docs/current-backlog.md): 現在の正本バックログと実装順
- [docs/ai-chat-task-breakdown.md](docs/ai-chat-task-breakdown.md): AI チャット初期分解の履歴資料
- [docs/settings-design.md](docs/settings-design.md): 設定画面、設定保存、秘密情報の扱いの設計
- [docs/ui-reset-and-html-safety-review.md](docs/ui-reset-and-html-safety-review.md): HTML 安全性の実装監査と UI 全体の再設計案
- [docs/adr/0009-ui-information-architecture-reset.md](docs/adr/0009-ui-information-architecture-reset.md): UI 情報設計リセット方針の決定

## 主要ファイル

- [src/App.tsx](src/App.tsx): UI、本体ロジック、renderer registry
- [electron/main.cjs](electron/main.cjs): Electron の起動入口。compiled main を読む薄い wrapper
- [src/electron/main.cts](src/electron/main.cts): Electron メインプロセス実装を読む入口。controller 初期化と依存配線を持つ
- [electron/mdast-adapter.cjs](electron/mdast-adapter.cjs): mdast submodule を main process から読む adapter
- [electron/preload.cjs](electron/preload.cjs): renderer へ公開する desktop API
- [server/mdv-server.cjs](server/mdv-server.cjs): MDV-Server。multi-window 母艦、client suspend/resume、server handoff の入口
- [build/icon.ico](build/icon.ico): Windows アプリ用アイコン
- [vendor/mdast-control](vendor/mdast-control): mdast-control submodule

## mdast 連携

MDV は [vendor/mdast-control](vendor/mdast-control) を git submodule として保持します。現時点の前提は次のとおりです。

- 連携の入口は main process 側の adapter に限定する
- 構造操作は library API を先に使う
- LSP は後段で sidecar process として追加できるように分離する
- packaged build では `vendor/mdast-control/dist` を同梱し、依存 package は MDV ルートの `node_modules` で解決する

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
