# Trusted Session Context And Structured State V1

- Status: done
- Outcome: completed
- Roadmap item: 12

## Trigger

The owner explicitly approved starting item 12 after ADR 0006 moved item 10
behind trusted state/dynamic-instruction and ExecutionEnv/Sandbox prerequisites.
The pass started on clean synchronized `develop` at `6ae28a2`; items 01-09 are
complete, item 10 is dependency-blocked, item 11 has no implemented schema
evolution to migrate, and item 12 is the lowest dependency-ready item.

## Product stage and context

LLM Space already has a Pi Agent-backed Runtime Harness, Host-provided CAS
Session Store, Desktop Thread and Server repository implementations, protected
Server principals, durable Run recovery, portable Agent source, and artifact
identity. These pieces stop immediately before the authored-Agent boundary:
verified identities authorize Host requests but are not visible to tools, and
the durable Session record contains lifecycle state but no typed working state.

Item 12 should close that gap without turning transcript history, prompt
variables, environment values, or external memory into one generic state bag.

## Evidence reviewed

- `AGENTS.md`, `LOOP_TASK.md`, `LOOP_PLAN.md`, `CONTEXT.md`, README/package
  scripts, ADRs 0001, 0002, and 0006, clean git state, and the latest item-10
  blocker/decision logs.
- Runtime Harness Session Store types, in-memory CAS/invariant implementation,
  recovery/replay, Agent Runtime/Session, prepared-tool execution, authored
  tool/connection APIs, compiler/discovery, snapshot/artifact exports, and
  relevant tests.
- Server authenticator, Session envelope/repository, Run controller, protected
  request flow, restart persistence, and integration tests.
- Desktop Thread Runtime Session, renderer-owned begin/settle persistence,
  Agent Project Bun streaming/manager path, RPC transport side channels, and
  external Project Thread persistence.
- Eve concurrency/step-failure source research fixed at
  `vercel/eve@6a5a36afa3a8094bb4d6caa9deedf32e55bd5507` and its locked AI SDK
  `7.0.26`; the evidence is in
  `.agents/research/2026-07-17-eve-state-concurrency-and-commit-failure.md`.
- Current capability map and the paused `Agent Studio Roadmap` Loopany config.
  No schedule, goal, enabled state, or task-file setting changed.

## External market scan

Access date: 2026-07-17.

Primary sources:

- Eve State: https://eve.dev/docs/guides/state
- Eve Session Context: https://eve.dev/docs/guides/session-context
- OpenAI Agents SDK Context Management:
  https://openai.github.io/openai-agents-js/guides/context/
- OpenAI Agents SDK Sessions:
  https://openai.github.io/openai-agents-js/guides/sessions

Eve treats state as stable source-declared, per-Session working memory available
only in a managed runtime scope and persisted at step boundaries. It keeps
current/initiator identity and Turn lineage separate and directs shared or
cross-Session memory to external storage. OpenAI's SDK separately treats local
RunContext as application/tool data that is not sent to the model, while its
Session interface owns conversation history and can use a pluggable store.

Table stakes are managed-scope access, explicit separation from model-visible
history, pluggable Host persistence, and crash/restart continuity. The real
LLM Space opportunity is stronger source/runtime identity and safety: validate
state with a runtime schema/version, bind it to verified Host context, commit it
through the existing CAS Session Store, preserve Pi `AgentEvent`, and keep
state values out of Agent source/artifacts/events.

Uncertainty: Eve's public state handle does not promise distributed
transactions or schema migration, and OpenAI RunContext is application-owned
rather than a source-authored durable state protocol. Neither source settles
LLM Space's atomicity, conflict, size, or migration policy.

## Capability-map freshness

- `Run And Streaming`: confirmed; Desktop Threads persist Run starts and
  settled checkpoints through the Thread-owned Session Store.
- `Runtime Recovery And Replay`: confirmed; safe-boundary recovery and CAS
  resume exist, while authorization remains a Host precondition.
