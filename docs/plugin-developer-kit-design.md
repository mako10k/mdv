# Plugin Developer Kit And Public SDK Design

## State

- `contract_state: active_contract`
- Implementation backlog: `ENG-BL-005` (accepted from `PROPOSED-PLUGIN-SLICE-001`)
- `backlog_state: completed`
- Internal Developer Kit: implemented, packaged-conformance validated, and exact-diff reviewed
- Public third-party SDK: future, requires a separate decision and backlog acceptance
- Governing architecture: [Plugin Architecture Design](plugin-architecture-design.md)
- Developer entrypoint: [Plugin Developer Guide](plugin-developer-guide.md)

The 2026-08-25 user message explicitly accepted the recorded first-slice allowed / blocked scope and authorized implementation as ENG-BL-005. Public SDK, executable Driver/runtime surfaces, Skill loading, and third-party distribution remain unaccepted.

## Objective

Plugin authoring support is divided by audience and compatibility promise.

1. The Internal Developer Kit helps MDV maintainers and bundled-package developers author and validate catalog metadata before executable Plugin loading exists.
2. If separately proposed and accepted later, a Public SDK could help external Plugin developers build supported executable packages after trust, distribution, versioning, and family-specific execution contracts are proven. It is an option behind readiness gates, not a committed roadmap item.

The first stage must not be called a stable public SDK. A manifest parser and TypeScript types do not by themselves provide a loadable third-party Plugin API or compatibility guarantee.

Here, a Conformance Kit means the validator, fixtures, sample metadata, diagnostic reference, and package checks used to prove that authored metadata matches MDV's catalog contract.

## Audience Boundary

### Internal / Bundled Developer

The early Kit is for contributors working in the MDV repository and for release-reviewed bundled package metadata. It detects identity, compatibility, path, digest, collision, diagnostics, and packaging failures before execution.

It does not let an arbitrary third party install or run a Plugin in MDV.

### External Plugin Developer

The later Public SDK is for developers outside the MDV release boundary. Publishing it means MDV has accepted an API support obligation, including documented compatibility, deprecation, migration, trust, installation, update, recovery, and packaged conformance behavior.

## Internal Developer Kit Contract

The ENG-BL-005 Kit contains:

- one canonical machine-readable manifest schema and a drift check for any generated or derived TypeScript types
- a strict validator API and command-line wrapper that use the same parser and diagnostic codes as the main-owned catalog
- valid and invalid fixtures for schema version, capability family, compatibility, path containment, missing resource, digest, and ID collision cases
- a non-executable bundled sample package that demonstrates identity, compatibility, capability declarations, and optional Skill contribution metadata
- a canonical diagnostic catalog with code, public message, developer detail, severity, and remediation guidance
- a conformance test helper that accepts one explicitly supplied manifest/package root or packaged `app.asar` view and reads only that manifest plus its declared, contained resources, without directory discovery/enumeration, Driver execution, or Skill loading
- source-fingerprint, electron-builder allowlist, stale-candidate, and Windows-host shared-`--prepackaged` checks required by the release contract
- the [Plugin Developer Guide](plugin-developer-guide.md), manifest reference generated or checked against the canonical schema, and a security/packaging checklist

The implemented layout and commands are:

- canonical contract: `plugin-contract/contract.json`
- generated JSON Schema: `plugin-contract/manifest.schema.json`
- generated TypeScript/public diagnostics declarations: `src/electron/main/plugin-manifest-contract-types.generated.d.cts`
- generated CommonJS runtime contract and bundled registration list: `src/electron/main/plugin-manifest-contract.generated.cts`
- shared runtime parser/catalog: `src/electron/main/plugin-catalog.cts`
- validator/conformance API: `scripts/plugin-conformance.mjs`
- validator CLI: `npm run plugin:validate -- --root <package-root> --manifest plugin.json [--host-version x.y.z] [--json]`
- packaged view CLI: `npm run plugin:validate -- --asar <app.asar> --manifest <bundle-relative-plugin.json> [--host-version x.y.z] [--json]`
- contract generation/check: `npm run plugin:contract:generate` and `npm run plugin:contract:check`
- shared fixture tests: `npm run test:plugin`
- metadata-only sample: `plugins/bundled/diagnostics-sample/`
- generated manifest/diagnostic reference: [Plugin Manifest Reference](plugin-manifest-reference.md)

The CLI requires exactly one explicit `--root` or `--asar` source. It never enumerates directories, rejects missing option values, validates real-path containment, rejects symlinked package paths, and reads only the manifest plus its declared resources.

## Single-Source And Symmetry Rules

