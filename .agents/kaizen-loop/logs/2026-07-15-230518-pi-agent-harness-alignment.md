# Pi AgentHarness Alignment

- Status: done
- Outcome: blocked
- Roadmap item: 01

## Trigger

Scheduled roadmap execution requested: `$kaizen-loop Make Pi AgentHarness the authoritative LLM Space session core without changing shipped behavior.`

Starting state was clean on branch `develop` at `8f4f48fabb4b0b131f5fcb9dba7f1d83079e7f28`.

## Product stage and context

LLM Space has shipped one filesystem-authored Agent Project model whose Project Threads execute manual, auto-once, and ReAct turns through `@llm-space/runtime`. Desktop Thread JSON is the durable editable transcript; runtime `AgentSession` owns live Pi `Agent` execution, deferred tool placeholders, continuation, event projection, abort, and transcript replacement persistence.

Roadmap item 01 proposes a behavior-preserving convergence onto Pi `AgentHarness` before the compiled-artifact and Server spine. It explicitly excludes new UI, Server, source slots, data migration, Pi forks, and changed shipped behavior.

## Evidence reviewed

- `LOOP_PLAN.md`, the originating Agent Studio/Eve gap roadmap, the current capability map, the three latest kaizen logs, and the prior Pi runtime reuse research.
- Current `packages/runtime` Agent runtime/session, tool policy, event projector, public Node boundary, tests, and runtime documentation.
- Current Desktop Project Thread session construction, persistence adapter, streaming event projection, and abort path.
- Current ordinary Thread `streamAgent()` low-level Pi path.
- Installed `@earendil-works/pi-agent-core@0.80.3` declarations and implementation for `Agent`, `AgentHarness`, Session/Repo, ExecutionEnv, events, save points, abort, and settled behavior.
- Current npm versions and upstream `earendil-works/pi` main at commit `5e336cfa808c7b6056f168d42482c27f3acfc5cc`.
- Clean starting worktree and focused baseline tests.

## External market and upstream scan

Access date: 2026-07-15.

Primary sources:

- Pi repository: https://github.com/earendil-works/pi
- Current Harness implementation: https://github.com/earendil-works/pi/blob/main/packages/agent/src/harness/agent-harness.ts
- Current Harness types: https://github.com/earendil-works/pi/blob/main/packages/agent/src/harness/types.ts
- Published package: https://www.npmjs.com/package/@earendil-works/pi-agent-core
- Pinned source used by the shipped runtime: https://github.com/earendil-works/pi/tree/v0.80.3/packages/agent

Current npm reports Pi Agent Core and Pi AI 0.80.7 while this repository resolves 0.80.3. Upstream 0.80.7 retains the same relevant Harness boundary: turn entry points call `runAgentLoop()` and necessarily add a user prompt; `appendMessage()` writes Session entries; `nextTurn()` queues another user message; `abort()` is present; no public `continue()`/`runAgentLoopContinue()` or transcript-replacement operation exists.

The table-stakes behavior for LLM Space is its already-shipped settled manual-tool workflow: after a model tool call, the run becomes idle, the host supplies exact tool results, and continuation performs another provider turn without inventing a user message. Pi `Agent.continue()` supplies that behavior; Pi `AgentHarness` does not.

The true gap is therefore an upstream Harness continuation/transcript mutation seam, not another LLM Space adapter. GitHub issue search was rate-limited (HTTP 403), so whether an upstream issue already tracks the seam is uncertain; the public source and package contract were directly verified.

## Capability-map freshness

- `Agent Definition And Runtime`: confirmed on 2026-07-15 from current source, focused tests, installed Pi, and upstream Pi.
- `Tool Execution And Continuation`: confirmed from the current runtime tool policy, Desktop streaming path, prior CEF evidence, and focused tests.
- Updated the map to state that Pi `Agent` plus LLM Space `AgentSession` remains the single owner of manual continuation and that AgentHarness alignment is blocked by missing public seams.
- No UI capability changed, so current CEF inspection and a product-design audit were not applicable.

## Product north-star metric

- Name: existing runtime behavior coverage through AgentHarness.
- Why it matters: item 02 and later Server/durability work should build on one Pi-native session authority rather than accumulate a second lifecycle model.
- Baseline: 0% of the target manual/auto-once/ReAct, persistence, abort, reload, tool, and event fixture matrix executes through `AgentHarness`; the focused matrix passes 11/11 through LLM Space `AgentSession` over Pi `Agent`.
- V1 target: 100% of that existing matrix passes through `AgentHarness` with byte/role-equivalent public transcript behavior and no new user prompt during manual continuation.
- Measurement: import-graph assertion plus the existing deterministic runtime and Desktop streaming fixture matrix, expanded for Harness save-point/settled/reload coverage.
- Guardrails: no Thread schema or persistence migration, no extra user message, no placeholder leakage, no changed tool execution boundary, no lost abort/event ordering, no Pi fork/private lifecycle copy, and all required TypeScript/lint/build checks remain healthy.

## Candidate product opportunities

### Main recommendation

Stop item 01 without product-code edits and keep it unchecked until Pi exposes a public prompt-free Harness continuation seam plus a supported way to seed/replace the effective transcript. Then rerun the same behavior-preserving convergence with Harness owning Session/Repo, ExecutionEnv, resources, hooks, save points, abort, and settled events while LLM Space retains only host projection and product-specific tool policy.

