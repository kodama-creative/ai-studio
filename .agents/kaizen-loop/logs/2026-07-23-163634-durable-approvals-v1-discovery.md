# Durable Human Approval V1 Discovery

- Status: done
- Outcome: completed; implementation, local acceptance, and fixed-point review passed without a safety blocker
- Roadmap item: 19
- Date: 2026-07-23
- Requirements updated: 2026-07-24

## Trigger and starting state

The owner asked to continue `LOOP_PLAN.md`. `develop` started clean and synchronized with `origin/develop` at `340ba0a feat(runtime): add crash-aware durable execution`. This loop follows shipped item 18. It does not run GitHub Actions, packaging, release, paid provider calls, or the paused Loopany schedule.

The product remains in development. Existing Threads and old Runtime Session records must be retained and rejected clearly when unsupported; no migration, reset, or automatic clearing is assumed. Approval and resume must stay in the current Thread and Runtime Run rather than implicitly creating a new Thread.

## Product stage and evidence reviewed

Reviewed the project contract, README, `LOOP_PLAN.md`, the latest durable-execution kaizen log, the current capability map, ADRs 0007, 0009, 0010, and 0011, the authored tool definition/compiler, `PreparedAgentTool`, Pi `beforeToolCall`, the durable operation coordinator and park CAS, Desktop Thread Runtime Session recovery, current manual/auto-once/ReAct controls, manual custom-tool authoring, Run History, and Server run/repository composition.

Concrete local findings:

- `ToolDefinition` has description, input/output schema, and execute, but no approval declaration.
- Dynamic tool source explicitly rejects `approval` as roadmap item 19 rather than dropping it.
- `AgentSession._beforeToolCall()` is the correct Pi-owned automatic-dispatch seam, but currently only validates structured output and prepares the item-18 operation ledger.
- The operation ledger already supplies exact request identity, durable `parked`, resume-schema fingerprint, parked Session version, and one-winner expected-version CAS.
- Desktop recovery converts a parked Run into `requires Host resume`; there is no authenticated approve/deny/resume flow.
- Manual tool-result editing and the Project MCP Retry warning are execution/debugging mechanisms, not policy decisions.

A fresh real Electrobun CEF session used an isolated temporary `LLM_SPACE_HOME`. It added the locally detected OpenAI Codex provider only to inspect controls and made no model request. Current Run Settings expose only `Enable ReAct loop` and `Auto run tools`; the custom function editor exposes only JSON definition and manual runtime response; Run History has no approval state. Current screenshots live under `audits/2026-07-23-163634-durable-approvals-discovery/`. At 1280×800 there was no document overflow and the console contained only Vite/React development information.

## External market scan

Primary sources accessed 2026-07-23:

- Vercel Eve HITL at commit `d2b57131c7817d61e9d6e4117f665aba20199bab`: https://github.com/vercel/eve/blob/d2b57131c7817d61e9d6e4117f665aba20199bab/docs/tools/human-in-the-loop.md
- Eve multi-tenant approvals: https://github.com/vercel/eve/blob/d2b57131c7817d61e9d6e4117f665aba20199bab/docs/patterns/multi-tenant-approvals.md
- Eve approval types/helpers: https://github.com/vercel/eve/blob/d2b57131c7817d61e9d6e4117f665aba20199bab/packages/eve/src/public/definitions/approval.ts and https://github.com/vercel/eve/blob/d2b57131c7817d61e9d6e4117f665aba20199bab/packages/eve/src/public/tools/approval/approval-helpers.ts
- Vercel AI SDK 7 Tool Approvals: https://ai-sdk.dev/docs/agents/tool-approvals
- Vercel AI SDK Policy-Based Tool Approvals: https://ai-sdk.dev/docs/agents/policy-tool-approvals
- OpenAI Agents SDK JS HITL: https://openai.github.io/openai-agents-js/guides/human-in-the-loop/
- LangGraph interrupts: https://docs.langchain.com/oss/javascript/langgraph/interrupts

Observed table stakes:

