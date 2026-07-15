# Pi AgentHarness Alignment Recheck

- Status: done
- Outcome: blocked
- Roadmap item: 01

## Trigger

The scheduled dev loop requested a previous-window completion check, task-status refresh, and timeline update before roadmap execution. The starting branch was `develop` at `b509d36`, matching `origin/develop`, with a clean worktree.

## Previous-window gate

The immediately preceding window was complete, not still executing. Its documentation result was committed and pushed as `b509d36`; local `develop` matched `origin/develop`, the worktree was clean, and no task-specific kaizen, test, build, or roadmap process remained. Long-lived editor TypeScript servers and the Loopany daemon were unrelated and excluded by the overlap rule, so this window proceeded.

## Product stage and evidence reviewed

Agent Project Threads still execute through LLM Space `AgentSession` over Pi `Agent`. Item 01 allows only behavior-preserving convergence onto `AgentHarness` and excludes a Pi fork, copied private Harness lifecycle, Thread/Pi Session persistence redesign, Server work, and new UI.

Evidence reviewed: `LOOP_TASK.md`, `LOOP_PLAN.md`, the originating roadmap, current capability map, the latest three AgentHarness kaizen logs, current runtime/Desktop session ownership, dependency lock state, git/remote/process state, current Pi upstream and npm metadata, and the focused runtime/Desktop fixture matrix.

## External market and upstream scan

Access date: 2026-07-15.

Primary sources:

- https://github.com/earendil-works/pi
- https://github.com/earendil-works/pi/blob/main/packages/agent/src/harness/agent-harness.ts
- https://github.com/earendil-works/pi/blob/main/packages/agent/src/harness/types.ts
- https://www.npmjs.com/package/@earendil-works/pi-agent-core

Upstream `main` remains `5e336cfa808c7b6056f168d42482c27f3acfc5cc`; npm latest remains `0.80.7`, while this repository resolves `0.80.3`. Because upstream and the public package are unchanged from the completed audit, no prompt-free Harness continuation or supported transcript seeding/replacement seam has appeared. The table-stakes behavior remains exact external-tool-result continuation without a synthetic user turn; the true missing capability remains upstream Harness continuation and transcript ownership support.

## Capability-map freshness

- `Agent Definition And Runtime`: confirmed from current source, dependency resolution, upstream identity, and focused tests.
- `Tool Execution And Continuation`: confirmed from the current `AgentSession`/Pi `Agent.continue()` path and focused tests.
- No capability-map edit was needed because its 2026-07-15 boundary remains current.
- CEF and product-design audit were not applicable because no UI or shipped interaction changed.

## Product north-star metric

- Name: existing runtime behavior coverage through AgentHarness.
- Why it matters: artifact, Server, and durability work need one Pi-native session authority.
- Baseline: 0% of the target matrix runs through `AgentHarness`; 11/11 focused fixtures pass through LLM Space `AgentSession` over Pi `Agent`.
- V1 target: 100% through `AgentHarness` with role/identity-equivalent transcripts and no synthetic continuation prompt.
- Measurement: the focused runtime/Desktop fixture matrix plus a session-ownership import assertion.
- Guardrails: no Thread migration, extra user message, placeholder leakage, lost abort/event ordering, Pi fork, private lifecycle copy, or changed tool-execution boundary.

## Recommendation, alternatives, and V1 boundary

Main recommendation: keep item 01 blocked and retry only after Pi exposes prompt-free Harness continuation plus supported transcript seeding/replacement. This is the only option inside the approved behavior-preserving boundary.

Alternative 1: redefine the roadmap around Pi `Agent` as the documented authority; defer because it changes the approved roadmap. Alternative 2: redesign editable Thread persistence around append-only Pi Session semantics; defer because it changes persistence and interaction boundaries.

When the prerequisite appears, V1 keeps manual, auto-once, ReAct, persistence, abort, reload, tool, and event behavior externally unchanged while every target fixture runs through `AgentHarness`. Non-goals remain Server/artifact work, source/UI changes, migration, public plugins, workflow durability, a private lifecycle copy, and a Pi fork. Stop when prompt-free continuation or supported transcript seeding/replacement is absent, or fixture parity requires a persistence change; those conditions still hold.

## Acceptance, implementation, and approval status

After the prerequisite appears: prove exact prompt-free tool-result continuation, move the complete fixture matrix through Harness, assert one session owner, verify persistence and abort ordering, then run focused tests, relevant TypeScript checks, lint, build, code review, capability-map refresh, and the kaizen log.

No in-boundary implementation plan exists against current Pi. The standing kaizen approval cannot authorize a material persistence/runtime boundary change, and no product-code edit was made.

## `$grill-me` requirements discussion

Not run because the evidence gate hit the declared stop condition before any product-code edit or implementable plan. The unresolved choices are material roadmap and persistence decisions, not routine defaults covered by unattended approval.

## Work performed

- Verified the preceding scheduled window was complete and did not overlap this run.
- Rechecked installed, npm, and upstream Pi state plus current session ownership.
- Re-ran the focused behavior matrix.
- Refreshed `LOOP_TASK.md` status and timeline.

No product code, dependency, roadmap checkbox, or capability-map boundary changed.

## Verification and review

- `bun test packages/runtime/src/runtime/agent/agent-runtime.test.ts apps/desktop/src/bun/streaming/stream-thread.test.ts`: 11 pass, 0 fail.
- Full TypeScript/lint/build were not run because no implementation exists and item 01 cannot meet its Done-when clause.
- Review found no in-boundary route around the missing Harness operations; the documentation-only delta accurately preserves the blocker and overlap decision.

## Follow-up product bets

1. Preferred: wait for or upstream a public Harness `continue()` plus supported transcript seeding/replacement, then rerun item 01.
2. Explicit roadmap decision: retain Pi `Agent` as authoritative.
3. Separately approved capability: redesign Thread persistence around Pi Session trees.

## Outcome

Blocked. Item 01 remains unchecked, all dependent roadmap items remain ineligible, and the next scheduled window must apply the overlap gate before rechecking upstream state.
