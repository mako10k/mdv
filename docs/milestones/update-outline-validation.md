# MD-BL-026 Responsive Outline Validation

- Date: 2026-07-22
- PERT task: `VALIDATE_OUTLINE`
- Result: partial pass; renderer behavior passed, product integration is blocked on the packaged editor window minimum and real screen-reader evidence
- Validated source commit: `21d0b47`
- Candidate version: `0.2.1` internal validation candidate; not promoted or published
- Candidate source fingerprint: `d9d92f69cb231f40f55bf5a13bc9a4507412e998a533bd99c2780b01916f45f7`
- Candidate generation ID: `1d0d2a21-3c25-4af1-893d-b65a574a33be`

## Passed Evidence

### Automated Regression

- `npm run lint`: passed
- Focused browser Playwright rerun: 4 passed (`outline layout follows`, `compact outline drawer`, `outline focus remains`, `preview, modal, and AI dock`). This is separate from the earlier 79-test full-suite result recorded by the implementation evidence.
- Focused Electron Playwright rerun: 1 passed (`outline active heading follows the editor caret`). This is separate from the earlier 51-test full-suite result recorded by the implementation evidence.
- Both targeted Playwright commands ran `npm run build`; the renderer security bundle check passed with DOMPurify 3.4.12 and only the existing large-chunk warning.

### Windows Candidate

- `npm run win:host:generate:clean:noadmin`: passed after invalidating the previous candidate
- `npm run release:check:candidate`: passed for portable, installer, blockmap, updater manifest / config, `app.asar`, exact renderer entry, version, generation ID, and current source fingerprint
- `npm run win:host:deploy:candidate:noadmin`: passed; the candidate was deployed to the Windows-local `%LOCALAPPDATA%\MarkDownViewer\latest` path
- The deployed runtime reported MarkDownViewer 0.2.1, Electron 39.8.10, Chrome 142.0.7444.265, Windows, and `devicePixelRatio=1.5`.
- Packaged validation used isolated temporary user-data. AI dock layout was enabled with a process-local dummy `OPENAI_API_KEY`; no chat request was sent. The validation processes and temporary profiles were removed afterward, while the deployed candidate remains available.

### Packaged Layout And Keyboard

The shipped window at 1280px outer width exposed a 1266px renderer viewport. Without the AI dock, the main column was 1266px in `wide` mode and left 994.7px for the editor. Opening the default-width AI dock reduced the main column to 839.6px and selected `compact`; the closed drawer left an 819.6px by 780px editor surface.

Opening the compact drawer did not change the editor bounding box. The drawer was 320px wide inside the 839.6px main column, its close button remained in the fixed header, and a 60-heading outline produced a 751px client-height / 1792px scroll-height list.

- The outline trigger was reachable by Tab from the document root and Enter opened it.
- Initial focus moved to the active first heading. Escape and the close button closed the drawer and returned focus to the trigger.
- Tab reached Heading 60; the internal list scrolled to `scrollTop=1040`. Enter selected the heading, closed the drawer, and returned focus to the editor.
- Preview removed the outline and trigger. Returning to write mode restored a closed compact drawer.

### Accessibility Tree

Chromium's packaged accessibility tree exposed the open drawer as `navigation` named `Heading outline`. The trigger was a `button` named `Close heading outline` with `expanded=true` and `controls=mdv-heading-outline-navigation`. After close, the navigation region was absent from the accessibility tree.

This is Chromium accessibility-tree evidence captured through CDP, not Windows UI Automation evidence and not a substitute for an actual Narrator or NVDA reading-order and announcement check.

### AI Dock Resize

Keyboard operation of the packaged `Resize AI Chat dock` handle used the same main-column authority:

| Dock state | Main column | Outline mode | Editor width |
| --- | ---: | --- | ---: |
| default | 839.6px | compact | 819.6px |
| narrowed with ArrowRight | 904.7px | wide | 633.3px |
| widened with ArrowLeft | 814.2px | compact | 794.2px |

The 900px transition occurred without a second viewport-based outline breakpoint.

## Blocking Findings

### Packaged Window Cannot Reach The Narrow-Window Contract

Users cannot drag the normal packaged editor window narrow enough to exercise the promised narrow-window outline behavior.

The renderer contract accepts a compact document workspace at 900px or below, but the normal editor `BrowserWindow` is created with `minWidth: 1200` in `src/electron/main/window-controller.cts`. Asking the packaged window to resize to 900px stopped at a 1186px renderer viewport, remained `wide`, and left a 914.7px editor. Therefore the packaged app reaches compact mode through AI dock allocation, but not through window narrowing alone.

The existing Electron regression lowers the window minimum to 700px before resizing to 880px. That proves the renderer transition but bypasses the shipped main-process window constraint. The root mismatch is between the renderer responsive contract and the main-owned editor window minimum, not the `ResizeObserver` breakpoint itself.

Repository history traces `minWidth: 1200` back to the initial editor-window implementation and shows it carried unchanged through later TypeScript and controller refactors. No current design rationale or acceptance test for 1200px was found. This makes the value an unexplained inherited constraint, not evidence that the accepted responsive contract should be narrowed.

| Countermeasure | Root-cause proximity / strength | Dependencies, side effects, residual risk | Judgment |
| --- | --- | --- | --- |
| Reduce the editor minimum enough for the accepted 900px main-column transition | High: removes the main-process constraint that prevents the renderer contract | Must select the exact outer-window minimum and regress topbar, editor, preview, AI dock, dialogs, and low-resolution displays | Recommended implementation candidate after the exact minimum is validated |
| Keep 1200px and redefine compact as AI-dock-only | Low for the user outcome: avoids a main-process change but abandons narrow-window behavior | Requires a user-approved design decision, invalidates current window-resize acceptance and leaves low-resolution window clipping | Reject under the current accepted contract |
| Keep 1200px and raise the renderer breakpoint above the minimum | Low: may hide the persistent outline earlier but does not let the application window fit a narrower display | Couples layout to an unexplained minimum and still leaves the window wider than the available display | Reject |

### Real Screen Reader Not Available

No Narrator or NVDA reading-order / announcement witness was available. The accessibility-tree checks verify roles, names, expanded state, controls relation, and closed-tree removal, but cannot establish what an actual screen reader announces.

The rerun must record the screen reader and version and confirm all of the following: the closed trigger is announced as a named collapsed button; activation exposes the named heading navigation and moves focus to the current heading; the current-location state is conveyed; Escape or close returns focus to the collapsed trigger; closed drawer headings disappear from browse / reading order and tab order; and heading activation closes the drawer and places focus at the destination editor heading.

## Judgment And Restart Point

`OUTLINE_RELEASE_READY` is not reached. The renderer slice is implemented, but product integration is incomplete. The next slice is `RECONCILE_OUTLINE_WINDOW_CONTRACT`: select and implement the exact packaged editor minimum that enables the accepted responsive behavior, or stop for a user-approved decision change if new evidence requires preserving 1200px. Add a regression that uses the shipped minimum instead of lowering it inside the test. Then regenerate the source-fingerprint-bound Windows candidate and rerun this validation with the screen-reader pass criteria above.

The candidate is valid evidence for commit `21d0b47`, but it must not be promoted as proof that MD-BL-026 is release-ready.