- Declare a per-tool rule or input-aware policy before execution.
- Represent allow, deny, and human-required separately; policy errors fail closed for sensitive work.
- Surface pending requests with stable IDs and exact tool input, then resume the same run/checkpoint after a durable wait.
- Support multiple pending tool approvals without losing request-to-decision correlation.
- Preserve sticky decisions only inside an explicit run/session scope.
- Re-evaluate authorization at the execution boundary; approval is not a substitute for tenant authorization, sandboxing, or side-effect idempotency.

Important differences and gaps:

- Eve is the closest source-shape match: `always()`, `once()`, `never()`, and async conditional policies park at `session.waiting` and resume through structured `inputResponses`. Its `once()` keys the bare tool name in the Session. Eve's own multi-tenant guide therefore tells applications to pin current/initiating tenant before consulting `approvedTools`; principal isolation is not intrinsic to the helper.
- AI SDK 7 now centralizes policy in `toolApproval` and supports automatic allow/deny/human-required plus optional signed approval payloads. Its ordinary manual flow is message-history based and warns that client-controlled history needs server binding; durable WorkflowAgent uses a separate workflow persistence boundary.
- OpenAI Agents SDK returns all pending `interruptions`, supports approve/reject plus run-sticky decisions, and serializes `RunState` for later resume. The application must rebuild a compatible agent graph and own principal authorization/version routing.
- LangGraph provides durable generic interrupts, exact `thread_id` checkpoint identity, approve/reject/edit patterns, and ID-keyed parallel resume. Authentication, policy merge, and tool-specific grant scope remain application concerns, and the interrupted node restarts from its beginning.

The true LLM Space gap is not another generic approval card. It is one integrated invariant across authored source, Host policy, authenticated principal, item-18 operation identity, Desktop Thread persistence, and Server resume: no dispatch without an effective decision, no grant crossing principal boundaries, and no automatic replay when a post-approval effect becomes ambiguous.

Uncertainty: AI SDK 7 policy APIs are current and some approval-signing surfaces remain experimental; Eve is rapidly changing and the scan pins one exact commit. None of these sources proves exactly-once external effects. LLM Space must retain item 18's `outcomeUnknown` behavior after a possible dispatch instead of treating approval as replay safety.

## Capability-map freshness

Updated the map through 2026-07-23. `Runtime Recovery And Replay`, `Dynamic Capability Snapshots`, `Agent Action Authoring`, `Sandbox Workspace And Attachment Delivery`, and `Tool Step Orchestration` are confirmed from current code and rendered-product evidence. Added `Durable Human Approval` as confirmed missing with its durable foundation ready. No stale or unknown boundary drives the recommendation.

## Product north-star metric

- Name: approval integrity across restart and resume.
- Reason: a user must be able to trust that one exact tool call either has an authenticated effective decision or cannot dispatch, even after process loss.
- Baseline: zero authored/Host approval policy classes exist; zero principal-bound once grants exist; the operation ledger can park but Desktop and Server expose no approval decision path; recovered Desktop parks only throw `requires Host resume`.
- V1 target: 100% of the source × Host policy merge matrix and injected restart/resume matrix produces the expected allow, deny, or durable human wait; zero unauthorized dispatch; zero decision reuse across principal, Session, Agent/tool/policy fingerprint, or changed arguments; zero automatic retry of an ambiguous post-dispatch effect.
- Measurement: deterministic policy and crash fixtures before policy evaluation, after request persistence, after decision persistence, during CAS claim, before dispatch, during dispatch, after completion, across fresh Runtime/Desktop/Server controllers, plus real CEF approve/deny/reopen checks.
- Guardrails: Pi remains the sole ReAct-loop owner; Thread/Session transcript authority stays unchanged; old records are retained; no model self-approval, cross-principal cache, raw secret/input leakage, approval-as-idempotency claim, Sandbox conflation, implicit Thread creation, data clearing, application console error, visible overflow, Actions, or packaging/release regression.

## Candidate product opportunities

### Main recommendation: item 19 source-minimum × Host-tightenable durable approval V1

