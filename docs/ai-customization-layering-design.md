# AI Customization Layering Design

## Status

Accepted

## Purpose

この文書は AI-UX-003 として、MDV で扱う customization layer の責務境界、使い分け、ownership-first の conflict policy を定義する。

対象は次の layer である。

- always-on instructions
- file-scoped instructions
- prompt files
- custom agents
- skills
- hooks

quick mental model は次の通り。

- `AGENTS.md` など always-on instructions は repo baseline
- `*.instructions.md` は path-specific refinement
- prompt files は task entrypoint
- custom agents は role mode
- skills は capability package
- hooks は deterministic enforcement

狙いは、同じ規則や workflow を複数 layer に重複配置して drift させないことと、Prompt File / SKILL / AGENT / HOOK の product backlog を実装できる粒度まで責務を確定することにある。

## Current Practice Alignment

この整理は、2026-06 時点の VS Code / Copilot customization docs の一般的なプラクティスに合わせる。

- always-on instructions は project-wide rules と conventions に使う
- file-scoped `*.instructions.md` は file type や folder ごとの限定ルールに使う
- prompt files は手動起動の repeatable task に使う
- custom agents は persona、tool restrictions、model preferences、handoffs を持つ role mode に使う
- skills は instructions だけでなく scripts / examples / resources を同梱する portable capability に使う
- hooks は deterministic、code-driven lifecycle automation と policy enforcement に使う

外部 practice で重要なのは次の点である。

- instructions は concise に保ち、non-obvious rules へ集中させる
- prompt files と custom agents は instructions を参照して再利用し、規則を複製しない
- skills は task-specific かつ on-demand で読み込まれる capability package として扱う
- hooks は soft guidance ではなく guaranteed outcome が必要な enforcement と automation に使う
- 複数 instruction file がある場合、runtime merge order に依存せず ownership を分離する

## Non-Goals

- VS Code 以外のすべての agent runtime へ完全移植可能な統一 abstraction を作ること
- personal instructions や organization instructions の管理 UI を MDV が肩代わりすること
- すべての customization layer を first slice で editable にすること

## Canonical Layer Model

### 1. Always-On Instructions

対象:

- `AGENTS.md`
- `.github/copilot-instructions.md`
- 同等の repo-wide always-on instruction source

責務:

- project-wide coding standards
- architecture constraints
- repo workflow and validation expectations
- cross-agent shared invariants

使わないもの:

- one-off task recipes
- role-specific tool restrictions
- deterministic automation

MDV rule:

- MDV では `AGENTS.md` を repo-wide always-on 正本として扱う
- compatibility のために他の always-on file を足す場合も、project-wide invariants の ownership は 1 か所に寄せる

### 2. File-Scoped Instructions

対象:

- `*.instructions.md`

責務:

- language-specific conventions
- framework- or folder-specific rules
- test/doc/backend/frontend などの path-targeted refinement

使わないもの:

- repo-wide baseline の再記述
- manual slash command workflow
- persona selection

MDV rule:

- file-scoped instructions は repo-wide baseline を補足する narrow rule だけを持つ
- repo-wide rule と衝突する別 policy をここに置かない

### 3. Prompt Files

対象:

- `.prompt.md`

責務:

- user-invoked repeatable task entrypoint
- one-shot workflow template
- task-specific parameters and expected output shape

使わないもの:

- always-on repository conventions
- persistent persona
- reusable multi-file capability package

MDV rule:

- prompt は task entrypoint であり、rule storage ではない
- prompt body で instructions や skills を参照して再利用し、同じ guidance をコピーしない

### 4. Custom Agents

対象:

- `.agent.md`

責務:

- persistent role mode
- tool restrictions and model preferences
- handoffs between roles
- optional agent-scoped hooks

使わないもの:

- project-wide invariants
- generic task macros that prompt で足りるもの
- portable capability package

MDV rule:

- agent は role と execution envelope を定義する
- repo-wide conventions は agent に重複記述せず always-on / file-scoped instructions を参照する
- 同じ workflow が persona を必要としないなら、まず prompt または skill を優先する

### 5. Skills

対象:

- `SKILL.md` と付随 resources

責務:

- portable reusable capability
- task-specific procedures
- scripts, examples, templates, references を含む workflow package
- heavy workflow を必要に応じて forked context へ隔離する

