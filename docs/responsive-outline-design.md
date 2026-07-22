# Responsive Outline Design

- Status: Accepted
- Contract state: `active_contract`
- Backlog item: `MD-BL-026`
- Accepted date: 2026-07-22

## Purpose

この文書は、MDV editor window の outline を、本文領域を優先しながら狭幅でも利用できるようにする current contract を定義する。対象は outline の layout mode、open / close state、breakpoint ownership、keyboard / focus、既存 heading jump / active tracking、AI dock との幅競合である。

[ADR 0009](adr/0009-ui-information-architecture-reset.md) の workspace-first 方針を維持し、responsive outline の判断は [ADR 0028](adr/0028-container-owned-responsive-outline-drawer.md) に記録する。

## Product Outcome

- document workspace に十分な幅があるときは、現行の persistent side outline を維持する。
- 幅が不足するときは outline を本文の layout flow から外し、明示的な icon trigger から一時的な drawer として開く。
- drawer を閉じた状態では outline が本文の幅も高さも消費せず、不可視の overlay や hit target を残さない。
- drawer を開いた状態でも active heading、heading jump、outline scroll-follow を維持する。
- preview mode に outline や outline trigger を新設しない。

## Controlling Width Contract

outline mode は browser viewport 幅ではなく、`.workspace-main-column` の content box inline size で決める。この値は AI dock への幅割当後、outline と editor を分割する前の document workspace 幅である。

- `inlineSize > 900px`: `wide`
- `inlineSize <= 900px`: `compact`
- 初回測定前: `unresolved`

900px は、240px outline、10px gap、左右16–20pxの panel padding を差し引いても、wide mode の editor に約630pxを残す境界である。outline 自体を表示・非表示にしても観測対象の main column 幅は変わらないため、mode 切替による breakpoint 振動を起こさない。

renderer は `ResizeObserver` で main column の content box を観測し、この判定を outline layout state の単一 authority とする。outline だけを viewport media query で切り替えたり、CSS と TypeScript に別々の breakpoint を持たせたりしない。AI dock の open / close / resize と window resize は同じ観測結果を通る。

`unresolved` は compact closed と同じ安全側の描画とし、persistent outline や drawer を表示しない。最初の layout measurement 後に `wide` または `compact` へ解決し、狭い初期windowで stacked outline が一瞬表示される状態を作らない。

## Layout Modes

| Mode | Outline | Trigger | Document layout |
| --- | --- | --- | --- |
| `wide` + write | 240px basis、220–272px bounds の persistent side pane | 非表示 | outline + editor の横並び |
| `compact` + write + closed | `hidden` な drawer | Workspace actions 内に表示、`aria-expanded=false` | editor が main column の利用可能幅と高さを使う |
| `compact` + write + open | main column 内の non-modal overlay drawer | 表示、`aria-expanded=true` | editor の bounding box を変更しない |
| preview | 表示しない | 表示しない | 現行 preview-only layout |
| `unresolved` | 表示しない | 表示しない | document-only の安全側 layout |

compact drawer は `.workspace-main-column` 内へ配置し、AI dock や topbar の別 layout contract を変更しない。drawer の inline size は `min(320px, calc(100% - 24px))` とし、極端な狭幅でも main column 内に収め、外側に最低24pxを残す。header と close button は drawer の scroll領域外に固定し、見出しlistだけをscrollさせる。

closed drawer は opacity や off-screen positioning だけで隠さず、`hidden` により layout、accessibility tree、pointer hit testing、tab order から外す。open drawer は global modal、change-proposal dialog、search dialog より下の local layer とする。

## Open State And Transitions

drawer open state は renderer-local transient state とし、settings、local storage、document metadataへ永続化しない。

- `wide -> compact`: compact closed へ正規化する。persistent outline 内にfocusがあった場合だけ、新しく表示されたtriggerへfocusを移す。document側のfocusは維持する。
- `compact closed -> open`: trigger操作で開く。
- `compact open -> closed`: trigger再押下、close button、Escape、またはdrawerとtrigger外のpointer操作で閉じる。
- `compact -> wide`: open stateを破棄し、persistent paneへ正規化する。heading itemのfocusは同じ論理itemで維持する。compact専用close buttonにfocusがあった場合はactive heading、先頭heading、editorの順でfocus先を選ぶ。
- writeからpreviewへ切り替える場合はdrawerを閉じ、triggerとoutlineを表示しない。writeへ戻ったcompact modeはclosedから始める。
- application modalを開く場合はdrawerを閉じてからmodal側のfocus contractへ移る。

