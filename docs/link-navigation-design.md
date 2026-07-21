# Link Navigation Design

この文書は、MDV の editor window で rendered Markdown link を activation するときの navigation contract を定義する。

## Decision State

- `contract_state: active_contract`
- 対象は normal editor window の preview と WYSIWYG surface で user が明示的に activation した link である。
- 背景 decision は [ADR 0025](adr/0025-main-owned-document-navigation-and-link-activation.md) に記録する。

## App Document Identity

- Editor、Settings、Fetch Permissions、About の各 BrowserWindow は、それぞれ main process が読み込んだ app entry document を保持する。
- Main process は app entry と同一 document の fragment 変更を除き、top-level navigation を deny-by-default にする。
- Renderer content からの new-window request も deny-by-default にし、desktop capability は preload IPC からだけ実行する。
- `did-finish-load` 後の launch / open-file dispatch は、現在の URL がその window の expected app entry と一致するときだけ行う。load failure や navigation drift 後の document を editor renderer とみなさない。

## Rendered Link Activation

- Renderer は raw `href` を保持したまま既定 navigation を止め、`open-document-link` preload IPC へ渡す。DOM が app entry 基準で展開した `anchor.href` を local path の正本にしない。
- Main process は送信元 BrowserWindow の tracked current-file state を基準に target を分類する。Renderer から基準 path を自己申告させない。
- `http:` / `https:` は既存 external-link permission policy と確認 dialog を通し、許可された場合だけ default browser で開く。
- Relative local path は保存済み source document の親 directory を基準に解決する。保存先を持たない document では relative local path を block する。
- Native absolute path と `file:` URL は source document の有無にかかわらず local candidate として解決する。
- `file:` の render-time exception は anchor link にだけ適用する。Markdown image や raw HTML の subresource を `file:` から自動 load する権限には拡張しない。production renderer は packaged application assets 配下だけを直接 load でき、そこから外れた local file request は Electron の request boundary で拒否する。user-controlled local file access は user activation 後の main-owned flow に限定する。
- Local candidate は normalize 後に存在する regular file であることを main process で確認する。directory、missing path、invalid encoding、unsupported scheme は BrowserWindow を遷移させず block result を返す。
- Local file は新しい editor window で preview として開く。同じ normalized path を既存 editor が追跡中なら新規 window を作らず、その window を focus する。
- Same-document `#fragment` は renderer-owned navigation とし、local-file IPC へ送らない。別 document の fragment は first slice では file open のみを行い、cross-document heading jump は行わない。

## Result Contract

Preload result は少なくとも次を区別する。

- `opened`: default browser または新しい MDV editor window で開いた
- `focused`: 同じ local file を開いている既存 editor を focus した
- `cancelled`: external-link confirmation を user が取り消した
- `blocked`: policy、invalid target、missing file、unsupported runtime のため開かなかった

Renderer は result に対応する status を表示するが、status 表示を navigation safety の防御境界にはしない。

## Allowed Scope

- preview / WYSIWYG の user-activated link
- HTTP(S) の既存 permission flow と default browser open
- relative / absolute / `file:` local regular-file link の MDV open と existing-window focus
- main-owned top-level navigation / new-window denial
- invalid / missing target の fail-closed status

## Blocked Scope

- `mailto:`、custom protocol、OS application deep link の起動
- directory browser、workspace tree、recent-file list の追加
- cross-document heading fragment jump
- managed-client supervisor の window topology 変更
- local link target の write、repair、copy、または Markdown rewrite

## Validation Contract

- Link activation 後も source editor window の URL は expected app entry のままである。
- Relative、native absolute、`file:`、missing、HTTP(S)、same-document fragment を target-kind 別に回帰固定する。
- `target=_blank`、scripted navigation、new-window request から app entry 外へ遷移できないことを main-process test で固定する。
- Markdown image、WYSIWYG image、raw HTML subresource が packaged application assets 外の `file:` target を自動 load できないことを Electron integration test で固定する。
- Local file open は new window と existing-window focus dedupe の両方を Electron integration test で固定する。
- Link activation 後の close path で `get-close-state` timeout を発生させない。
