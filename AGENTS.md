# MDV Agent Guide

## Scope

- Keep this file minimal. Link to existing docs instead of duplicating them.
- Use [README.md](README.md) for the current project overview, [DEVELOPMENT.md](DEVELOPMENT.md) for setup/build/testing/packaging and the release entrypoint, and [docs/release-workflow.md](docs/release-workflow.md) for detailed release runbook steps.
- Use [docs/ai-chat-design.md](docs/ai-chat-design.md) and [docs/ai-chat-feasibility.md](docs/ai-chat-feasibility.md) before changing AI chat behavior, IPC contracts, or editor tool semantics.

## Validation

- Run `npm run codex:map` when you need a quick project map, current worktree routing, or validation suggestions.
- Run `npm run codex:validate` after making changes to print the recommended validation and pre-commit review gates for the current diff.
- Primary validation is `npm run build`.
- Run `npm run lint` when touching TypeScript, React, Electron, or build scripts.
- Automated checks exist for build, Playwright E2E, and release validation. Do not overstate coverage beyond the commands you actually ran.

## Architecture Boundaries

- Renderer UI lives in `src/` and uses React + Toast UI Editor.
- Electron main process lives in `electron/main.cjs` and owns window lifecycle, file I/O, and IPC orchestration.
- The preload bridge in `electron/preload.cjs` is the only supported renderer boundary for desktop capabilities.
- Assistant UI logic lives under `src/ai-chat/` and is currently embedded in the editor window as a dock; keep assistant concerns modular even though the primary surface is no longer a separate renderer entry.
- `server/mdv-server.cjs` is the managed-client supervisor path. Treat it as a separate runtime from the normal editor window flow.

## Project-Specific Conventions

- Keep preload APIs, renderer usage, and `src/shims.d.ts` in sync whenever the desktop bridge changes.
- Keep AI editor spans canonical in Markdown coordinates. When behavior depends on Toast UI mode conversion, follow the rules already recorded in [docs/ai-chat-feasibility.md](docs/ai-chat-feasibility.md).
- Prefer `@toast-ui/editor` directly. Do not introduce `@toast-ui/react-editor` in this repo.
- Follow the existing split between CommonJS in `electron/` and ESM/TypeScript in `src/`.
- Treat type safety as a repo rule: do not paper over typing gaps with casual `any`, `as any`, or `as unknown as ...` casts. Fix the type boundary or model the shape explicitly instead.
- Preserve existing packaging workarounds for WSL and Windows host builds; do not assume `electron-builder --win portable` is reliable on this Linux environment.
- For debugging or RCA work, do not stop at the first symptom or mixed-representation explanation. Trace the controlling contract boundary, record hypothesis and disconfirming check, and fix the root contract or state-model mismatch rather than only adding surface guards.
- Do not hide contract drift by broadening a helper to accept multiple payload shapes "for convenience". If a helper is being used with mixed representations, treat that as the bug: split the helper or tighten the caller contract so each path passes one explicit shape.
- When a user says the RCA is shallow, treat that as a request to inspect the abstraction design itself, not just the failing value. Identify whether one API, schema, or helper is carrying multiple responsibilities, request modes, or semantic branches, and prefer separating those contracts over making the shared shape more permissive.
- For AI tool work specifically, do not keep help/introspection requests, action requests, and runtime argument validation entangled in one schema or helper. If those concerns are fighting each other, treat the mixed contract as the root cause and split the protocol surface so OpenAI-facing schemas, help discovery, and runtime validation each have one explicit responsibility.
- For AI tool contracts, state target-kind-specific validity rules explicitly. Do not imply that every SPAN kind is valid for every `editorId`; for example, `selection` is live-editor-only and non-editor targets must use `document`, `pageTarget`, or explicit ranges.

## Commit Workflow

- Default repo workflow is one logical commit per turn.
- Before any commit, run the `consistency-review` custom agent on the exact diff.
- If the diff touches Windows packaging, Electron distribution, release artifacts, or `scripts/build-win-host.*`, also run the `packaging-review` custom agent before commit.
- The review must check consistency, symmetry, and coverage first, then report bugs, regressions, and missing validation.
- If a higher-priority session policy forbids automatic commits, stop after the review and present the proposed commit message instead of committing silently.

## GitHub Access

- Route GitHub-facing git commands through `secdat exec git ...` so `GH_TOKEN` is injected by the local secure store.
- Route GitHub CLI commands through `secdat exec gh ...` for the same reason.
- Local-only git inspection such as `git status`, `git diff`, and `git log` does not need `secdat`.
- If Codex sandboxing cannot see the `secdat unlock` session, use the `ptyterm` workaround documented in [docs/codex-secure-github-access.md](docs/codex-secure-github-access.md).

## ADR Workflow

- Create or update an ADR when a change affects architecture, cross-process contracts, persistent workflow, packaging strategy, tool contracts, or any decision likely to outlive the current implementation slice.
- Store ADRs under `docs/adr/` using `NNNN-short-title.md` naming.
- Each ADR should stay short and include: Status, Context, Decision, Consequences.
- Update the ADR in the same turn as the code or doc change that depends on it.
- When a new ADR replaces an older decision, mark the older ADR as superseded and cross-link both files.
- Small local refactors that do not change shared rules do not need an ADR.
- Use the `/write-adr` prompt when you need the agent to draft or update an ADR from the current change.

## Review Anchors

- Renderer example: `src/App.tsx`
- Chat example: `src/ai-chat/ChatApp.tsx`
- Desktop bridge example: `electron/preload.cjs`
- Main-process orchestration example: `electron/main.cjs`
