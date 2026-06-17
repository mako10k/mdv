# ADR 0021: User Utterance Intent Boundary

## Status

Accepted

## Context

Agent work in this repository often alternates between implementation, backlog inventory, review, and commit preparation. In that flow, a user may ask a question or raise a concern while previous work is still in progress.

If the agent treats a question such as "is this already implemented?" as a new instruction to edit or commit, it can turn a useful correction signal into unauthorized scope changes. The existing default of one logical commit per turn is still useful, but it must not convert questions, doubts, or status checks into implementation authority.

## Decision

- Agent guidance must distinguish explicit user instructions from questions, doubts, status checks, and concerns.
- Questions and concerns are requests to verify, explain, or re-evaluate. They are not, by themselves, authorization to implement, change backlog scope, or commit.
- When a concern conflicts with current work, the agent should pause the conflicting work, gather direct evidence, report the result, and continue only under a still-applicable explicit instruction or after confirmation.
- The default commit workflow applies to changes made under an explicit work request. It does not make a question or concern commit-authorizing.
- Keep the short always-on rule in [AGENTS.md](../../AGENTS.md) and the detailed interpretation rule in [docs/agent-judgment-hardening.md](../agent-judgment-hardening.md).

## Consequences

- User doubts and status questions become checkpoints instead of implicit work orders.
- Agents should ask or report evidence before making durable changes when the user's latest message is only a concern.
- Backlog inventory and review work becomes less likely to reimplement already-complete scope.
- The workflow may pause more often before commits, but the extra pause preserves user intent and reduces unauthorized durable changes.
