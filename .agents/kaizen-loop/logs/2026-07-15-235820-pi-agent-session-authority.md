# Pi Agent Session Authority

- Status: done
- Outcome: implemented; validation blocked
- Roadmap item: 01

## Trigger

The user requested a deeper source-level AgentHarness manual-execution audit and authorized abandoning Harness in favor of an LLM Space session core built on Pi `Agent` if Harness cannot preserve the current manual contract. The run started clean on `develop` at `15d952b`, synchronized with `origin/develop`.

## Product stage and context

Agent Project Threads already execute manual, auto-once, and ReAct modes through LLM Space `AgentSession` backed by Pi `Agent`. Item 01 had been blocked on making `AgentHarness` authoritative. The product requirement is settled manual execution: a model run ends at deferred tool calls, Thread stays durable/editable across time and reload, exact host results replace internal placeholders, and continuation adds no user message.

## Evidence reviewed

- `LOOP_TASK.md`, `LOOP_PLAN.md`, the originating roadmap, current capability map, recent item-01 logs, current runtime/session/tool-policy/event-projector/Desktop streaming source, and existing focused fixtures.
- Installed Pi 0.80.3 package source/declarations and npm 0.80.7 source at git head `818d67457cdd6b60bce6b121d16b23141c252dd8`.
- Upstream Pi `main` at `5e336cfa808c7b6056f168d42482c27f3acfc5cc`, including Harness turn runner, hooks, Session/storage, Agent continuation, agent loops, abort, save-point, and settlement behavior.
- Independent primary-source research recorded in `.agents/kaizen-loop/research/pi-agent-harness-manual-execution.md`.

## External market and upstream scan

Access date: 2026-07-15.

Primary sources:

- https://github.com/earendil-works/pi/commit/5e336cfa808c7b6056f168d42482c27f3acfc5cc
- https://github.com/earendil-works/pi/tree/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/agent
- https://registry.npmjs.org/@earendil-works%2fpi-agent-core/0.80.7
- https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/agent/README.md#L131-L140

Npm 0.80.7 and upstream main have byte-identical relevant Harness/Agent/session sources. Harness can keep a run busy by awaiting an unresolved tool Promise, but cannot settle and later resume from an exact external tool result without a new user message. Its only public model-running entries create a user message and call `runAgentLoop()`; `appendMessage()` does not run the model, hooks cannot suspend a settled turn, and Session has no transcript replace operation. Pi `Agent.continue()` delegates to official `runAgentLoopContinue()` and provides the exact table-stakes behavior LLM Space needs.

## Capability-map freshness

- `Agent Definition And Runtime`: confirmed from current source, Pi source, and focused tests.
- `Tool Execution And Continuation`: confirmed from settled manual, reload, persistence-order, abort, auto-once, ReAct, and Desktop streaming fixtures.
- Capability map now records Pi `Agent` plus LLM Space `AgentSession` as the accepted single session authority and separates future Pi compaction/tree work.
- CEF and product-design audit are not applicable because no UI or interaction changed.

## Product north-star metric

- Name: runtime behavior coverage through one Pi Agent-backed session core.
- Why it matters: compiled artifacts, Server, safety, and durability work need one stable session owner rather than a split or blocked lifecycle.
- Baseline: 11/11 focused fixtures passed, but reload, abort settlement, and persistence-before-terminal-event ownership were implicit.
- V1 target: 14/14 focused runtime/Desktop fixtures pass through LLM Space `AgentSession` backed by Pi `Agent`, explicitly covering manual reload, abort terminal persistence, and persistence-before-`agent_end`.
- Measurement: focused Bun matrix plus runtime/Desktop TypeScript, lint, build, diff review, and an ownership documentation check.
- Guardrails: no synthetic user message, no visible placeholder result, no Thread schema/data migration, no copied ReAct loop, no Pi fork, stable tool identity, and preserved abort/event order.

## Candidate product opportunities

1. Main recommendation: make Pi `Agent` plus LLM Space `AgentSession` the single documented Agent Project session authority and close item 01 against that boundary.
2. Alternative: keep waiting for Harness prompt-free continuation; rejected because it blocks the roadmap without improving current product behavior.
3. Alternative: fork/copy Harness lifecycle or migrate Thread to Pi Session; rejected because it duplicates lifecycle code or changes durable product semantics.

