# MD-BL-026 Responsive Outline Implementation

- Date: 2026-07-22
- PERT task: `IMPLEMENT_OUTLINE`
- Result: renderer implemented; product integration blocked
- Validation status: partial pass; blocked ([evidence](update-outline-validation.md))
- Release readiness: `OUTLINE_RELEASE_READY` not reached
- Remaining validation: packaged editor window minimumのcontract整合と実screen reader
- Governing contract: [Responsive Outline Design](../responsive-outline-design.md)
- Decision record: [ADR 0028](../adr/0028-container-owned-responsive-outline-drawer.md)

## Delivered Behavior

- 狭幅ではoutlineを閉じたときに本文の幅・高さを消費せず、必要なときだけ一時的に本文上へ開く。十分な幅がある場合は従来のpersistent outlineを維持する。
- `.workspace-main-column` の content box inline size を単一の `ResizeObserver` で観測し、900px超を `wide`、900px以下を `compact`、初回観測前を `unresolved` として扱う。
- `wide` は既存の220–272px persistent outlineを維持し、`compact` はWorkspace actionsのicon triggerから `hidden` なnon-modal navigation drawerを開く。旧1100px / 980px media queryによるoutline縦積みは除去した。
- drawerはeditor layout flowから外れ、外形を最大320px、main column右側の残りを24px以上とする。header / close buttonをlist scroll領域外へ置いた。
- persistent paneとdrawerは同じheading data、active item、placeholder、jump、scroll-follow描画を共有する。previewにはoutline / triggerを表示しない。
- trigger、close、Escape、outside pointer、heading jump、preview / modal遷移、wide / compact跨ぎのclose・focus移送をrenderer-local stateとして実装した。drawerはdialog、focus trap、backdrop、background inertを使用しない。

## Implementation Evidence

- Renderer / layout: `src/App.tsx`, `src/App.css`
- Accessible labels: `src/shared/i18n.ts`
- Browser regression: `tests/e2e/app-layout.spec.ts`
- Electron real-window regression: `tests/e2e-electron/outline-follow.spec.ts`

## Automated Verification

- `npm run lint`: pass
- `npm run build`: pass（renderer security bundle checkを含む。既存のlarge chunk warningのみ）
- browser Playwright: 79 passed
- Electron Playwright: 51 passed（real BrowserWindow resize、compact drawer、heading jump、editor focus、wide復帰を含む）

## Remaining Validation Boundary

`IMPLEMENT_OUTLINE` のrenderer sliceは完了したが、[packaged validation](update-outline-validation.md) でmain processが所有する `BrowserWindow` の `minWidth: 1200` がwindow resize単独のcompact到達を妨げることが判明した。keyboard-only、長いoutline、AI dock resize、Chromium accessibility treeは合格したが、product integrationと`OUTLINE_RELEASE_READY`は未完了である。次は `RECONCILE_OUTLINE_WINDOW_CONTRACT` でwindow minimumとcurrent contractの不一致を解消し、その後にpackaged再検証と実screen reader確認を行う。
