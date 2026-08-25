# ENG-BL-004 Plugin Architecture Inventory

- Date: 2026-08-24
- Proposal revision: 2026-08-25, internal Developer Kit / Public SDK staging added
- PERT task: `INVENTORY_PLUGIN_ARCHITECTURE`
- Result: complete
- Backlog result: `ENG-BL-004` inventory complete
- Plugin runtime result: no Plugin implementation slice accepted; `PROPOSED-PLUGIN-SLICE-001` remains `future_requires_acceptance`
- Governing contract: [Plugin Architecture Design](../plugin-architecture-design.md)
- Decision records: [ADR 0030](../adr/0030-capability-separated-plugin-architecture.md), [ADR 0017](../adr/0017-ai-customization-layer-boundaries.md)

## Inventory Conclusion

MDV has several fixed extension points, but no common plugin runtime. Code block rendering, Mermaid viewer lifecycle, Markdown rendering, and AI tool execution each use a different owner and failure boundary. The correct common layer is therefore package identity, compatibility, lifecycle state, diagnostics, and provenance—not a shared executable hook.

The accepted AI customization decision treats Skill as an independent workflow layer. The `AI-CFG-002` product runtime is an accepted-active backlog item, but it remains `inventory_pending`, unimplemented, and unauthorized for implementation until its own gate is satisfied. A Skill is not a fourth executable driver. It may refer to tools provided by LLM Tool Drivers, but it does not inherit or grant their authority. This inventory accepts the ownership boundary for a possible Plugin-origin Skill contribution; actual Plugin distribution, discovery, loading, and request injection remain unaccepted.

In practical terms, a Skill gives the LLM instructions, references, and templates for how to perform a task. If it tells the LLM to use a save Tool, that Tool still performs its own target validation, permission check, and approval flow. If the future source package is unavailable, the Skill is not eligible to load.

Developer experience uses the same separation principle. The first proposal supports MDV/bundled developers with a manifest contract, validator, fixtures, metadata-only sample, diagnostics, conformance checks, and guide. It does not present those artifacts as a Public SDK. External compatibility and executable authoring remain behind later trust, distribution, versioning, and family-contract gates.

## Current Responsibility Map

| Area | Current owner and implementation | Current contract | Inventory implication |
| --- | --- | --- | --- |
| Editor preview code blocks | `src/App.tsx` splits fenced blocks with a local regular expression and resolves a local `Map<string, CodeBlockRenderer>` | Only `mermaid` has a specialized renderer; unknown languages use `DefaultCodeBlock` | There is a fixed registry, not a discovery or compatibility contract |
| AI chat code blocks | `src/ai-chat/ChatMarkdown.tsx` repeats the fenced-block splitter and renderer registry | It independently registers `mermaid` and falls back to the default renderer | A future Codeblock Driver must remove registry drift without broadening renderer trust |
| Mermaid inline rendering | Renderer calls `mermaid.render()` and inserts returned SVG in the same renderer surface | Render failure falls back to the original code block | Generated SVG already crosses a sensitive DOM boundary and cannot become the generic plugin payload |
| Mermaid viewer | `src/electron/main/main-ipc.cts` accepts bounded `code + theme`; `window-controller.cts` owns one isolated auxiliary window per editor | Main rejects non-editor senders and invalid payloads; HTML/SVG never crosses IPC | This is a future Codeblock Driver consumer candidate, not a generic viewer contract |
| Editor Markdown rendering | `src/App.tsx` uses `markdown-it` with `html: true` and inserts the result into the preview DOM | Runtime preview has no complete shared sanitizer; export uses a separate sanitizer | A plugin must not return raw HTML into this unresolved boundary |
| AI chat Markdown rendering | `src/ai-chat/ChatMarkdown.tsx` uses `html: false`, but inserts Markdown renderer output and Mermaid SVG into the DOM | Safer than editor raw HTML, but not text-only | Text Rendering Engine output needs an MDV-owned safe representation and surface-specific policy |
| HTML export | `src/App.tsx` clones rendered content and applies `sanitizeExportHtmlFragment()` | Export removes dangerous elements, attributes, and schemes | Export policy cannot be reused as proof that runtime plugin rendering is safe |
| LLM tool definitions | `src/electron/main.cts` owns a static list of OpenAI function schemas | Top-level schemas are validated and runtime argument rules remain tool-specific | LLM Tool Driver discovery must not merge help, OpenAI schema, and runtime validation into one permissive shape |
| LLM tool execution | `executeAiToolCall()` validates and dispatches each tool in the main process | File, network, editor, and context operations keep their current permission and proposal gates | A Skill or Plugin declaration cannot bypass those gates |
| OpenAI request assembly | Main passes fixed instructions and static function tools into the Responses tool loop | There is no product Skill selection, loading, or provenance in the request | `AI-CFG-002` remains the owner of Skill eligibility and injection diagnostics |
| Renderer desktop access | `electron/preload.cjs` exposes explicit IPC methods; `src/shims.d.ts` types the renderer boundary | BrowserWindows use `contextIsolation: true`, `nodeIntegration: false` | Plugin-facing renderer access must be narrower typed capabilities, never raw IPC/Electron |
| Window and request safety | `window-controller.cts` owns expected renderer documents, top-level navigation denial, new-window denial, and packaged `file:` subresource restriction | Only application renderer assets are trusted automatically | Future isolated plugin renderers require the same or stricter entry/resource ownership checks |
| Settings | Main process sanitizes one fixed settings schema and distributes sanitized state | No plugin installation, lifecycle, or per-capability permission registry exists | Immutable manifest facts, mutable enable state, and derived diagnostics must be separate models |
| Packaging | Vite declares a fixed set of HTML entries; electron-builder packages `dist`, `electron`, mdast runtime, and `package.json` into `asar` | No plugin resource root or packaged manifest verification exists | First implementation must prove packaged metadata and referenced resources before executable loading |
| Repository Skills | `.agents/skills/*/SKILL.md` is available to development agents | These are contributor/runtime customization assets, not MDV product Skill runtime | Product diagnostics must not mistake repository-development Skills for enabled MDV assistant Skills |

