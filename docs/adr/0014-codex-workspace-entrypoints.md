# 0014 Codex Workspace Entrypoints

## Status

Accepted

## Context

MDV has enough architecture notes, packaging caveats, and AI tool contract rules that an agent can waste time rediscovering the same routing decisions each turn. The core docs remain the source of truth, but they are optimized for human reading rather than quick task triage from the current diff.

The repository also has commit review requirements and a secure GitHub access convention that need to be visible before an agent reaches for external commands or prepares a commit.

## Decision

- Add `npm run codex:map` as the standard workspace-map entrypoint for agents.
- Add `npm run codex:validate` as the standard diff-based validation and review-gate summary. When there is a staged diff, prefer that exact staged subset; otherwise fall back to the full worktree.
- For dependency resolution, generated-runtime wiring, cross-process contracts, and packaging / distribution changes, make `codex:validate` route an early contract review after the smallest buildable change and before broad regression or Windows candidate generation. This review traces actual execution and generated artifacts, and records the limits of metadata-only evidence.
- Allow early review of a committed WIP through an explicit base / head comparison range instead of silently reviewing only the current dirty tree.
- Bound early review to actual contract blockers, one initial pass, and at most one confirmation after blocker fixes. Candidate integration and exact-diff polish remain final-review responsibilities.
- Keep early contract review and final exact-diff pre-commit review as separate checkpoints; neither substitutes for the other.
- Keep the review-agent routing advisory and file-pattern-based. `AGENTS.md` remains authoritative when a high-judgment diff needs extra review beyond the auto-detected area.
- Route test validation by suite instead of treating all `tests/` changes alike: release tests use release validation, renderer E2E tests use the browser-installing renderer E2E entrypoint, Electron E2E tests use Electron validation, and shared test support fans out to both E2E suites.
- On Linux, run the standard Electron E2E entrypoint inside an automatically allocated Xvfb display so Electron windows cannot take focus from the physical desktop. Fail closed when `xvfb-run` is unavailable instead of silently falling back to the host display.
- Keep host-display Electron E2E as an explicit `npm run test:e2e:electron:visible` entrypoint for focus, visibility, and window-manager checks. Windows and macOS continue to use the host display because this Xvfb isolation is Linux-specific.
- Keep the scripts local and deterministic: they inspect tracked workspace files, package scripts, git status, and submodule status without requiring network access.
- Keep `AGENTS.md` as the rule surface for agents and link these commands from `DEVELOPMENT.md` for human discoverability.
- Require GitHub-facing `git` and `gh` usage to go through `secdat exec` so token injection stays outside prompts and shell history.
- Document `ptyterm` as the Codex sandbox workaround when direct commands cannot see the active `secdat unlock` session.

## Consequences

- Agents get a repeatable first command instead of manually reconstructing project routing from long docs.
- Validation recommendations are explicit but still require the agent to run and report the actual commands it used.
- `codex:validate` aligns better with exact-diff commit review because staged partial commits no longer inherit unrelated worktree review gates by default.
- Expensive regression and packaging work can start after runtime / artifact contract mistakes are challenged, instead of discovering them only at final review.
- Version-only release metadata changes need not trigger the early checkpoint, but file-pattern routing may conservatively recommend it when package metadata is mixed with dependency changes.
- Partial-commit workflows become clearer because the command can tell the agent whether it reasoned from the staged subset or the full worktree.
- Release-only test changes no longer suggest the full default E2E test entrypoint.
- Routine Electron E2E on Linux / WSL no longer interrupts work on the physical desktop, but Linux development and CI environments now require Xvfb for the standard entrypoint.
- Tests that intentionally depend on host focus, visibility, or native window-manager behavior must use the visible entrypoint or an appropriate Windows / macOS test session.
- The command output is advisory; `AGENTS.md`, architecture docs, and release docs remain authoritative when there is a conflict.
- GitHub access remains token-safe in Codex environments where `secdat` session-agent visibility depends on XDG runtime socket access.
- Future workflow changes should update the script, `AGENTS.md`, and this ADR together when the entrypoint contract changes.
