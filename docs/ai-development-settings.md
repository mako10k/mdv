# AI Development Settings Compatibility

This note maps the repository AI-development settings that must stay available
from both GitHub Copilot-compatible surfaces and Codex surfaces. The goal is
entrypoint parity: matching role or workflow purpose, review checklist, and
allowed tools or execution constraints where each platform supports them. The
checklist should cover the same responsibilities, even when the two platforms
express them differently. The files do not need identical wording, and durable
policy should stay in the source-of-truth docs below.

## Sources Of Truth

- [AGENTS.md](../AGENTS.md) is the repo-wide rule baseline for agents.
- [docs/ai-customization-layering-design.md](ai-customization-layering-design.md)
  defines how instructions, prompt files, custom agents, skills, and hooks are
  separated.
- [docs/agent-judgment-hardening.md](agent-judgment-hardening.md) defines when
  the review agents are required.

Keep durable rules in those files. The tool-specific files below should remain
thin entrypoints or role definitions.

## Current Mapping

| Capability | GitHub Copilot-compatible surface | Codex surface |
| --- | --- | --- |
| Consistency review role | `.github/agents/consistency-review.agent.md` | `.codex/agents/consistency-review.toml` |
| Plain-eye review role | `.github/agents/plain-eye-review.agent.md` | `.codex/agents/plain-eye-review.toml` |
| Packaging review role | `.github/agents/packaging-review.agent.md` | `.codex/agents/packaging-review.toml` |
| ADR drafting workflow | `.github/prompts/write-adr.prompt.md` | `.agents/skills/write-adr/SKILL.md` |

Codex project agents live under `.codex/agents`. Codex repo-shared repeatable
workflows should be added as skills under `.agents/skills`, not as copied
Copilot prompt files. Copied prompt files duplicate policy and drift; skills are
the Codex-owned package for reusable instructions, scripts, examples, and
resources.

## Maintenance Rules

- When adding `.github/agents/*.agent.md`, add the matching
  `.codex/agents/*.toml` in the same change.
- When adding `.codex/agents/*.toml`, add the matching
  `.github/agents/*.agent.md` in the same change when Copilot should expose the
  same role. A Codex-only agent is acceptable when the role depends on
  Codex-only execution behavior or should not be selectable from Copilot; record
  that reason with the change.
- When adding `.github/prompts/*.prompt.md`, add a matching
  `.agents/skills/<name>/SKILL.md` if the workflow should be reusable from
  Codex. If there is intentionally no Codex equivalent, record the reason in
  the prompt change.
- When adding `.agents/skills/*/SKILL.md` for a manual repeatable workflow, add
  a matching `.github/prompts/*.prompt.md` when Copilot should expose the same
  task entrypoint. A Codex-only skill is acceptable when it depends on bundled
  scripts, resources, or other Codex skill behavior that Copilot cannot run;
  record that reason with the change.
- Treat a workflow as reusable from Codex when it is a named repo task that an
  agent is expected to invoke repeatedly, such as ADR drafting, validation
  routing, release review, or commit review. A prompt can stay Copilot-only when
  it depends on a Copilot-specific UI or integration; record that platform
  dependency as the reason.
- Do not copy large shared policy blocks across tool-specific files. Link back
  to `AGENTS.md` or the owning design doc instead.
- Keep `scripts/codex-workspace.mjs` in sync when a new AI-development settings
  directory or workflow should appear in `npm run codex:map` and
  `npm run codex:validate`.
- After changing these settings, run `npm run codex:validate`. Before commit,
  run `consistency-review`; also run `plain-eye-review` when the change updates
  agent instructions, workflow policy, or high-judgment explanations.
