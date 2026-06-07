# ADR 0017: AI Customization Layer Boundaries

## Status

Accepted

## Context

MDV の AI backlog では prompt file、skill、model registry、将来の custom agent と hook support が並行して増えつつある。

このままだと、repo-wide rule、task entrypoint、role mode、portable capability、deterministic automation が同じ customization surface として混線し、次の問題が起きる。

- 同じ rule を複数 layer に重複配置して drift する
- prompt file が repo-wide instruction editor に化ける
- skill が persona や role mode を背負い始める
- hook が soft guidance の代替として誤用される
- diagnostics がないため、どの layer が効いたか追えない

外部プラクティスとしても、Codex / VS Code / Copilot は instructions、prompt files、custom agents、skills、hooks を別種の customization として案内している。
Codex は `AGENTS.md`、repo skill、project-scoped custom agent、hook を別 surface として扱い、repo 共有の repeatable workflow には prompt file より skill を使う。

## Decision

MDV は AI customization を次の 6 layer に分ける。

1. always-on instructions: repo-wide invariants と conventions
2. file-scoped instructions: file/folder-specific refinement
3. prompt files: user-invoked one-shot task entrypoint
4. custom agents: persistent role mode、tool restrictions、model preferences、handoffs
5. skills: portable reusable capability package with resources
6. hooks: deterministic lifecycle automation and enforcement

追加ルール:

- repo-wide invariants の正本は `AGENTS.md` とする
- Codex 向け role mode は `.codex/agents`、Codex 向け repo skill は `.agents/skills` に置く
- Copilot 互換の custom agents と prompt files は `.github` 配下に残す
- path-specific conventions は `.instructions.md` に置く
- prompt file editor の first slice は prompt file だけを編集対象にする
- skill surface は capability package と diagnostics を扱い、repo-wide rules と混ぜない
- custom agent support は role/tool/model boundary を主対象にし、repo rule store と混ぜない
- hook support は deterministic automation / enforcement だけを扱う
- conflict は runtime precedence に依存せず ownership 修正で解消する

## Consequences

- AI-UX-003 の policy 自体は accepted 済みとし、backlog 上の AI-UX-003 はその rollout と propagation work を追う umbrella として扱う
- AI-CFG-001、AI-CFG-002、将来の agent / hook support が同じ editor へ雑に統合されるのを防げる
- diagnostics requirement が明確になり、「何が効いたか」を UI で説明しやすくなる
- repo-wide guidance と task-specific workflow の責務が分離される
- release / settings / help / metadata surface もこの layer model を前提に用語を揃えられる
