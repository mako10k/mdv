# 0008 Version Source And Release Numbering

- Status: Accepted

## Context

The repository already tracks Windows release artifacts under release/windows-host and uses package.json as the Electron app manifest. We need one persistent rule for which version number is authoritative, when that number changes, and how source commits, packaging refreshes, and release tags relate to each other.

Without an explicit policy, two kinds of drift are easy to create:
- source and packaged binaries can be pushed without a shared release boundary
- a rebuild can change tracked Windows artifacts even when the intended release line did not change
- a git tag can be created before the distributable binaries for that exact release commit are fixed

## Decision

- package.json version is the single authoritative application version.
- The project follows SemVer, but remains in the 0.y.z range until it is ready to make explicit compatibility promises.
- Minor bumps are used for user-visible feature additions, larger UX shifts, contract changes, or other changes that can redefine the current release line.
- Patch bumps are used for bug fixes, packaging/runtime fixes, UI polish, and other corrections that stay within the same release line.
- Rebuilding Windows artifacts from the same intended release line does not require a version bump by itself. Artifact-only refreshes keep the existing version unless the release boundary is intentionally changing.
- An external binary release is defined as one release commit plus one annotated git tag named vX.Y.Z plus the distributable binaries built from that exact tagged commit.
- A release cut updates package.json version, validates the tree, regenerates Windows artifacts, commits the matching source and artifacts, pushes main, and then creates an annotated git tag named vX.Y.Z on that release commit.
- The tag must never be created before the matching distributable binaries exist and have been validated from the same release commit.
- Published binaries must only be distributed under a matching release tag. If a build is produced for verification, recovery, or internal packaging refresh without creating a new tag, it is not a release.
- If a tagged release needs a binary respin, cut a new version and new tag rather than replacing the binaries behind an existing tag.
- 1.0.0 is reserved for the point where file behavior, settings behavior, and major tool or workflow contracts are intentionally documented as stable commitments.

## Consequences

- Future conversations and release work have one canonical answer for version authority: package.json wins.
- Source changes and tracked Windows artifacts are expected to move together when cutting a release, but packaging reruns do not force artificial version churn.
- Git tags become release markers rather than generic commit labels, and every public binary release can be traced back to one immutable tagged commit.
- The workflow draws a hard line between internal packaging refreshes and external releases, so the project does not silently swap binaries behind an existing version tag.
- The repository can keep moving quickly in 0.y.z while still having a stable, documented release workflow.
