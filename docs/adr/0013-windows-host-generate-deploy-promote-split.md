# 0013 Windows Host Generate Deploy Promote Split

- Status: Superseded in part by [0018 Untracked Windows Release Artifacts And History Rewrite](0018-untracked-windows-release-artifacts-and-history-rewrite.md)

## Context

The repository keeps canonical local Windows release artifacts under `release/windows-host`.
The previous host packaging workflow mixed three responsibilities in one command path:

- building fresh Windows artifacts from source
- deploying a runnable Windows-local copy for validation
- updating the local canonical release artifacts

That coupling let local validation reruns mutate the same tracked path used as the public release artifact source of truth. It blurred the boundary between internal packaging refreshes and actual release artifacts, especially when source moved ahead of the most recent release tag while `package.json` stayed on the same version.

## Decision

- Windows host packaging is split into three explicit actions: `generate`, `deploy`, and `promote`.
- `generate` builds artifacts from the current source and writes them only to the ignored candidate path `release/windows-host-candidate`.
- `generate` invalidates any previous candidate before starting. A failed or interrupted build therefore leaves no same-version artifact that can be mistaken for the current source output.
- `deploy` copies `win-unpacked` from either the canonical local release artifacts or the candidate artifacts into the Windows-local runnable path under `%LOCALAPPDATA%\MarkDownViewer\latest`.
- `promote` is the only action allowed to replace the canonical local artifact cache under `release/windows-host`.
- Full candidate metadata binds the artifact to a deterministic fingerprint of the release build inputs and a unique generation ID. Candidate and canonical release checks compare that fingerprint with the current source and inspect the renderer entry selected by packaged `dist/index.html` inside `app.asar`.
- `promote` runs the full candidate check itself and fails closed on stale source, invalid metadata, an invalid packaged renderer security contract, or incomplete artifacts.
- Release workflows generate candidate artifacts first, optionally validate them locally, and only then promote them into the canonical local cache before creating the release commit and tag.

## Consequences

- Local validation reruns no longer dirty the canonical release artifact path by default.
- The canonical `release/windows-host` path regains a single meaning: a local release-bound cache used for validation, deploy, and publish.
- Deploying a local Windows runnable copy no longer implies rebuilding or rewriting canonical artifacts.
- Interrupted generation cannot leave an older candidate eligible for later deploy or promotion. A new full generation is required after failure.
- Version/path/existence metadata is not sufficient promotion evidence; the source fingerprint and exact packaged renderer entry are part of the authorization check.
- The script surface is no longer backward compatible with the old `full` and `diff` terminology; the new command names describe responsibilities directly instead.