Add a Host-neutral approval contract to authored Agent Project actions, merge it monotonically with Host policy, persist the exact request and authenticated decision alongside the item-18 operation park, and expose same-Run approve/deny in Desktop plus an authenticated Server command.

### Alternative 1: item 20 Runtime Harness compaction and branch UX

Long-session context and branch navigation are meaningful user value and dependency-ready, but they do not protect the increasingly capable tool surface. Deferring approvals would leave Sandbox, MCP, and authored effects governed only by global execution mode.

### Alternative 2: item 21 Session Token Budget V1

Real provider usage and safe waits make exact token budgets feasible. It is deferred because it unlocks fewer downstream capabilities and does not close the authorization gap blocking OAuth resume, advanced connections, schedules, and broader autonomous execution.

Item 10 remains a strong authoring bet but is not selected as an alternative because its existing item-17 current-head Actions shipment gate is owner-deferred; this loop does not waive that policy.

## Why now

Item 18 deliberately built the exact durable park, request fingerprint, CAS resume, and ambiguity boundary item 19 needs. Adding approval now converts that internal foundation into a user-visible safety capability before more connection, OAuth, lifecycle, schedule, and delegation features widen the effect surface. It also keeps approval and Sandbox as orthogonal policy layers while that boundary is still explicit.

## V1 capability definition

After V1:

1. Agent Project local tools, canonical ExecutionEnv helpers, and project connection tools may declare source approval using `never`, `once per session`, `always`, or a deterministic/input-aware conditional policy. Omission behaves as source `never`.
2. The Host independently evaluates the same verified call context and may allow, require a human, or deny. Effective merge is monotonic: deny is strongest, then human-required, then allow. A Host cannot weaken source `always` or a source conditional requirement. Evaluation failure blocks rather than silently allowing.
3. A human request is durably bound to Session, Runtime Run/Step/operation, tool call ID/name/contribution, exact argument fingerprint, Agent/capability/policy fingerprints, current authenticated principal and initiator, and decision scope. The model cannot create or answer it.
4. `once per session` records a grant only after explicit approval and scopes it to the same Session, principal, Agent/tool identity, and policy fingerprint. Denial never grants. Principal/policy/artifact/input drift fails closed and never consumes or reuses another request.
5. A model step with parallel gated calls persists every request before any gated dispatch. V1 uses a decision barrier: approved calls dispatch only after every call in the batch has an effective allow/deny decision; denied calls never dispatch and return an explicit bounded denial result to Pi so ReAct may choose a different action.
6. Desktop shows pending approval inline on the existing tool card with exact arguments, policy reason/scope, and separate Direct/Sandbox execution provenance. Approve and Deny update the same Thread and Runtime Run; reopen/restart restores the request. Run History shows `Waiting for approval` rather than a terminal failure.
7. Manual mode is not an approval bypass. An approval-gated executable action enters the same review/decision path before its manual call action can dispatch. Editable custom result tools remain manual debugging and do not pretend to be approved execution.
8. Server accepts approval decisions only through a Host-authenticated, Session-authorized, expected-version command and emits Host-facing pending/settled control-plane state without placing principal data or decisions in model-visible Pi messages.
9. If execution may have started and the process disappears, item 18 still wins: recovery is `outcomeUnknown`, never a second approval prompt followed by automatic redispatch.

Proposed source vocabulary is an approval sub-entrypoint beside `@llm-space/runtime/tools`, not a generic permission DSL. Exact names and interaction copy remain subject to the required `$grill-me` and UI confirmation gates.

Explicit non-goals: argument editing under an existing decision, model self-approval, cross-principal/cross-Session cache, approval administration/roles/four-eyes workflows, external notification channels, organization policy UI, generic OPA integration, workflow graph DSL, exactly-once/idempotency protocol, automatic retry, Sandbox policy changes, operation inspector, or production migration/reset.

## Acceptance and audit plan