- `Agent Definition And Runtime`: confirmed; portable source/runtime/tool
  execution exists without state definitions or identity context.
- `Independent Agent Serving`: confirmed; authenticated Server principal and
  durable Session ownership exist without Agent-visible context/state.
- `Trusted Session Context And Structured State`: added as confirmed absent
  before V1 from current source and Server/Desktop evidence.

## Product north-star metric

- Name: isolated structured-state recovery after Server restart.
- Why it matters: an authored Agent becomes durably stateful only when its own
  typed working data survives process loss without crossing principal/Session
  boundaries or being reconstructed from transcript text.
- Baseline: 0%; no state source slot, managed handle, Agent-visible verified
  context, state mutation, or restart fixture exists.
- V1 target: 100% of deterministic two-principal fixtures preserve each
  Session's exact schema-valid state after Server restart while rejecting every
  cross-Session read, spoofed context, invalid value, conflict, and schema
  mismatch fixture.
- Measurement: Runtime compiler/handle tests, Session Store atomicity and
  rollback tests, Server disk restart integration with two principals, Desktop
  Agent Project persistence/reopen coverage, artifact/source assertions, and
  full non-packaging repository gates.
- Guardrails: unchanged Pi `AgentEvent`; no state value in source, artifacts,
  transcript, Trace/Eval/event payloads, or logs; no secret store; no implicit
  Host authority; no silent persistence merge or automatic retry after an
  authored side effect; legacy stateless Agents and stored Sessions remain
  usable; no
  Electrobun packaging, signing, notarization, patch-feed, or release command.

## Candidate product opportunities

1. Main recommendation: source-declared, runtime-schema-validated Session state
   plus immutable Host-verified Session/Turn context, executed in a managed tool
   scope and committed atomically through the existing Session Store.
2. Alternative: add only an OpenAI-style Host `RunContext` object to tools.
   Deferred because it gives dependencies and identity but no portable authored
   state definition, restart contract, or item-10 variable/state target.
3. Alternative: model all state as an external KV/vector memory connection.
   Deferred because it conflates short-lived Session working data with
   cross-Session memory, expands authority, and violates the V1 no-database
   boundary.

## Main recommendation

Add `agent/state/*.ts` declarations using stable qualified names, positive
definition versions, TypeBox runtime schemas, and JSON-safe initial values.
Tools import state handles and use synchronous `get()`/`update()` only inside a
Runtime-managed scope. `ToolContext` receives an immutable Session view with
Session id, verified initiator/current principal, optional tenant, channel, and
Turn id/sequence; none is automatically inserted into model context.

The Runtime creates one temporary state Map for each model tool step. Pi keeps
its existing parallel tool execution; every tool in the batch shares that Map,
and synchronous `update()` calls become visible immediately inside the step.
Same-key writes follow actual execution order and are last-write-wins, not model
source order. `get()` returns a deeply frozen snapshot so mutation cannot bypass
`update()` or validation.

Only when every automatic-step tool and output validation succeeds does the Runtime persist
the complete state snapshot in one Session Store CAS before Pi starts another
model call. One thrown tool, invalid output, invalid state, or deferred result
discards every temporary update in that step while Pi retains its normal
tool-error handling. A persistence failure
after tools may have produced external effects terminates as `outcomeUnknown`;
the Runtime never automatically reruns the step or tools, and tool authors own
external idempotency.

The recommended policy is JSON-safe plain data, at most 64 state definitions,
64 KiB serialized per slot, and 256 KiB total per Session. Stored values carry
the definition version and schema fingerprint. Missing/removed definitions,
version drift, or schema drift block that Session with a precise diagnostic;
V1 never resets, drops, or migrates a value automatically.

## V1 capability definition and non-goals

After V1, an Agent author can declare typed Session state, read verified
Session/Turn context from a tool, update several state slots atomically, and
observe the same isolated values after Desktop Agent Project reopen or Server
restart. Desktop supplies a fixed local verified principal/channel; Server
derives context only from authenticated repository-owned identity and the
accepted Run, never from request body or model content.

