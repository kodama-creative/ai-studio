# Session Token Budget V1

- Status: done
- Outcome: completed
- Roadmap item: 21
- Date: 2026-07-25

## Trigger and starting state

The owner asked to continue `LOOP_PLAN.md` after item 20 shipped. `develop`
started clean and synchronized with `origin/develop` at
`4857f40da7994f62a3968ce0553bdd1fc32e3115`. This discovery changes only the
capability map, current-run audit evidence, and this decision log; it does not
change product code, run GitHub Actions, package/release the app, or make a paid
provider call.

The product remains in development. Old Runtime Session bytes do not need an
automatic migration, but they must not be cleared or silently rebuilt. Budget
decisions must stay in the same Project Thread and Runtime Session. They must
not create a Thread, choose a checkpoint, or replay completed provider/tool
effects on the user's behalf.

## Product stage and evidence reviewed

Reviewed `AGENTS.md`, README, `LOOP_PLAN.md`, the current capability map, the
item 18–20 kaizen records, ADRs 0011–0013, the authored/compiled Agent
definition and fingerprint path, Runtime Session Store schema V4 and CAS
mutations, durable provider settlement, Pi Agent ReAct hooks, Runtime
compaction, Desktop Direct/Sandbox streaming, protected and embedded Local
Server execution/protocols, Run History, approval safe waits, recovery/resume,
and the previous superseded budget discovery.

Concrete findings:

- Provider usage is visible per assistant step, Run, and Trace, but is only
  descriptive. Neither authored Agent source nor Runtime Session state defines
  an input/output token limit.
- `createDurableProviderStream()` settles a main provider terminal message into
  the operation ledger before exposing its terminal event. This is the correct
  one-time accounting seam: replaying a settled operation must not count usage
  again, and a persistence-ambiguous provider call must remain
  `outcomeUnknown` rather than guessed.
- Runtime Session schema V4 owns Runs, operations, approvals, full history,
  compactions, checkpoints, and branches through expected-version CAS. Desktop
  Project records and Server repositories are persistence envelopes around
  that state, not independent budget authorities.
- Runtime compaction uses separately identified auxiliary provider operations.
  Roadmap item 21 explicitly excludes compaction, so V1 counts only main Agent
  provider operations. Summary usage remains observable only through its
  existing compaction provenance and is not silently deducted from the main
  Session token window.
- Pi's low-level loop already has `shouldStopAfterTurn`, which is the correct
  no-error boundary after a complete response/tool batch, but the pinned
  stateful `Agent` wrapper does not expose that option. `afterToolCall.terminate`
  alone is insufficient because an unknown or immediately blocked tool result
  can still lead to another provider turn. Implementation must expose the
  existing turn-stop hook through a compatible Pi dependency update (preferred)
  or an equally narrow Runtime adapter; it must not synthesize an assistant
  error/tool result to represent a budget pause. Preflight on a newly started
  Run can park before invoking Pi at all.
- Existing `waitingForContinue` is semantically generic. A dedicated
  `waitingForBudget` state and budget decision mutation are needed so Desktop,
  Server, recovery, and audit history cannot confuse cost authority with tool
  continuation or approval.
- Runtime schema validation rejects an unsupported schema version explicitly.
  V1 should move to Session schema V5, retain V4 bytes, and reject V4 without
  reset or migration. This matches the development-stage policy used by item
  20.

## Current rendered-product audit

A fresh real Electrobun CEF process used an isolated temporary
`LLM_SPACE_HOME`. Evidence is in
`audits/2026-07-25-162558-session-token-budget-discovery/`.

- `01-current-thread-usage-no-budget.png` shows completed assistant messages
  with `100 in / 20 out` usage and current compaction/branch history, but no
  source limit, current window, remaining budget, or reached state.
- `02-current-run-settings-no-budget.png` shows Run settings open with only
  `Enable ReAct loop` and `Auto run tools`. DOM inspection found no budget text.
