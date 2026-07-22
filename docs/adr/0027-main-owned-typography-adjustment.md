# 0027 Main-Owned Typography Adjustment

## Status

Accepted

## Context

MDV の editor / chat font size は main-owned settings に保存される一方、既存 shortcut は renderer が読み取った絶対値を generic settings patch として送る。`Ctrl/Cmd + wheel` を同じ方式で追加すると、高頻度 input と複数 window の更新が stale な絶対値や並行 file write を生む。Electron page zoom を使うと document typography と app chrome / responsive layout が結合する。

Current contract は [Typography Interaction Design](../typography-interaction-design.md) と [Settings Screen Design](../settings-design.md) に定義する。この ADR は [ADR 0001](0001-settings-store-and-secret-boundary.md) の main-owned settings 方針を拡張し、supersede はしない。

## Decision

- keyboard は focus、wheel は pointer location から typography target を解決し、resolver 自体は共有しない。解決後の typed adjustment dispatch だけを共有する。
- document editor / preview は既存 `editor.fontSizePx`、AI transcript / composer は既存 `ai.chatFontSizePx` を変更する。Electron page zoom、新しい zoom setting、document-local zoom は導入しない。
- renderer は absolute settings patch ではなく、target と `delta` / `reset` を持つ dedicated discriminated command を preload 経由で送る。
- main process は typography command、generic settings update、legacy theme migration、pending fetch prompt からの ACL rule 保存を含む全 non-secret settings mutation を一つの queue で直列化し、実行時点の正本値へ変更を適用してから persist / broadcast する。
- primary-modifier wheel の browser default は editor window で抑止し、eligible text surface だけが 1px step を生成する。通常 wheel scroll と app chrome は変更しない。

## Consequences

- 複数 window と Settings の更新は main-owned ordering に従い、renderer の古い絶対値による lost update を避けられる。
- preload、main IPC、renderer coordinator、`src/shims.d.ts`、main / browser / Electron tests を同じ implementation slice で同期する必要がある。
- main の settings mutation ordering は typography 以外の generic update にも適用され、並行 persist の挙動が明示的になる。
- wheel gesture は document の読みやすさだけを変更し、toolbar、dialog、outline、responsive breakpoint の寸法は変えない。
