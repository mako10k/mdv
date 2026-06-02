# Release Workflow

## Scope

この文書は、MDV の外向け binary release を切るときの詳細 runbook である。日常的な運用入口と要約手順は [../DEVELOPMENT.md](../DEVELOPMENT.md) を正本とし、この文書は release 実務の詳細、preview / publish の差分、内部 packaging refresh の扱いを補足する。

内部 packaging refresh と正式 release を混ぜないことを目的にする。

## Invariants

- 外向け release は 1 つの release commit、1 つの annotated tag `vX.Y.Z`、その commit から生成した配布物の 1 組で扱う
- tag を先に切らない
- 既存 tag のまま binary だけ差し替えない
- 配布する Windows artifact は `release/windows-host` 配下の version 一致成果物だけを使う
- Windows packaging の candidate 生成、local deploy、canonical release artifact 更新は別操作として扱う

## Public Release Checklist

以下の `npm run ...:noadmin` は WSL / bash から Windows host を呼ぶ alias である。native Windows PowerShell では同じ action を `.\scripts\build-win-host.ps1 ...` で実行する。

1. `package.json` の `version` を bump する
2. `npm run lint && npm run build` を通す
3. `npm run win:host:generate:clean:noadmin` で candidate artifact を生成する
4. 必要なら `npm run win:host:deploy:candidate:noadmin` で candidate の `win-unpacked` を Windows ローカルへ配置して検証する
5. 問題なければ `npm run win:host:promote:noadmin` で candidate artifact を `release/windows-host` に昇格する
6. release notes を [release-notes-template.md](release-notes-template.md) から `docs/release-notes/vX.Y.Z.md` として作成する
7. version bump と artifact と release notes を同じ release commit として commit する
8. `npm run release:check` を実行し、version 一致 artifact と clean worktree を確認する
9. `main` へ push する
10. `git tag -a vX.Y.Z -m "Release vX.Y.Z"` を release commit に作成する
11. `git push origin vX.Y.Z` を実行する
12. `npm run release:github -- --notes docs/release-notes/vX.Y.Z.md` で `gh release create` の dry-run command を確認する
13. 問題なければ `npm run release:github -- --notes docs/release-notes/vX.Y.Z.md --execute` を実行する

## Internal Packaging Refresh

次は正式 release ではない。

- local validation のための build
- recovery 用の artifact refresh
- 同じ version のままの内部 packaging rerun

これらは tag を切らず、GitHub Release も作らない。
canonical path の `release/windows-host` を直接更新せず、candidate 生成か既存 artifact の local deploy に分離する。

## Commands

release candidate check:

```bash
npm run release:check
```

candidate artifact generate:

```bash
npm run win:host:generate:noadmin
```

candidate artifact generate (native Windows PowerShell):

```powershell
.\scripts\build-win-host.ps1 -Action generate
```

candidate local deploy:

```bash
npm run win:host:deploy:candidate:noadmin
```

candidate local deploy (native Windows PowerShell):

```powershell
.\scripts\build-win-host.ps1 -Action deploy -ArtifactSource candidate
```

canonical artifact promote:

```bash
npm run win:host:promote:noadmin
```

canonical artifact promote (native Windows PowerShell):

```powershell
.\scripts\build-win-host.ps1 -Action promote
```

GitHub Release command preview:

```bash
npm run release:github -- --notes docs/release-notes/vX.Y.Z.md
```

GitHub Release actual publish:

```bash
npm run release:github -- --notes docs/release-notes/vX.Y.Z.md --execute
```