Explicit non-goals: dynamic instructions (item 13), dynamic tools/model
resolution, hooks/channels/subagents, state UI/editor, generic query API,
cross-Session sharing, state history browser, arbitrary custom codecs, secret
storage, external memory, automatic schema migration/reset, distributed
transactions, tool-side-effect replay, or Pi protocol changes.

## Acceptance and audit plan

- Compiler: discover deterministic regular `state/*.ts` files; validate brand,
  stable name/version/schema/initial value, duplicates/reserved names, artifact
  schema/capability identity, and imports from tools.
- Runtime: managed-scope-only handles, immutable reads, schema validation,
  concurrent shared-step visibility and last-write-wins semantics, multi-slot
  atomic success, whole-step rollback on tool/output/deferred failure,
  concurrent Session isolation, CAS conflict without retry, serialization and
  size failures, and no state leakage into Pi events.
- Context: Host-only construction, immutable initiator/current principal,
  tenant/channel/Turn validation, Server request-spoof rejection, Desktop local
  projection, and exact tool visibility without model injection.
- Persistence: Server filesystem restart preserves two principals' independent
  values; unknown/removed/version/schema drift fails without mutation. Desktop
  Bun commits through the Project Thread's existing Session Store record and
  returns the newest record before renderer settle/reopen.
- Repository gates: focused Runtime/Server/Desktop tests; full `bun test`;
  TypeScript for Runtime, Core, CLI, Server, example Agent, and Desktop; root
  lint; Runtime browser/server bundles and renderer-only Vite build; diff check
  and Standards/Spec review. Product-design/CEF audit is not applicable because
  V1 adds no UI or visible interaction.

## Proposed implementation plan and approval status

1. Add public context/state definitions and managed runtime scope with TypeBox
   validation, JSON/size limits, and no active-scope fallback.
2. Discover/compile `state/*.ts`, attach immutable definitions to the project
   snapshot/artifact, and add canonical example/source diagnostics.
3. Extend the Session Store with an optional backward-compatible structured
   state envelope and atomic state mutation while preserving existing Run
   recovery/replay invariants and legacy stateless records.
4. Wrap each Pi model tool batch in one shared temporary state transaction;
   expose frozen reads and verified context, then use Pi's awaited next-turn
   barrier to commit only after every tool and output succeeds.
5. Project authenticated Server owner/tenant plus Run-derived channel/Turn
   metadata, persist through the repository, and add restart/isolation/spoofing
   acceptance.
6. Add Desktop Agent Project state persistence through the Bun-owned project
   record and an RPC transport side channel that returns the newest Runtime
   Session before renderer settle; preserve renderer Thread authority.
7. Update Runtime/example docs, capability evidence, roadmap/log, then run all
   non-packaging gates and two-axis review.

Approval status: the original and revised Eve-style shared-step plans were
approved and implemented. Final review exposed a new settled/manual execution
branch; the owner resolved it by making execution mode, not Agent shape, the
boundary. Manual development debugging skips state entirely, while automatic
modes share one state path for every Agent.

## `$grill-me` requirements discussion

Resolved one question at a time:

- A state commit failure after possible external effects ends the current Run
  as `outcomeUnknown`; the Runtime never automatically retries the step/tool.
- After inspecting Eve source, the owner selected Eve-style concurrent tools
  sharing one step-local state Map instead of serial stateful tools.
- State is temporary until every tool in the model step succeeds. Any thrown
  tool, invalid output, or deferred result rolls back the whole step while Pi
  retains its normal tool-error lifecycle; the Runtime does not replay tools.
- Tools that need model-visible recovery return a schema-valid structured
  result rather than throwing.
- Same-key concurrent updates are last-actual-write-wins. There is no per-tool
  lock, rollback, conflict merge, or model-order promise inside the step.
