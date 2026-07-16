# Pi Agent-backed Runtime Harness V0 Verification

- Status: done
- Outcome: completed
- Roadmap item: 01

## Trigger

The user requested one complete but bounded roadmap pass following `LOOP_TASK.md`, limited to the lowest-numbered unchecked dependency-ready item. The run started on `develop` at `b377b52`, matching `origin/develop`, with user-owned roadmap-contract changes in `LOOP_PLAN.md` and `LOOP_TASK.md` plus untracked `CONTEXT.md` and `docs/adr/`. Those starting changes are preserved and are not owned by this pass.

## Product stage and context

Agent Project Threads already have an implementation candidate for roadmap item 01: one LLM Space `AgentSession` backed by official Pi `Agent`. The accepted Runtime Harness boundary leaves provider streaming and model/tool iteration to Pi while LLM Space owns execution-mode waits, exact settled manual continuation, Thread persistence, and Host-facing event projection. This pass verifies and closes that existing capability if every current `Done when` and execution-rule gate passes; it does not begin item 02.

## Evidence reviewed

- Repository contract: `AGENTS.md`, `README.md`, `package.json`, `LOOP_TASK.md`, `LOOP_PLAN.md`, and `CONTEXT.md`.
- Accepted architecture: `docs/adr/0001-runtime-harness-over-pi-agent.md`.
- Current git status, recent commits, the paused Loopany configuration and its three recent outcomes.
- `.agents/kaizen-loop/CAPABILITY_MAP.md` and the latest three item-01 kaizen logs.
- Current `AgentSession`, `AgentRuntime`, execution policy, event projector, Desktop streaming integration, and their focused fixtures.
- The item-01 implementation commit `5a164a1` and the follow-up lint cleanup through current `develop`.

## External market and upstream scan

Access date: 2026-07-16.

Primary sources:

- https://github.com/earendil-works/pi
- https://api.github.com/repos/earendil-works/pi/commits/main
- https://api.github.com/repos/earendil-works/pi/compare/5e336cfa808c7b6056f168d42482c27f3acfc5cc...c6d8371521fc8357958bb21fd43552c15f46c7f4
- https://registry.npmjs.org/@earendil-works%2fpi-agent-core/latest

Upstream Pi `main` is `c6d8371521fc8357958bb21fd43552c15f46c7f4`; the two commits since the last recorded audit only reset the Windows terminal title after an npm-package check and do not touch Agent, Harness, Session, tool, or continuation code. npm latest remains `0.80.7` at git head `818d67457cdd6b60bce6b121d16b23141c252dd8`; this repository resolves `0.80.3`. The table-stakes product behavior remains exact external tool-result continuation without a synthetic user message. The true local gap is no longer an implementation gap but fresh acceptance evidence for the accepted Pi `Agent`-backed Runtime Harness. Uncertainty is low because the relevant upstream code did not change; this pass does not claim compatibility with uninstalled Pi versions.

## Capability-map freshness

- `Agent Definition And Runtime`: read as `confirmed`, last checked 2026-07-15; current source and fresh focused validation will determine whether it remains confirmed on 2026-07-16.
- `Tool Step Orchestration`: read as `confirmed`, last checked 2026-07-14; current manual, auto-once, ReAct, reload, tool, abort, persistence, and Desktop fixtures will refresh the Runtime Harness evidence.
- No UI capability is changed. Real CEF and product-design audit are not applicable to this behavior-preserving runtime verification.

## Product north-star metric

- Name: existing runtime behavior coverage through the Pi Agent-backed session core.
- Why it matters: every later Runtime Harness, artifact, Server, safety, and durability capability needs one proven session owner rather than a split or custom ReAct lifecycle.
- Baseline: the prior pass reported 14/14 focused runtime/Desktop fixtures, but item 01 remained unchecked under the former repository-wide lint policy.
- V1 target: 100% of the current manual, auto-once, ReAct, persistence, abort, reload, tool, and event acceptance matrix passes through one LLM Space `AgentSession` backed by Pi `Agent`, with all current non-packaging quality gates green or any unrelated baseline debt precisely demonstrated.
- Measurement: focused Bun tests, full Bun tests, all relevant TypeScript projects, touched-file and repository-wide lint, browser-safe runtime bundle, renderer-only Vite build, diff review, and ownership inspection.
- Guardrails: no synthetic user message, visible deferred placeholder, Thread schema migration, copied ReAct loop, Pi fork, packaging/release command, changed shipped UI, lost tool identity, broken abort/event ordering, or user-data mutation.

## Candidate product opportunities

1. Main recommendation: verify the existing Pi `Agent`-backed Runtime Harness candidate against the revised current gates and close item 01 when all evidence passes.
2. Alternative: wait for Pi `AgentHarness` to gain prompt-free continuation and transcript replacement; defer because the accepted ADR no longer depends on it and waiting adds no product value.
3. Alternative: redesign Desktop Thread persistence around Pi Session semantics; reject for this pass because it changes the accepted persistence and data-ownership boundary.

## Main recommendation

Close the already-implemented foundation rather than rebuilding it. This is the lowest-numbered dependency-ready roadmap capability, it unblocks the explicit Runtime Harness spine, and current product/source evidence shows no missing user behavior that warrants a second implementation. The alternatives either revive a settled blocker or require a new persistence decision outside item 01.