## Confirmed Current Boundaries

1. Main process owns current privileged AI tool execution, runtime validation, permission decisions, and authoritative desktop operations.
2. Renderer receives current desktop capabilities only through the typed preload boundary; application BrowserWindows do not expose Node.js or arbitrary IPC.
3. Existing code block, Mermaid, Markdown, AI tool, settings, window, and packaging paths are fixed application contracts. None implements generic Plugin discovery or product Skill loading.
4. Current packaging has an explicit electron-builder `files` allowlist and release-source fingerprint input set. There is no Plugin resource root, so a future bundled resource is not covered merely by calling it bundled.

## Decided Requirements For Future Slices

1. Main process owns Plugin discovery decisions, compatibility evaluation, lifecycle state, permissions, privileged execution, and authoritative diagnostics.
2. A Plugin declaration cannot grant renderer Node.js or arbitrary IPC access.
3. Codeblock Driver and Text Rendering Engine never return raw HTML/SVG for direct insertion into a trusted renderer.
4. LLM Tool Driver exposes one explicit action schema and one runtime validator per tool. Help and introspection do not replace runtime validation.
5. Skill selection and instruction loading are customization behavior. Tool authentication, authorization, approval, and mutation safety remain enforced by the owning tool/runtime.
6. A package-level disabled, invalid, incompatible, or quarantined state makes all its capabilities and Skill contributions unavailable. Enabling one Skill cannot override the package state.
7. Skill-level enabled state is distinct from package state so a user can disable one workflow without changing unrelated capabilities from the same future package.

## Shared Lifecycle Model

The common model contains three kinds of state that must not be collapsed.

### Declared facts

Immutable package data:

- `manifestVersion`
- stable package `id`, display name, and package `version`
- MDV/API compatibility declaration
- capability declarations, each with its own kind-specific payload
- optional Skill contribution metadata and bundle-relative resource path
- requested permissions per capability, never one implicit package-wide authority grant

### Located facts

Main-owned observations:

- origin: `bundled`, future `user-installed`, or future `workspace-local`
- resolved root and referenced resource existence
- content digest and packaged/runtime path agreement
- signature or trust evidence when an origin requires it

Paths are bundle-relative, cannot escape the package root, and do not become renderer-visible filesystem paths.

