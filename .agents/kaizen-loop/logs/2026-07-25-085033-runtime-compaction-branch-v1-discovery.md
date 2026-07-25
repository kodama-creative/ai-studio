# Runtime Compaction And Branch Navigation V1 Discovery

- Status: done
- Outcome: completed and locally verified
- Roadmap item: 20
- Date: 2026-07-25

## Trigger and starting state

The owner asked to continue the next roadmap item after item 19 shipped. The
`develop` branch started clean and synchronized with `origin/develop` at
`ece1168 feat(runtime): add durable tool approvals`. This loop does not modify
product code before approval and does not run Actions, packaging, release, or
the paused Loopany schedule.

The product remains in development. Existing Threads and Runtime Sessions must
not be cleared or silently rewritten. A user chooses an execution boundary in
the same Thread; inspecting or restoring a checkpoint must not implicitly
create a Thread or execute a Run.

## Product stage and evidence reviewed

Reviewed the project contract, README, `LOOP_PLAN.md`, the three latest kaizen
logs, the current capability map, ADRs 0001, 0002, and 0011, Runtime Run/Session
Store schemas and journal invariants, Desktop Thread Runtime coordination, Run
History grouping/inspection/restore, the 20-snapshot Thread history cap, Server
transcript authority, and Pi Agent Core 0.80.3's public context and compaction
surface.

Concrete findings:

- Runtime Session schema V3 stores Run/configuration/journal, instruction,
  capability, state, operation, and approval records, but `RuntimeRunSnapshot`
  has no parent Run, parent checkpoint, branch id, label, active leaf, immutable
  message entry, or compaction record.
- Desktop already creates a new Run when a waiting continuation fingerprint
  changes and marks the prior Run superseded, but lineage is implicit. Run
  History groups checkpoints by Run id in a flat newest-first list.
- `restoreThread()` keeps Runtime Session/Profile/Run History and replaces the
  working Thread as one undoable action. It does not record which checkpoint is
  now the selected execution base.
- Core retains at most 20 complete Run snapshots. Runtime Session retains the
  ordered journal but not complete message history, so neither structure alone
  supplies an unbounded, de-duplicated audit tree.
- `AgentSession` currently passes its complete `initialMessages` to Pi and has
  no `transformContext`. Long Sessions therefore grow model context without an
  inspectable summary boundary.
- Installed Pi 0.80.3 publicly exports `transformContext`,
  `prepareCompaction()`, `compact()`, context estimation/cut-point helpers, and
  branch-summary helpers. The latest published package is 0.82.0 and upstream
  main was inspected at commit
  `8eef62ed3ea62d646a7fad92fa583fc8d71fec17`. V1 can reuse the pinned public
  pure helpers through an adapter without adopting Pi `AgentHarness`, Pi
  `Session`, or Pi's session repository as durable authority.

## Current rendered-product audit

A fresh real Electrobun CEF process used an isolated temporary
`LLM_SPACE_HOME` and a deterministic two-checkpoint Thread. Evidence is in
`audits/2026-07-25-085033-runtime-compaction-branch-discovery/`.

- Run History correctly groups two checkpoints under one Runtime Run and
  exposes Compare, Inspect, and Restore.
- Inspect is non-mutating and shows the checkpoint transcript, but navigation
  is only `1 of 2` / `2 of 2` chronological movement.
- Restoring the older checkpoint updates the working editor in the same Thread,
  but there is no active checkpoint/branch marker or explanation that the next
  execution will fork. Visual emphasis remains on the newest checkpoint.
- The group header uses an opaque truncated Run id and exposes no user label,
  divergence point, parent/child relation, summary boundary, or current branch.
- The 1280×800 viewport, document, and body dimensions matched exactly. Console
  output contained only Vite/React development information.

## External market scan

Primary sources accessed 2026-07-25:

- Pi Agent Core main at pinned evidence commit:
  https://github.com/earendil-works/pi/tree/8eef62ed3ea62d646a7fad92fa583fc8d71fec17/packages/agent/src/harness/compaction