- At 1280×800, viewport, document, and body dimensions were all exactly
  1280×800. The console contained only Vite connection and React development
  information.
- The app was stopped with the required two-stage Ctrl+C shutdown. Ports 5173
  and 9333 had no remaining listener.

## External market scan

Primary sources accessed 2026-07-25. Eve evidence was independently checked
against `main@05f348023d4268c974c225c1189a283ace20b742`:

- Eve Agent config:
  https://github.com/vercel/eve/blob/05f348023d4268c974c225c1189a283ace20b742/docs/agent-config.md#L122-L168
- Eve session-limit enforcement:
  https://github.com/vercel/eve/blob/05f348023d4268c974c225c1189a283ace20b742/packages/eve/src/harness/session-limit-enforcement.ts#L43-L119
- Eve durable turn-tag state:
  https://github.com/vercel/eve/blob/05f348023d4268c974c225c1189a283ace20b742/packages/eve/src/harness/turn-tag-state.ts#L94-L255
- Eve compaction:
  https://github.com/vercel/eve/blob/05f348023d4268c974c225c1189a283ace20b742/packages/eve/src/harness/compaction.ts#L204-L226
- Eve subagent token budget:
  https://github.com/vercel/eve/blob/05f348023d4268c974c225c1189a283ace20b742/packages/eve/src/harness/subagent-token-budget.ts#L5-L45
- Pydantic AI usage limits:
  https://ai.pydantic.dev/agents/#usage-limits
- Claude Agent SDK TypeScript:
  https://platform.claude.com/docs/en/agent-sdk/typescript
- OpenAI Agents SDK running agents:
  https://openai.github.io/openai-agents-js/guides/running-agents/

Observed table stakes:

- Autonomous loops need framework-owned limits before another provider request.
  OpenAI Agents has a default maximum-turn boundary; Pydantic AI supports
  request, input/output token, and tool-call limits; Claude Agent SDK exposes
  turn and budget controls with explicit terminal reasons.
- Exact token usage is known only after a provider call. Eve therefore lets the
  crossing call finish, checks independent input/output windows before the next
  call, and requests a deterministic Continue/Stop decision.
- Interactive fresh-window decisions must be durable. Eve stores cumulative
  usage and baselines in Session state and resets both baselines together on a
  grant; a process-local counter would silently bypass the boundary after
  restart.
- Missing provider usage cannot support exact enforcement. Pydantic and Claude
  offer broader run/task safeguards, but neither provides Eve's exact durable
  per-Session input/output fresh-window workflow.

The true LLM Space gap is not another usage chip. It is the missing control
connection between source-authored cost intent, already-durable provider
results, and the next ReAct provider dispatch. LLM Space can make this boundary
inspectable in the same Thread without adopting a hosted task model or losing
the transcript used for debugging.

Eve alignment, intentional differences, and uncertainty:

- LLM Space V1 treats omitted axes as uncapped instead of adopting Eve's hosted
  40,000,000-token root input default. A local development workbench should not
  invent a surprising source policy when the author wrote none. Both omitted
  axes are explicitly uncapped; LLM Space V1 has no implicit default budget.
- Item 21 excludes compaction, so auxiliary summary operations do not consume
  the authored main Agent window in V1. The independent Eve review confirmed
  this matches Eve's current accumulator: compaction `generateText()` usage is
  not added to Session totals. Compaction usage may retain separate visibility;
  exclusion is not a claim that summary calls are free.
- Task-mode fail-fast, delegated-child quota inheritance, schedules, and
  parent-child aggregation belong to later roadmap items 22 and 27.
- Providers can return zero/absent usage. V1 records a settled dispatched main
  call with no non-zero input/output evidence as unmetered, contributes zero,
  and never estimates it. This makes the hard boundary exact for metered calls
  without overstating total spend.

## Capability-map freshness