outside pointer handler はdrawerとtriggerを除外し、元のpointer event、default action、outside targetへのfocusを妨げずにdrawerだけを閉じる。trigger操作はoutside handlerと二重toggleしない。

## Accessibility And Focus

compact outline は modal dialog ではなく、non-modal navigation disclosure とする。

- trigger はbuttonとしてaccessible nameを持ち、`aria-expanded` と `aria-controls` でdrawerを示す。
- drawer はlabel付きnavigation regionとし、`role=dialog`、`aria-modal`、background `inert`、focus trap、pointer-blocking backdropを使用しない。
- open時のfocusは、active heading、先頭の有効なheading、close buttonの順で選ぶ。
- Escape、close button、trigger再押下で閉じた場合はtriggerへfocusを戻す。
- outside pointerで閉じた場合はclicked targetのfocusを優先し、triggerへ強制的に戻さない。
- headingをpointerまたはkeyboardで選択した場合は既存jumpを実行してdrawerを閉じ、移動先editor headingへfocusを送る。
- `aria-current=location`、disabled placeholder semantics、active itemのoutline内scroll-followを維持する。closed中もactive line stateは更新し、再open時に現在itemをfocus・scrollできるようにする。

## Existing Outline Contract

- heading extraction、label、depth、placeholder、active heading計算は再実装しない。
- persistent pane と compact drawer は同じ `visibleHeadingOutline`、`activeOutlineIndex`、heading button rendering、`jumpToOutlineHeading` を使用する。
- drawer openをeffect dependencyに含め、closed中にactive indexが変わらなくてもopen直後にactive itemをscroll範囲へ入れる。
- heading選択後のsource span selectionとeditor focusは既存pending jump経路を使う。
- outline typography / density、editor typography、AI typographyのsettings contractは変更しない。

## Alternatives Considered

| Alternative | Root-cause proximity | Strength / verification | Side effects / residual risk | Decision |
| --- | --- | --- | --- | --- |
| 現行のvertical stackを継続 | 低い。幅不足を高さ消費へ移すだけ | 既存CSSのままだが981–1100px帯の本文高さを保証できない | 長いoutlineが本文を押し下げる | 不採用 |
| viewport固定breakpointでcollapse | 中程度 | resize testは容易 | AI dockがdocument列を縮めてもwindow幅が広いと反応しない | 不採用 |
| persistent icon rail | 中程度 | stateは単純 | 狭幅で常に幅を消費し、navigation chromeが増える | 不採用 |
| floating popover | 中程度 | 小さなoutlineには適する | 長いoutlineのscroll領域とclose操作が不安定になりやすい | 不採用 |
| main-column幅でtransient drawer | 高い。利用可能な本文幅を直接観測する | 899 / 900 / 901px、AI dock resize、state transitionを固定できる | open中は本文を一時的に覆い、focus stateが増える | 採用 |

## Validation Contract

### Browser Renderer

- 899 / 900 / 901px相当の main-column幅でcompact / wide境界を固定する。
- wideではpersistent paneと約630px以上のeditor幅、compact closedではoutlineが幅・高さを消費しないことを確認する。
- compact open前後でeditor panelのbounding boxが変わらず、drawerがmain column bounds内に収まり、close buttonが常に到達可能であることを確認する。
- triggerのname / `aria-expanded` / `aria-controls`、drawer navigation label、initial focus、Escape / close / trigger / outside pointer、focus returnを確認する。
- active heading、jump後のeditor focus、open直後のscroll-follow、empty outlineを確認する。
- wide / compact crossing、open中のcrossing、preview切替、modal open、AI dock open / close / resizeを確認する。
- 760px editor-only、981–1100px帯、editor + AI dockで本文の実用領域とoverlay cleanupを確認する。

### Electron Integration

- BrowserWindow resizeとAI dock操作で同じmain-column判定が使われ、focusがremoved / hidden outline DOMへ残らないことを確認する。
- 既存のreal Electron active-heading follow regressionを維持し、compact drawerを経由したheading jumpを追加する。

## Implementation Slice

- main-column `ResizeObserver` と `unresolved` / `wide` / `compact` state
- transient drawer open stateとtransition / focus coordinator
- Workspace actionsのoutline trigger、drawer header / close button、共有outline rendering
- current stacked outline media ruleの除去またはoutline-specific無効化
- responsive / accessibility browser testsとtargeted Electron regression

新しいsettings、preload / IPC、preview outline、outline extraction、AI dock全体の再設計はこのsliceに含めない。
