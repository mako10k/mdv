---
name: write-adr
description: Draft or update an ADR for architecture, IPC contracts, packaging strategy, workflow rules, or long-lived technical decisions in this repo.
---

# Write ADR

Use this skill when drafting or updating an ADR for architecture, IPC contracts, packaging strategy, workflow rules, or long-lived technical decisions in this repo.

## Inputs

Use the user's request as the decision brief. If the user provides extra context, treat it as the affected files, decision scope, and whether this is a new ADR or an update/supersession.

## Requirements

- Follow the ADR policy in [AGENTS.md](../../../AGENTS.md).
- Store ADRs under `docs/adr/` as `NNNN-short-title.md`.
- Keep the ADR short and use exactly these sections: `# Title`, `Status`, `Context`, `Decision`, `Consequences`.
- If an existing ADR already covers the same decision, update it instead of creating a duplicate.
- If the current decision supersedes an older ADR, mark the older ADR as superseded and cross-link both files.
- Link to existing design docs instead of copying large background sections.

## Workflow

1. Inspect the current diff and the referenced files or docs.
2. Decide whether this needs a new ADR, an update to an existing ADR, or no ADR.
3. If no ADR is needed, explain why against the AGENTS criteria.
4. If an ADR is needed, create or update the file in `docs/adr/` and keep the wording decision-oriented rather than implementation-changelog-oriented.
5. End by summarizing what ADR file was created or updated and whether any older ADR was superseded.
