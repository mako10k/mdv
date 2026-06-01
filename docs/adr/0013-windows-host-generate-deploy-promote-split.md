# 0013 Windows Host Generate Deploy Promote Split

- Status: Accepted

## Context

The repository tracks canonical Windows release artifacts under `release/windows-host`.
The previous host packaging workflow mixed three responsibilities in one command path:

- building fresh Windows artifacts from source
- deploying a runnable Windows-local copy for validation
- updating the tracked canonical release artifacts

That coupling let local validation reruns mutate the same tracked path used as the public release artifact source of truth. It blurred the boundary between internal packaging refreshes and actual release artifacts, especially when source moved ahead of the most recent release tag while `package.json` stayed on the same version.

## Decision

- Windows host packaging is split into three explicit actions: `generate`, `deploy`, and `promote`.
- `generate` builds artifacts from the current source and writes them only to the ignored candidate path `release/windows-host-candidate`.
- `deploy` copies `win-unpacked` from either the canonical release artifacts or the candidate artifacts into the Windows-local runnable path under `%LOCALAPPDATA%\MarkDownViewer\latest`.
- `promote` is the only action allowed to replace the tracked canonical artifacts under `release/windows-host`.
- Release workflows generate candidate artifacts first, optionally validate them locally, and only then promote them into the canonical tracked release path before creating the release commit and tag.

## Consequences

- Local validation reruns no longer dirty the tracked release artifact path by default.
- The canonical `release/windows-host` path regains a single meaning: release-bound artifacts intended to move with a release commit.
- Deploying a local Windows runnable copy no longer implies rebuilding or rewriting canonical artifacts.
- The script surface is no longer backward compatible with the old `full` and `diff` terminology; the new command names describe responsibilities directly instead.