# MD-BL-025 / MD-BL-026 Editor Inventory

- Date: 2026-07-22
- PERT task: `INVENTORY_EDITOR`
- Result: complete
- Backlog state: both items remain `accepted_active`
- Inventory-time contract state: both items were `decision_change_required`; this inventory alone did not authorize implementation
- Follow-up: MD-BL-025 became `active_contract` in [Typography Interaction Design](../typography-interaction-design.md), and MD-BL-026 became `active_contract` in [Responsive Outline Design](../responsive-outline-design.md)

## MD-BL-025 Ctrl+Mouse-Wheel Zoom

### Confirmed Current State

- Editor typography is persisted as `editor.fontSizePx`; the default is 13px and the accepted range is 11–18px. AI chat uses the separate `ai.chatFontSizePx` setting with a default of 12px and a range of 11–16px.
- `applyTypographyToRoot` maps those settings to `--editor-font-size` and `--chat-font-size`. Markdown source, WYSIWYG, rendered preview, and preview code blocks use `--editor-font-size`; AI chat uses its separate variable.
- `Ctrl/Cmd + +/-/0` changes the setting for the focused editor surface or AI chat composer, persists it through `mdv:settings-update`, and rolls the optimistic local ref back when persistence fails.
- The keyboard target contract is focus-based. Preview content and non-composer AI chat content are not keyboard typography targets.
- No `wheel` handler or Electron `webContents` zoom call exists in the renderer, main process, or current tests.
- Settings sanitization tests cover the numeric bounds. Browser tests cover the resulting typography CSS, but do not directly cover the existing typography shortcut, persistence, or failure rollback.

### Design Decisions Required at Inventory Time

- Define a pointer-location contract for the wheel gesture separately from the existing focus-based keyboard contract. Do not broaden one helper to silently carry both meanings.
- Decide whether pointer positions in editor and preview both update `editor.fontSizePx`, and whether the complete AI dock or only specific AI content updates `ai.chatFontSizePx`.
- Keep unmodified wheel scrolling unchanged and call `preventDefault` only for an eligible modified-wheel target.
- Define wheel delta normalization, one-pixel size steps, event coalescing, persistence ordering, and rollback so a physical wheel gesture does not flood settings IPC or apply stale acknowledgements.
- Preserve `Ctrl/Cmd + +/-/0`, the current bounds, Settings synchronization, proposal-modal interaction blocking, and browser/Electron coverage. Do not use global `webContents` zoom because that would scale app chrome and alter responsive breakpoints.

### Recommended Starting Point at Inventory Time

- Reuse the persisted typography settings and their existing bounds.
- Resolve wheel targets by pointer containment: editor and preview map to editor typography; an explicitly accepted AI dock region maps to chat typography; all other regions retain native wheel behavior.
- Keep the wheel-target resolver separate from `getFocusedTypographyTarget`, then share only the typed size-change/persistence operation after target resolution.

## MD-BL-026 Responsive Outline

### Confirmed Current State

- The outline pane is rendered only in editor mode. Preview mode keeps heading highlighting and scrolling, but does not render the outline pane.
- Above 1100px, the outline is a fixed left column with a 240px basis, 220px minimum, and 272px maximum width.
- At 1100px and below, `.single-panel` becomes a vertical column and the outline moves above the editor. The AI dock also stacks below the main workspace.
- At 980px and below, the stacked outline receives a 220px maximum height. Between 981px and 1100px it has no explicit maximum height, so this band can consume more vertical document space than the narrower layout.
- There is no collapsed state, icon trigger, floating drawer, manual toggle, `aria-expanded` contract, or focus-return behavior.
- Existing browser coverage confirms outline presence, compact typography, table-action reachability at 760px, and AI-dock stacking at 1000px. It does not assert a minimum usable document size, outline open/close behavior, hidden-overlay cleanup, or keyboard/screen-reader operation.

### Design Decisions Required at Inventory Time

- Preserve the fixed desktop outline where sufficient width exists, then compare automatic collapse, icon trigger, and floating/overlay drawer behavior for narrow widths.
- Define breakpoint ownership and manual state transitions, including what happens when the window crosses the breakpoint while the outline is open.
- Define keyboard activation, `aria-expanded` / `aria-controls`, Escape and outside-click close behavior, initial focus, and focus return.
- Preserve active-heading indication, heading jump, and outline scroll-follow. Do not add a preview outline as an implicit part of this item.
- Add practical-width and practical-height assertions for editor-only, preview, and editor-with-AI layouts, including the 981–1100px band.

### Recommended Starting Point at Inventory Time

- Keep the current desktop side pane above the selected breakpoint.
- Below that breakpoint, default to a collapsed icon trigger and open the outline as an explicit overlay/drawer that does not permanently reduce document width or height.
- Treat the responsive open state as transient UI state unless a later design explicitly justifies persistence.

## Evidence

- Code: `src/App.tsx`, `src/App.css`, `src/shared/desktopTypography.ts`, `src/electron/main/settings-controller.cts`, `src/settings/SettingsApp.tsx`
- Tests: `tests/e2e/app-layout.spec.ts`, `tests/node/electron-main-settings-controller.spec.mjs`
- Targeted browser regression on 2026-07-22: 4 passed (`editor mode keeps the outline`, `editor mode uses denser outline`, `narrow editor topbar`, `narrow layout stacks the AI dock`)
- Repository search confirmed no current wheel handler or Electron zoom call.

## Inventory-Time Next PERT Tasks

- `DESIGN_ZOOM`
- `DESIGN_OUTLINE`

Both become dependency-ready after this inventory. Product ordering remains governed by `docs/current-backlog.md`; this inventory does not assign implementation priority.

Follow-up: `DESIGN_ZOOM`、`DESIGN_OUTLINE`、`IMPLEMENT_OUTLINE` のrenderer sliceは完了した。Current runnable / blocked stateは [the PERT plan](update-zoom-outline.pert) を正本とし、packaged validationで見つかったeditor window contract不一致を解消する `RECONCILE_OUTLINE_WINDOW_CONTRACT` がrunnable、`VALIDATE_ZOOM` はhigh-resolution trackpad evidence待ちでblockedである。
