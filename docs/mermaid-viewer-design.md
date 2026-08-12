# Mermaid Viewer Design

## State

- `contract_state: active_contract`
- `backlog_state: completed`
- `inventory_status: inventory_confirmed`
- Governing backlog item: MD-BL-029

## User outcome

Rendered Mermaid diagrams in the document preview and assistant transcript can be opened in a dedicated desktop window, where large diagrams can be zoomed and panned without changing the document layout.

## Active contract

- A primary click or keyboard activation on a successfully rendered Mermaid diagram requests a dedicated viewer owned by the source editor window.
- Each editor owns at most one Mermaid viewer. A later request updates and focuses that viewer instead of creating an unbounded set of windows.
- Renderer-to-main IPC carries only bounded Mermaid source text and the explicit `light` or `dark` theme. Generated SVG or arbitrary HTML does not cross the bridge.
- The viewer renders Mermaid independently and provides zoom in, zoom out, reset, modified-wheel zoom, native scrollbars, and pointer drag panning. Keyboard support covers opening a focused source diagram and operating native zoom buttons; it does not add dedicated keyboard panning beyond native scrolling behavior.
- Viewer zoom and pan are transient presentation state. They do not mutate Markdown, settings, exported HTML, or the inline preview.
- Closing an editor closes its owned viewer. The normal expected-entry, navigation-deny, new-window-deny, context-isolated preload, and local-subresource protections apply.

## Blocked scope

- Generic image, table, math, or code-block viewers.
- Persisted zoom, window placement, or viewer settings.
- Mermaid editing, SVG export, Markdown rewrite, or plugin/driver APIs.
- Passing rendered HTML or SVG from an untrusted renderer through IPC.

## Validation

- Browser regression covers preview-surface activation and the viewer's core render/reset/button-zoom semantics. Node regression covers the main-side IPC/window boundary. Preview and assistant use the same typed `openMermaidViewer` bridge caller, but assistant activation and the real Electron route are not separately exercised in this slice.
- Node regression covers bounded IPC validation, per-editor viewer reuse, payload delivery, navigation protection, and owner-close lifecycle.
- A future Electron integration regression should cover the real preload/main/viewer route, including preload buffering when main sends the initial payload before React subscribes.