- Exhaust the source helper and source × Host merge matrix, including conditional input thresholds, async/throwing policy, omitted policy, and Host tightening.
- Prove exact artifact/capability/policy identity for static and dynamic tools, bundled projects, MCP contributions, and changed-source continuation.
- Add principal-isolation fixtures for two principals sharing infrastructure, initiator/current drift, Session reuse, restart, denial, and once-grant scope.
- Inject crashes at every request/decision/park/resume/dispatch/completion boundary. Only a durable grant may authorize dispatch; ambiguous post-dispatch work remains `outcomeUnknown` and never replays automatically.
- Cover parallel batches with mixed auto-allow, deny, human-required, once-granted, tool failure, and ambiguous sibling outcomes. No approved member dispatches before the batch decision barrier.
- Cover manual, auto-once, and ReAct; Desktop Direct and Sandbox; protected Server; fresh controller/repository restart; old Session schema rejection without deletion.
- Run focused Runtime/Server/Desktop tests, workspace-split full tests, all TypeScript projects, repository lint, renderer-only Vite, and `git diff --check`. Continue to omit Actions and packaging/release unless the owner changes direction.
- Run a fresh real CEF product-design audit after implementation: pending card, argument/reason visibility, Approve/Deny, denial continuation, restart restore, once-grant second call, Run History, keyboard/focus, 1280×800 and 900×700, overflow, and console.
- Run fixed-point Standards and Spec reviews before closing item 19.

## Implementation plan and approval status

1. After approval, run `$grill-me` to resolve policy vocabulary, `once` identity, denial projection, batch barrier, manual-mode behavior, Server authorization, old-schema handling, and exact crash stop conditions.
2. Because the capability changes UI, present the concrete interaction scheme after the requirements discussion and obtain a second explicit confirmation before product-code edits. Confirm entry point, card actions, reasons, pending/approved/denied/stale/unknown states, batch behavior, keyboard/focus, persistence effects, and evidence captures.
3. Record the accepted authority, merge lattice, principal/grant identity, durable state machine, and denial/ambiguity semantics in a new ADR.
4. Add approval authoring/types/helpers and compiler/artifact/bundle/capability snapshot support without exposing Host policy or principal secrets to source/artifacts.
5. Extend the Harness Session/journal with bounded approval requests, decisions, principal-bound once grants, mutations, invariants, replay, and expected-version commands. Reuse item-18 park/operation identity rather than adding another workflow engine.
6. Integrate policy evaluation at Pi `beforeToolCall` and every manual dispatch path; commit the parallel batch decision barrier before executing approved tools.
7. Add explicit Host policy to Desktop and Server composition. Add authenticated Bun/RPC and Server command/event paths; never trust renderer-supplied principal or Host path data.
8. Implement the confirmed inline Desktop interaction and Run History waiting state using current tool-card, command, Tooltip, confirmation, memoization, and narrow store-selector conventions.
9. Run the crash/policy/principal matrices, rendered audit, verification, fixed-point reviews, capability-map refresh, and mark item 19 complete only when its metric is proven.

Stop if implementation would let authored code or the model grant Host authority, reuse a decision after any bound identity changes, execute one gated batch member before the decision barrier, turn approval into an idempotency claim, duplicate Pi's ReAct loop, require clearing existing Threads, or broaden into organization policy administration/notifications.

Approval status: the owner approved the product recommendation and plan, then completed the required `$grill-me` discussion on 2026-07-24. Product code remains blocked on explicit confirmation of the concrete Desktop interaction scheme below. No product code has been changed.

## `$grill-me` requirements discussion

Completed with owner confirmation on 2026-07-24. The discussion resolved:

