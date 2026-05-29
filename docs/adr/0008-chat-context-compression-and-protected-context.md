# 0008 Chat Context Compression And Protected Context

Status: Accepted

## Context

AI chat transcript growth can overflow the model context window if every turn is replayed verbatim. The first implementation slice needs a small, local mechanism that reduces transcript size before `responses.create()` while still preserving a narrow set of high-value session facts.

At the same time, the first slice must stay main-process local and avoid a renderer/UI dependency. The protected area is intentionally session-scoped and budget-limited.

## Decision

- Build OpenAI chat input in the main process with an explicit token budget derived from the selected model context window.
- Preserve the latest chat turn verbatim when it fits within the input budget.
- Compress only older turns into a bounded synthetic summary block.
- Keep protected context as a session-local store in editor runtime state, not as a persisted memory system.
- Expose the minimal protected-context tool surface as `save_context_item`, `list_context_items`, and `delete_context_item`.
- Enforce protected-context budget checks against the actual injected prompt text, including item formatting overhead.

## Consequences

- The first slice reduces prompt growth without changing the renderer chat UI.
- Protected context survives transcript compression within the current session only.
- Very large latest turns may still need truncation to fit the hard input budget.
- Future topic memory or persisted impression memory can build on this boundary without changing renderer contracts first.