- `Token Usage Visibility`: confirmed from current UI and persistence code;
  still explicitly has no quota enforcement.
- `Run And Streaming`, `Runtime Recovery And Replay`, `Durable Human Approval`,
  and compaction/branch capability: confirmed from item 18–20 current source and
  shipped verification records.
- Added `Agent Session Token Budgets`: `missing`, freshness `confirmed`, from
  fresh CEF evidence plus current Runtime/Desktop/Server source inspection.
- No stale or unknown boundary drives this recommendation.

## Product north-star metric

Name: **exact budget-boundary stop correctness**.

Why it matters: an autonomous Agent workbench is trustworthy only when a
source-owned token threshold prevents the first forbidden next paid model call
without truncating the call or effects already authorized by the prior window.

Baseline: zero of two provider-reported axes are authorable or enforced. Usage
is visible after calls, while ReAct can continue until the model stops, the
user aborts, or an unrelated error occurs.

V1 target: input and output limits are both source-authorable; every
threshold-crossing call and its tool batch complete; additional main provider
dispatches remain exactly zero while the Run waits; one fresh-window grant
resumes exactly once; Stop dispatches nothing; totals, baselines, reached axes,
unmetered count, and decisions remain identical after restart and branch
restore.

Measurement: deterministic provider fixtures cover input-only, output-only,
both-axis, exact-equality, crossing, all-zero/unmetered, provider failure with
reported usage, replay, crash/CAS races, tool batches, restart, Stop, fresh
window, new Run, compaction exclusion, branch restore/fork, Desktop
Direct/Sandbox, and protected/embedded Server. Tests assert provider call
counts at every boundary. A real CEF audit verifies authored limits, active and
reached summaries, same-Run Continue/Stop, restart hydration, 1280×800 and
900×700 layout, keyboard focus, overflow, and console state.

Guardrails: no estimates; no transcript/history deletion; no implicit Thread,
Run, branch, or user message; no replay of completed model/tool effects; no
rollback of consumed totals on restore/fork; no renderer-provided usage,
principal, limit, or resume claim; approvals, compaction, Sandbox, state,
structured output, and `outcomeUnknown` semantics remain intact; old Session
bytes are retained; full Bun tests, all eight TypeScript configurations, lint,
Vite, diff checks, and real CEF checks pass. Actions and packaging remain out
of scope per owner direction.

## Candidate product opportunities

### Main recommendation: source-owned Session Token Budget V1

Add independent authored input/output token limits, Runtime Session-global
exact accounting for settled main provider operations, a durable
`waitingForBudget` boundary, and explicit fresh-window or Stop decisions shared
by Desktop Direct/Sandbox and Local Server.

Why now: items 18–20 supplied the missing prerequisites—one-time provider
operation identity, safe durable waits, approval-grade CAS decisions, complete
Session history, and branch semantics. Implementing the budget now converts
existing usage visibility into actual autonomous-execution control without
prematurely generalizing all limits.

### Alternative 1: general maximum-turn/request limits first

Preflightable request counts are simpler and provide a useful loop fuse, but
they do not fulfill item 21's exact provider-token job. Cost, turns, tools,
time, and inheritance are deliberately grouped under roadmap item 22 after the
token authority exists.

### Alternative 2: warning-only token alerts

Soft alerts need less Runtime state and may improve awareness, but cannot meet
the north-star metric: ReAct would still dispatch the forbidden next provider
call while nobody is looking.

## V1 capability definition

Authored contract:

```ts
defineAgent({
  model: "openai/gpt-5.3-codex",
  limits: {
    maxInputTokensPerSession: 200_000,
    maxOutputTokensPerSession: 20_000,
  },
})
```

- Each axis accepts a positive safe integer or `false`. Omission leaves that
  axis uncapped. Unknown keys, zero, negative, fractional, unsafe, NaN, and
  infinite values fail authored-definition validation.
