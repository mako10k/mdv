# MD-BL-025 Typography Gesture Validation

- Date: 2026-07-22
- PERT task: `VALIDATE_ZOOM`
- Result: partial pass; blocked on high-resolution trackpad evidence
- Validated source commit: `e9379e1`
- Candidate version: `0.2.1` internal validation candidate; not promoted or published
- Candidate source fingerprint: `ed35ad5b007f5b5901cb2aa20fe4d9ac6f8076512907baf6e61d01ff0b5b53f2`
- Candidate generation ID: `4bef7229-5124-41de-8a16-57b9bcd68860`

## Passed Evidence

### Broad Regression

- `npm run lint`: passed
- `npm run test:release`: 30 passed
- `npm run test:node`: 119 passed
- `npm run test:e2e:electron`: 51 passed, including typography zoom-factor, cross-editor broadcast, and restart persistence coverage
- `npm run test:e2e`: 75 passed, including wheel target, modifier, burst, keyboard continuity, failure resync, and active-proposal coverage

### Windows Candidate

- `npm run win:host:generate:clean:noadmin`: passed after invalidating the previous candidate
- `npm run release:check:candidate`: passed for portable, installer, blockmap, updater manifest / config, `app.asar`, exact renderer entry, version, generation ID, and source fingerprint
- `npm run win:host:deploy:candidate:noadmin`: passed; the candidate was deployed to the Windows-local `%LOCALAPPDATA%\MarkDownViewer\latest` path
- The deployed packaged runtime reported MarkDownViewer 0.2.1, Electron 39.8.10, and Chrome 142.0.7444.265.

Trusted CDP wheel input against the deployed Windows package produced these observations:

| Observation | Before | After |
| --- | ---: | ---: |
| editor typography | 13px | 14px |
| topbar height | 40.66666793823242px | 40.66666793823242px |
| `devicePixelRatio` | 1.5 | 1.5 |
| visual viewport scale | 1 | 1 |

- A second editor received the authoritative value, then another trusted wheel step changed both editors and the Settings selector to 15px.
- Changing the Settings selector to 16px updated both editors.
- Restarting the deployed candidate with the same isolated user-data restored 16px in CSS and authoritative settings.
- Validation used isolated temporary user-data. The validation process and temporary directory were removed after the manual check; the deployed candidate remains available at the Windows-local runnable path.

### Physical Device

- Discrete mouse wheel: user-reported pass. From the 13px reset state, `Ctrl` plus one upward notch produced one 14px step.
- High-resolution trackpad: not tested because no validation device was available.

## Judgment

- Keep the 120ms same-direction burst gate provisional. The discrete mouse result and automated burst regressions do not justify changing it.
- Do not infer high-resolution trackpad behavior from synthetic wheel input or discrete mouse evidence. Those inputs cannot reproduce the device event cadence that the gate is intended to control.
- `VALIDATE_ZOOM` and `ZOOM_RELEASE_READY` remain incomplete until packaged Windows evidence from a high-resolution trackpad confirms that a short gesture does not jump to a bound, sustained movement advances in steps, and direction reversal is not unnaturally delayed.
- If source affecting the packaged candidate changes before that check, regenerate and re-check the candidate rather than reusing this fingerprint-bound artifact as current evidence.

## Adjacent Release Preflight Observations

These observations do not change the zoom acceptance result:

- `npm audit --omit=dev --json` reported zero production vulnerabilities. The full development / build tree reported 11 findings: 1 low, 7 high, and 3 critical. Dependency remediation requires a separate scoped decision before public release; no automatic audit fix was applied.
- Current refs contain no LFS-tracked file or LFS object to push, and `.gitattributes` has no active LFS rule. The authenticated GitHub token lacks the `user` scope required by the shared-storage billing endpoint, so historical remote LFS quota usage was not re-verified through the API. No auth scope was changed.
