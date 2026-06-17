# Image Storage Design

## Status

Current design / contract.

ADR 0020 records the decision history and rationale behind the current model. This document is the implementation authority for image storage behavior.

## Scope

This document governs:

- new paste / drop image storage
- inline image rendering and source-view abbreviation
- relative image compatibility for existing Markdown
- app-managed draft workspace and imported-asset temporary cleanup
- future image-management scope classification

## Current Contract

- New paste / drop images are stored as inline Markdown image expressions: `![](data:image...)`.
- The inline Markdown expression is the canonical saved representation. It is not an editor-only widget, hidden blob, or temporary display artifact.
- Source view may abbreviate long inline data URLs for usability, but the underlying Markdown value remains the canonical representation.
- Preview, WYSIWYG, saved-file reopen, draft recovery, and HTML export must preserve visible image continuity for inline images.
- Existing relative image Markdown, including `assets/...` references from older documents or fixtures, remains compatibility input for open, preview, WYSIWYG rendering, fallback display, and export.
- New-image materialization into a Markdown-adjacent `assets/` directory is deprecated and must not be treated as a release gate, accepted backlog requirement, or default implementation target.
- Existing app-managed draft workspace and imported-asset cleanup remain internal compatibility / maintenance behavior only for close, recovery, renderer housekeeping, and stale app-owned temporary records. They do not reopen the `assets/` materialization model for new paste / drop images.
- Cleanup compatibility does not include user-facing cleanup / repair UI, deletion from user-managed `assets/` directories, Markdown reference rewrites, conversion / extraction flows, export-to-file, or any new file mutation behavior.

## Contract States

- Inline paste / drop storage: `active_contract`
- Existing relative image read / render / WYSIWYG display / fallback / export support: `compatibility_only`
- Existing app-managed draft workspace / imported-asset cleanup for close, recovery, renderer housekeeping, and stale temporary records: `compatibility_only`
- New `assets/` materialization for paste / drop images: `deprecated`
- Changing the canonical storage model away from inline Markdown images: `decision_change_required`

## Backlog States Requiring Acceptance

- Asset manager, export-to-file, conversion UI, and other user-facing image-management surfaces: `backlog_state: future_requires_acceptance`; `contract_state: decision_change_required` until this document reclassifies a specific accepted surface as `active_contract`

This document classifies those surfaces as future scope; it does not accept them for implementation. current-backlog must record acceptance and this document must record the accepted contract state before implementation starts.

Compatibility export means maintaining existing export behavior that resolves inline and existing relative images. Export-to-file means a new user-facing conversion / extraction surface that writes image files or changes Markdown references; it is not compatibility maintenance.

## Change Workflow

Before changing image behavior:

1. Check this document for the current contract state and backlog state.
2. Check [current-backlog](current-backlog.md) for an accepted backlog item that permits the work.
3. If the desired work is `future_requires_acceptance`, do not implement from this document alone. First get explicit acceptance, create or update a backlog slice, and update this design contract so the accepted slice's allowed scope and decision state are visible before implementation.
4. If the desired work changes the canonical storage model, update this design document and the relevant ADR in the same turn before implementation.
5. Keep compatibility work explicitly scoped to read / render / WYSIWYG display / export / fallback paths and app-managed draft / imported temporary cleanup. Do not add new `assets/` write behavior, user-data deletion, Markdown rewrite, repair UI, conversion UI, or export-to-file under a compatibility rationale.

## Related Records

- [ADR 0020 Inline Image Storage And Assets Deprecation](adr/0020-inline-image-storage-and-assets-deprecation.md): decision history and rationale
- [Local Asset Storage Design](local-asset-storage-design.md): historical workspace and compatibility background
- [Markdown Editor Fit / Gap Backlog](markdown-editor-fit-gap-backlog.md): accepted editor backlog detail
- [Current Backlog](current-backlog.md): current priority and accepted-state source
