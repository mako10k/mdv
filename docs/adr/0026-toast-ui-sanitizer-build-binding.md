# 0026 Toast UI Sanitizer Build Binding

## Status

Accepted

## Context

Toast UI Editor 3.2.2 publishes ESM bundles with DOMPurify 2.3.3 embedded in the module. Package-manager overrides can resolve a patched `dompurify` package while leaving that embedded implementation active, so dependency-tree audits alone cannot prove which sanitizer ships. The broader HTML policy direction remains in [ADR 0009](0009-ui-information-architecture-reset.md) and [UI Reset And HTML Safety Review](../ui-reset-and-html-safety-review.md).

## Decision

MDV will keep Toast UI Editor on its published ESM entry and apply a Vite pre-transform that rebinds the bundle's single sanitizer instance to MDV's exact direct DOMPurify dependency. Toast UI is excluded from dependency pre-bundling so the transform sees the upstream source. The transform must fail the build unless the expected upstream instance marker occurs exactly once. Release validation must check the transform contract and the built renderer dependency version; a package-lock audit alone is insufficient.

## Consequences

The editor's preview and WYSIWYG conversion paths use the patched workspace sanitizer without maintaining a full Toast UI fork. An upstream Toast UI bundle-shape change intentionally breaks the build until the binding is reviewed. This decision only corrects Toast UI's embedded sanitizer dependency; it does not claim to complete the shared runtime-preview, AI-chat, and export sanitizer policy planned by ADR 0009.
