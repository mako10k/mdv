# Main-owned Mermaid viewer window

Status

Accepted

Context

Large Mermaid diagrams are difficult to inspect inside the width-constrained document preview or assistant dock. Inline zoom controls would add layout and gesture state to every rendered block, while a desktop window lets the diagram use independent screen space. The new surface crosses renderer, preload, IPC, and Electron window-lifecycle boundaries.

Decision

Adopt the dedicated viewer contract in [Mermaid Viewer Design](../mermaid-viewer-design.md). The main process owns one viewer per source editor and its lifecycle. The bridge accepts bounded Mermaid source plus an explicit theme, never renderer-generated HTML or SVG. The isolated viewer renderer performs Mermaid rendering and owns transient zoom and pan state under the same navigation and subresource protections as other application windows.

Consequences

Large diagrams can be inspected without changing document typography or layout, and repeated activation reuses a predictable window. The application gains a new renderer entry, typed preload/IPC surface, and auxiliary-window lifecycle. Node and browser regressions are the completion gate for this slice; a real Electron-route regression remains an explicitly recorded follow-up because the current harness does not exercise preload timing. This contract does not establish a generic plugin, code-block driver, rendering-engine, or LLM-tool extension API.
