# 0003 Guarded Fetch Tool And Permission Window

- Status: Accepted

## Context

AI chat tool contracts now extend beyond editor-local reads and writes. Tavily web search and direct HTTP fetch both introduce network safety concerns, larger response bodies, and a growing permission surface that does not fit cleanly inside the main settings pane.

The implementation also already uses session temp buffers as a durable handoff mechanism between tools. Large network responses need the same EditorID-based flow so the model can continue with `read_target` / `write_target` instead of forcing oversized inline payloads into one response.

## Decision

- Add `web_search` for Tavily-backed search in the main-process AI tool loop.
- Add `fetch_url` as a guarded HTTP(S) fetch tool enforced in main process.
- Enforce allowlisted URL rules, explicit allowed methods, explicit allowed headers, timeout limits, and redirect re-validation in main process.
- Reject unsafe targets such as localhost, private or reserved IP space, embedded credentials, and blocked protocols even if a URL pattern matches.
- When fetched content exceeds the inline one-chunk budget, materialize it as a session temp buffer and return its EditorID / target instead of inline text.
- Add `dispose_buffer` so tools can explicitly release temp buffers.
- Add idle auto-disposal for temp buffers created for network results.
- Store fetch permission settings in the main settings schema, but edit the larger allowlist-oriented fields in a dedicated auxiliary fetch-permissions window.

## Consequences

- AI network access remains possible, but only through main-process policy gates.
- Large network responses follow the same EditorID + SPAN contract as other temp buffers.
- Settings UI grows by one more auxiliary window, but the main settings pane stays compact.
- Existing external-link allowlist patterns remain a manual reference when filling fetch rules, but do not automatically expand fetch reachability.
