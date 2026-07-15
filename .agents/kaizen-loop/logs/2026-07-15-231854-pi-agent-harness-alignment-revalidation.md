# Pi AgentHarness Alignment Revalidation

- Status: done
- Outcome: blocked
- Roadmap item: 01

## Trigger

Scheduled roadmap execution requested: `$kaizen-loop Make Pi AgentHarness the authoritative LLM Space session core without changing shipped behavior.`

Starting state was clean on branch `develop` at `318510501df06e048861f3669bab6a9586e8e030`.

## Product stage and context

Agent Project Threads currently execute through LLM Space `AgentSession` over Pi `Agent`. Item 01 is restricted to behavior-preserving convergence onto `AgentHarness`; it excludes new UI, Server behavior, source slots, persistence migration, private Harness lifecycle copies, and a Pi fork.

## Evidence reviewed

- `LOOP_PLAN.md`, its originating Agent Studio/Eve gap roadmap, the current capability map, the latest AgentHarness alignment log, recent capability-model history, current source, and a clean git status.
- Current runtime ownership in `packages/runtime/src/runtime/sessions/agent-session.ts`, Desktop Project Thread persistence/session construction, streaming continuation, tool policy, and event projection.
- Installed Pi 0.80.3 resolution, npm latest 0.80.7, and upstream Pi `main` at `5e336cfa808c7b6056f168d42482c27f3acfc5cc`.
- The current focused manual/auto-once/ReAct, persistence, deferred tool, MCP error, and Desktop streaming fixtures.

## External market and upstream scan

Access date: 2026-07-15.

Primary sources:

- https://github.com/earendil-works/pi
- https://github.com/earendil-works/pi/blob/main/packages/agent/src/harness/agent-harness.ts
- https://github.com/earendil-works/pi/blob/main/packages/agent/src/harness/types.ts
- https://www.npmjs.com/package/@earendil-works/pi-agent-core

Npm latest remains 0.80.7 and upstream `main` is unchanged from the prior audit. `AgentHarness` still exposes prompt/skill/template turn entry points, queued `nextTurn(text)`, `appendMessage()`, abort, save points, and settled events, but its turn runner still calls `runAgentLoop()` with a required prompt. It exposes neither prompt-free continuation nor supported transcript replacement.

The table-stakes behavior remains the already-shipped manual-tool flow: after exact external tool results replace deferred placeholders, the provider continues without a synthetic user prompt. The true missing prerequisite remains an upstream Harness continuation/transcript seeding seam. No new upstream capability changes the product decision.

## Capability-map freshness

- `Agent Definition And Runtime`: confirmed from current source, installed/upstream Pi, and focused tests.
- `Tool Execution And Continuation`: confirmed from current tool policy, streaming path, and focused tests.
- No map content changed because its 2026-07-15 AgentHarness boundary still matches current evidence.
- UI evidence and a product-design audit are not applicable because this capability is behavior-preserving runtime convergence and no product surface changed.

## Product north-star metric

- Name: existing runtime behavior coverage through AgentHarness.
- Why it matters: later artifact, Server, and durability work need one Pi-native session authority.
- Baseline: 0% of the target fixture matrix runs through `AgentHarness`; 11/11 focused fixtures pass through LLM Space `AgentSession` over Pi `Agent`.
- V1 target: 100% of the matrix runs through `AgentHarness` with role/identity-equivalent transcripts and no synthetic continuation prompt.
- Measurement: focused runtime/Desktop fixtures plus an import-graph ownership assertion.
- Guardrails: no Thread migration, extra user message, placeholder leakage, lost event/abort ordering, Pi fork, private lifecycle copy, or changed tool execution boundary.

## Candidate product opportunities

1. Main recommendation: keep item 01 unchecked and retry only when Pi exposes prompt-free Harness continuation plus supported transcript seeding/replacement.
2. Alternative: explicitly redefine the roadmap around Pi `Agent` as the documented session owner; deferred because it materially changes the approved roadmap.
3. Alternative: migrate editable Thread persistence to append-only Pi Session semantics; rejected inside this behavior-preserving item because it changes the data and interaction contract.

## Main recommendation

Stop this item without product-code edits. Forcing alignment now would either invent a user turn, duplicate private Pi lifecycle behavior, or change durable Thread semantics. Waiting for or contributing the missing upstream seam preserves the roadmap's ownership goal.

## V1 capability definition

When the prerequisite exists, manual, auto-once, and ReAct execution, persistence, abort, reload, tools, and events remain externally unchanged while every target fixture instantiates `AgentHarness` and Pi Session/Repo becomes authoritative.

Explicit non-goals: Server/artifact work, new source or UI, data migration, public plugins, workflow durability, private Harness copies, or a Pi fork.

Stop conditions: no prompt-free continuation; no supported transcript seeding/replacement; required Thread/Pi Session migration; or loss of fixture parity. The first three remain true.

## Acceptance and audit plan

After the prerequisite appears, prove prompt-free exact tool-result continuation, run the full target fixture matrix through Harness, assert single session ownership, verify save-point/settled persistence and abort ordering, then run focused tests, relevant TypeScript checks, lint, build, code review, capability-map refresh, and the kaizen log. CEF/product-design audit remains unnecessary unless interaction behavior changes.

## Implementation plan and approval status

Approval remains stopped at the declared persistence/runtime boundary. The standing routine approval does not authorize a Pi fork, private lifecycle copy, roadmap redefinition, or data migration. No implementable in-boundary plan exists against current Pi.

## `$grill-me` requirements discussion

Not run because no product-code edit is authorized or planned. The kaizen evidence gate reached the same explicit stop condition before an implementable plan; the unresolved choices are material boundary changes, not routine defaults.

## Work performed

- Rechecked installed, npm, and upstream Pi capabilities.
- Re-inspected current runtime and Desktop session ownership.
- Re-ran the focused behavior matrix.
- Refreshed loop memory while leaving item 01 and all other items unchecked.

No product code, dependency, roadmap checkbox, or capability-map boundary changed.

## Verification

- `bun test packages/runtime/src/runtime/agent/agent-runtime.test.ts apps/desktop/src/bun/streaming/stream-thread.test.ts`: 11 pass, 0 fail.
- Full TypeScript/lint/build: not run because there is no implementation to validate and the Done-when clause remains unsatisfied.
- Product-design audit/CEF: not applicable; no UI or shipped interaction changed.

## Review

The current `AgentSession` remains the one documented owner of exact manual continuation. Review reconfirmed that each apparent Harness shortcut violates either shipped transcript behavior, the no-duplication objective, or the persistence boundary. Documentation-only changes introduce no product regression.

## Follow-up product bets

1. Preferred: upstream or wait for a public Harness `continue()` plus supported transcript seeding/replacement, then rerun item 01 unchanged.
2. Explicit roadmap decision: retain Pi `Agent` as authoritative.
3. Separately approved capability: redesign Thread editing and persistence around Pi Session trees.

## Outcome

Blocked. Current Pi still cannot make `AgentHarness` authoritative while preserving the shipped manual continuation and editable durable Thread contract inside item 01's boundary. The item remains unchecked.
