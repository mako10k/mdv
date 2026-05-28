# 0004 Windows Dual Package Targets

- Status: Accepted

## Context

Windows 配布はこれまで portable と win-unpacked を中心に扱っていたが、installer 形式も必要になった。既存の Windows host build は `win-unpacked` を生成してローカル runnable copy を更新する流れで安定しており、ここを崩さずに配布物だけ増やす必要がある。

一方で、portable と installer を同じ output directory と同じ artifact name で連続生成すると成果物が衝突しやすい。さらに noadmin 環境では `signAndEditExecutable=false` と post-build の `rcedit` に依存しているため、host build では編集済みの `win-unpacked` を基準に再パッケージしたい。

## Decision

- Windows 配布は portable と NSIS installer の両方を正式サポートする。
- 直ビルドの output は `release/portable` と `release/installer` に分離し、artifact 名衝突を避ける。
- 既定の Windows host build は最初に `win-unpacked` を作成して `rcedit` を適用し、その prepackaged app から portable と installer を追加生成する。
- 既存の unpacked-only 運用も残すため、host build には `PackageTargets none` 相当の明示スクリプトを用意する。

## Consequences

- 配布チャンネルが増え、portable 利用者と installer 利用者の両方をサポートできる。
- README と build scripts は出力先が増える前提で管理する必要がある。
- host build の時間は少し伸びるが、local runnable copy の安定経路は維持される。