- Limits flow through normalized/compiled definitions, immutable artifact
  fingerprints, capability snapshots, and Run configuration. The synced Agent
  definition is authoritative; the Thread/renderer cannot override a limit.
- Runtime Session schema V5 adds one versioned budget snapshot with cumulative
  input/output totals, independent window baselines, unmetered dispatched-main-
  provider count, current reached axes, last decision metadata, and the limits
  fingerprint used for each wait/grant. Totals and baselines are Session-global
  and never roll back on checkpoint restore or branch creation.
- Only a main provider operation's first durable settlement contributes.
  `usage.input` and `usage.output` are added exactly as reported, including a
  failed provider message that reports real usage. Cache read/write, reasoning,
  totalTokens, estimated context size, and auxiliary compaction calls do not
  inflate either V1 axis. A dispatched call with no non-zero input/output usage
  is recorded unmetered and contributes zero.
- Reaching or crossing an axis never interrupts that provider call or its full
  tool batch. Before the next main provider dispatch, Runtime atomically moves
  the active Run to `waitingForBudget` and publishes the exact reached axes,
  window consumption, limit, cumulative totals, and unmetered count.
- `Continue with fresh budget` is an authenticated Host command that CAS-wins
  once, sets both baselines to current cumulative totals, records the grant,
  transitions the same Run back to execution, and resumes without adding a
  message or replaying settled work.
- `Stop session` is a normal user decision that CAS-transitions the waiting Run
  to `cancelled`; it is not an agent/provider failure. The Thread remains
  editable at its current working location. A later user can choose any current
  Thread execution point exactly as today; the new Runtime Run parks before its
  first provider call until a fresh window is granted. Stop never selects a
  checkpoint or creates/clears a Thread.
- Desktop displays a compact read-only `Input used / limit` and
  `Output used / limit` Session summary in the Agent runtime provenance area.
  A reached Run gets one inline blocking card after the latest settled step,
  with reached-axis details, unmetered disclosure, `Continue with fresh budget`
  as the primary action, and `Stop session` as the secondary action. Run History
  records reached/granted/stopped decisions. Run settings remains execution-mode
  preferences, not the place to override source-owned limits.
- Protected Server adds a typed budget-required control event and authenticated
  budget-decision endpoint. Desktop Local Server consumes the same protocol;
  no Local Server-only or renderer-only budget state exists.
- Explicit Project Thread duplication is normalized across Desktop Direct,
  Desktop Sandbox, and Local Server: copy the editable transcript, Agent/model
  configuration, and ordinary Thread settings into a new Thread and new Runtime
  Session, but do not copy lifetime/window budget totals, active Run, Run
  History, checkpoint/branch authority, or Server Session identity. This is the
  only fresh-budget path that creates a Thread, and it occurs only after the
  user's existing explicit Duplicate action.

Explicit non-goals: estimated enforcement; context-window reservation;
auxiliary compaction usage; cost/turn/request/tool/time/concurrency/schedule
limits; ordinary Thread budgets; Thread-local or renderer limit overrides;
provider quota/billing reconciliation; organization policy; subagent/task
inheritance; parent-child aggregation; automatic Stop; migration of V4 Session
bytes; broad usage dashboards; or a generic human-input framework.

## Acceptance and audit plan

- Public/source contract tests validate exact fields, values, normalization,
  compilation, artifact fingerprinting, Build diagnostics, and `false`/omission.
- Session Store tests validate schema V5, atomic first-settlement accounting,
  legal `waitingForBudget` transitions, same-Session global totals across
  branches, CAS one-winner grant/stop, journal order, V4 explicit rejection,
  and invariant corruption checks.
- Runtime tests prove the full crossing call and tools settle, no forbidden next
  main call occurs, replay does not double-count, compaction does not count,
  zero usage is unmetered, Stop is cancellation rather than failure, and fresh
  window resumes the same Run once after restart.
