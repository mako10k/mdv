# 0025 Main-Owned Document Navigation And Link Activation

## Status

Accepted

## Context

Rendered Markdown の relative link が renderer の HTTP(S) 専用 click hook を通らず、editor BrowserWindow 自身の navigation として処理された。Packaged Windows では document base が開いている Markdown の directory ではなく `app.asar/dist` であるため、存在しない app resource へ遷移し、MDV renderer が失われた。その後も main process は同じ webContents を editor とみなし、open-file dispatch、close-state request、existing-window focus を続けたため、UI と IPC が応答できない実質的な hang になった。

Current contract は [Link Navigation Design](../link-navigation-design.md) に定義する。

## Decision

- App BrowserWindow の top-level document identity は main process が所有し、expected app entry 外への navigation と renderer-originated new-window request を deny-by-default にする。
- Renderer の click helper を唯一の navigation safety boundary にしない。Rendered link は raw `href` を preload IPC へ渡す明示 activation として扱う。
- Main process は送信元 editor の tracked file identity を使って local target を解決し、HTTP(S) external activation と local-file activation を別の責務として実行する。
- External HTTP(S) は既存 permission policy を維持し、local regular file は MDV の新しい editor windowで開く。同じ file が既に開かれていれば focus する。
- Launch / open-file dispatch は expected app entry document にだけ送り、load error document や navigation drift 後の webContents を editor renderer とみなさない。
- Renderer の `file:` request は Electron request boundary で packaged application assets 配下だけを許可する。Markdown image、WYSIWYG image、raw HTML が user-controlled local file を直接 load することを許可しない。

## Consequences

- Relative link は Markdown source file の directory を基準に解決でき、absolute / `file:` local link も MDV で開ける。
- BrowserWindow の既定 navigation に依存しないため、missing link や unsupported scheme でも app renderer を失わない。
- Preload、IPC、renderer result type、window-controller navigation guard を同期して変更する必要がある。
- Same-document fragment は renderer 内 navigation に残るが、cross-document fragment jump、custom protocol、managed-client window topology は別の受理済み scope を必要とする。