- LangGraph persistence:
  https://docs.langchain.com/oss/javascript/langgraph/persistence
- LangGraph time travel:
  https://docs.langchain.com/oss/javascript/langgraph/use-time-travel
- Claude Code checkpointing:
  https://code.claude.com/docs/en/checkpointing
- Claude Code sessions and branching:
  https://code.claude.com/docs/en/sessions#branch-a-session

Observed table stakes:

- Durable checkpoints are inspectable and identified independently of the
  mutable current working state.
- Replaying and forking are distinct. Forking creates a new branch from a past
  checkpoint while preserving the original path; replay may re-execute later
  LLM/API work and must say so explicitly.
- The current branch/session and divergence point remain visible. Branches have
  stable identities and useful labels rather than only opaque ids.
- Long conversations can be summarized at explicit boundaries while the
  original transcript remains available. Users can tell what range was
  summarized and retain recent full-fidelity context.
- Compaction is not destructive history deletion and is not a substitute for
  version control, effect idempotency, or durable external-operation evidence.

The true LLM Space gap is the missing bridge between its stronger durable
operation ledger and its flat, capped Thread snapshots. Copying a competitor's
tree widget would not solve this. LLM Space needs one Runtime-owned immutable
checkpoint tree whose active model-context projection can compact without
discarding audit history or replaying external effects.

Uncertainty: LangGraph uses a graph/checkpointer programming model and warns
that replay re-executes downstream nodes. Claude Code also tracks filesystem
state, whereas this V1 concerns Runtime transcript/context only. Pi's latest
package is newer than the pinned catalog; implementation must validate the
pinned public helper behavior and should not bundle an unrelated dependency
upgrade into the capability.

## Capability-map freshness

`Runtime Recovery And Replay`, `Run History And Debug Timeline`, and `Prompt And
Thread Building` are confirmed from current source and the fresh CEF audit.
Added `Long Session Context And Branch Navigation` as a confirmed missing
capability with a dependency-ready Runtime foundation. No stale or unknown
boundary drives the recommendation.

## Product north-star metric

- Name: long-session branch continuity with complete audit history.
- Reason: an Agent builder must be able to continue beyond one model context
  window and try an alternative from any safe checkpoint without losing or
  confusing the original execution path.
- Baseline: zero Runtime parent/branch/compaction records; the visible history
  is a flat list capped at 20 snapshots; restored checkpoints are not marked;
  model context always receives the complete current transcript.
- V1 target: one deterministic long-Session fixture compacts the active model
  context at a safe boundary, retains 100% of original message/journal entries,
  and creates an explicit child branch when execution begins from an earlier
  checkpoint. After restart, every checkpoint has one stable parent/path,
  current branch/base is visible, and zero pre-fork provider/tool effect is
  re-dispatched.
- Measurement: table-driven Session tree/compaction/restart/CAS fixtures plus a
  60-turn two-fork Desktop/Server fixture; compare full-history entry count and
  fingerprints against the compacted Pi context; inspect current/parent branch
  and compaction nodes in real CEF at 1280×800 and 900×700.
- Guardrails: Pi `Agent` remains the loop owner; no Pi `AgentHarness`/`Session`
  durable authority, destructive history deletion, implicit Thread creation,
  silent branch switch, external-effect replay, hidden summary model call,
  production migration/reset, secret/raw provider payload retention, console
  error, visible overflow, or regression of approval/Sandbox/structured-output
  state.

## Candidate product opportunities

### Main recommendation: one immutable Runtime checkpoint tree with compaction nodes

Add parent-linked Runtime checkpoints, branches, user-editable labels, immutable
message entries, and durable compaction records to the existing Session Store.
Project the active path into Pi using its public compaction helpers while the
full tree remains intact. Replace the flat Run History grouping with a
navigable tree that clearly marks the current branch and selected execution
base.

### Alternative 1: branch navigation before compaction

Add parent links and a tree UI but keep sending the full transcript. This is a
smaller UI win, but it does not meet item 20's long-Session outcome and would
likely force a second schema/UI pass when compaction arrives.

### Alternative 2: automatic compaction with the current flat Run History