- Desktop V1 adds no Host-policy settings page. Source declares the minimum; Desktop uses a neutral Host policy; protected Server and embedded Hosts may add code-configured restrictions that only tighten.
- Source and Host use the bounded `never`, `always`, `once`, and `deny(reason)` results. Conditional callbacks may be synchronous or asynchronous and receive read-only verified Session/principal/tool/input context. Invalid, throwing, or non-serializable decisions fail closed.
- A `once` grant is bound to Session, current principal, initiator, Agent/tool identity, and policy fingerprint. It may cover later arguments for the same tool, but the conditional policy still evaluates every call and may require a call-specific approval or deny.
- A model step uses one durable decision barrier. Every member receives an effective decision before any approved member dispatches; after the barrier Pi retains its original parallel execution semantics.
- Denial is per exact tool call, never grants, never executes the tool, and becomes an explicit bounded not-executed result for Pi. A later model call is new and must pass policy again.
- Manual execution does not split approval and execution intent into separate business actions: a gated call uses one durable `Approve & run` decision. The repository-required `ConfirmDialog` is a safety confirmation for that same decision, not a second Run action. Existing once grants still do not convert manual mode into automatic execution. Auto-once/ReAct continue automatically after the barrier.
- Only the same authenticated current-principal/initiator tuple that caused the request may decide it. Desktop uses its fixed local principal; delegated/admin/four-eyes approval is outside V1.
- Source, Agent, or Host-policy drift makes the request stale and stops the original Run without deleting it. The user chooses a boundary in the same Thread for a new Run; there is no implicit Thread creation or history clearing.
- Online approval continues automatically once the barrier is complete. A crash after decision persistence but before dispatch claim restores `Approved — ready to resume` and requires an explicit same-Thread Resume; app startup never executes it in the background. Loss after dispatch claim remains item-18 `outcomeUnknown` and cannot resume.
- Old Thread/Session schema is retained and rejected clearly without migration, clearing, or reset during development.

Shared understanding now covers the target developer job, must-have behavior, explicit non-goals, acceptance criteria, persistence/authority boundaries, risks, and stop conditions. The owner explicitly confirmed the discussion complete. The remaining pre-code gate is the concrete Desktop interaction confirmation.

## Proposed Desktop interaction scheme

Status: confirmed by the owner on 2026-07-24; implementation authorized.

### Entry points and layout

- Reuse the existing inline `ToolCallListItem`; do not add a global approval inbox, modal-first flow, or Host-policy settings page.
- Keep the exact read-only tool name and arguments at the top. Add an always-visible policy row under the arguments with state, source/Host reason, approval scope (`This call` or `This Session`), and a separate execution provenance label such as `Desktop Direct` or `Desktop Sandbox`.
- Keep Copy arguments and response preview. Safety actions remain visible at rest rather than using the current hover-only tool-call action pattern.
- Extend the existing message-level `ToolStepContinuation` footer to summarize the batch, for example `3 tool calls · 2 awaiting approval · 1 denied`. V1 has no Approve All or bulk selection.
- Extend the existing Run History row with `Waiting for approval · N pending` and a `Review` action that scrolls/focuses the first pending card. Decisions are not made inside Run History.

### Primary actions by execution mode

- Auto-once/ReAct pending card: `Approve` and `Deny`. Approve records a durable decision; execution waits until the whole batch barrier is complete, then continues automatically.
- Manual pending card: `Approve & run` and `Deny`. The approval and execution intent are one durable user action, but dispatch still waits for all batch decisions.
- Manual call with a reusable `once` grant: show the existing Run-tool action, because approval is already satisfied but manual execution still requires intent.
- Host/source automatic denial: show `Blocked by policy` plus reason and no approval action. The tool never dispatches.
- Approved-before-crash recovery: cards show `Approved`; the message footer exposes one `Resume approved run` action for the batch. No per-card duplicate Resume and no startup execution.

### States and transitions

- `Checking policy` is transient and non-actionable.
- `Approval required` shows arguments, reason, scope, provenance, Approve/Deny actions, and an accessible pending status.
- `Approved · waiting for N decisions` is durable and disables repeat decisions.
- `Running` reuses the existing spinner/disabled action treatment after the dispatch claim.
- `Response` retains current tool-result rendering.
- `Denied · not run` is a durable read-only result; users cannot edit it into an apparent successful result.
- `Blocked by policy` is an automatic durable denial with reason and no human action.
- `Approved · ready to resume` appears only after safe pre-dispatch recovery and resumes at the message/batch footer.
- `Approval expired` appears when source/Host/Agent identity changed. It has no Approve action; the existing Run-from-message controls let the user choose a new boundary.
- `Outcome unknown` keeps the existing item-18 warning and guarded Retry behavior. An approval decision never changes its ambiguity semantics.

