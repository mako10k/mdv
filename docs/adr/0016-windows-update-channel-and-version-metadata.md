# 0016 Windows Update Channel And Version Metadata

- Status: Accepted

## Context

MDV は package.json version を正本とする version rule をすでに持っている。この ADR の対象は、Windows では installer を自動更新経路にし、portable は manual update のままにすること、そしてその案内に使う version metadata と release artifact 契約を共通化することである。今回の実装では updater runtime まで含めて整えた。具体的には次を同時に満たしたい。

- help/about、settings、AI metadata/introspection で同じ version facts を返すこと
- candidate と canonical release artifact の version 追従を script で厳密に確認できること
- できれば one-click の自動 update を Windows 向けに実現すること

一方で、現行の Windows 配布は installer と portable の 2 系統を維持している。portable 配布は展開先や実行場所が利用者依存で、実行中自己置換や rollback を含む自動 update との相性が悪い。対して NSIS installer 系は GitHub Release と blockmap を使った差分 update へ載せやすい。

## Decision

- 自動 update の主経路は installer ベースの Windows 配布に限定して設計する。
- updater 実装は electron-updater を第一候補とし、publish source は GitHub Release を前提に進める。
- portable 配布は継続するが、自動自己更新の対象にはしない。portable は manual update とし、updater runtime も有効化しない。
- package.json version を引き続き唯一の正本とする。
- main process は shared app metadata surface を持ち、renderer の help/about・settings と AI metadata tool はそこから同じ version facts を読む。
- Windows artifact には canonical release と、promote 対象になる full candidate で artifact-metadata.json と installer/latest.yml を保持し、release validation は artifact file 名、updater manifest、metadata の一致、および app.asar の存在を確認する。
- updater runtime は main process に置き、Windows installer build だけで起動時 check、download、restart-install を扱う。

## Consequences

- one-click auto update は installer ユーザーを主対象に設計され、portable の制約を無理に共通化しない。
- help/about、settings、AI metadata で version drift が起きにくくなる。
- release check は「ファイルがある」だけではなく、artifact metadata、latest.yml、app archive の存在と整合まで確認できる。
- updater feed は GitHub Release asset を前提にし、stable な `releases/latest/download` URL と `latest.yml` を使って更新先を解決する。
- portable には installer と同じ自動更新体験は提供されないため、その差は help/about と release note で明示する必要がある。
