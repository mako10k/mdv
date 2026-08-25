# Plugin Architecture Design

## State

- `contract_state: active_contract`
- Governing inventory backlog: `ENG-BL-004`
- `backlog_state: completed`
- `inventory_status: inventory_confirmed`
- Proposed runtime slice: `PROPOSED-PLUGIN-SLICE-001`
- Proposed runtime state: `future_requires_acceptance`
- Inventory evidence: [ENG-BL-004 Plugin Architecture Inventory](milestones/plugin-architecture-inventory.md)
- Governed plan: [Plugin Architecture PERT](milestones/plugin-architecture.pert)
- Developer experience contract: [Plugin Developer Kit And Public SDK Design](plugin-developer-kit-design.md)
- Developer entrypoint: [Plugin Developer Guide](plugin-developer-guide.md)

The 2026-08-25 request accepted only the Developer Kit/Public SDK staging design and proposal revision. It did not accept the proposed slice's allowed/blocked scope for implementation; catalog, diagnostics, Kit, runtime, and SDK implementation remain unauthorized.

## Objective

MDV に Codeblock Driver、LLM Tool Driver、Text Rendering Engine を段階的に追加できる plugin architecture を定義する。共有するのは package identity、compatibility、lifecycle state、diagnostics、provenance であり、入力、出力、permission、execution、rendering safety は capability family ごとに分離する。

Skill は fourth driver ではない。受理済みなのは Skill を独立 customization layer とする方針である。`AI-CFG-002` product runtime は `accepted_active + inventory_pending` で未実装・未許可、Plugin-origin Skill の実際の配布・読込は将来候補である。この inventory は、将来接続する場合の ownership boundary だけを確定する。Skill は LLM Tool Driver を利用する手順を提供できるが、Tool の認証、権限、approval、runtime validation を継承または上書きしない。

例えば Skill が「内容を確認して保存 Tool を使う」と LLM に指示しても、保存 Tool 側の対象確認、runtime validation、permission、approval は別に通る。Plugin package が unavailable なら、その Skill は候補にもならない。

## Inventory Result

現行 MDV には固定 extension point はあるが、共通 plugin runtime はない。

- editor preview と AI chat は別々の fenced-code splitter と Mermaid-only renderer registry を持つ。
- Mermaid viewer は bounded `code + theme` を main-owned auxiliary window へ渡す built-in contract であり、汎用 viewer ではない。
- AI tools は main process の静的 function schema と tool-name dispatcher で登録され、既存 permission / proposal / fetch safety rule を個別に適用する。
- runtime preview、AI chat、export は HTML safety policy が一致しておらず、plugin-origin raw HTML/SVG を受け入れられない。
- preload、BrowserWindow、navigation、packaging は明示 entry の allowlist で成立し、directory discovery や plugin resource root はない。
- product Skill runtime は未実装であり、`AI-CFG-002` は棚卸待ちである。

詳細な責務 map、配置候補、countermeasure 比較、Evidence Chain は [inventory](milestones/plugin-architecture-inventory.md) を正とする。

## Architecture Model

```text
Plugin package
├─ immutable manifest facts
├─ located/package facts (main-owned)
├─ derived lifecycle state (main-owned)
├─ capabilities
│  ├─ Codeblock Driver
│  ├─ Text Rendering Engine
│  └─ LLM Tool Driver
└─ optional contributions
   └─ Skill metadata/resources -> AI-CFG-002 runtime
```

Plugin package lifecycle and Skill invocation lifecycle are related but not identical.

- package disabled / invalid / incompatible / quarantined: all capabilities and Skill contributions are unavailable
- package ready + Skill disabled: other capabilities may remain available, but that Skill is not eligible
- Skill enabled: eligibility only; it grants no Tool permission and cannot override package or Tool state

## Manifest And Lifecycle Contract

### Immutable manifest facts

A manifest declares:

- manifest schema version
- stable package ID, display name, and package version
- MDV/plugin API compatibility
- capability declarations with family-specific payloads
- optional Skill contribution metadata and bundle-relative resource location
- permissions requested per capability

Manifest data does not contain mutable enabled state, resolved absolute paths, approval decisions, secrets, or runtime health.

### Located facts

Main process resolves and records:

- origin: bundled; future user-installed or workspace-local
- package root and path-containment result
- referenced resource existence
- package/resource digest
- packaged metadata and actual load-target agreement
- future signature or trust evidence

Absolute package paths and executable entry references are not exposed to renderer diagnostics.

### Derived lifecycle state

The main process derives one explicit status such as:

- `ready`
- `disabled`
- `invalid`
- `incompatible`
- `blocked-permission`
- `quarantined`
- `failed`

Package ID or capability ID collision fails closed. The runtime does not use last-wins, search-path precedence, or origin precedence to shadow one package with another.

### Enable / disable

