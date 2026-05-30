# 0009 UI Information Architecture Reset

- Status: Accepted

## Context

The current MDV UI grew by layering editor actions, preview actions, search, outline, settings entry, and AI chat entry onto a compact toolbar while also adding separate settings and fetch-permissions windows. At the same time, HTML trust boundaries now differ across runtime preview, AI chat rendering, and exported HTML.

Without an explicit reset, the product keeps three kinds of drift:

- task flows are spread across separate windows and overloaded toolbar space
- shortcuts exist but are hard to discover and do not form a coherent navigation system
- HTML rendering policy differs by surface and is not defined as one shared sanitizer pipeline

## Decision

- MDV will be redesigned around one workspace-first information architecture instead of preserving the current toolbar-centric layout.
- The default workspace will move to a persistent multi-pane layout with outline/search navigation, editor, preview, and an assistant dock instead of forcing editor and preview into exclusive modes.
- AI assistance will be treated as part of the main workspace flow by default, with an optional detached window only as a secondary mode.
- Statusbar, transient toast, and shortcut help will be consolidated into a single activity surface with clear priority rules.
- Keyboard navigation will be redesigned as a first-class command system with a shortcut overlay and command palette.
- Runtime preview, AI chat rendering, and HTML export will share one explicit sanitizer policy, with surface-specific extensions only when necessary.

## Consequences

- A future implementation can remove backward-compatibility constraints and optimize for clearer task flow instead of preserving the old toolbar contract.
- The application will need coordinated updates across [src/App.tsx](src/App.tsx), [src/ai-chat/ChatApp.tsx](src/ai-chat/ChatApp.tsx), [src/settings/SettingsApp.tsx](src/settings/SettingsApp.tsx), [src/fetch-permissions/FetchPermissionsApp.tsx](src/fetch-permissions/FetchPermissionsApp.tsx), and the desktop menu/shortcut surface in [electron/main.cjs](electron/main.cjs).
- HTML safety work is no longer an export-only concern; it becomes a shared rendering contract.
- Documentation and release notes should describe this as a UI reset rather than incremental polish.