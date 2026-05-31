# Release Workflow

## Scope

この文書は、MDV の外向け binary release を切るときの実務 runbook である。

内部 packaging refresh と正式 release を混ぜないことを目的にする。

## Invariants

- 外向け release は 1 つの release commit、1 つの annotated tag `vX.Y.Z`、その commit から生成した配布物の 1 組で扱う
- tag を先に切らない
- 既存 tag のまま binary だけ差し替えない
- 配布する Windows artifact は `release/windows-host` 配下の version 一致成果物だけを使う

## Public Release Checklist

1. `package.json` の `version` を bump する
2. `npm run lint && npm run build` を通す
3. `npm run dist:win:host:noadmin:full` で Windows host artifact を更新する
4. release notes を [docs/release-notes-template.md](docs/release-notes-template.md) から `docs/release-notes/vX.Y.Z.md` として作成する
5. version bump と artifact と release notes を同じ release commit として commit する
6. `npm run release:check` を実行し、version 一致 artifact と clean worktree を確認する
7. `main` へ push する
8. `git tag -a vX.Y.Z -m "Release vX.Y.Z"` を release commit に作成する
9. `git push origin vX.Y.Z` を実行する
10. `npm run release:github -- --notes docs/release-notes/vX.Y.Z.md` で `gh release create` の dry-run command を確認する
11. 問題なければ `npm run release:github -- --notes docs/release-notes/vX.Y.Z.md --execute` を実行する

## Internal Packaging Refresh

次は正式 release ではない。

- local validation のための build
- recovery 用の artifact refresh
- 同じ version のままの内部 packaging rerun

これらは tag を切らず、GitHub Release も作らない。

## Commands

release candidate check:

```bash
npm run release:check
```

GitHub Release command preview:

```bash
npm run release:github -- --notes docs/release-notes/vX.Y.Z.md
```

GitHub Release actual publish:

```bash
npm run release:github -- --notes docs/release-notes/vX.Y.Z.md --execute
```