- Desktop Direct/Sandbox and Server integration tests prove the same Runtime
  snapshot/decision semantics with Host-only authority and no renderer claims.
- Duplicate tests prove every Runtime Profile creates a new Thread/Session with
  copied editable content/configuration, zero budget totals, no active Run,
  no Run History/checkpoint/branch authority, and no automatic execution.
- Real CEF audit captures active, reached, granted, stopped, Run History, and
  restart states at 1280×800 and 900×700; checks keyboard focus/order,
  accessibility names, no overflow, and no relevant console errors.
- Final local acceptance runs package Bun tests (including opt-in real Docker),
  all eight TypeScript projects, root lint, Vite, diff checks, fixed-point
  Standards/Spec review, and an Eve-alignment review. GitHub Actions and release
  packaging remain excluded unless the owner changes direction.

## Implementation plan and approval status

Approval status: the original recommendation was approved on 2026-07-25.
`$grill-me` added one coherent scope delta—normalize explicit Project Thread
duplication to a fresh Runtime Session—and the owner then approved the complete
revised V1. No product code will change until the separate concrete Desktop
interaction is confirmed.

1. After approval, run `$grill-me` to resolve target job, Stop/new-Run behavior,
   exact usage classification, schema V5, compaction exclusion, branch/global
   totals, Server authority, risks, and stop conditions. If scope changes, ask
   for approval again.
2. Present the exact Desktop interaction—summary placement, reached card,
   actions, transitions, focus/keyboard behavior, persistence side effects, and
   audit screenshots—and obtain a second explicit confirmation before editing
   product code.
3. Extend authored/compiled Agent definitions and artifact fingerprints with
   validated `limits`; update public docs/examples and diagnostics.
4. Introduce a deep Runtime budget coordinator and Session schema V5. Make main
   provider settlement plus usage accounting atomic, add `waitingForBudget`,
   recovery, CAS grant/stop commands, journal entries, and explicit V4 rejection.
5. Expose Pi's existing low-level `shouldStopAfterTurn` through the stateful
   Agent API via a compatible dependency update, or stop for renewed approval
   if that cannot be done narrowly. Use it so a reached crossing step completes
   its whole tool batch and exits naturally before another provider request;
   preflight new/resumed Runs before Pi dispatch and avoid synthetic transcript
   messages. Do not rely only on `afterToolCall.terminate`.
6. Extend Desktop RPC/controller and Project Thread projection with Host-owned
   budget decisions, compact summary, inline wait card, Run History provenance,
   and same-Run resume. Reuse the existing Thread execution-point selection.
   Normalize explicit Project Thread Duplicate across Runtime Profiles to copy
   editable content/configuration into a new Thread and new Runtime Session
   without copied budget, Run History, checkpoint/branch, or Server authority.
7. Extend protected Server protocol/client/controller/repository and embedded
   Local Server with the same wait/control/decision semantics.
8. Add the deterministic acceptance matrix, run full local verification and
   real CEF/product-design audit, fix in-scope findings, update ADR/README/
   capability map/roadmap/log, and run fixed-point reviews before commit/push.

Stop conditions: any implementation would estimate missing usage, interrupt a
crossing call, replay a settled effect, count compaction contrary to the
roadmap, lack a no-error all-turn Pi stop hook, let renderer data authorize a
decision, require clearing Session/Thread data, create a Thread implicitly, or
diverge between Desktop and Server.

## `$grill-me` requirements discussion

Complete; revised scope awaits renewed approval. Resolved decisions:

1. `Stop session` cancels only the active Runtime Run. It retains Session
   totals/baselines and Thread working state; a later user-selected execution
   point parks again before provider dispatch until a fresh window is granted.
2. A waiting/current Run remains bound to its immutable Agent snapshot and
   limits. Rebuilt/synced limits apply only to a newly created Run; cumulative
   budget state remains Session-owned.