使わないもの:

- repo-wide baseline rules
- default role selection
- deterministic enforcement

MDV rule:

- skill は capability package であり、persona ではない
- 大きい調査や intermediate reasoning を main chat に残したくない skill は fork-compatible に設計する
- skill を background knowledge 化するときも、その ownership は repo-wide rules ではなく task capability に限る

### 6. Hooks

対象:

- `.github/hooks/*.json`
- agent-scoped hooks

責務:

- deterministic lifecycle automation
- policy enforcement
- audit trails
- approval control
- post-edit validation / formatting / logging

使わないもの:

- style guidance の文章化
- persona definition
- repository conventions の説明

MDV rule:

- hook は instructions の代わりに soft rule を書く場所ではない
- guaranteed outcome が必要なものだけ hook へ置く
- hook で止める policy は user-visible な reason を返せる設計にする

## Ownership Matrix

| Need | Primary layer | Why |
| --- | --- | --- |
| Repo-wide coding rules | Always-on instructions | Every requestに効くべき baseline だから |
| File/folder-specific rule | File-scoped instructions | applyTo / path で narrow に効かせるべきだから |
| Reusable slash command | Prompt file | Manual task entrypoint だから |
| Persistent specialist mode | Custom agent | Tool/model/handoff を束ねる role だから |
| Portable workflow with resources | Skill | instructions + resources を package 化できるから |
| Deterministic approval / formatting / logging | Hook | guaranteed execution が必要だから |

## Priority And Conflict Policy

runtime precedence を過信せず、ownership で conflict を避けるのを基本方針にする。

そのうえで MDV では次の policy を採る。

1. personal / organization instructions の precedence は host platform の仕様に従う
2. repo は always-on instructions で baseline を定義する
3. file-scoped instructions は matching scope の narrow refinement だけを足す
4. custom agent は selected role と execution envelope を足す
5. prompt file は single invocation の task framing を足す
6. skill は loaded capability instructions と resources を足す
7. hook は prompt precedence ではなく execution side effect として最終的に enforce できる

conflict policy:

- 同じ rule を 2 つ以上の layer に複製しない
- collision が起きたら precedence で押し切らず ownership を修正する
- tool restrictions は agent に置き、prompt や instructions に埋め込まない
- deterministic stop / approval / logging は hook に置き、instructions に書くだけで済ませない

## MDV Decision Summary

### Repo Rule

- repo-wide invariants は `AGENTS.md` を正本にする
- path-specific conventions は `.instructions.md` に切り出す
- prompt file editor は prompt file を編集対象にし、always-on instructions は直接の first-slice 編集対象にしない
- skill manager は SKILL metadata と invocation policy を扱い、repo-wide rule editor にはしない
- future custom agent support は role mode と tool/model envelope を主対象にし、repo-wide rule store と混ぜない
- hook support は deterministic enforcement / automation として扱い、prompt file や skill と同じ編集面に雑に混ぜない

### First-Slice Consequences

- AI-CFG-001 は prompt file editing surface として扱う
- AI-CFG-002 は skill runtime / diagnostics surface として扱う
- AI-UX-003 完了前は prompt file、agent、skill、hook を 1 つの generic customization editor にまとめない
- AI-TL-001 や AI-CFG-003 のような他 backlog は、この layering policy を前提に help、metadata、settings を分離する

## Diagnostics Requirement

layering が見えないと user は「なぜ効いたか / 効かなかったか」を判断できないため、少なくとも次を追える必要がある。

- loaded always-on instructions
- matched file-scoped instructions
- selected agent
- invoked prompt
- loaded skills
- executed hooks and their blocking reason

## References

- VS Code Customize AI overview: https://code.visualstudio.com/docs/agent-customization/overview
- VS Code custom instructions: https://code.visualstudio.com/docs/agent-customization/custom-instructions
- VS Code prompt files: https://code.visualstudio.com/docs/agent-customization/prompt-files
- VS Code custom agents: https://code.visualstudio.com/docs/agent-customization/custom-agents
- VS Code agent skills: https://code.visualstudio.com/docs/agent-customization/agent-skills
- VS Code hooks: https://code.visualstudio.com/docs/agent-customization/hooks
- GitHub Copilot custom instruction precedence: https://docs.github.com/en/copilot/concepts/prompting/response-customization