### Runtime evaluation

Derived status:

- `ready`
- `disabled`
- `invalid`
- `incompatible`
- `blocked-permission`
- `quarantined`
- `failed`

Identity collisions do not use origin precedence or last-wins shadowing. Conflicting packages stay unavailable until an explicit resolution contract exists.

## Capability Contracts

### Codeblock Driver

- Input: explicit fenced code, normalized language, parsed metadata, theme, and target surface.
- Output: an MDV-owned typed render result or a structured failure; never arbitrary HTML/SVG.
- Owner: renderer may materialize an approved safe render tree; any privileged preparation or isolated renderer lifecycle remains main-owned.
- Permissions: none by default. File/network access requires a separately declared and approved privileged operation.
- Failure: show the original fenced code with a bounded diagnostic. A driver crash or timeout must not remove document content or block other blocks.

The exact safe render-result union remains an implementation-slice design item. Until that contract is accepted, a driver cannot execute.

### Text Rendering Engine

- Input: ordinary Markdown-derived text plus explicit surface/locale/theme context.
- Output: an MDV-owned allowlisted text/render tree.
- Owner: renderer materializes the tree under the surface sanitizer/navigation policy.
- Permissions: no implicit file, network, code-block selection, or executable behavior.
- Failure: preserve the original text or built-in rendering; never fall back to plugin-origin raw markup.

This family cannot be used to convert normal document text into an action trigger.

### LLM Tool Driver

- Input: model function-call arguments validated against one driver-specific action schema and runtime validator.
- Output: structured JSON result or structured error.
- Owner: main process owns registration, permission evaluation, execution, timeout, logging redaction, and side-effect classification.
- Permissions: explicit per action. Existing editor proposal, fetch ACL, secret, and target-kind rules remain controlling boundaries.
- Failure: report a typed failure without broadening accepted payload shapes or blindly retrying ambiguous side effects.

Help/introspection, OpenAI-facing schema, and runtime validation remain separate protocol responsibilities even when generated from shared metadata.

### Skill Contribution

- Input: Skill metadata, instructions, and declared resources selected for a user request.
- Output: a provenance-bearing instruction/resource contribution to the LLM request; it is not a renderer result or privileged action.
- Owner: `AI-CFG-002` owns matching, explicit invocation, enabled state, loading, token budgeting, and loaded/not-loaded diagnostics.
- Tool relationship: a Skill may name or explain LLM Tool Driver capabilities, but actual calls still pass the registered tool schema, runtime validation, permission, and approval gates.
- Failure: do not load the Skill and expose a reason such as condition mismatch, disabled package, disabled Skill, incompatible version, missing resource, or validation failure.

Skill-bundled script execution is not accepted. Scripts may be inventoried as resources, but execution requires a separate trust, sandbox, permission, and failure-isolation contract.

## Placement Candidate Comparison

| Origin | Strengths | Dependencies and risks | Inventory decision |
| --- | --- | --- | --- |
| Bundled | Release-reviewed, deterministic identity, and eligible to share the application updater/version boundary | Requires application release for updates; a resource root must be added to both the package allowlist and release-source fingerprint, or be intentionally contained in an existing fingerprinted input | Selected as the only origin for the proposed first implementation slice |
| User-installed | Independent updates and reusable personal capabilities | Signature/trust, install transaction, rollback, path ownership, Windows ACL, update compatibility, and executable-code isolation are unresolved | Future; no scan, install, or execution contract accepted |
| Workspace-local | Project portability and reviewable repository ownership | Opening a document could discover untrusted code/instructions; repository trust, ID collision, relative path, and portable/installer behavior are unresolved | Future; no automatic discovery contract accepted |

Portable and installer packages must consume the same Windows-host `win-unpacked/resources/app.asar` candidate, produced through the existing shared `--prepackaged` path. User data paths or installer registry state cannot be required for the bundled first slice. The existing `signAndEditExecutable=false`, post-package `rcedit`, and UNC-launch containment workarounds remain controlling constraints.

## Countermeasure Comparison