Use `transformContext` and Pi summaries without adding branch lineage. This
extends context quickly but makes summary provenance and restore/fork behavior
harder to trust. It would hide the durable boundary that users need to debug
why a later model call saw a summary instead of original messages.

## Why now

Items 18 and 19 established exact provider/tool operation identity, safe
restart, park/resume, and approval integrity. Item 20 can now compact and fork
without treating old effects as replayable. It also establishes the lineage
needed by future Subagents, limits, schedules, evaluations, and unified Trace,
while directly improving the core Desktop debugging workflow.

## V1 capability definition

After V1:

1. Runtime Session owns an append-only checkpoint tree with stable checkpoint,
   branch, Run, and parent identities. Immutable message entries retain the
   complete transcript; the mutable Desktop Thread and Server transcript are
   current-path projections committed atomically with the same Host envelope.
2. The first path is `Main`. Executing from the current head continues that
   branch. Inspecting/restoring an older checkpoint does not create anything;
   starting a new Run from that selected base creates one explicit child branch
   in the same Thread and preserves the original branch.
3. Branches get deterministic fallback labels (`Main`, `Branch 2`, …) and may
   be renamed by the user. V1 does not spend a model call generating labels.
4. Before a provider call at a safe settled boundary, Runtime may prepare a
   compaction from the active branch using Pi's public pure helpers. The summary
   call is visible and covered by the durable provider-operation boundary.
5. A successful compaction stores summary text, summarized entry range,
   first-kept entry, input/model/configuration fingerprints, token evidence,
   and terminal state as an immutable tree node. Original entries are never
   deleted. Future model context uses the latest summary plus retained recent
   messages; the visible Thread transcript remains full fidelity.
6. Compaction never starts during a model/tool/approval operation. Failure or
   cancellation stops before the main provider call and remains explicitly
   retryable; it never silently drops messages or falls through to a context
   request known to exceed the model window.
7. Run History becomes a branch/checkpoint tree. It marks `Current`, the
   selected `Working from` base, branch state, checkpoint count, and compaction
   nodes. Inspect stays non-mutating. `Restore here` explicitly selects the
   working base; the banner explains that the next Run will create a branch.
8. Tree keyboard behavior uses Up/Down between visible nodes, Left/Right to
   collapse/expand, Enter to inspect, and separate explicit controls for
   `Continue from here` and Rename. No key or selection starts execution.
9. Restart reconstructs the same active branch, selected safe base, latest
   usable compaction, and complete history. Old schema records are retained and
   rejected clearly during development; nothing is cleared or silently
   migrated.

Explicit non-goals: branch merge/rebase/delete, cross-Thread branches, shared
collaboration history, AI-generated branch labels, source-authored compaction
DSL, new summarization model/provider selector, arbitrary summary editing,
generic operation inspector, token/cost enforcement, history search, Pi
`AgentHarness`/Pi `Session` adoption, replay of pre-checkpoint effects, or
production migration/reset.

## Acceptance and audit plan

- Add Session schema/invariant fixtures for parent cycles, missing parents,
  unique branch heads, immutable entries, selected-base validity, branch label
  limits, concurrent fork CAS, restart, and old-schema rejection without data
  deletion.
- Prove same-head continuation does not branch, older-base execution creates
  exactly one child, and two concurrent attempts admit one winner.
- Project a 60-turn path through Pi compaction helpers and prove full durable
  history remains byte/fingerprint stable while provider context contains one
  summary plus the expected recent messages.
- Inject abort/failure/crash around summary request, summary persistence,
  compaction-node commit, and next provider dispatch. Reuse only durable summary
  completion; never repeat ambiguous work or dispatch the main provider early.
- Cover Desktop Direct/Sandbox/Local Server and protected Server restart while
  preserving approvals, structured output, state, attachments, and Run
  lineage.
- Run focused Runtime/Core/Desktop/Server tests, workspace-split full tests,
  all TypeScript projects, root lint, renderer Vite, and `git diff --check`.
  Continue to omit Actions and Electrobun packaging/release.