3. A dispatched main-provider operation with no non-zero input/output evidence
   is recorded unmetered, contributes zero, is never estimated, and is visibly
   disclosed.
4. `window usage >= limit` is reached. The equality/crossing call completes;
   the first forbidden next call does not dispatch.
5. Crossing-response tool calls retain their existing tool/approval lifecycle.
   A required tool approval is decided and the full batch is durably settled
   before the Run parks for budget; budget never bypasses approval or drops
   tool calls.
6. Failed provider results with reported real usage count. `outcomeUnknown`
   usage is never guessed and keeps existing fail-closed behavior.
7. Protected/Local Server without an online decider remains durably waiting;
   it does not auto-Continue, auto-Stop, or use Eve task-mode fail-fast.
8. All main provider/model selections in a Runtime Session share one budget.
   Model, provider, reasoning, or Thread override changes do not reset it.
9. Explicit Project Thread Duplicate creates a new Runtime Session with copied
   editable transcript/configuration but no copied budget, active Run, Run
   History, checkpoint/branch authority, or Server Session identity. This is
   the only scope change from the originally approved plan.
10. Every fresh-window grant advances both input/output baselines to current
    lifetime totals even when only one axis reached. Totals never reset.
11. Explicit Abort while waiting is equivalent to Stop and cancels the Run
    without resetting budget. App close is not Abort; restart restores the wait.

Target job, must-have behavior, non-goals, acceptance criteria, data authority,
risks, and stop conditions are now resolved. No ambiguity remains for product
scope; concrete UI placement/copy/focus states require the separate interaction
confirmation mandated by `kaizen-loop`.

## Concrete Desktop interaction proposal

Status: confirmed by the owner and implemented.

Entry points and active summary:

- When at least one authored axis is limited, Agent Thread `headerDetails`
  shows one keyboard-focusable `Session budget` chip beside Agent/runtime
  provenance, not inside Run settings. Its compact text uses current-window
  usage (`Budget · 12k in / 3k out`); at narrow width it collapses to icon plus
  `Budget` without forcing document overflow.
- Activating the chip opens a read-only popover with input/output window
  usage and limits, lifetime totals, unmetered main-provider call count, and
  `From Agent source`. A `false` axis displays `Unlimited`; if both axes are
  omitted/false the chip is absent. The renderer derives all values from the
  persisted Runtime Session snapshot.

Reached state and primary actions:

- `waitingForBudget` renders one non-transcript inline region immediately after
  the latest settled assistant/tool batch. Heading: `Session budget reached`.
  It lists each reached axis as exact `window usage / limit`, lifetime totals,
  and any unmetered disclosure. It does not masquerade as a user, assistant,
  tool, approval, or error message.
- Primary action: `Continue with fresh budget`. It opens `ConfirmDialog` titled
  `Continue with a fresh budget?`, explains that both baselines advance to the
  current lifetime totals and the same Run resumes, and confirms with
  `Continue`. While the authenticated CAS is pending, both actions disable and
  the primary label is `Continuing…`. The winning decision changes the inline
  boundary to `Fresh budget granted` while the next provider turn streams.
- Secondary action: `Stop run`. It opens `ConfirmDialog` titled
  `Stop this run?`, explains that the Thread and lifetime budget remain, and
  confirms with `Stop run`. The boundary becomes `Run stopped at budget
  boundary`; the Runtime Run is cancelled and ordinary execution-point actions
  become available again.
- The global Run split button does not dispatch while a budget decision is
  pending. Its main label becomes `Budget reached`; click or Cmd/Ctrl+Enter
  scrolls/focuses the inline region rather than creating another Run. The Run
  settings chevron remains available only for the existing ReAct/auto-tool
  preferences and never edits limits.

States, transitions, and coexistence:

- `running → waitingForApproval → waitingForBudget` is visible when the
  crossing response requires tool approval. Budget actions do not appear until
  the approval batch and tool results settle.
