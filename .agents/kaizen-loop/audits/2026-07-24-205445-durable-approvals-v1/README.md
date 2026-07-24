# Durable approvals V1 rendered acceptance

Real Electrobun CEF renderer inspected through CDP on 2026-07-24. Runtime data
used the isolated temporary root
`/var/folders/1q/xb41drtj6_s9x69p62_ry_600000gp/T/llm-space-approval-cef-TkiHNJ`.
No mocked `electrobun.rpc` or ordinary browser renderer was used.

## Evidence

- `01-pending-1280x800.png`: inline approval card with exact arguments,
  reason, Source/Host requirements, call scope, Direct provenance, `Deny`,
  `Approve & run`, and the pending batch footer.
- `02-pending-900x700.png`: the same state under a CDP device-metrics override.
- `03-denied-1280x800.png`: real `Deny` RPC result with the read-only
  `Denied — not run` card and `Denied · ready to resume` batch state.
- `04-denied-900x700.png`: the denied state under the narrow viewport.

Both viewports reported exact viewport/document/body dimensions with no page
overflow. The console contained only Vite connection/HMR messages and the
React DevTools development notice. The actual Deny interaction exposed and
then fixed one copy defect: a fully denied batch had incorrectly said
`Approved · ready to resume`; it now says `Denied · ready to resume` and uses
`Resume decided run` when a missing model prevents immediate continuation.

The fixture does not make a paid provider call. Runtime and Server integration
tests provide the execute-once approval/denial/restart evidence; this audit is
the rendered Desktop interaction acceptance. The accepted evidence boundary is
explicit: screenshots cover pending and real Deny at both target sizes, while
deterministic Runtime/Desktop/Server fixtures cover mixed batches,
policy-blocked calls, restart resume, stale drift, once grants, principal
isolation, and `outcomeUnknown`. A post-review HMR check at 900×700 revalidated
exact viewport/body/document widths and found only Vite/React development
console messages after the focus and hot-list performance fixes.