- Run a fresh post-implementation product-design audit with a long two-branch
  fixture: flat baseline, current branch, selected older base, branch creation,
  rename, compaction progress/success/failure, summary inspection, restart, and
  1280×800/900×700 keyboard/focus/overflow/console checks.
- Run fixed-point Standards and Spec reviews before marking item 20 complete.

## Implementation plan and approval status

1. After owner approval, run `$grill-me` to resolve transcript authority during
   schema V4, automatic versus explicit compaction trigger, summary failure and
   retry semantics, selected-base persistence, branch-label ownership, and the
   exact old-schema development boundary.
2. Record the accepted Session tree, context projection, summary-operation, and
   branch state machine in ADR 0013.
3. Add deep Runtime modules for immutable history entries, checkpoint/branch
   mutations, validation, replay, active-path projection, and Pi compaction
   adaptation; keep the Session Store interface and CAS boundary.
4. Extend Desktop Thread-file and Server repository atomic envelopes so current
   transcript projection and Runtime tree cannot diverge.
5. Integrate durable compaction before the next provider call without changing
   Pi's ReAct ownership or effect recovery rules.
6. Replace flat Run grouping with the confirmed tree interaction using existing
   Run History/Inspector components, app wrappers, commands, memoization, and
   narrow selectors.
7. Run the long-session/fork/crash matrices, full local verification, rendered
   audit, fixed-point reviews, capability-map refresh, and mark item 20 complete
   only when the north-star fixture passes.

Stop if V1 requires deleting original messages, adopting Pi's Session as
authority, generating a hidden summary outside the operation ledger, replaying
pre-fork effects, implicitly creating a Thread, switching branches on inspect,
weakening approval/Sandbox boundaries, or inventing production migration.

Approval status: the owner approved the recommendation and broad V1 plan, then
completed the required `$grill-me` discussion and separately confirmed the
concrete Desktop interaction. Product implementation is authorized. No product
code had been changed when the approval gates completed.

## `$grill-me` requirements discussion

The owner resolved every material branch one question at a time and approved
the resulting shared understanding:

1. Runtime Session Store owns the append-only immutable executed
   message/checkpoint tree. Desktop `Thread.context.messages` remains the
   editable working copy, and Server transcript is a validated active-path
   projection/cache. Inspect/Restore alone never create a branch or Run; only
   executing commits immutable history.
2. Automatic compaction is checked only when the user starts the next Run and
   before its main provider call. Runtime uses the actual model context window,
   latest provider usage when available, and Pi estimation for the trailing
   messages. The visible, cancellable `Compacting context…` phase and explicit
   `Compact now` action use the same durable provider-operation state machine.
   Nothing compacts in the background, during model/tool/approval work, or on
   app startup.
3. A validated successful summary atomically creates a compaction node.
   Failure or cancellation leaves the prior checkpoint/tree unchanged and
   stops before the main provider call. Ambiguous completion is
   `outcomeUnknown`, is never retried automatically, and requires a new
   user-confirmed attempt. Automatic threshold compaction is fail-closed; it
   cannot be skipped to issue a request without the required reserve.
4. Restore persists a `workingFromCheckpointId` with the current Thread draft
   and remains undoable without mutating Runtime history. Starting a Run from a
   branch tip continues that branch. Starting from an older checkpoint creates
   the child branch, Run, and parent link in one `runStarted` CAS commit. A Run
   that later fails still remains auditable on that branch. No action creates,
   clears, or switches to another Thread.
5. Runtime owns stable branch ids and mutable durable labels. The first default
   is `Main`; later defaults use a non-recycled creation ordinal (`Branch 2`,
   `Branch 3`, …). All branches, including Main, may be renamed. Trimmed labels
   are non-empty, length-bounded, and case-insensitively unique. Rename does not
   create a Run/checkpoint or enter Thread content undo/redo. V1 has no branch
   delete.
6. Runtime Session schema advances from V3 to V4 without an automatic or
   on-open migration. Existing V3 bytes remain untouched and their Thread
   working copy/history stays viewable/editable, but Runtime execution is
   blocked with an explicit unsupported-schema error. Desktop and Server never
   silently clear, replace, or rewrite that record. An explicit migration tool
   is outside Item 20.
