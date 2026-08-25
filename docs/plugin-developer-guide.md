# Plugin Developer Guide

## Availability

This is a contract preview for MDV maintainers and future bundled-package developers.

- Plugin runtime: not implemented
- Internal Developer Kit: proposed, not implemented
- Public third-party SDK: unavailable and unaccepted
- Driver dispatch and Skill injection: unavailable

There is currently no command that installs, validates, or runs an MDV Plugin. Do not infer a working API from illustrative names or examples in this guide.

The 2026-08-25 proposal revision approved only this developer-experience design. It did not authorize catalog, diagnostics, Kit, runtime, or SDK implementation. A Public SDK is a possible later proposal, not a committed roadmap item.

## Start Here

Read these documents in order:

1. [Plugin Architecture Design](plugin-architecture-design.md): lifecycle, capability, privilege, and blocked boundaries
2. [Plugin Developer Kit And Public SDK Design](plugin-developer-kit-design.md): internal Kit deliverables and Public SDK readiness gates
3. [Plugin Architecture Inventory](milestones/plugin-architecture-inventory.md): current code/package evidence and proposed first-slice acceptance tests
4. [ADR 0030](adr/0030-capability-separated-plugin-architecture.md): long-lived decision record

## Mental Model

A Plugin package may eventually declare one or more capabilities plus optional workflow resources. MDV shares package identity, compatibility, lifecycle state, diagnostics, and provenance, but it does not use one universal executable hook.

```text
package metadata
├─ Codeblock Driver declaration       future, non-executable today
├─ Text Rendering Engine declaration  future, non-executable today
├─ LLM Tool Driver declaration        future, non-executable today
└─ Skill contribution metadata        future, loaded only by AI-CFG-002
```

A Skill tells the LLM how to perform a workflow. It is not a Driver and does not grant file, network, editor, or Tool permission.

## Who The Early Kit Is For

The proposed Internal Developer Kit targets:

- MDV maintainers changing the manifest/catalog contract
- contributors adding release-reviewed bundled package metadata
- release engineers verifying source fingerprints and packaged resources

It does not target external Plugin distribution. Validator success will mean that package metadata conforms to the catalog contract, not that Plugin code can execute.

## Planned Authoring Flow

After the proposed slice is explicitly accepted and implemented, the intended bundled-development flow is:

1. Start from the checked-in non-executable bundled sample and pass its manifest/root explicitly; the Kit does not discover Plugin directories.
2. Declare package identity, package version, host compatibility, and family-specific metadata.
3. Reference only bundle-relative resources contained by the package root.
4. Run the developer validator against the same strict parser used by the main catalog.
5. Run the shared valid/invalid fixture and conformance suite.
6. Confirm the manifest/resource inputs affect the release-source fingerprint and electron-builder allowlist.
7. Validate the Windows-host shared `win-unpacked/resources/app.asar` candidate used for portable and NSIS.
8. Review typed public diagnostics without exposing absolute paths or executable internals.

The concrete command names and file layout will be documented only after they exist and pass the accepted tests.

## Planned Manifest Reference

The exact serialization and fields are not yet accepted. The canonical contract must eventually cover these concepts:

- manifest schema version
- stable package ID, display name, and package version
- compatible MDV/Plugin API range
- one or more family-specific capability declarations
- optional Skill contribution metadata and bundle-relative resource references
- requested permissions per capability, which are requests rather than grants

Mutable enable state, resolved absolute paths, approval decisions, secrets, and runtime health do not belong in immutable manifest data.

## Terms

- Conformance Kit: validator, fixtures, sample metadata, diagnostics, and package checks that prove metadata matches the catalog contract
- type symmetry: a check that the canonical machine-readable schema, runtime parser, and TypeScript view accept and describe the same shapes
- source fingerprint: a digest of release build inputs used to reject a candidate produced from stale source or resources

## Diagnostics Expectations

Every validation result must provide a contract-defined diagnostic code and distinguish at least:

- invalid schema or unknown version
- incompatible host/capability version
- duplicate package/capability ID
- missing resource or path escape
- digest or packaged-resource mismatch
- source-fingerprint/candidate staleness

Public UI diagnostics remain bounded and path-redacted. Developer diagnostics may identify the failing bundle-relative field or resource and provide remediation guidance.

## Capability Rules

### Codeblock Driver

Future only. It must accept an explicit fenced block and return an MDV-owned safe render result. It cannot return arbitrary HTML/SVG or obtain file/network authority by default.

### Text Rendering Engine

Future only. It must return an allowlisted MDV-owned text/render tree and cannot turn ordinary document text into executable behavior.

### LLM Tool Driver

Future only. Each Tool keeps a target/action-specific OpenAI schema, runtime validator, permission/approval contract, structured result, and side-effect policy in the main process.

### Skill Contribution

Future only. Skill metadata/resources are consumed by `AI-CFG-002`, not dispatched as a Driver. A Skill may explain how to use a Tool but cannot add or authorize that Tool. Scripts remain non-executable until a separate trust/sandbox contract is accepted.

## Security Checklist

- Treat all manifest/resource input as untrusted until strict validation succeeds.
- Never use last-wins identity collision handling.
- Reject paths that escape the located package root.
- Read only an explicitly supplied manifest/root and the contained resources it declares; do not enumerate directories to discover packages.
- Never expose raw Electron/IPC or Node.js access to renderer Plugin code.
- Never insert Plugin-origin arbitrary HTML/SVG into a trusted MDV surface.
- Treat declared permissions as requests; authoritative runtime checks remain main-owned.
- Never treat a Skill or validator result as execution authorization.
- Preserve existing Windows packaging and candidate-freshness checks.

## Compatibility And Publication

The early Kit is internal/experimental. It provides no third-party semantic-version compatibility promise.

Before MDV publishes a Public SDK, it must separately accept trust/loading, install/update/rollback, compatibility/deprecation/migration, family-specific execution isolation, external conformance fixtures, and packaged E2E contracts. See [Public SDK Readiness Gates](plugin-developer-kit-design.md#public-sdk-readiness-gates).

## Current Contribution Rule

This guide records the current contract proposal only. Plugin runtime, Kit implementation, SDK publication, driver execution, Skill injection, and third-party loading remain blocked until their stated backlog/acceptance gates are satisfied.