### Batch and selection behavior

- Each call is decided independently by exact request ID; there is no row selection or bulk approval.
- While any request is pending, message-level Call tools/Continue and every dispatch action that could cross the barrier are disabled.
- Approved manual calls remember execution intent while waiting. Once all decisions settle, those calls dispatch; ungated manual calls still require the existing explicit Call tool/Call tools intent.
- Denied members produce known not-run results; approved members execute only after the barrier; Pi receives the complete settled batch and continues under its existing ReAct behavior.

### Keyboard and focus

- When a live Run first parks, scroll the first pending card into view and focus its status container, never the Approve button.
- Tab order within a pending card is Copy arguments, Approve/Approve & run, then Deny. Enter/Space activates only the focused button.
- Cmd/Ctrl+Enter never approves. While approval is pending it cannot Continue the Run and announces that decisions are required.
- Escape never approves or denies. There is no default approval action.
- After a decision, focus the next pending card's status; after the final online decision, focus the batch status while continuation begins. Reopening a Thread restores state without forcibly stealing focus until the user chooses Review.

### Persistence and side effects

- Approval request/decision/grant stays in the Thread-owned Runtime Session record and ordered Host journal, outside the Pi transcript and editable tool-result text.
- Renderer receives only the bounded safe projection needed for the card. It never supplies the authenticated principal, policy fingerprint, Host path, Sandbox authority, or resume claim.
- Approve/Deny/Resume serialize through the existing Thread-file authority and expected-version CAS. No action creates a Thread, clears messages, mutates old Run History, or changes Direct/Sandbox selection.

### Planned rendered evidence matrix

- 1280×800 and 900×700 captures for single pending, conditional reason/scope, mixed parallel batch, manual `Approve & run`, denial, policy-blocked, approved-before-restart Resume, stale request, Run History Review, and `Outcome unknown` coexistence.
- Keyboard/focus checks for Tab, Enter/Space, Escape, Cmd/Ctrl+Enter, focus restoration, accessible status announcements, zero horizontal overflow, and no application console errors.

## Work performed

- Added `always()`, `once()`, `never()`, `deny(reason)`, conditional sync/async approval callbacks, `defineTool({ approval })`, and approval as the only canonical read/write/bash helper option.
- Compiled approval outside Pi-visible definitions and persisted static requirements in immutable Turn capability snapshots. Static dynamically generated requirements rehydrate; dynamically generated conditional callbacks fail explicitly because their executable policy cannot be reconstructed safely under the existing closure contract.
- Added Runtime Session schema V3 approval requests and grants bound to Session, Run/Step/operation, exact request, Agent/tool/contribution, Source/Host policy, current principal, and initiator. Old Session schemas remain untouched and unsupported rather than migrated or cleared.
- Merged Source × Host policy as `deny > always > once > never`, re-evaluated conditional policy after matching once grants, failed invalid/error results closed, and kept Desktop Host policy neutral while exposing a stable-id code-configured Server Host policy.
- Integrated the policy at Pi `beforeToolCall`, preserving Pi's ReAct loop and one full parallel-batch barrier before any sibling receives `preCall`. Denial becomes a known read-only not-run Pi error; ordinary tool failures remain ordinary harness results.
- Reused item-18 park/claim. Approval does not dispatch: an authenticated CAS claim crosses into `preCall`; restart before claim is resumable and restart after claim remains `outcomeUnknown`.
- Wired Agent/Host/principal drift to atomically mark the parked batch `stale`, remove unconsumed request grants, cancel parked operations, publish the updated durable Session, and stop before dispatch.
- Added protected Server approval decision routing, browser client support, safe SSE pending events, owner/continuation authorization, cross-principal hiding, and same-Run resume after every decision.
- Added Bun-authoritative Desktop RPC for standalone and Agent Project Threads. Renderer submits only request ID and decision; it never supplies a Host path, principal, policy fingerprint, Sandbox authority, or resume claim.
- Added inline approval cards, arguments/reason/policy/scope/provenance, pending/approved/denied/stale states, manual `Approve & run`, automatic `Approve`, Run History waiting/Review, and same-message resume. Approval-managed output is read-only and pending batches disable other dispatch actions.
- Added ADR 0012, refreshed the capability map, and completed roadmap item 19 without creating, clearing, migrating, or resetting any Thread.

