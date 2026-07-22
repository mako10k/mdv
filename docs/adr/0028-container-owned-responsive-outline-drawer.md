# 0028 Container-Owned Responsive Outline Drawer

## Status

Accepted

## Context

現行outlineはwindow幅1100px以下でeditorの上へ積まれ、981–1100pxでは高さ上限もない。これは本文の幅不足を本文の高さ不足へ移す。さらにviewport幅は、side-by-sideのAI dockが幅を使った後のdocument workspace幅を表さないため、windowが広くても本文列だけが狭い状態を判定できない。

Current contractは [Responsive Outline Design](../responsive-outline-design.md) に定義する。この判断は [ADR 0009](0009-ui-information-architecture-reset.md) のworkspace-first方針を具体化し、supersedeはしない。

## Decision

- outline modeはAI dock割当後、outline/editor分割前の `.workspace-main-column` content box inline sizeで判定し、rendererの`ResizeObserver`を単一authorityとする。
- 900px超では現行persistent side paneを維持する。900px以下ではoutlineをlayout flowから外し、write modeのaccessible icon triggerからtransient overlay drawerとして開く。
- compact drawerはnon-modal navigation disclosureとし、backgroundをinert化せず、dialog semantics、focus trap、pointer-blocking backdropを使用しない。
- drawer stateは永続化せず、breakpoint crossing、preview切替、modal openで明示的に正規化する。trigger、close、Escape、outside pointer、heading jumpとfocus returnの契約を共通stateで管理する。
- persistent paneとdrawerは既存heading extraction、active tracking、scroll-follow、jump経路を共有し、preview outlineや新しいsettings / IPCを追加しない。

## Consequences

- AI dockやwindow resizeでdocument列の実幅が変わると、同じ900px境界でoutline modeも追従する。
- compact closedでは本文幅と高さをoutlineが消費しない一方、open中はdrawerが本文の一部を一時的に覆う。
- rendererはlayout mode、transient open state、responsive遷移時focusを明示的に持ち、hidden overlayやremoved DOMにfocusを残さない必要がある。
- browser testsは899 / 900 / 901px、AI dock resize、open / close / view transition、accessibilityを固定し、Electron integrationはreal window resizeとheading jumpを確認する。
