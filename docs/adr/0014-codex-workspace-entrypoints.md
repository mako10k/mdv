# 0014 Codex Workspace Entrypoints

- Status: Accepted

## Context

MDV has enough architecture notes, packaging caveats, and AI tool contract rules that an agent can waste time rediscovering the same routing decisions each turn. The core docs remain the source of truth, but they are optimized for human reading rather than quick task triage from the current diff.

The repository also has commit review requirements and a secure GitHub access convention that need to be visible before an agent reaches for external commands or prepares a commit.

## Decision

- Add `npm run codex:map` as the standard workspace-map entrypoint for agents.
- Add `npm run codex:validate` as the standard diff-based validation and review-gate summary. When there is a staged diff, prefer that exact staged subset; otherwise fall back to the full worktree.
- Keep the review-agent routing advisory and file-pattern-based. `AGENTS.md` remains authoritative when a high-judgment diff needs extra review beyond the auto-detected area.
- Route test validation by suite instead of treating all `tests/` changes alike: release tests use release validation, renderer E2E tests use the browser-installing renderer E2E entrypoint, Electron E2E tests use Electron validation, and shared test support fans out to both E2E suites.
- Keep the scripts local and deterministic: they inspect tracked workspace files, package scripts, git status, and submodule status without requiring network access.
- Keep `AGENTS.md` as the rule surface for agents and link these commands from `DEVELOPMENT.md` for human discoverability.
- Require GitHub-facing `git` and `gh` usage to go through `secdat exec` so token injection stays outside prompts and shell history.
- Document `ptyterm` as the Codex sandbox workaround when direct commands cannot see the active `secdat unlock` session.

## Consequences

- Agents get a repeatable first command instead of manually reconstructing project routing from long docs.
- Validation recommendations are explicit but still require the agent to run and report the actual commands it used.
- `codex:validate` aligns better with exact-diff commit review because staged partial commits no longer inherit unrelated worktree review gates by default.
- Partial-commit workflows become clearer because the command can tell the agent whether it reasoned from the staged subset or the full worktree.
- Release-only test changes no longer suggest the full default E2E test entrypoint.
- The command output is advisory; `AGENTS.md`, architecture docs, and release docs remain authoritative when there is a conflict.
- GitHub access remains token-safe in Codex environments where `secdat` session-agent visibility depends on XDG runtime socket access.
- Future workflow changes should update the script, `AGENTS.md`, and this ADR together when the entrypoint contract changes.