- `get()` returns a deeply frozen snapshot; all changes must use `update()`.
- Previously approved boundaries remain: Host-verified context, JSON-safe 64
  slots/64 KiB each/256 KiB total, no automatic CAS retry, hard diagnostics for
  missing/version/schema-drifted state, no secrets/history/external memory, and
  Desktop/Server use of the existing Session Store.

This deliberately borrows Eve's simple shared-step authoring model but rejects
Eve Workflow's automatic replay of an interrupted side-effecting step. Manual
mode is explicitly a development/debugging boundary: tools remain deferred and
state validation, scope, update, and commit are skipped.

## Work performed

- Completed the evidence gate and the focused Eve concurrency/commit-failure
  source investigation requested by the owner.
- Implemented the public typed state handle, source compilation/artifact
  identity, managed shared-step state scope, frozen reads, validation, limits,
  Session Store CAS replacement, and commit-unknown errors.
- Projected Session/Turn context through Runtime and Server, added Server
  repository persistence, and implemented Desktop Project Thread state handoff
  through its existing Runtime Session record.
- Added canonical example state/tool source, Runtime/Server/Desktop/example
  tests, and author-facing documentation.
- Updated the capability map to shipped V1 and checked item 12 only after all
  acceptance gates completed.
- Did not modify Loopany schedule, goal, enabled state, or task-file settings.
  No packaging, signing, notarization, canary/stable build, or release command
  ran.

## Verification

- 80 focused Runtime/compiler/Server/Desktop/example tests passed; the sole
  failure in that selection was the same fixed-point Server timeout below.
- The Server two-principal restart/isolation/tenant/schema-drift integration
  fixture passed independently.
- Full `bun test`: 257 tests, 256 passed, 1014 assertions. The sole failure is
  the previously reproduced Server shutdown-test timeout
  `aborts explicitly while observation disconnect remains passive`, which also
  times out at the clean fixed point and is unrelated repository debt.
- TypeScript passed for Runtime, Core, CLI, Server, example Agent, and Desktop.
- Root lint passed after the final review fixes. Non-packaging
  Runtime browser/client/harness, Runtime Bun Server, Server package, and
  renderer-only Vite builds passed. No UI changed, so CEF/product-design audit
  was not applicable.
- `git diff --check` passed. Standards review's three module-level constant
  names were corrected, and source/bundled state definition validation now
  shares one compiler so qualified/reserved-name and fingerprint rules cannot
  diverge.

## Review and remaining risks

Final Standards/Spec findings were resolved in scope:

- Manual mode skips state validation/scope/commit. Automatic mixed-deferred
  steps discard temporary updates instead of committing before the Host result.
- Tool failure rollback preserves Pi's normal model-visible recovery for every
  Agent; there is no stateful/stateless lifecycle split.
- Raw `AgentRuntime` now requires Host-supplied context. Local Runtime, Desktop,
  and Server construct context only at their trusted Host boundaries.
- Tenant remains optional verified context and no longer changes ADR 0002's
  exact `(issuer, principalId)` ownership comparison.
- Source and bundled state compilation share definition validation/fingerprint
  code, and all hard naming findings were fixed.

The deliberately nondeterministic same-key last-actual-write ordering remains
approved. Automatic mixed-deferred steps intentionally lose temporary state;
durable staged state belongs to later durable-execution work. External side
effects followed by persistence failure remain outcome-sensitive and must
never trigger an automatic retry.

## Follow-up product bets

1. Item 13 can resolve dynamic instructions from the verified Turn context and
   read-only Session state into immutable per-Turn snapshots.
2. Item 11 or a dedicated later state-migration loop must add explicit
   previewable migration before stored state schema can evolve in place.
3. External long-term memory remains a connection/capability decision, not an
   extension of Session state.

## Outcome

Item 12 is complete. The north-star fixture preserves exact isolated typed
state for two principals across Server restart while projecting verified
initiator/current principal, tenant, channel, and Turn lineage; Desktop Project
Threads persist and reopen the same state through their existing Runtime
Session authority. Context, Session state, transcript history, and external
memory remain distinct. This pass stops without starting another roadmap item.
