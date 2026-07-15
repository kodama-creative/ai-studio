# Pi AgentHarness Alignment Window Check

- Status: done
- Outcome: blocked
- Roadmap item: 01

## Trigger

The scheduled dev loop requested a previous-window completion check, task-status refresh, and timeline update before continuing the roadmap. Starting branch was `develop` at `9ece6cf`, matching `origin/develop`; the only worktree delta was the user-provided untracked `LOOP_TASK.md`.

## Previous-window gate

The preceding window was complete rather than still executing. Its blocked item-01 result was committed and pushed as `9ece6cf`; the branch matched its remote, no task-specific test/build/kaizen process remained, and recent logs had terminal `Status: done` outcomes. This window therefore proceeded. `LOOP_TASK.md` now makes this gate explicit: a genuinely overlapping window must skip without touching the repository, committing, or pushing.

## Product stage and context

Agent Project Threads execute through LLM Space `AgentSession` over Pi `Agent`. Roadmap item 01 permits only behavior-preserving convergence onto `AgentHarness`; it excludes a Pi fork, copied private Harness lifecycle, Thread/Pi Session persistence redesign, Server work, and new UI.

## Evidence reviewed

- `LOOP_TASK.md`, `LOOP_PLAN.md`, the originating roadmap log, the current capability map, the two latest AgentHarness logs, current runtime/session source, git/remote state, and active task-specific processes.
- Installed Pi resolution in `bun.lock`, npm latest metadata, upstream Pi `HEAD`, and current public Harness source/API evidence.
- The focused runtime and Desktop streaming fixture matrix.

## External market and upstream scan

Access date: 2026-07-15.

Primary sources:

- https://github.com/earendil-works/pi
- https://github.com/earendil-works/pi/blob/main/packages/agent/src/harness/agent-harness.ts
- https://github.com/earendil-works/pi/blob/main/packages/agent/src/harness/types.ts
- https://www.npmjs.com/package/@earendil-works/pi-agent-core

Upstream `HEAD` remains `5e336cfa808c7b6056f168d42482c27f3acfc5cc`; npm latest remains `0.80.7`, while the repository resolves `0.80.3`. No public prompt-free Harness continuation or supported transcript replacement seam has appeared. The table-stakes behavior remains the shipped exact external-tool-result continuation without a synthetic user turn. The true missing capability remains upstream Harness continuation/transcript seeding; there is no new market or upstream evidence that changes the decision.

## Capability-map freshness

- `Agent Definition And Runtime`: confirmed from current source, dependency resolution, upstream state, and focused tests.
- `Tool Execution And Continuation`: confirmed from the current manual continuation path and focused tests.
- No capability-map edit was needed because its 2026-07-15 boundary still matches current evidence.
- CEF and product-design audit are not applicable because no UI or shipped interaction changed.

## Product north-star metric

- Name: existing runtime behavior coverage through AgentHarness.
- Why it matters: artifact, Server, and durability work need one Pi-native session authority.
- Baseline: 0% of the target matrix runs through `AgentHarness`; 11/11 focused fixtures pass through LLM Space `AgentSession` over Pi `Agent`.
- V1 target: 100% through `AgentHarness` with role/identity-equivalent transcripts and no synthetic continuation prompt.
- Measurement: the focused runtime/Desktop fixture matrix plus a session-ownership import assertion.
- Guardrails: no Thread migration, extra user message, placeholder leakage, lost abort/event ordering, Pi fork, private lifecycle copy, or changed tool-execution boundary.

## Candidate product opportunities

1. Main recommendation: keep item 01 blocked and retry only after Pi exposes prompt-free Harness continuation plus supported transcript seeding/replacement.
2. Alternative: redefine the roadmap around Pi `Agent` as the documented authority; deferred because it changes the approved roadmap.
3. Alternative: redesign editable Thread persistence around append-only Pi Session semantics; deferred because it changes persistence and interaction boundaries.

## Main recommendation and V1 boundary

Do not edit product code in this window. When the prerequisite appears, manual, auto-once, and ReAct execution, persistence, abort, reload, tools, and event fixtures should remain externally unchanged while running through `AgentHarness`.

Non-goals remain Server/artifact work, source/UI changes, migration, public plugins, workflow durability, a private lifecycle copy, or a Pi fork. Stop when prompt-free continuation or supported transcript seeding/replacement is unavailable, or fixture parity would require a persistence change; those stop conditions still hold.

## Acceptance, audit, and implementation plan

After the prerequisite appears: prove exact prompt-free tool-result continuation, move the complete fixture matrix through Harness, assert one session owner, verify persistence and abort ordering, then run focused tests, relevant TypeScript checks, lint, build, review, capability-map refresh, and the kaizen log. No in-boundary implementation plan exists against current Pi, so the standing approval gate cannot authorize product edits.

## `$grill-me` requirements discussion

Not run because no product-code edit is planned or authorized. The unresolved options are material runtime/persistence boundary changes, not routine choices covered by the unattended default approval.

## Work performed

- Verified the preceding scheduled window had completed and did not overlap this run.
- Added the overlap gate and refreshed execution status/timeline in `LOOP_TASK.md`.
- Rechecked installed, npm, and upstream Pi capabilities and current session ownership.
- Re-ran the focused behavior matrix. No product code, dependency, roadmap checkbox, or capability-map boundary changed.

## Verification and review

- `bun test packages/runtime/src/runtime/agent/agent-runtime.test.ts apps/desktop/src/bun/streaming/stream-thread.test.ts`: 11 pass, 0 fail.
- Full TypeScript/lint/build were not run because no implementation exists and the Done-when clause remains unsatisfied.
- Review found no in-boundary route around the missing Harness operations; documentation changes preserve the roadmap and make concurrent-window handling explicit.

## Follow-up product bets

1. Preferred: wait for or upstream a public Harness `continue()` plus supported transcript seeding/replacement, then rerun item 01.
2. Explicit roadmap decision: retain Pi `Agent` as authoritative.
3. Separately approved capability: redesign Thread persistence around Pi Session trees.

## Outcome

Blocked. Item 01 remains unchecked, all dependent roadmap items remain ineligible, and the next scheduled window should first apply the overlap gate before rechecking upstream state.
