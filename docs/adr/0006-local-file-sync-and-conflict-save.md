# 0006 Local File Sync And Conflict Save

Status: Accepted

## Context

The editor now needs to keep one opened local file synchronized with disk changes without turning every external edit into an implicit overwrite. Drag-and-drop, normal open, and later saves must all preserve the same local-file identity when possible.

At the same time, saving cannot silently overwrite a file that changed since the renderer last synchronized it. The save flow needs explicit user choices and must keep the renderer state coherent when a merge succeeds or fails.

## Decision

- `read-file` and `open-file` return a file snapshot alongside text content so the renderer can remember the last synchronized disk version.
- The preload bridge exposes current-file tracking and change notifications from the main process to the renderer.
- The main process watches only the renderer's currently attached local file path and emits lightweight change events instead of pushing content automatically.
- The main process re-arms that path watch across delete and recreate cycles so the same file path can resume synchronization after atomic saves or temporary absence.
- When the renderer is not dirty and the watched file changes, it reloads the file from disk and updates the synchronized baseline.
- When the renderer is dirty and the last synchronized snapshot no longer matches disk at save time, including deletion, the main process shows four choices: overwrite save, save as, merge save, or cancel.
- Merge save is conservative: it applies the renderer's patch from the last synchronized base onto the current disk text and fails closed when the patch cannot be applied cleanly.
- Drag-and-drop keeps the file attached whenever a native file path can be recovered from Electron's dropped file object or file URI payload.

## Consequences

- Dirty state remains renderer-owned, but save safety depends on an explicit snapshot contract shared with the main process.
- Non-dirty editors now follow local file edits automatically without user prompts.
- Merge save can preserve both sides for non-overlapping edits, but conflicting edits return to the editor without writing anything.
- Save flows on close reuse the same snapshot-aware logic, so window-close save behavior matches normal save behavior.