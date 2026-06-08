# Git History Rewrite Recovery

This repository rewrote history to remove previously tracked Windows release binaries and old Git LFS payloads. Existing clones must be repaired before you continue development.

## Simple Path

If you have no local-only commits and no unpushed work, the safest fix is to delete the old clone and make a fresh clone.

```bash
cd ..
mv mdv mdv.pre-rewrite-backup
secdat exec git clone https://github.com/mako10k/mdv.git
cd mdv
git lfs prune
```

## Repair an Existing Clone With No Local Commits To Keep

Before running the destructive reset path below, confirm that `git status --short` is empty or that you are willing to lose any remaining staged and unstaged work.

```bash
secdat exec git fetch origin --prune --tags
git checkout main
git reset --hard origin/main
git tag -l | xargs -r -n 1 git tag -d
secdat exec git fetch origin --tags
git reflog expire --expire=now --all
git gc --prune=now --aggressive
git lfs prune
```

If you still have files under `release/windows-host`, keep them only if you need them as local generated artifacts. They are no longer git-tracked source of truth.

Before running `git gc` or `git lfs prune`, delete any local branch that still points to pre-rewrite history. Old local refs keep the removed objects reachable.

## Repair an Existing Clone With Local Commits To Keep

1. If you have staged or unstaged work, stash or commit it before you reset anything.

```bash
git stash push -u -m pre-rewrite-safety-backup
```

2. Save your local-only commits outside the repaired working clone. A bundle is safer than a backup branch in the same clone because a local backup branch keeps the old history reachable.

```bash
secdat exec git fetch origin --prune --tags
git bundle create ../mdv-pre-rewrite-local.bundle HEAD ^origin/main
```

3. Fetch the rewritten remote history.

```bash
secdat exec git fetch origin --prune --tags
```

4. Delete local tags before refetching rewritten tags.

```bash
git tag -l | xargs -r -n 1 git tag -d
secdat exec git fetch origin --tags
```

5. Reset your mainline branch to the rewritten remote.

```bash
git checkout main
git reset --hard origin/main
```

6. Reapply the local work you still need from the saved commits by cherry-picking or rebasing specific commits.

```bash
git cherry-pick <commit> [<commit> ...]
```

or

```bash
git rebase --onto origin/main <old-base> <saved-local-branch>
```

7. If you stashed uncommitted work at step 1, restore it only after your branch points at rewritten history and your kept commits are back in place.

```bash
git stash pop
```

8. Before cleanup, make sure no local branch or tag still points to pre-rewrite history.

9. Clean out unreachable old objects and stale LFS payloads.

```bash
git reflog expire --expire=now --all
git gc --prune=now --aggressive
git lfs prune
```

## Forks Or Mirrors

- Fetch the rewritten upstream first.
- Reset your default branch to the rewritten upstream branch.
- Force-push the repaired branch and tags to your fork only after you confirm no collaborators still depend on the old history.

Example:

```bash
secdat exec git fetch upstream --prune --tags
git checkout main
git reset --hard upstream/main
git tag -l | xargs -r -n 1 git tag -d
secdat exec git fetch upstream --tags
secdat exec git push origin main --force-with-lease
secdat exec git push origin --tags --force
```

## Notes

- Old clones may still show large `.git/lfs/objects` or dangling objects until you run `git gc` and `git lfs prune`.
- Any branch or tag that still points to pre-rewrite history will keep those old objects reachable in that clone. Keep such refs only in a separate backup clone or bundle if you still need them.
- GitHub Release assets remain the public binary source of truth. `release/windows-host` in a local clone is only a local canonical cache.