7. Compaction is visible as a read-only `Context compacted` child of its Run.
   Inspector exposes the model, source range, token evidence, summary, and the
   retained recent-message boundary. The ordinary message list shows only a
   lightweight boundary marker, not a fabricated system/assistant message.
   Original messages remain inspectable. Users may copy but not edit summaries;
   re-compaction starts from a pre-compaction checkpoint and preserves the old
   node.
8. The confirmed Desktop tree nests Branch → Run → compaction/checkpoint
   rows and separately marks `Current`, `Working from`, and local inspection.
   Clicking inspects; `Restore here` changes the working copy/base. A persistent
   banner explains when the next Run will fork and offers `Return to Current`.
   `Compact now` is exposed only for the current settled tip; an older restored
   base relies on the next Run's automatic pre-call compaction. Up/Down traverse
   visible nodes, Left/Right collapse/expand or move parent/child, Enter
   inspects, F2 renames a branch, Escape backs out, and the existing
   Command/Ctrl+Enter runs from `Working from`. Restore has no single-key
   shortcut and Compare retains a separate checkbox.

Target user/job, must-have behavior, explicit non-goals, persistence authority,
failure/cancellation/restart risks, acceptance criteria, and stop conditions
are resolved. No ambiguity remains that requires another product approval gate.

## Work performed

Implemented the approved V1 end to end:

- Accepted ADR 0013 and advanced Runtime Session storage to V4 with immutable
  message entries, parent-linked checkpoints, stable branch identity/labels,
  current pointers, compaction records, validation, replay filtering, and CAS
  mutations for start/fork, settle, compaction, and rename.
- Added the Pi 0.80.3 compaction adapter and durable coordinator. Summary calls
  run through provider-operation identity, known completions replay, failure or
  ambiguity blocks the main provider, and the successful record commits with
  its provider-only Step checkpoint. The existing Pi `Agent` remains the ReAct
  owner and uses Pi's public `convertToLlm` adapter so summary-plus-recent
  context reaches the main provider.
- Added the explicit compaction-only action. `Compact now` runs only at the
  current settled Desktop tip, exposes `Compacting context…`, makes no main
  provider request, creates no transcript message or Runtime checkpoint, and
  remains unavailable for an older restored base and Local Server V1.
- Persisted Desktop `runtimeWorkingBase` through normal Run metadata and
  restore/undo paths. Inspect/Restore remain non-executing; the next Run from
  an older base creates the child branch atomically. Branch rename persists
  through the Bun-owned Thread authority.
- Replaced the flat Runtime grouping with Branch → Run → compaction/checkpoint
  navigation, independent `Current` and `Working from` state, Restore/Return to
  current, fork-warning banner, rename, keyboard traversal, and a read-only,
  copyable compaction inspector.
- Added Server transcript-backed Runtime checkpoints and kept the protected
  transcript as its current active-path projection/cache. Local Server now
  sends and validates the working base, rebuilds older-fork input from the
  authoritative checkpoint transcript, returns the complete Runtime Session
  projection at terminal, and renames branches through its authenticated
  Server authority. Unsupported V3 Sessions fail closed without rewrite,
  clearing, or implicit migration.
- Added an explicit confirmation before retrying an unknown summary outcome.
  The first click creates no new Run/provider operation; the dialog warns that
  the previous request may have reached the model and retry may incur the
  summary cost again. Other unknown operations remain fail-closed.
- Fixed replay fingerprint drift by normalizing Pi's non-provider-semantic
  synthetic summary timestamp. Added known-failure zero-main-dispatch,
  summary-completion persistence uncertainty, compaction-record commit retry,
  Local Server authority/restart, and 60-turn/two-fork/restart fixtures.
- Closed final review findings: Local Server idempotency lookup now hashes the
  same working base as Run creation; new Desktop tests live in strict mirrored
  `tests/.../stream-thread.test.ts` and `tests/.../thread-store.test.ts` files;
  the long-history fixture now executes 60 sequential Runtime Runs and
  checkpoints before two historical forks and restart; the compaction
  inspector exposes covered/retained entry identities; the main editable list
  shows a non-transcript compaction boundary; and Escape returns from both
  inspector views.