## Verification and product-design audit

- Full local tests: Runtime 181 pass plus one normal Docker skip; Desktop 110 pass; Server 28 pass; Core 41 pass; CLI 21 pass; example Agents 2 pass. The separately enabled real-Docker acceptance passed 1 test/42 assertions, for 384 passing tests total.
- All eight TypeScript configurations passed. Root lint, `git diff --check`, and the Desktop renderer Vite production build passed. Vite retained its existing large-chunk warning only.
- Fresh real Electrobun CEF evidence is stored under `audits/2026-07-24-205445-durable-approvals-v1/`. Pending and real Deny states were inspected at 1280×800 and 900×700. Both viewport/document/body dimensions matched exactly with no overflow; console output contained only Vite/React development information.
- The real Deny interaction found two in-scope copy/layout defects and both were fixed: a fully denied batch no longer says `Approved · ready to resume`, and the narrow footer no longer truncates its decision state. It now uses `Denied · ready to resume` plus `Resume decided run` when immediate continuation cannot start.
- Post-review CEF HMR verification at 900×700 rechecked exact viewport/body/document widths, the final decision-specific card/footer copy, and console output after the focus/performance fixes; it remained overflow-free with only Vite/React development messages.
- Runtime and Server integration fixtures supply batch, once-grant, restart, principal isolation, stale drift, execute-once, and terminal evidence that the no-provider CEF fixture cannot exercise. A full screen-reader pass and live paid-provider continuation remain outside this local audit.

## Review and remaining risks

The fixed-point Standards and Spec reviews used `340ba0a` and the final staged diff. They found and drove fixes for manual-mode approval bypass, historical-request resume routing, pending-card tab/focus behavior, immutable-decision confirmations, cross-Thread Run History focus, policy-denial preflight ordering, test/helper naming, and hot-list approval derivation. A follow-up Standards review withdrew two false positives after checking the exact ADR batch semantics and the repository's typed request/response RPC precedent; it reported no hard violation or correctness blocker. The final Spec review reported no approval-integrity/Runtime safety blocker. Its focus finding was fixed by focusing the next pending request after a decision and the batch status when live continuation begins. The apparent `Approve & run` gesture conflict is resolved by treating the required confirmation as part of one durable approval-and-execution-intent action.

The main semantic risks are covered by Runtime invariants and tests: approval remains separate from dispatch evidence, sticky grants cannot cross principal or policy identity, and the full batch resolves policy before any sibling dispatch. A Host that changes approval behavior without changing its stable policy id would defeat drift detection; ADR 0012 therefore makes policy-id versioning part of the Host contract.

Rendered evidence remains intentionally split rather than overstated: current CEF screenshots prove pending and real Deny at both target sizes, while deterministic fixtures prove mixed batches, policy-blocked calls, restart resume, stale drift, once grants, principal isolation, and `outcomeUnknown`. The remaining product-design risks are full screen-reader/high-zoom coverage and live paid-provider continuation; the 900×700 evidence is overflow-free and preserves the complete decision state.

## Follow-up product bets

- Item 20 compaction and navigable branches after the approval spine is safe.
- Item 21 exact provider-usage token budgets.
- Item 24 OAuth can later reuse principal-bound durable approval and park/resume without copying tokens into Runtime data.
- Advanced organization/four-eyes policy, external notifications, and policy-as-code remain separate product bets.

## Outcome

Item 19 is complete. The approval-integrity metric is met by the full policy/principal/restart matrix with zero unauthorized dispatch in the fixtures, the fixed-point reviews found no remaining safety blocker, and the next suggested product loop is item 20 compaction and navigable branch UX.