- package enable state controls availability of the package as a whole
- Skill enable state remains owned by `AI-CFG-002`
- capability-specific enable state may be added only by a capability slice that defines persistence and recovery semantics
- a state change applies to later invocations and must not rewrite or resume an in-flight render/tool/Skill invocation

## Capability Contracts

### Codeblock Driver

- accepts only an explicit fenced code block with normalized language, parsed metadata, theme, and target surface
- returns an MDV-owned typed render result or structured failure, never raw HTML/SVG
- has no file/network authority by default
- falls back to the original fenced code on rejection, timeout, crash, or incompatible output
- isolates one block failure from other blocks and document editing

The exact safe render-result union and execution isolation mechanism are not accepted by the inventory alone. Until a later slice defines them, Codeblock Driver declarations remain non-executable metadata.

### Text Rendering Engine

- accepts ordinary Markdown-derived text with explicit surface, locale, and theme context
- returns an MDV-owned allowlisted text/render tree
- cannot select code blocks or trigger file/network actions implicitly
- cannot convert ordinary text into executable plugin behavior
- preserves original text or built-in rendering on failure; plugin-origin raw markup is never a fallback

### LLM Tool Driver

- follows the active Tool schema, target, approval, and execution contracts in [AI Chat Design](ai-chat-design.md)
- exposes one target/action-specific OpenAI schema and one runtime validator per tool
- returns structured JSON or structured error
- keeps discovery, registration, permission, privileged execution, timeout, redacted logging, and side-effect classification in main process
- does not act as a content renderer
- keeps help/introspection, OpenAI-facing schema, and runtime argument validation as separate protocol responsibilities
- does not broaden a helper to accept mixed payload representations

Existing editor proposal, target-kind, fetch ACL, secret, and mutation contracts continue to govern equivalent actions.

### Skill Contribution

- contains metadata, instructions, and declared resources selected for a user request
- is consumed by `AI-CFG-002`, not dispatched as a Plugin Driver
- may describe how to combine LLM Tool Drivers, but cannot add a Tool or bypass its validation/permission gate
- records package ID/version/digest, Skill ID/version, match or explicit-invocation reason, load result, and non-load reason in diagnostics
- fails by remaining unloaded; it does not silently fall back to an unrelated Skill

Skill scripts are resources only under this contract. Local or hosted script execution requires a separate accepted trust, sandbox, permission, timeout, network, and failure-isolation design.

## Renderer And Privilege Boundary

- main process owns package discovery, manifest validation, compatibility, lifecycle, permission, diagnostics, and all privileged operations
- renderer uses typed preload capabilities only; Node integration and raw Electron/IPC access remain unavailable
- plugin-origin content cannot inject arbitrary HTML/SVG into trusted editor, AI chat, viewer, or export surfaces
- an isolated plugin renderer, if later accepted, must have a known packaged entry, owner window lifecycle, navigation/subresource guards, CSP/resource ownership, bounded typed input, and no ambient desktop bridge
- permission declarations are requests, not grants; runtime checks remain authoritative

## Placement Contract

### Bundled

Bundled is the only origin eligible for `PROPOSED-PLUGIN-SLICE-001`. Resources become part of the MDV release/update boundary only when every manifest/resource input is inside an existing release-fingerprinted package root or is explicitly added to both `computeReleaseSourceFingerprint()` and electron-builder's `files` allowlist. Packaged verification uses the Windows-host shared `win-unpacked/resources/app.asar` input for portable and NSIS; Linux/WSL direct Windows packaging is not acceptance evidence.

### User-installed

Future only. Search path, install transaction, signature/trust, update/rollback, Windows ACL, conflict resolution, and executable isolation are unresolved. No directory scan or execution is accepted.

### Workspace-local

Future only. Repository/document trust, automatic discovery, identity collision, relative path ownership, and portable/installer behavior are unresolved. Opening a Markdown file must not execute or load workspace code/instructions implicitly.

## Mermaid Compatibility Boundary

The built-in Mermaid implementation remains unchanged.

- current editor/AI chat Mermaid rendering stays built-in
- current viewer continues accepting bounded Mermaid source plus theme, not generated HTML/SVG
- inventory may describe Mermaid as a future Codeblock Driver consumer candidate
- catalog metadata must not reroute execution or claim that Mermaid has migrated
- migration requires a later accepted slice with safe render-result, registry unification, viewer compatibility, fallback, and Electron regression evidence

## Developer Experience Boundary

Developer support is staged by audience and compatibility promise.

- Internal Developer Kit: for MDV maintainers and bundled-package developers; includes the canonical manifest contract, strict validator API/CLI, TypeScript type symmetry, fixtures, non-executable sample metadata, diagnostic reference, conformance helper, packaging checks, and developer guide
- Public SDK: for external Plugin developers; requires separate trust/load, install/update/rollback, versioning/deprecation/migration, family execution/isolation, packaged E2E, and distribution decisions