Why now: implementing against today's API would violate the exact behavior and ownership objective of item 01. Waiting for or contributing the missing upstream seam is smaller and safer than cementing private Harness lifecycle code immediately before Server and durability work.

### Alternative 1 — retain Pi Agent and redefine item 01

Declare the current Pi `Agent` + LLM Space `AgentSession` adapter the documented session owner, and narrow the roadmap away from Harness convergence. This preserves behavior and may be technically sound, but it materially changes the user-approved roadmap and forfeits Harness-native Session tree, compaction, save-point, and lifecycle semantics. Defer pending an explicit roadmap decision.

### Alternative 2 — migrate Thread persistence onto append-only Pi Session now

Adopt Harness prompt/session semantics and redesign manual continuation, transcript edits, rerun, undo, and reload around Pi Session branches. This could make Harness authoritative without upstream work, but it is a product/data migration and changes shipped behavior. Reject inside item 01's boundary.

Rejected implementation shortcut: copy Harness private `executeTurn()` around `runAgentLoopContinue()` or patch/fork Pi locally. That creates the duplicate session semantics item 01 exists to remove and violates its explicit non-goals.

## V1 capability definition

After the upstream prerequisite, a user should observe no change: manual calls settle and resume without a synthetic prompt; auto-once and ReAct retain exact boundaries; abort, reload, tools, persistence, and events remain equivalent. Internally, every target fixture should instantiate `AgentHarness`, with Pi Session/Repo and Harness events authoritative and one documented LLM Space projection owner.

Non-goals remain: Server, artifact format, new source slots, UI changes, data migration, public plugins, workflow durability, copied Eve behavior, or a Pi fork.

Stop conditions:

- Harness cannot continue from externally appended tool results without adding a user prompt.
- Harness cannot preserve the current editable/reload transcript contract without a Thread/Pi Session data migration.
- The implementation requires copied private Harness lifecycle code or a local Pi fork.
- Event/persistence ordering cannot remain equivalent under focused fixtures.

The first three conditions are true in current Pi, so the loop stopped.

## Acceptance and audit plan

When the prerequisite exists:

1. Prove manual continuation adds no user message and preserves exact tool-call/result identities.
2. Run manual, auto-once, ReAct, dangerous/deferred tool, MCP error, persistence, reload, abort, and event-order fixtures through `AgentHarness`.
3. Assert the runtime import graph no longer constructs Pi `Agent` or drives low-level loops for Agent Project sessions.
4. Verify Harness save-point/settled events persist before terminal Desktop delivery and abort remains lossless.
5. Run runtime, core, CLI, example, and Desktop TypeScript checks; full Bun tests; lint; Desktop build; diff check; and Standards/Spec review.
6. UI/CEF audit remains unnecessary if behavior and UI are unchanged; if any interaction changes, stop and reopen the UI approval/audit gate.

## Implementation plan and approval status

Approval status: stopped at a material persistence/runtime boundary; the standing routine approval does not authorize a Pi fork, private lifecycle copy, data migration, or roadmap redefinition.

Planned implementation after the prerequisite would replace the internal Pi `Agent` with `AgentHarness`, seed a runtime-owned Pi Session from the durable Thread projection, adapt host model streaming through a scoped Models wrapper, map Harness events through one projector, and delete superseded event/session lifecycle logic. No such product-code edit was made.

## `$grill-me` requirements discussion

Not run because the kaizen evidence gate reached an explicit stop condition before an implementable in-boundary plan or product-code edit. The unresolved decision is material rather than a routine default: wait/upstream the missing Harness seam, redefine item 01 around Pi `Agent`, or approve a persistence migration. The scheduled run cannot obtain that new authority through one-way reporting.

## Work performed

- Rechecked current installed, npm, and upstream Pi capabilities.
- Re-inspected the current runtime and Desktop session ownership boundaries.
- Ran the focused current behavior matrix.
- Updated the capability map, Pi research note, roadmap blocker, and loop memory.
- Left item 01 and all other numbered items unchecked.

No product code or dependency version changed.

## Verification

- `bun test packages/runtime/src/runtime/agent/agent-runtime.test.ts apps/desktop/src/bun/streaming/stream-thread.test.ts`: 11 pass, 0 fail.
- Product-design audit: not applicable; no product surface changed.
- Full TypeScript/lint/build suite: not run because no implementation exists and item 01 cannot satisfy its Done-when clause under the current dependency contract.

## Review

Review found that forcing Harness today would either add a synthetic user message to manual continuation, duplicate private Pi lifecycle code, or change the durable transcript model. Each is a spec regression, not an in-scope implementation detail. Documentation-only changes accurately preserve the current owner and blocker; no product regression was introduced.

Remaining risk: future Pi releases may add the missing seam, so every retry must recheck the public contract rather than treating this blocker as permanent.

## Follow-up product bets

1. Preferred: upstream or wait for `AgentHarness.continue()` plus supported transcript seeding/replacement, then rerun item 01 unchanged.
2. Product decision: explicitly redefine item 01 to keep Pi `Agent` as the authoritative runtime session owner.
3. Larger migration: redesign Thread editing/manual continuation around Pi Session trees in a separately approved capability.

## Outcome

Blocked. Current Pi cannot make AgentHarness authoritative while preserving LLM Space's shipped manual continuation and durable Thread contract inside item 01's no-migration/no-fork boundary. The roadmap item remains unchecked.