- `running → waitingForBudget` occurs after an ordinary complete crossing tool
  batch, or before Pi dispatch when a newly user-started Run is already over
  its current window.
- `waitingForBudget → running` occurs only after one fresh-window CAS winner;
  `waitingForBudget → cancelled` occurs after Stop/Abort. App close keeps the
  wait unchanged and reopening restores the same inline region.
- Run History adds `Waiting for budget`, `Fresh budget granted`, and
  `Stopped at budget boundary` journal/status rows with exact axes/totals/
  baselines. Historical/inspected Runs are read-only and never show active
  decision buttons.
- Restore/fork keeps the Session budget chip/totals global. The next execution
  still starts from the user's selected working point using existing behavior;
  budget UI never selects or creates a branch. Explicit Duplicate creates the
  approved fresh Thread/Session and does not copy the budget/history authority.

Keyboard, focus, and accessibility:

- The reached region has a stable labelled `region` and polite live
  announcement. Arrival scrolls it into view after streaming settles but does
  not steal focus.
- Tab order is `Continue with fresh budget` then `Stop run`. While waiting,
  clicking Run or pressing Cmd/Ctrl+Enter moves focus to the primary action.
  Escape closes only an open confirmation/popover; it never decides, grants,
  stops, or navigates the Thread.
- ConfirmDialog returns focus to the invoking action on cancel. After a
  successful decision, focus moves to the persisted boundary status until the
  normal streaming focus behavior takes over. All compact/icon states retain
  full accessible names and use the app-level Tooltip wrapper.

Persistence side effects and audit evidence:

- Only Bun/Server authenticated commands commit grant/stop. Renderer input is
  action identity only; it never supplies usage, limits, baseline, Session,
  Run, principal, or expected-version claims.
- CEF acceptance captures the chip/popover, reached card, both confirmations,
  continuing/stopped boundaries, approval-before-budget ordering, Run History,
  restart recovery, historical read-only state, restored-branch behavior, and
  fresh explicit Duplicate at 1280×800 and 900×700. It verifies tab/focus/Escape,
  live labels, zero overflow, and no relevant console error.

## Work performed

Implemented the approved V1 end to end:

- Added source-owned `defineAgent({ limits })` input/output Session limits,
  validation, compiled/artifact/bundle identity, and immutable Run snapshotting.
- Advanced Runtime Session storage to V5 with lifetime usage, two baselines,
  unmetered-call count, append-only waiting/decision history, and
  `waitingForBudget` CAS transitions.
- Settled real main-provider usage exactly once with durable operation
  completion, excluded auxiliary compaction, and parked only after the crossing
  call and complete approval/tool batch.
- Added a minimal pinned Pi Agent Core patch that forwards its existing
  `shouldStopAfterTurn` hook through the stateful `Agent` wrapper.
- Added Desktop Direct/Sandbox and embedded/protected Server wait, observation,
  fresh-window, Stop, recovery, and authenticated decision paths.
- Added the Desktop budget chip/popover, non-transcript wait card,
  confirmations, Run/Cmd+Enter focus behavior, persisted read-only boundaries,
  and Run History budget nodes.
- Made explicit Project Thread Duplicate create a new Runtime Session across
  Direct, Sandbox, and Local Server profiles without copying budget, Run
  History, checkpoint/branch authority, or Server identity.
- Added ADR 0014 and updated Runtime/Server README, capability map, roadmap, and
  this record. Unsupported V4 bytes remain retained and explicitly rejected.

No ordinary Thread budget, implicit Thread creation, data clearing, Actions,
packaging, signing, release, or paid-provider call was added or run.

## Verification and product-design audit

Final local verification on Bun 1.3.14:

- `bun run lint:check`: pass.
- Eight `tsc --noEmit` project checks (root, Desktop, both examples, CLI, Core,
  Runtime, Server): pass.