- The main catalog and developer validator use one strict parsing implementation and one diagnostic registry.
- TypeScript compile-time types never replace runtime validation of Plugin input.
- Machine-readable schema, TypeScript types, documentation tables, fixtures, and diagnostics must be generated from or checked against one canonical contract.
- The developer command and main-owned catalog must agree on success/failure for the same input corpus.
- Public diagnostics exclude absolute paths, executable module references, secrets, and raw unbounded manifest data; developer-only diagnostics may identify a bundle-relative field/resource location.
- Packaged conformance checks inspect the same Windows-host `win-unpacked/resources/app.asar` candidate used to create portable and NSIS artifacts.

## Capability Family Structure

Shared support is limited to package identity, versioning, compatibility, lifecycle vocabulary, provenance, schema validation, and diagnostics.

Family-specific SDKs/testkits remain separate because their inputs, outputs, permissions, and failure semantics differ:

- Codeblock Driver SDK / Testkit: future safe render-result and fallback contract
- Text Rendering Engine SDK / Testkit: future allowlisted text/render-tree contract
- LLM Tool Driver SDK / Testkit: future OpenAI schema, runtime validator, permission, approval, and side-effect contract

Skill is not a fourth Driver SDK. A future Skill contribution schema/testkit is owned jointly by Plugin package provenance rules and the `AI-CFG-002` workflow-loading contract; it cannot add Tool authority or executable script permission.

Exact package names are intentionally not fixed by this design.

## Internal Kit Compatibility Promise

Until a separate Public SDK decision is accepted:

- all Kit artifacts are internal/experimental
- only the catalog manifest and validation behavior accepted for the bundled slice may be relied upon inside the MDV repository
- Driver execution APIs, third-party loading, semantic-version compatibility, marketplace compatibility, and external support windows are not promised
- incompatible Kit changes require the design, fixtures, guide, and bundled sample to change together in one reviewed diff
- a successful validator result means only that metadata/package conformance passed; it does not mean a Driver or Skill is executable

## Public SDK Readiness Gates

A Public SDK proposal may be made only after all of the following have separate accepted contracts and evidence:

1. third-party package discovery and explicit trust/consent policy
2. installation transaction, signature/integrity, update, rollback, disable, quarantine, and recovery behavior
3. API versioning, compatibility matrix, support window, deprecation notice, and migration policy
4. at least one accepted family-specific execution/isolation contract proven with a bundled reference consumer
5. permission denial, timeout/crash isolation, ambiguous side-effect, and safe fallback conformance for the published family
6. Windows-host packaged E2E conformance and release-source freshness checks
7. external-form sample consumer and conformance fixtures that do not depend on private MDV internals
8. explicit backlog acceptance for public distribution and compatibility guarantees

Passing one bundled reference example is necessary evidence for a family but does not automatically authorize Public SDK publication.

## Public SDK Version Axes

The future Public SDK must keep these versions distinct:

- manifest schema version: how package metadata is parsed
- MDV Plugin API compatibility range: which host versions may consider the package
- capability-family contract version: the input/output/permission contract for one Driver family
- package version: the Plugin package release identity
- SDK/testkit version: the developer dependency release

The later versioning ADR must define compatibility evaluation, prerelease policy, deprecation, migration, and failure diagnostics before any axis is advertised as stable.

## First-Slice Acceptance

ENG-BL-005 is release-ready only when:

1. the developer validator and main catalog return equivalent typed results for the shared fixture corpus
2. the sample is metadata-only and cannot register/dispatch a Driver or inject/run a Skill
3. every documented field and diagnostic is checked against the canonical contract
4. invalid and incompatible packages fail closed with actionable bundle-relative diagnostics
5. packaged validation covers fingerprint freshness, actual packaged resources, and the shared Windows-host candidate path
6. the guide clearly labels implemented commands separately from future examples and states that third-party/public compatibility is unavailable
7. no public npm package, stable SDK claim, dynamic discovery, or execution API is introduced

Items 1-7 have implementation, automated/package evidence, and final exact-diff review recorded in the [ENG-BL-005 work memo](release-work-memos/eng-bl-005-plugin-first-slice.md). The bounded Internal Kit slice is release-ready; Public SDK readiness remains a separate future decision.

## Blocked Scope

- publishing a stable or public Plugin SDK
- promising semantic-version compatibility or external support windows
- user-installed/workspace-local discovery or loading
- automatic Plugin directory discovery/enumeration; the internal helper may inspect only one explicitly supplied manifest/root and its declared contained resources
- Plugin install/update/rollback/marketplace UX
- third-party executable examples
- generic Driver interfaces that erase family-specific validity, permission, or failure rules
- Skill loading, request injection, or script execution
- treating validator success as execution authorization

## Transition Rule

Moving from Internal Developer Kit to Public SDK is a decision change, not a normal refactor. It requires an updated current design, a versioning/distribution ADR, a formal backlog item with allowed/blocked scope, and explicit user acceptance before implementation or publication.