| Candidate | Root-cause proximity | Strength and verifiability | Side effects | Residual risk | Result |
| --- | --- | --- | --- | --- | --- |
| A. Main-owned bundled manifest catalog and diagnostics | Directly addresses missing identity, compatibility, packaging, state, and provenance contracts | High: schema, collisions, digests, paths, IPC, and packaged artifacts can be tested without executing plugin code | Adds metadata/runtime surface but does not change rendering or tools | Does not yet prove capability dispatch | Proposed first implementation slice |
| B. Convert Mermaid directly into the first Codeblock Driver | Exercises a real renderer and viewer | Medium-high, but requires safe render-result, duplicated registry migration, HTML/SVG policy, and Electron regression together | High regression surface in current built-in behavior | Lifecycle defects can be hidden behind a successful single built-in | Defer until catalog contract is proven |
| C. Implement `AI-CFG-002` Skill runtime first | Delivers visible LLM workflow value and diagnostics | High for Skill behavior, low for Codeblock/Text/Tool plugin lifecycle | Couples the architecture inventory to a separate AI-P2 product slice | Does not validate shared driver lifecycle | Keep as separate backlog owner; connect through contribution contract |
| D. Start with user/workspace dynamic loading | Maximizes apparent extensibility | Low under current evidence; trust, installer/portable, isolation, and recovery are unresolved | Executes untrusted code/instructions early | Highest security and support risk | Blocked |

Candidate A is the strongest candidate for proving the missing common Plugin lifecycle; it is not asserted to be the next product priority. It is stronger than a documentation-only mitigation because it can create an enforceable runtime/package contract while keeping executable behavior behind a later acceptance gate. The normal product priority remains `MD-BL-021` unless this proposed slice is explicitly accepted.

### Developer experience staging

The catalog proposal should include an internal/experimental Developer Contract and Conformance Kit because its schema, parser, diagnostics, fixtures, and package checks are the same contract surfaces contributors must author against. Calling this a Public SDK would be premature: user/workspace discovery, third-party trust/load, install/update/rollback, compatibility/deprecation/migration, family execution, and public support obligations are still blocked.

| Developer-support option | Drift prevention | Scope/risk | Result |
| --- | --- | --- | --- |
| Guide/schema only | Low: prose and schema cannot prove catalog/author-tool agreement | Smallest slice, but no mechanical parity check | Reject as insufficient |
| Catalog first, Kit in a later slice | Medium: catalog can be tested internally, but author tooling may derive a second parser/diagnostic model later | Smaller first release, higher contract-drift risk and another acceptance boundary | Not selected |
| Catalog plus shared Internal Kit | High: one parser/diagnostic corpus mechanically checks catalog and author-facing validation | Larger slice; controlled by designing and implementing the Kit after the catalog contract within the same acceptance unit | Selected proposal |
| Public SDK immediately | Premature: executable and compatibility behavior is not defined | Crosses unresolved third-party trust, distribution, support, and family-execution boundaries | Blocked |

The early Kit targets MDV maintainers and bundled-package developers only. Public SDK readiness is governed by [Plugin Developer Kit And Public SDK Design](../plugin-developer-kit-design.md).

## Proposed First Implementation Slice

`PROPOSED-PLUGIN-SLICE-001` is `future_requires_acceptance`. It has not been assigned a formal backlog ID and is not authorized for implementation.

### Scope statement

Add a main-owned, bundled-only Plugin Manifest Catalog, read-only diagnostics surface, and Internal Developer Contract/Conformance Kit. It validates package identity, compatibility, capability-specific declarations, optional Skill contribution metadata, bundle-relative paths, content digests, and packaged resource agreement. It lets MDV/bundled developers author and test metadata against the same parser/diagnostics without dispatching a Driver or injecting a Skill.

### Allowed scope after explicit acceptance

