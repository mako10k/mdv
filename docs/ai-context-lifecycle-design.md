# AI Context Lifecycle Design

## Status

Draft

## Purpose

この文書は、MDV の AI chat における thread 管理、active context 切替、永続化、retention、archive/delete を含む context lifecycle 面の設計基準を定義する。

対象は user-visible な conversation lifecycle と、それを支える session binding / storage / retention policy である。Phase 1 の context compression 基盤そのものは [docs/ai-impression-memory-phase1-backlog.md](docs/ai-impression-memory-phase1-backlog.md) を正とし、本書はその後段の運用面を扱う。

## Goals

- thread 一覧と resume 導線を持つ
- active context がどの editor / window / thread に紐づくかを常に明確にする
- context 継続を永続化し、再起動後も必要な conversation を復元できる
- 古い context を archive / delete / GC できる lifecycle policy を持つ
- multi-editor / multi-window 時でも context binding を曖昧にしない

## Non-Goals

- Phase 1 compression layer の再設計
- subagent orchestration そのものの設計
- arbitrary workspace-global omniscient context
- 無制限保存

## Design Constraints

- active chat は常に primary target editor を表示する
- thread は editor binding を持つが、binding の解除や retarget は明示操作に限定する
- 永続化は transcript 全量保存よりも summary / references / metadata を優先する
- archive と delete は別 state とし、soft delete 後に GC できるようにする
- retention は size、age、pin、resume frequency を見て決める
- main process が正本となり、renderer は projection を表示する
- durable / resumed thread でも、直近 turn で効いた customization provenance を user が追跡できるようにする

## Core Concepts

### Context Thread

```ts
type ContextThreadId = string

type ContextThread = {
  threadId: ContextThreadId
  title: string
  state: 'active' | 'idle' | 'archived' | 'deleted'
  boundEditorId: string | null
  boundWindowId: number | null
  summaryRef: string | null
  lastMessageAt: string
  lastResumedAt: string | null
  persistenceMode: 'ephemeral' | 'session' | 'durable'
  retentionClass: 'default' | 'pinned' | 'ephemeral'
}
```

### Active Context Binding

```ts
type ActiveContextBinding = {
  threadId: ContextThreadId
  editorId: string | null
  windowId: number | null
  targetMode: 'current-editor' | 'fixed-editor' | 'unbound'
}
```

### Customization Provenance

```ts
type ContextCustomizationProvenance = {
  alwaysOnInstructionSources: string[]
  matchedFileScopedInstructionSources: string[]
  selectedAgentId: string | null
  invokedPromptId: string | null
  loadedSkillIds: string[]
  hookDecisions: Array<{
    hookId: string
    outcome: 'executed' | 'blocked'
    reason: string | null
  }>
}
```

### Lifecycle Policy

```ts
type ContextLifecyclePolicy = {
  autoArchiveAfterDays: number
  hardDeleteAfterDays: number
  maxDurableThreads: number
  preservePinnedThreads: boolean
}
```

## User Stories

1. ユーザーとして、今の chat がどの editor を既定対象にしているかを一目で知りたい。
2. ユーザーとして、複数 editor を開いているときに chat context が別 window と混線してほしくない。
3. ユーザーとして、以前の thread を一覧から再開したい。
4. ユーザーとして、重要 thread は保持し、古い thread は archive や削除で整理したい。
5. ユーザーとして、再起動後も必要な conversation だけ復元されてほしい。

## Thread Model

- thread は assistant transcript の UI 単位である
- thread は optional に editor binding を持つ
- one active thread per editor window を初期方針とする
- bound thread を別 editor へ移す操作は explicit retarget のみ許可する
- unbound thread は review / planning 用の補助 thread として扱う

## Multi-Editor Rules

- AI chat header に default target editor を常時表示する
- 複数 editor window があるときは、thread 作成時に source editor binding を記録する
- 別 window の thread を resume した場合、resume 時に focus move するか detached continue するかを明示する
- cross-window write は implicit に行わず、target editor 再確認を挟む

## Persistence Rules

- persistence は `ephemeral`、`session`、`durable` の 3 class を持つ
- `ephemeral` は window close で破棄してよい
- `session` は app runtime 中だけ保持し、再起動では復元しない
- `durable` は metadata、summary、artifact refs を保存し、必要に応じて transcript の一部を再構築する
- durable 保存時も protected context / pinned refs を優先し、全文 transcript を正本にしない
- durable thread は必要に応じて customization provenance summary も保持し、resume 後に selected agent / prompt / skills / hooks の由来と blocked hook reason を説明できるようにする

## Archive / Delete / GC Rules

- `archived` は一覧から active を外すが復元可能
- `deleted` は soft delete 状態で、短い猶予後に GC 候補へ送る
- pinned thread は retention clock を緩和する
- orphaned artifact や detached summary は thread GC と連動して掃除する

## UI Implications

- thread list surface が必要
- active thread header に target editor、persistence class、pin 状態を表示する
- active thread header または diagnostics で always-on instructions、matched file-scoped instructions、selected agent、invoked prompt、loaded skills、executed hooks と blocked hook reason を確認できるようにする
- archived / deleted thread を別フィルタで扱う
- context resume 時に current editor と bound editor が違う場合は明示確認を出す

## Relationship To Other Backlogs

- AI-UX-001 default target editor 明示
- AI-UX-002 multi-editor context binding policy
- AI-UX-003 instruction / prompt / agent / skill / hook layering policy
- AI-CM-001 thread list / resume / active context switch
- AI-CM-002 persistence / restore
- AI-CM-003 archive / delete / retention / GC
- AI-P4 subagent orchestration は本書の thread / lifecycle 基盤を前提にする

## Open Questions

- durable thread で transcript をどこまで保存するか
- editor binding を持たない thread をどこまで first-class に扱うか
- archived thread を summary-only で復元するか、full transcript を lazily hydrate するか
- retention policy を user setting 化するか、固定 policy から始めるか