The early Kit validates metadata/package conformance only. It does not expose Driver execution, load third-party packages, publish a stable API, or guarantee semantic-version compatibility. Shared Kit support is limited to identity, versioning, compatibility, lifecycle vocabulary, provenance, parsing, and diagnostics. Codeblock, Text Rendering, and LLM Tool execution SDK/testkit surfaces remain family-specific. Skill is handled as an `AI-CFG-002` contribution, not as a fourth Driver SDK.

The exact contract is [Plugin Developer Kit And Public SDK Design](plugin-developer-kit-design.md). Moving from the internal Kit to a Public SDK is a future decision change and cannot occur automatically after one bundled reference implementation.

## Proposed First Implementation Slice

`PROPOSED-PLUGIN-SLICE-001` is a bundled-only Plugin Manifest Catalog, read-only diagnostics surface, and Internal Developer Contract/Conformance Kit.

It would:

- strictly parse explicitly imported bundled manifests without scanning directories
- keep declared, located, and derived state in separate typed models
- validate identity, compatibility, capability-specific declarations, Skill contribution metadata, path containment, digests, collisions, and packaged resource agreement
- expose bounded typed diagnostics through main/preload/renderer
- show package/capability/Skill contribution status and failure reasons in a small diagnostics UI
- provide one canonical manifest contract with checked TypeScript symmetry, a validator API/CLI using the catalog parser, shared fixtures, a non-executable bundled sample, a diagnostic reference, a conformance helper, and the developer guide
- add source-fingerprint freshness, electron-builder allowlist, Windows-host shared `app.asar`, and same-`--prepackaged` portable/NSIS release tests while preserving existing Windows packaging workarounds

It would not execute a driver, inject a Skill, run a script, migrate Mermaid, discover user/workspace packages, grant a new permission, publish a Public SDK, or promise third-party compatibility.

It also does not add mutable package enable/disable persistence or a quarantine authority. The catalog may define the broader lifecycle vocabulary for forward compatibility, but first-slice acceptance exercises only statuses derivable from immutable/located facts and validation outcomes, such as `ready`, `invalid`, `incompatible`, and `failed`.

The exact allowed/blocked scope and acceptance tests are recorded in the [inventory proposal](milestones/plugin-architecture-inventory.md#proposed-first-implementation-slice). This slice is not authorized until the user explicitly accepts that scope and current-backlog records a formal item.

## Blocked Scope

- automatic Plugin directory discovery/enumeration or dynamic module loading; an accepted internal validator may inspect only one explicitly supplied manifest/root and its declared contained resources
- user-installed/workspace-local code or instruction loading
- driver dispatch before a family-specific execution contract is accepted
- renderer Node integration, raw Electron/IPC access, or arbitrary HTML/SVG injection
- Skill request injection or script execution through Plugin Architecture alone
- merging LLM help/introspection, action schema, and runtime validation into one permissive schema
- built-in Mermaid migration or Markdown/export behavior changes
- marketplace, remote install, automatic third-party update, or public compatibility guarantees
- Public SDK/package publication, external support window, or stable semantic-version compatibility claims

## Validation Contract

- first-slice manifest/catalog tests cover valid and invalid schemas, unknown versions, incompatible versions, path traversal, missing resources, ID collisions, derivable catalog failures, and structured diagnostics
- developer validator and main catalog return equivalent typed outcomes/diagnostics for one shared fixture corpus
- the bundled sample remains metadata-only, and generated/derived types and documentation are checked against the canonical contract
- later lifecycle slices must define a main-owned configuration/trust source and persistence/recovery semantics before testing `disabled`, `blocked-permission`, or `quarantined` transitions
- family contract tests keep Codeblock, Text, LLM Tool, and Skill contribution payloads mutually invalid instead of accepting a common permissive object
- Electron tests keep typed preload/main ownership, known renderer entry, navigation denial, and owner-window lifecycle
- packaged checks compare declared metadata, resource existence, digest, and actual load target in the Windows-host shared `win-unpacked/resources/app.asar`
- release checks prove all manifest/resource inputs affect the release-source fingerprint, stale candidates fail `release:check:candidate`, the electron-builder `files` allowlist contains the packaged root, and portable/NSIS use the same `--prepackaged` input
- final packaging validation runs on the Windows host and preserves `signAndEditExecutable=false`, post-package `rcedit`, and UNC-launch containment; a Linux build is not Windows packaging evidence
- future driver tests cover valid/invalid payload, permission denial, timeout/crash isolation, fallback, disable/recovery, and ambiguous side-effect handling per family
- security-sensitive renderer or generated runtime changes use release workflow early contract review

## Next Gate

The inventory is complete. Runtime implementation remains blocked at `WAIT_FIRST_SLICE_ACCEPTANCE` in the [governed PERT](milestones/plugin-architecture.pert). If the proposed slice is not explicitly accepted, product work returns to the next item in [Current Backlog](current-backlog.md).