## Main recommendation and V1 capability

Pi `Agent` owns the official provider/ReAct/tool/abort/continuation lifecycle. LLM Space `AgentSession` owns execution modes, settled manual placeholder/result replacement, public event projection, and host persistence. Desktop Thread remains the durable editable transcript. Remove the remaining runtime snapshot dependency on `AgentHarnessResources`, document the ownership boundary, and add explicit reload/abort/persistence-order fixtures.

Non-goals: Harness compaction/tree adoption, Thread schema migration, Server/artifact implementation, UI changes, durable workflow recovery, or a new ReAct loop. Stop on any shipped message, tool, persistence, or abort semantic regression.

## Acceptance and implementation plan

1. Record the user-authorized roadmap decision and timeline transition.
2. Remove the direct `AgentHarnessResources` snapshot type dependency in favor of an LLM Space resource contract.
3. Add focused settled-manual reload, persistence-before-terminal-event, and abort-settlement tests.
4. Document the single session ownership boundary and update roadmap/capability map.
5. Run focused/full tests, relevant package TypeScript, lint, non-packaging checks, diff review, and final code review; only then check item 01.

Approval status: approved by the user's explicit “if Harness cannot, do not use it; implement based on Pi Agent” direction.

## `$grill-me` requirements discussion

The unattended default approval resolved the grill with the user's explicit direction. Target user/job: developers debugging Agent Project Threads. Must-have behavior: settled manual continuation without synthetic user turns, stable tool identity, Thread persistence/reload, and correct abort/event settlement. Data boundary: Thread stays durable authority; Pi `Agent` owns in-memory run state. Non-goals and stop conditions match the V1 definition above. No ambiguity remains.

## Work performed

- Updated `LOOP_TASK.md` Timeline to `IN PROGRESS` before product-code edits, as requested.
- Completed independent and local source audits of installed, npm, and upstream Pi.
- Reframed item 01 around Pi Agent session authority.
- Removed the runtime snapshot's `AgentHarnessResources` type dependency.
- Added three focused Session ownership fixtures and documented the runtime boundary.
- Refreshed the capability map and recorded the worktree prohibition on packaging validation.

## Verification

- Focused runtime/Desktop matrix: 14 pass, 0 fail, 44 assertions.
- Full Bun suite: 134 pass, 0 fail, 366 assertions.
- Runtime, core, CLI, example Agent, and Desktop TypeScript: passed.
- Touched TypeScript ESLint and `git diff --check`: passed.
- Full `bun run lint:check`: blocked by a pre-existing baseline. Clean commit `15d952b` and the current worktree both report exactly 1,451 problems (1,356 errors, 95 warnings); this run added zero lint failures.
- Packaging validation is prohibited in this worktree. A previously started unsigned pack was terminated when the user clarified the rule, and its generated canary build artifacts were removed; no packaging result is used as acceptance evidence.
- Product-design audit/CEF: not applicable; no UI or shipped interaction changed.

## Review

Final review found no product regression or duplicate loop owner. `packages/runtime/src` has no `AgentHarness` code dependency; `AgentSession` is the sole constructor of Pi `Agent`, owns placeholder replacement and `continue()`, and Desktop calls only that session boundary. The new tests prove exact tool identity across reload, persistence before terminal event publication, and abort terminal persistence. Remaining risk is repository-wide lint debt unrelated to this capability.

## Follow-up product bets

1. Item 02: immutable inspectable compiled Agent artifact.
2. Item 17: separately integrate Pi-native compaction/session tree capabilities without changing this session boundary.
3. Revisit Harness only after public prompt-free continuation and editable-transcript reconstruction exist.

## Outcome

Implemented but validation blocked. The Harness decision and Pi Agent session-core implementation are complete, but item 01 remains unchecked because the repository-wide lint gate is already red at the clean baseline. The next run should not redo Harness research or this implementation; it should recheck whether the unrelated lint baseline has been restored, then close item 01 if the gate passes.