## V1 capability definition

After V0, manual, auto-once, and ReAct Agent Project Thread execution all run through one LLM Space `AgentSession` backed by official Pi `Agent`; exact externally supplied tool results can continue a settled manual run without a new user message; public messages exclude internal deferred placeholders; Desktop Thread persistence and event projection have one documented LLM Space owner; and Pi owns provider streaming, model/tool iteration, continuation, and abort.

Explicit non-goals: Runtime Run state machine, transactional Session Store, Server, compiled artifact, UI work, schema migration, crash-safe external-effect replay, compaction, approval policy, public plugin SDK, Pi `AgentHarness` adoption, or a custom ReAct loop.

Stop conditions: stop without checking the item if a target fixture fails, ownership is split, fresh verification is unavailable, a regression is introduced, or satisfying the contract requires a new architecture, security, permission, persistence, or data-ownership decision.

## Acceptance and audit plan

- Run the focused `AgentSession`, `AgentRuntime`, and Desktop `StreamThreadController` fixtures.
- Run the full Bun test suite.
- Run TypeScript for runtime, core, CLI, example Agent, and Desktop.
- Run touched-file lint and repository-wide `bun run lint:check`.
- Run a browser-target bundle of the runtime root and a renderer-only Vite build; do not run any Electrobun packaging, signing, notarization, feed, or release command.
- Inspect the final diff against repository standards and the item-01 spec.
- Refresh the capability map, roadmap status, task memory, and this log only if the Done-when evidence is complete.
- CEF and product-design audit are not applicable because no UI, interaction, navigation, or rendered product surface changes.

## Implementation plan and approval status

The exact roadmap run is `$kaizen-loop Make the Pi Agent-backed LLM Space session core authoritative without changing shipped behavior.` Existing `LOOP_PLAN.md` and ADR 0001 are pre-approved implementation boundaries under `LOOP_TASK.md`. Prefer validation and reuse; make product-code changes only if a concrete in-boundary gap appears. If validation passes without a product-code delta, update only the durable evidence and status artifacts.

## `$grill-me` requirements discussion

Not invoked. `LOOP_TASK.md` requires it only for a newly discovered branch in the design tree. Current evidence matches the accepted ADR and exposes no new choice about target user/job, must-have behavior, non-goals, acceptance, persistence/data ownership, risk, or stop conditions.

## Work performed

- Reconciled the item-01 implementation candidate with current source, capability-map evidence, the accepted ADR, and the revised roadmap boundary.
- Rechecked Pi upstream and npm state. The only upstream movement since the previous audit is unrelated to Agent/Harness/session behavior.
- Reused the existing `AgentSession` implementation and added no duplicate runtime or product code.
- Ran the complete focused and repository-wide acceptance matrix.
- Checked roadmap item 01, refreshed current capability evidence, and updated bounded task memory. No item-02 work was started.

## Verification and product-design audit results

- Focused Runtime Harness/Desktop matrix: 14 pass, 0 fail, 44 assertions.
- Full Bun suite: 136 pass, 0 fail, 370 assertions.
- TypeScript: runtime, core, CLI, example Agent, and Desktop all passed with `tsc --noEmit`.
- Focused ESLint across the session/runtime/policy/projector/Desktop streaming implementation and fixtures: passed.
- Repository-wide `bun run lint:check`: passed.
- Browser-safe runtime root bundle: passed with `bun build --target=browser` using a temporary output outside the repository.
- Renderer-only `bun run vite build`: passed. Vite reported the existing large-chunk advisory; it did not fail the build.
- `git diff --check`: passed during final review.
- Product-design audit and CEF are not applicable because this pass changes no UI, interaction, navigation, or rendered product behavior; deterministic runtime and Desktop integration fixtures are the relevant acceptance evidence.
- No Electrobun packaging, DMG, patch-feed, signing, notarization, canary/stable build, pack, or release command was run.

## Review

The final implementation review confirmed one constructor of Pi `Agent` inside LLM Space `AgentSession`; `AgentRuntime` is the session factory; the execution policy owns only mode/deferred-result behavior rather than a second ReAct loop; the event projector persists the public transcript before publishing `agent_end`; and Desktop Agent Project streaming calls only the runtime session boundary. No product regression, duplicate lifecycle owner, architecture-boundary violation, missing target fixture, or in-scope code change was found. The only remaining risk is that live paid-provider connectivity is not part of this deterministic foundation gate; no current `Done when` requirement depends on it.

## Follow-up product bets

1. Main next roadmap bet: item 02, explicit durable Runtime Run state plus one transactional Host-provided Session Store boundary.
2. Later alternative: compiled Agent artifact work after the four-item Runtime Harness foundation spine is complete.
3. Deferred alternative: revisit Pi `AgentHarness` only if it gains public settled prompt-free continuation and compatible transcript reconstruction; it is not required by the accepted architecture.

## Outcome

Completed. Roadmap item 01 satisfies its current `Done when` clause and shared execution rules, so it is checked. The north-star target is met at 14/14 focused fixtures through one Pi Agent-backed session core, with 136/136 full tests and every relevant non-packaging quality gate green. This bounded pass ends here; item 02 remains untouched for a future pass.
