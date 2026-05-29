# mdast Integration Design

## 目的

MDV から mdast-control を無理なく取り込み、必要であれば同時に mdast-control 側も改修できる開発フローを作る。

## 採用方針

- `vendor/mdast-control` を git submodule として保持する
- 連携の入口は `electron/mdast-adapter.cjs` に限定する
- 最初は library API を main process から direct import する
- LSP は live symbol / diagnostics が必要になったタイミングで sidecar process として追加する

## レイヤ構成

### Layer 1: mdast submodule

- 配置先: `vendor/mdast-control`
- ソース管理: upstream は独立 repo、MDV は submodule SHA を pin する

### Layer 2: main-process adapter

- ファイル: `electron/mdast-adapter.cjs`
- 役割:
  - submodule dist の存在確認
  - CommonJS から ESM dist への dynamic import
  - MDV 向けの操作単位へ薄く整形
  - 将来 LSP mode と library mode を切り替える窓口

### Layer 3: renderer integration

- renderer は submodule を直接 import しない
- renderer は preload/main の IPC 経由で構造情報と変換結果だけを受け取る

## まず使う対象

- heading outline
- heading jump のための query
- query based insert / replace / delete / move
- table plugin capability check

## 後から追加する対象

- LSP document symbols
- fenced `mdast-query` diagnostics
- plugin introspection UI
- live structure-aware editing

## 依存解決方針

- packaged app では `vendor/mdast-control/dist/**/*` を同梱する
- mdast runtime dependency は MDV ルートの `package.json` にも持たせる
- submodule の `node_modules` を packaged app に含める前提にはしない

## 開発フロー

1. `git submodule update --init --recursive vendor/mdast-control`
2. `npm run mdast:install`
3. `npm run mdast:build`
4. `npm run dev:with-mdast` または `npm run build`

mdast-control 側で改修が必要な場合は submodule 内で修正し、必要に応じて MDV 側 adapter も同じターンで更新する。

## 境界ルール

- renderer から submodule の API を直接呼ばない
- mdast の生 API を複数箇所へばら撒かない
- main process の保存競合・file watch・window lifecycle は既存境界を維持する
- mdast が返す Markdown 全文は、MDV 側の既存 save / dirty / conflict 制御を通して適用する