- versioned manifest types and strict parser
- explicitly imported bundled catalog; no automatic directory discovery/enumeration
- immutable manifest facts, located facts, and derived runtime status kept as separate types
- ID/capability collision rejection, compatibility evaluation, path containment, and digest verification
- typed read-only main/preload/renderer diagnostics contract
- a small Settings/About diagnostics surface showing ID, version, origin, status, capabilities, Skill contributions, and failure reason
- one canonical machine-readable manifest contract with checked/generated TypeScript symmetry
- validator API/CLI using the main catalog parser and diagnostic registry
- shared valid/invalid fixtures, non-executable bundled sample metadata, diagnostic reference, conformance helper, and developer guide
- conformance helper input is one explicit manifest/package root or packaged `app.asar` view; it reads only the manifest and declared contained resources without automatic discovery/enumeration
- package configuration and release checks that either keep every bundled Plugin input under an existing release-fingerprinted root or add all manifest/resource inputs to `computeReleaseSourceFingerprint()` and electron-builder's `files` allowlist
- Windows-host candidate checks that inspect the shared `win-unpacked/resources/app.asar`, reject a stale candidate after a Plugin input changes, and prove portable/NSIS are built from the same `--prepackaged` input
- node, renderer, Electron, and packaging contract tests appropriate to the touched boundaries

### Blocked scope

- driver dispatch or executable entrypoint loading
- Mermaid migration
- Skill selection, request injection, or script execution
- user-installed/workspace-local discovery
- install, uninstall, marketplace, remote update, or signature UX
- Public SDK/package publication, third-party compatibility/support promise, or external executable sample
- new file/network/editor permissions
- arbitrary HTML/SVG or renderer Node access

### Acceptance tests

1. Valid bundled manifests produce stable catalog entries and provenance.
2. Unknown manifest/capability versions, missing required fields, path traversal, duplicate IDs, duplicate capability IDs, and incompatible MDV versions fail closed with structured diagnostics.
3. Optional Skill metadata is visible as a contribution, but cannot become loaded or executable through this slice.
4. Package invalid/incompatible/failed states make every declared contribution unavailable in diagnostics. `disabled` and `quarantined` remain lifecycle states for later slices; this read-only slice creates no enable-state persistence or quarantine source.
5. Renderer receives no absolute package path, executable module reference, secret, or raw manifest object beyond the typed public diagnostics contract.
6. The Windows-host shared `win-unpacked/resources/app.asar` contains the declared resources and matching digests, and portable/NSIS are derived from that same `--prepackaged` input without bypassing the existing Windows packaging workarounds.
7. Changing any manifest/resource input changes the release-source fingerprint; `release:check:candidate` rejects the older candidate, and the electron-builder `files` allowlist includes the actual packaged root.
8. Existing Markdown preview, Mermaid rendering/viewer, AI tool schemas/dispatch, settings, and exports remain behaviorally unchanged.
9. Developer validator and main catalog produce equivalent typed outcomes and diagnostics for the shared fixture corpus.
10. The bundled sample is metadata-only; it cannot dispatch a Driver or load/inject/run a Skill.
11. Schema/types/docs/fixtures are generated from or checked against one canonical contract, and the guide labels unavailable commands/APIs honestly.
12. No Public SDK package, stable compatibility claim, or third-party loading surface is introduced.

## Evidence Chain

Labels distinguish direct observation from accepted design and comparative inference. `✅` means high confidence from direct readback or governing decisions; `➖` means a provisional inference that must be tested by a later slice.

### C-PLUGIN-001 📜✅ — Observed fact

Claim: MDV has fixed built-in extension points but no common plugin discovery, lifecycle state, compatibility, or packaged-resource contract.

Evidence:

- E-PLUGIN-001: [`src/App.tsx`](../../src/App.tsx#L1126) and [`src/ai-chat/ChatMarkdown.tsx`](../../src/ai-chat/ChatMarkdown.tsx#L145) independently create Mermaid-only renderer maps.
- E-PLUGIN-002: [`src/electron/main.cts`](../../src/electron/main.cts#L2631) defines the static `aiToolDefinitions` list and dispatches by explicit tool name in [`executeAiToolCall()`](../../src/electron/main.cts#L4699).
- E-PLUGIN-003: [`vite.config.ts`](../../vite.config.ts#L18) and [`package.json`](../../package.json#L72) declare fixed renderer/package inputs and no Plugin resource root.

### C-PLUGIN-002 📜✅ — Accepted design decision

Claim: Skill is a separate workflow/customization contribution and must not be treated as a fourth executable driver or an authorization source.

Evidence:

Basis:

- E-PLUGIN-004: [ADR 0017](../adr/0017-ai-customization-layer-boundaries.md) accepts Skill as a separate customization layer; [current-backlog](../current-backlog.md#ai-p2-current-product-gaps) keeps the `AI-CFG-002` runtime `inventory_pending`.
- E-PLUGIN-005: Current Tool schema/dispatch remains main-owned at [`src/electron/main.cts`](../../src/electron/main.cts#L2631), while renderer capabilities remain explicit in [`electron/preload.cjs`](../../electron/preload.cjs).
- E-PLUGIN-006: [OpenAI Skills documentation](https://learn.chatgpt.com/docs/build-skills) defines Skills as reusable workflows that package instructions, resources, and optional scripts. MDV adopts the design rule that workflow loading does not replace its separately owned Tool authentication, authorization, approval, or execution contracts.

### C-PLUGIN-003 📜➖ — Comparative design inference

Claim: A bundled-only manifest catalog is the strongest first implementation slice currently supportable without crossing the unaccepted executable-loading boundary.

Reasoning basis:

- E-PLUGIN-007: The governing Plugin Architecture contract blocks automatic Plugin directory discovery/enumeration, dynamic loading, user code execution, Mermaid migration, and marketplace behavior until a later slice is explicitly accepted. The proposed internal validator is limited to one explicitly supplied manifest/root and its declared contained resources.
- E-PLUGIN-008: Bundled resources can be brought under the application release and `asar` boundary with explicit package/fingerprint wiring, while user/workspace trust and update contracts do not exist.
- E-PLUGIN-009: The proposed acceptance tests can verify manifest parsing, collisions, compatibility, path containment, diagnostics, fingerprint freshness, and packaged resource agreement independently of driver execution. This remains an inference until the slice is accepted and tested.

### C-PLUGIN-004 📜✅ — Accepted design boundary

Claim: Developer support must begin as an internal/bundled conformance Kit, while Public SDK publication requires later third-party trust, distribution, versioning, and family-execution decisions.

Basis:

- E-PLUGIN-010: The current [first-slice proposal](../plugin-architecture-design.md#proposed-first-implementation-slice) specifies one canonical manifest contract, strict catalog parser, typed diagnostics, shared fixtures, and package conformance as planned single-source requirements; none is claimed as implemented.
- E-PLUGIN-011: [Plugin Architecture Design](../plugin-architecture-design.md#blocked-scope) blocks user/workspace loading, dynamic execution, and public compatibility guarantees.
- E-PLUGIN-012: Codeblock, Text Rendering, and LLM Tool capability contracts have different input/output, permission, and failure semantics; Skill is owned by `AI-CFG-002` rather than a Driver dispatcher.

Actions:

- A-PLUGIN-001 🚀 [実行済み]: Record the completed inventory, lifecycle/capability boundaries, Skill connection, placement comparison, and proposed slice in design, ADR, backlog, and PERT documents. References: C-PLUGIN-001, C-PLUGIN-002, C-PLUGIN-003.
- A-PLUGIN-002 ⛔ [保留]: Implement `PROPOSED-PLUGIN-SLICE-001`. References: C-PLUGIN-003, C-PLUGIN-004. Blocked until the user explicitly accepts the stated allowed/blocked scope and current-backlog records a formal item.
- A-PLUGIN-003 🚀 [実行済み]: Add the internal Developer Kit/Public SDK staging contract, developer guide, proposal acceptance tests, ADR rationale, backlog scope, and PERT work. Reference: C-PLUGIN-004.

## Next Gate

The governed PERT is [plugin-architecture.pert](plugin-architecture.pert). The only Plugin Architecture continuation is the blocked acceptance task. Without explicit first-slice acceptance, normal product ordering returns to `docs/current-backlog.md`.

## Inventory Verification

- Direct code/doc readback covered the responsibility-map paths and the current packaging/release inputs.
- `perttool document check`, `perttool dag analyze --schedule both`, and `perttool dag next --format json` passed; the last command reported no runnable Plugin task and only `WAIT_FIRST_SLICE_ACCEPTANCE` as blocked.
- For the 2026-08-25 proposal revision, `npm run lint`, `npm run build`, `npm run test:release`, `git diff --check`, local Markdown target checks, and required early contract review passed.
- No runtime source, packaged resource, or existing Mermaid/Markdown/AI Tool behavior changed in this inventory action.
