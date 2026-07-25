# Session Token Budget V1 product audit

- Date: 2026-07-25
- Surface: real Electrobun CEF renderer (`bun run dev:cef`)
- Viewports: 1280×800 and 900×700
- Runtime data: isolated temporary `LLM_SPACE_HOME`
- Result: pass; no critical or high-severity product issue found

## Acceptance exercised

1. Opened an Agent Project Thread whose persisted Runtime Session had reached
   both its authored input and output limits.
2. Inspected the header budget summary and its read-only detail popover.
3. Activated `Continue with fresh budget`, inspected and cancelled the
   confirmation, then repeated it through the Bun-owned decision RPC.
4. Verified that the same Run resumed, both baselines advanced, lifetime totals
   remained unchanged, and the boundary became read-only.
5. Repeated the waiting state and selected `Stop run`; verified that only the
   active Run was cancelled and the editable Thread remained.
6. Restarted the app against the same isolated data root and confirmed that the
   pending wait and actions were restored without creating or clearing a
   Thread.
7. Exercised the Run button and Command+Enter while waiting. Both focused the
   primary budget action even when the configured model was unavailable.
8. Inspected the labelled live region, confirmation focus flow, Run History
   budget nodes, and historical granted/stopped read-only boundaries.
9. After fixed-point review fixes, rechecked frozen-Run presentation, both-axis
   header copy, exact Run History window/lifetime/baseline provenance, and
   active-Thread focus scoping.

## Product health

- The crossing assistant result remains visible before the budget boundary.
- Waiting, granted, and stopped states are visually distinct from transcript
  messages and do not claim to be model output.
- `Continue with fresh budget` is the clear primary action; `Stop run` is a
  secondary destructive choice with confirmation.
- The 900×700 waiting card remains fully visible and actionable. At both tested
  sizes, `documentElement` and `body` had no horizontal or vertical page
  overflow.
- The waiting container exposes a labelled `region` with `aria-live="polite"`.
  Decision completion moves focus to the persisted read-only boundary.
- The console contained only expected Vite/React development information and
  no application error.

## Evidence

- `02-budget-popover-1280x800.png` — active budget summary and source-owned
  limits.
- `03-continue-confirmation-1280x800.png` — explicit fresh-window confirmation.
- `04-stop-confirmation-1280x800.png` — explicit stop confirmation.
- `07-restarted-wait-900x700.png` — restart recovery and narrow layout.
- `08-final-granted-1280x800.png` — same-Run fresh-window boundary.
- `09-final-stopped-1280x800.png` — stopped Run with retained Thread and totals.
- `10-review-fixes-1280x800.png` — final two-axis header, waiting card, and
  exact Run History provenance after review fixes.
- `11-final-budget-popover-1280x800.png` — final read-only popover structure.
- `12-review-fixes-900x700.png` — final narrow layout and focused primary
  action after review fixes.

## Limits and residual risk

The audit used deterministic persisted Runtime fixtures to reach exact token
boundaries; it did not spend a live paid-provider request. Runtime, Desktop,
Server, and real-Docker automated acceptance cover settlement, accounting,
tool-batch ordering, restart, and decision semantics. A full screen-reader
matrix and live paid-provider smoke remain follow-up evidence, not V1 blockers.
