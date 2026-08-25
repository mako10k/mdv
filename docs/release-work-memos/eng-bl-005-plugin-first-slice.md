# ENG-BL-005 Plugin First Slice Work Memo

This memo records contract-review and validation evidence for the accepted metadata-only Plugin Manifest Catalog and Internal Developer Kit slice. It is not a public release memo and does not authorize publication, promotion, or any blocked Plugin scope.

## Review Target

- Target: current uncommitted `ENG-BL-005` exact diff from the clean `main` worktree at `46eaebb`
- Accepted scope: bundled manifest catalog, read-only diagnostics, Internal Conformance Kit, developer guide, and package/fingerprint checks
- Blocked scope preserved: driver/Skill execution, dynamic discovery, install/update/marketplace, new permissions, Public SDK, and third-party compatibility guarantees

## Early Contract Review

- Initial consistency review: blocked on acceptance-document synchronization, symlink/root containment, schema/parser symmetry, IPC type/test symmetry, and one release test failure.
- Remediation evidence: canonical JSON Schema is validated by the shared runtime parser; explicit root and `app.asar` readers reject path escape/symlink paths; missing CLI option values fail closed; generated public diagnostics types cross main/preload/renderer; packaged contract/runtime bytes and digest checks are primary evidence; the release fixture was corrected.
- Packaging blocker-confirmation: passed for the reviewed representation. Packaged `contract.json`, generated schema, compiled catalog, and compiled generated contract are byte-compared with source; missing or stale packaged evidence fails closed.
- Consistency blocker-confirmation: passed for the reviewed representation; all five initial blockers were resolved.
- Subsequent full `tsc -b` exposed that runtime values and renderer-shared types could not remain in one generated CommonJS source under both TypeScript projects. The generator was corrected to emit one declaration-only type contract and one CommonJS runtime contract from the same canonical input. This changed reviewed generated-runtime/build wiring and therefore invalidated both early passes under the two-checkpoint rule. The one-confirmation cap is exhausted, so the adjusted representation is covered by the final exact-diff reviews rather than another early retry.

## Validation

- `npm run plugin:contract:check`: pass.
- `npm run test:plugin`: 16 pass, including missing registered package, package-root/app-root child symlink rejection, and root-level packaged manifest coverage.
- `npm run lint`: pass.
- `npm run build`: pass, including generated contract check and renderer security bundle checks.
- `npm run test:node`: 122 pass.
- `npm run test:release`: 36 pass, including stale Plugin input/contract/runtime and packaged digest fail-closed cases.
- `npm test`: 82 pass, including the bounded About Plugin diagnostics surface.
- `npm run test:e2e:electron`: 49 pass / 2 fail. The proactive draft-workspace cleanup test passed its focused rerun. The clean tracked-file auto-reload test failed again in a focused rerun; a detached clean `46eaebb` worktree was built and the same 10-second on-disk-change readback failed with the same unchanged editor content. This is confirmed pre-existing baseline behavior, not evidence of an ENG-BL-005 regression. The temporary worktree was removed.
- `npm audit --omit=dev`: 7 existing runtime findings (4 moderate, 3 high). The direct Ajv dependency was updated from vulnerable 8.17.1 to 8.20.0 and no longer appears in the audit; remaining findings are outside this slice and are not claimed fixed.
- `perttool document check docs/milestones/plugin-architecture.pert`: pass.
- `perttool dag analyze docs/milestones/plugin-architecture.pert --schedule both`: pass; no unfinished task remains after final review closure.
- `perttool dag next docs/milestones/plugin-architecture.pert --format json`: pass; no runnable task remains after final review closure.
- Initial Windows generation failed before source copy because the host process exposed `PATHEXT=.CPL` and could not execute the existing `C:\Windows\System32\robocopy.exe`. The failed action had already invalidated the old candidate and produced no replacement. A single clean retry supplied the standard process-local `PATHEXT` without changing the repository.
- The first complete candidate was then rejected by a fresh `release:check:candidate` after two accidental TypeScript emit files from the earlier failed build were removed from `src/shared`; its recorded fingerprint no longer matched current source. This directly confirmed stale-candidate rejection. A second clean generation used the corrected final source.
- Windows-host candidate generation after final containment/read-failure remediation: pass. Final generation ID `1e7e6bf8-0495-4bdb-ac54-2d45c38bfc47`; source fingerprint `fb64d48fdf0085dd2ed7ff28e2611af1c88de4e026456781c836769f50af18b6`; portable, NSIS installer/blockmap, `win-unpacked`, updater manifests, and `app.asar` were generated from the shared prepackaged input.
- `npm run release:check:candidate`: pass. It read back source fingerprint/version/artifacts, renderer entries, packaged Plugin representations, and bundled resource conformance.
- packaged `npm run plugin:validate -- --asar release/windows-host-candidate/win-unpacked/resources/app.asar --manifest plugins/bundled/diagnostics-sample/plugin.json --host-version 0.2.3 --json`: pass. `dev.mdv.diagnostics-sample` is `ready`; declared and actual resource SHA-256 both equal `f7dac32ee1fd2242f93b988bfced1833149c85c37e6c793bc3d02dc217744685`; all capabilities and the Skill contribution report `executable:false` and `loaded:false`.
- The Windows candidate was not launched for a live packaged About -> preload -> main -> catalog smoke. Browser About rendering used a mocked bridge, Node tests covered IPC delegation, and the candidate evidence covers archive/package conformance; these are separate evidence layers.
- Final exact-diff consistency review: pass after root-containment, structured package-read failure, generated-runtime freshness, and documentation-polish remediation.
- Final exact-diff packaging review: pass; candidate metadata, fingerprint, packaged representations, explicit validator command, and Windows shared-prepackaged path were confirmed.
- Final exact-diff plain-eye review: pass after narrowing evidence claims, leading the About surface with the non-installed/non-loaded/non-executable conclusion, and removing stale validation-pending wording.

## Evidence Boundary

The completed evidence proves metadata/package conformance paths only. It does not prove or authorize Driver dispatch, Skill loading, dynamic Plugin discovery, installation, or a Public SDK. `FIRST_SLICE_RELEASE_READY` is closed only for this bounded slice.
