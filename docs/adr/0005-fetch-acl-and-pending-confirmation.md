# 0005 Fetch ACL And Pending Confirmation

- Status: Accepted

## Context

The original guarded fetch implementation only supported one global allowlist plus global method and header lists. That was too coarse for real-world use because path-specific exceptions, forced headers, and interactive escalation all had to be handled outside the policy model.

The fetch permission window also needs to remain the operator-facing control plane for this feature. If the main process can pause on a pending decision and write back a narrow rule, the runtime policy and the editable configuration stay aligned.

## Decision

- Replace the old fetch allowlist/method/header triplet with one YAML ACL stored at `settingsState.ai.fetch.aclText`.
- Support exact origin nodes, nested path-prefix nodes, exact-path nodes for narrow writes and legacy migration, `allow`, `deny`, and `pending` directives for methods and request headers, plus forced headers.
- Keep network safety checks such as blocked localhost, private IP ranges, embedded credentials, and redirect re-validation outside the ACL so they remain mandatory.
- When a fetch request evaluates to `pending`, show a main-process dialog with four actions: allow and save, deny and save, run once, and do not run.
- Saved pending decisions write back only the pending method/header facets on an exact current-path rule by default, with an option to widen the decision to the whole origin.
- Migrate legacy persisted fetch settings into the new ACL format on read so existing installations do not lose current permissions.

## Consequences

- Fetch policy becomes expressive enough for per-path exceptions without adding more ad hoc settings fields.
- Runtime fetch decisions and operator-edited policy share one source of truth.
- The fetch permissions window becomes a text-based ACL editor instead of separate allowlist and method/header lists.
- Auto-written rules may normalize formatting because the ACL is re-serialized from parsed YAML.