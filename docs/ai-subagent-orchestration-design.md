# AI Subagent Orchestration Design

## Status

Draft

## Purpose

この文書は、MDV の assistant に subagent orchestration を導入する際の設計基準を定義する。

対象は、main chat から specialist / evaluator 系 subagent を起動し、独立 context で作業させ、join / wait / merge を通じて呼び出し元へ結果を戻す制御面である。

## Goals

- タスク実行の並列化
- 独立した context による専門化
- 独立した context による客観評価
- agent 実装実験のための最小だが拡張可能な orchestration 面を持つ

## Non-Goals

- 任意数の agent を無制限に常駐させること
- main chat と subagent の transcript を雑に共有すること
- tool 権限を agent 間で暗黙継承すること
- 長期 memory 設計を飛ばして subagent だけ先行実装すること

## Design Constraints

- main chat と subagent は session contract を対称に保つ
- subagent は独立 context branch を持つが、origin task と cancellation lineage は失わない
- merge 時は全文 transcript を親へ戻さず、summary、artifact、structured result を基本単位にする
- evaluator は specialist と別 role とし、評価対象と評価結果を混線させない
- wait-all / cancel / timeout を first-class lifecycle event として扱う

## Core Model

### Agent Session

```ts
type AgentSessionId = string

type AgentSession = {
  sessionId: AgentSessionId
  parentSessionId: AgentSessionId | null
  role: 'main' | 'specialist' | 'evaluator'
  state: 'idle' | 'running' | 'awaiting-tool' | 'joining' | 'completed' | 'cancelled' | 'failed' | 'timed-out'
  objective: string
  branchSummary: string | null
  createdAt: string
  updatedAt: string
}
```

### Subagent Request

```ts
type SubagentRequest = {
  parentSessionId: AgentSessionId
  role: 'specialist' | 'evaluator'
  objective: string
  inputRefs: ContextRef[]
  constraints: {
    toolPolicy: ToolPolicy
    tokenBudget: number
    deadlineMs: number | null
  }
}
```

### Join Result

```ts
type SubagentJoinResult = {
  sessionId: AgentSessionId
  status: 'completed' | 'cancelled' | 'failed' | 'timed-out'
  summary: string
  artifacts: ArtifactRef[]
  structuredResult: Record<string, unknown> | null
}
```

## Lifecycle

1. parent が subagent request を生成する
2. orchestrator が branch context を materialize する
3. subagent が独立 transcript / tool state で実行する
4. parent は wait-one / wait-all / continue を選べる
5. subagent 完了時は join payload を parent queue へ返す
6. parent は join payload を文脈へ差し込み、必要なら follow-up subagent を起動する
7. cancelled / timed-out / orphaned session は GC 対象として回収する

## Context Rules

- parent transcript 全量は渡さず、summary + explicit refs + protected context だけを渡す
- subagent transcript 全量は親へ戻さず、join summary と artifact refs に圧縮する
- evaluator へは specialist の raw chain-of-thought ではなく、review target と observed artifacts だけを渡す
- 複数 subagent の wait-all merge は到着順ではなく merge policy 順で行う

## Symmetry Rules

- main chat も subagent も同じ session state machine を使う
- tool call / cancellation / timeout / failure は共通 event schema に載せる
- UI 表示は非対称でもよいが、protocol contract は main / subagent で分岐させない

## Open Questions

- parent が join 前に続きを話し続けた場合の merge point をどう固定するか
- specialist と evaluator の tool policy をどこまで分けるか
- partial join を transcript event とするか、artifact-only handoff とするか
- wait-all 中に 1 agent が failed した場合の default policy をどうするか

## Backlog Mapping

- AI-SA-001 session model と対称 contract
- AI-SA-002 request / branch / state branch
- AI-SA-003 join / wait-all / context handoff
- AI-SA-004 specialist / evaluator role model
- AI-SA-005 lifecycle / cancel / timeout / GC