- Runtime tests: 211 pass, one opt-in Docker test skipped.
- Desktop tests: 123 pass.
- Server tests: 31 pass.
- Core/CLI/examples tests: 64 pass.
- Total non-Docker suite: 429 pass, zero fail.
- `bun run test:docker`: one pass, 42 assertions, with real Docker create,
  isolate, retain, reconstruct, and delete behavior.
- `git diff --check`: pass.
- Renderer Vite build ran successfully as part of the real CEF sessions.

The current product audit is recorded at
`audits/2026-07-25-230642-session-token-budget-v1/audit.md`. Real Electrobun CEF
inspection at 1280×800 and 900×700 confirmed the source-owned budget summary,
both confirmations, same-Run fresh grant, active-Run Stop, restart recovery,
Run/Cmd+Enter primary-action focus, labelled polite live region, Run History,
read-only historical boundaries, zero document/body overflow, and no
application console error. Deterministic persisted fixtures reached the exact
boundary without spending a live paid-provider request.

One parallel high-memory Runtime run printed only passing cases and then hit a
Bun 1.3.14 process-exit segmentation fault at 1.93 GB RSS. The same Runtime
package immediately passed alone with its stable final result: 209 pass, one
opt-in Docker skip, zero fail. This is the same runner-level failure shape
observed before the review fixes and did not correspond to a failed assertion.

## Review and remaining risks

The independent `eve_alignment` review returned PASS with no blocker. It
confirmed authored field/value parity, crossing-call completion, next-call
preflight, dual-baseline fresh grants, normal Stop cancellation, missing-usage
zero contribution, compaction exclusion, and Session-global non-rollback across
branches. It classified omission-as-uncapped and deferred task/subagent
inheritance as explicit V1 scope differences; LLM Space must not claim complete
Eve limits or delegation-tree budget parity.

The implementation preserves the item 18–20 authority and does not overload
approval state. The narrow Pi patch adds only wrapper forwarding for an
existing loop hook; it remains maintenance risk until upstream exposes the
same option. Deterministic acceptance proves missing/all-zero usage is visible
but cannot provide enforcement for an unmetered provider. A live paid-provider
smoke and full screen-reader matrix remain evidence gaps, not V1 correctness
blockers.

The first fixed-point Standards/Spec review against
`04726c0366d7967b2f232d627fbb1dc147363d25` found actionable issues. All were
fixed before push:

- resumed waits select the immutable Run configuration's Agent fingerprint;
  Desktop persists trusted compiled snapshots as Bun-only closed bundles, and
  the top-level A-wait → B-sync → manager-restart fixture proves a fresh grant
  still selects A while the following new Run selects B;
- each wait persists exact lifetime totals and pre-grant baselines, and Run
  History renders them;
- the header presents both axes, explicitly labels `false` as `Unlimited`, and
  focus lookup is scoped to the active Thread container;
- the budget UI is split into one memoized primary component per file using the
  house `FooImpl` pattern;
- every newly added test now lives under its workspace-level `tests/` mirror;
  the legacy state-machine matrix was moved intact and its colocated copy was
  removed;
- client and Server reuse one strict budget-wait protocol validator.

The remaining judgement-call suggestions (a shared decision request type and
deduplicating `AgentSession.prompt()`/`continue()` control flow) do not change
the V1 contract and are deferred rather than expanded into this loop. Final
fixed-point re-review from `04726c0366d7967b2f232d627fbb1dc147363d25` to
the final candidate returned Standards PASS and Spec PASS with no blocker.

## Follow-up product bets

- Item 22 general limits and Host/child tightening after the token state machine.
- Item 27 subagent inheritance and parent-child aggregation.
- Optional auxiliary-operation/cost observability policy in a separate loop;
  it must not be silently added to item 21.

## Outcome

Implementation, local product acceptance, Eve alignment, and final fixed-point
Standards/Spec reviews are complete. The next suggested loop is item 22,
General Limits V2, while subagent inheritance stays deferred until item 27.