- Fixed verification findings: Pi's summary was initially omitted from
  the main provider context until `convertToLlm` was wired; Thread metadata
  initially dropped `runtimeWorkingBase`; and narrow history cards initially
  overlapped `Current`/`Working from`. The audit also found and fixed
  `Compact now` remaining visible after restoring old history.

## Verification and product-design audit

Final local acceptance passed:

- Core: 41 tests, 0 failures.
- Runtime: 199 tests, 0 failures, with the opt-in real-Docker acceptance test
  skipped by the ordinary suite.
- Server: 29 tests, 0 failures.
- Desktop: 117 tests, 0 failures.
- Root lint, the root plus seven workspace TypeScript configurations,
  `git diff --check`, and the renderer-only Vite production build.
- Eve-alignment focused verification: 35 tests, 0 failures, 126 assertions.

The fresh post-implementation audit used the real Electrobun CEF renderer with
an isolated temporary `LLM_SPACE_HOME`, not a mocked RPC browser. Evidence is
in `audits/2026-07-25-114849-runtime-history-compaction/`. At 1280×800 and
900×700 it verified branch/checkpoint nesting, compaction provenance, same-
Thread Restore and Return to current, current-versus-working-base labels,
rename persistence, Up/Down/Left/Right/F2/Escape/Enter behavior, current-tip
`Compact now` visibility, old-base hiding, scroll reachability, and no page
overflow or application console error. The final 1280×800 fixture also proves
that an unknown summary opens the explicit duplicate-cost confirmation before
any retry operation is created or dispatched. Follow-up screenshots `08` and
`09` verify the main-message boundary, covered/retained identities, inspector
Escape navigation, exact viewport dimensions, and a clean application console.

The north-star target is met across deterministic Runtime history/compaction,
Desktop, and Server fixtures: original entries remain retained, the model sees
the durable summary plus recent messages after restart, execution from older
history produces an explicit child branch, and no pre-fork effect or explicit-
compaction main-provider call is dispatched. A paid live-provider context-
exhaustion run was not needed for deterministic correctness and remains an
explicit evidence limit.

## Review and remaining risks

Main-thread review found no correctness or architecture blocker. The immutable
Runtime ledger and Host working projections remain in one Host persistence
envelope, compaction stays behind the durable provider-operation boundary, and
Pi retains ReAct ownership. The final Eve comparison classified the branch
tree, pre-provider compaction, and Desktop Restore flow as aligned compatible
extensions. LLM Space intentionally remains more conservative than Eve for an
ambiguous dispatched provider effect: it records `outcomeUnknown` and does not
retry automatically.

The first final fixed-point Standards/Spec pass identified Local Server
idempotency lookup, strict test mirroring, missing provenance UI, an overstated
60-Turn fixture, and inspector Escape gaps. Each finding was fixed and rerun;
the final re-review found no blocker. Remaining non-
blocking risks are the size of the in-memory reference Store/history UI, no
live paid-provider context-exhaustion smoke, and the 900×700 whole-workbench
density where variable labels and usage chips may wrap or clip. The document
does not overflow and history remains usable. Formal ARIA tree roles and
expanded-state semantics are also V2 accessibility work.

## Follow-up product bets

- Item 21 can consume the same exact provider-usage and compaction boundary for
  hard Session token budgets without turning compaction into enforcement.
- Item 27 can attach child Session lineage to the same branch/checkpoint model.
- Item 29 can select stable branch checkpoints as Eval inputs.
- Item 32 can project the complete tree into canonical Trace.

## Outcome

Completed Roadmap Item 20. The long-session compaction and same-Thread branch
workflow is implemented, locally verified, audited in the real Desktop, and
recorded in the capability map and roadmap. The next suggested product loop is
Item 21, which can enforce exact Session token budgets at the provider boundary
created here without conflating compaction with policy enforcement.
