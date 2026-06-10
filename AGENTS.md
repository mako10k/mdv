# MDV Agent Guide

## Scope

- Keep this file minimal. Link to existing docs instead of duplicating them.
- Use [README.md](README.md) for the current project overview, [DEVELOPMENT.md](DEVELOPMENT.md) for setup/build/testing/packaging and the release entrypoint, and [docs/release-workflow.md](docs/release-workflow.md) for detailed release runbook steps.
- Use [docs/current-backlog.md](docs/current-backlog.md) as the product backlog source of truth. Treat [docs/usernote.md](docs/usernote.md) as user-intake notes only; do not treat its numbering as official PBI IDs. Once an item is accepted, refer to the backlog ID assigned in current-backlog instead.
- Use [docs/ai-chat-design.md](docs/ai-chat-design.md) and [docs/ai-chat-feasibility.md](docs/ai-chat-feasibility.md) before changing AI chat behavior, IPC contracts, or editor tool semantics.
- Use [docs/ai-customization-layering-design.md](docs/ai-customization-layering-design.md) first for the customization layer explainer, and [docs/adr/0017-ai-customization-layer-boundaries.md](docs/adr/0017-ai-customization-layer-boundaries.md) when you need the decision record behind always-on instructions, file-scoped instructions, prompt files, custom agents, skills, or hooks.
- Use [docs/agent-judgment-hardening.md](docs/agent-judgment-hardening.md) for the repo's general judgment rules: broad-first interpretation, anti-overcompression, evidence-first RCA, objective countermeasure evaluation, and expert-plus-plain-eye review.

## Validation

- Run `npm run codex:map` when you need a quick project map, current worktree routing, or validation suggestions.
- Run `npm run codex:validate` after making changes to print the recommended validation and pre-commit review gates for the current diff. If you are preparing a partial commit, stage that subset first so the command reads the staged diff instead of the full worktree.
- Primary validation is `npm run build`.
- Run `npm run lint` when touching TypeScript, React, Electron, or build scripts.
- Automated checks exist for build, Playwright E2E, and release validation. Do not overstate coverage beyond the commands you actually ran.

## Architecture Boundaries

- Renderer UI lives in `src/` and uses React + Toast UI Editor.
- Electron main process owns window lifecycle, file I/O, and IPC orchestration; its implementation lives in `src/electron/main.cts` and `src/electron/main/`, with `electron/main.cjs` kept as the compiled-entry wrapper.
- The preload bridge in `electron/preload.cjs` is the only supported renderer boundary for desktop capabilities.
- Assistant UI logic lives under `src/ai-chat/` and is currently embedded in the editor window as a dock; keep assistant concerns modular even though the primary surface is no longer a separate renderer entry.
- `server/mdv-server.cjs` is the managed-client supervisor path. Treat it as a separate runtime from the normal editor window flow.

## Project-Specific Conventions

- Do not narrow a request, impact surface, or cause candidate to the nearest convenient interpretation just because the current file, diff, or symptom is local; keep broader plausible readings alive until direct evidence rules them out.
- Do not compress away scope, assumptions, alternative explanations, or unresolved ambiguity merely to keep an answer short; concise output must still preserve the true decision surface.
- For debugging, RCA, and design justification, follow the default order `direct evidence -> deeper cause analysis -> root-cause judgment -> countermeasure comparison`; treat pre-root-cause fixes as temporary probes or containment unless proven otherwise.
- Compare countermeasures by root-cause proximity, strength, dependencies, verifiability, side effects, and residual risk; do not rank documentation-only or caution-only mitigations as strong preventive action on their own.
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
- For important RCA, important architecture or workflow decisions, major countermeasure comparisons, or user-facing explanations that carry significant judgment, pair expert review with the `plain-eye-review` agent and resolve any strong conclusion-order or evidence-gap objections before finalizing.

## Commit Workflow

- Default repo workflow is one logical commit per turn.
- Before any commit, run the `consistency-review` custom agent on the exact diff.
- If the diff changes RCA guidance, architecture or workflow policy, agent instructions, major countermeasure comparisons, or an important user-facing explanation with significant judgment, also run the `plain-eye-review` custom agent before commit.
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
- Use the `$write-adr` Codex skill, or the `/write-adr` Copilot prompt for compatibility, when you need the agent to draft or update an ADR from the current change.

## Review Anchors

- Renderer example: `src/App.tsx`
- Chat example: `src/ai-chat/ChatApp.tsx`
- Desktop bridge example: `electron/preload.cjs`
- Main-process orchestration example: `src/electron/main.cts`
