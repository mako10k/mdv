# 0007 mdast Submodule And Adapter

Status: Accepted

## Context

MDV から Markdown 構造操作を導入したいが、mdast-control はまだ同時改修しながら育てる前提がある。npm publish を都度挟む形だと、MDV と mdast-control の契約変更を同じターンで試しにくい。

一方で、MDV は renderer / preload / main process の境界が明確なので、submodule をそのまま各層へ直接露出すると依存点が散って保守しづらくなる。

## Decision

- mdast-control は `vendor/mdast-control` に git submodule として取り込む。
- MDV からの連携入口は `electron/mdast-adapter.cjs` に限定する。
- adapter の source of truth は `src/electron/mdast-adapter.cts` に置き、`electron/mdast-adapter.cjs` は生成済み runtime への thin CommonJS wrapper とする。
- 初期連携は library API を main process から dynamic import して使う。
- LSP は後段で sidecar process として追加できるように、library integration と設計上分離する。
- packaged build では submodule の `dist` だけを同梱し、runtime dependency は MDV ルートの `node_modules` で解決する。

## Consequences

- MDV と mdast-control を同時改修しやすくなる。
- mdast-control API の変更点は adapter に集約できる。
- adapter 本体は TypeScript で型検査でき、Electron 側の CommonJS は起動と require 境界へ薄く寄せられる。
- submodule の初期化と build が開発前提になるため、README と package scripts の整備が必要になる。
- 将来 LSP 統合へ進んでも renderer 依存点を増やさずに済む。