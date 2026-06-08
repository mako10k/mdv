# 0018 Untracked Windows Release Artifacts And History Rewrite

- Status: Accepted

## Context

The repository accumulated large Windows release binaries in both Git history and Git LFS while the same distributables were also published as GitHub Release assets. That duplicate storage is no longer acceptable. We still need local canonical artifacts for validation, promote, and GitHub Release upload, but those files do not need to be part of the git source of truth.

Existing release ADRs assumed that canonical Windows release artifacts under `release/windows-host` were tracked in git and moved with the release commit. That assumption now conflicts with the storage constraint and with the fact that GitHub Release assets are the real public distribution channel.

This decision supersedes only the tracked-canonical-binary assumptions inside [0008 Version Source And Release Numbering](0008-version-source-and-release-numbering.md), [0013 Windows Host Generate Deploy Promote Split](0013-windows-host-generate-deploy-promote-split.md), and [0016 Windows Update Channel And Version Metadata](0016-windows-update-channel-and-version-metadata.md).

## Decision

- Heavy generated Windows release artifacts under `release/windows-host` are no longer tracked in git.
- Git history is rewritten to remove the previously tracked Windows release binaries and app archives that consumed Git LFS and repository history size.
- `release/windows-host` remains the local canonical cache used by release validation, deploy, promote, and GitHub Release upload commands, but it is a workspace artifact, not a git artifact.
- GitHub Release assets are the public source of truth for shipped Windows binaries.
- Release commits contain source changes, version changes, release notes, and any lightweight metadata we intentionally keep, such as `release/windows-host/artifact-metadata.json` and `release/windows-host/installer/latest.yml`, but not the heavy release binaries themselves.
- Existing clones must be repaired explicitly after the force-push so local refs, tags, and stale LFS objects do not keep the pre-rewrite history alive.

## Consequences

- Future releases stop growing Git LFS usage through repeated binary commits.
- Repository history rewrite and force-push are required, so existing clones need a documented recovery path.
- Local release tooling still works because validation reads files from the workspace, not from git tracking state.
- The parts of 0008, 0013, and 0016 that required tracked canonical Windows binaries are no longer valid.