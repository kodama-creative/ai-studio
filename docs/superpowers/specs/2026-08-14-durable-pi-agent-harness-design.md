# Durable Pi Agent Harness Design

**Status:** Proposed

**Decision date:** 2026-08-14

**Primary decision:** LLM Space will not fork Pi and will not inherit Pi's
in-memory `Agent`. It will implement a Session-native durable Harness using
only Pi's public Session, model, message, tool, result, and `AgentLane` types.
Pi Session is the sole durable authority for transcript and execution state.

## Problem Statement

Studio needs model/tool single-step debugging that survives application
restart. The current Engine provides that durability through its own Thread,
Checkpoint, Run, and Step model, while Pi is used only as an executor. This
creates a second execution model beside Pi Session and prevents Studio and the
end-application Session layer from sharing Pi's transcript, branch, operation,
and recovery semantics directly.

Pi's `beforeToolCall` and `afterToolCall` hooks are awaited and can pause a live
tool call, but the pause exists only in the current JavaScript call stack. The
hooks do not persist the current action, replay policy, result identity, or
recovery cursor. Pi's stock `Agent` also owns its run lifecycle privately and
cannot resume from a durable assistant entry whose tool calls have not yet
executed.

Pi 0.84.1 publicly exposes the intended Session and `AgentLane` contracts, but
its `AgentHarness` execution methods remain a scaffold. Forking Pi would expose
LLM Space to an unstable internal implementation and recurring merge work,
especially because upstream `main` has already moved beyond the 0.84.1 record
design.

LLM Space therefore needs a runtime that preserves Pi's public Session model
without depending on the unfinished Harness implementation. The runtime must
make single-step a durable semantic boundary, recover safely from every
provider/tool crash window, and let Studio remove its duplicate authoritative
execution state.

## Solution

Build `@llm-space/pi-runtime`, containing a `DurablePiAgentHarness` and a thin
`StudioPiSessionRuntime` facade.

`DurablePiAgentHarness` owns execution policy but not a second Session model.
It composes Pi's public `Session`, `SessionRepo`, `SessionTree`, `Entry`,
`LaneRecord`, `Models`, `AgentMessage`, and `AgentTool` contracts. It implements
the manual-drive subset of Pi's public `AgentLane` behavior and grows toward
full structural compatibility as capabilities are added.

`StudioPiSessionRuntime` is the single product-facing test and integration
seam. Studio sends commands and semantic step requests to it; the facade hides
Pi's micro-actions and returns snapshots projected only from committed Pi
Session data.

The execution invariant is:

```text
durable intent -> external effect -> durable settlement
```

A Studio model step drives internal actions until one assistant entry is
durably committed. A Studio tool step drives internal actions until one tool
result is durably committed. Continue uses the same driver without parking at
those semantic boundaries. Restart reconstructs the next action entirely from
Pi Session entries and records; no live `Agent`, closure, Promise, event buffer,
or UI state participates in recovery.

Studio continues to own Project, Playground, Experiment, Draft, source
revision, Evaluation, Task, and presentation metadata. Those objects reference
Pi `sessionId`, lane, operation id, and entry/leaf ids. They never copy an
authoritative transcript or execution cursor.

## User Stories

1. As an Agent author, I want to execute exactly one model step, so that I can inspect the assistant output before any local tool runs.
2. As an Agent author, I want to execute exactly one local tool call, so that I can inspect its arguments and result before the Agent continues.
3. As an Agent author, I want Continue to use the same runtime as Step, so that debug and normal execution do not diverge semantically.
4. As an Agent author, I want a paused step to survive closing and reopening Studio, so that debugging does not depend on one process lifetime.
5. As an Agent author, I want Studio to show whether the next action is a model or tool action, so that each click has a predictable effect.
6. As an Agent author, I want a tool breakpoint to prove that the tool has not started, so that reopening at that breakpoint is safe.
7. As an Agent author, I want unsafe tools not to be replayed automatically after a crash, so that an uncertain side effect is not duplicated.
8. As an Agent author, I want safe tools to be replayable under an explicit policy, so that read-only or idempotent work can recover automatically.
9. As an Agent author, I want streamed text and thinking to appear immediately, so that model steps remain interactive.
10. As an Agent author, I want committed Session content to replace temporary streaming content, so that the visible transcript converges to durable truth.
11. As an Agent author, I want cancellation to survive process boundaries, so that abort is not merely a local `AbortController` operation.
12. As an Agent author, I want missing models or tools to suspend recovery visibly, so that Studio never silently substitutes a different implementation.
13. As an Agent author, I want the model, tools, system prompt, and source revision used by a run to remain identifiable after restart, so that recovery is reproducible.
14. As an Agent author, I want branches and retries to use Pi Session identity, so that the transcript tree is not projected through another checkpoint system.
15. As an Agent author, I want usage and cost to survive restart, so that accounting is not reconstructed from transient UI events.
16. As an Agent author, I want errors from the provider or tool to become durable run outcomes, so that reopening Studio explains why execution stopped.
17. As an Agent author, I want storage corruption and writer conflicts to fail loudly, so that the runtime never guesses the next side effect.
18. As a Studio user, I want existing Playgrounds and Experiments to remain accessible during migration, so that the runtime change does not delete my work.
19. As a Studio user, I want old execution data imported explicitly, so that migration is auditable and reversible.
20. As a CLI user, I want CLI and Studio to use the same Pi Session runtime, so that behavior does not depend on the host surface.
21. As an application integrator, I want one stable facade instead of direct Harness access, so that Pi upgrades are isolated from product code.
22. As a tool author, I want to declare `safe` or `never` replay semantics, so that recovery treats my side effects correctly.
23. As a tool author, I want a stable idempotency key for a recovered invocation, so that my backend can provide stronger duplicate protection.
24. As a maintainer, I want manual and automatic drive to produce the same durable log, so that debugging does not create a second execution protocol.
25. As a maintainer, I want restart tests at every effect boundary, so that recovery behavior is demonstrated rather than inferred.
26. As a maintainer, I want LLM Space to depend only on public Pi exports, so that package upgrades do not break deep imports.
27. As a maintainer, I want one Session writer claim per open Session, so that concurrent windows cannot fork execution accidentally.
28. As a maintainer, I want unsupported Harness capabilities rejected explicitly, so that an unfinished feature cannot fall back to non-durable behavior.
29. As an evaluator, I want evaluation results to reference stable Pi entries and operations, so that scores remain attached to the exact transcript that was evaluated.
30. As a product owner, I want the Engine execution path removable after cutover, so that Session and Run semantics have one owner.

## Implementation Decisions

### 1. Dependency boundary

The runtime depends only on supported Pi package exports. It must not:

- subclass Pi `Agent` or `AgentHarness`;
- monkey-patch private Agent methods;
- import `dist/harness/*` or another unexported subpath;
- copy Pi Session types into an LLM Space namespace;
- reconstruct Session state from Agent events;
- treat `Agent.sessionId` as durable Session identity.

The runtime may implement Pi interfaces structurally and may use Pi's exported
message conversion, compaction, prompt-template, skill, telemetry, and tool
types when a supported capability is added.

The Pi dependency is exact-pinned while the runtime persists 0.84.1 records.
Every upgrade requires a Session-format compatibility review and explicit
migration decision.

### 2. Module ownership

`@llm-space/pi-runtime` owns:

- durable command admission;
- lane coordination and lifecycle;
- recovery reduction;
- next-action planning;
- model and tool execution phases;
- manual/automatic drive;
- runtime snapshots and committed/ephemeral events;
- mapping LLM Space model/tool services onto Pi contracts;
- Session repository lifecycle.

Pi owns:

- Session metadata, entry tree, lane pointers, records, facts, and sequence;
- messages, model identities, usage shape, and tool call/result protocol;
- `SessionRepo` and `SessionStorage` contracts;
- the SQLite Session backend and writer fencing;
- public `AgentLane`, `ActionInfo`, result, and error vocabulary used for
  compatibility.

Studio owns:

- Projects, Playgrounds, Experiments, Drafts, source revisions, Evaluations,
  Tasks, ordering, and presentation metadata;
- references to Pi Session and run identities;
- no authoritative messages, checkpoints, active-run state, or usage.

App owns a product facade over Pi Session. It does not persist another model
transcript or Engine-to-Session projection.

Desktop and CLI are composition roots. They provide data roots, Models,
runtime tools, environment services, and event transport, but do not drive the
model/tool loop themselves.

### 3. Public runtime seam

The only product-facing runtime seam is conceptually:

```ts
interface StudioPiSessionRuntime {
  open(input: { sessionId: string; lane?: string }): Promise<SessionSnapshot>;

  start(input: {
    operationId: string;
    sessionId: string;
    lane?: string;
    messages: AgentMessage[];
    binding: RuntimeBinding;
  }): Promise<StepSnapshot>;

  step(input: {
    sessionId: string;
    lane?: string;
    expectedActionId: string;
    kind: "model" | "tool";
  }): Promise<StepSnapshot>;

  continue(input: { sessionId: string; lane?: string }): Promise<StepSnapshot>;

  abort(input: { sessionId: string; lane?: string }): Promise<StepSnapshot>;

  subscribe(
    sessionId: string,
    listener: (event: RuntimeEvent) => void
  ): () => void;
}
```

The snippet captures the decision-rich boundary, not the final syntax. The
facade uses caller-provided `operationId` for idempotent run admission.
`expectedActionId` protects a Step click from stale UI state and makes a retry
of a lost Step response converge on the already-committed result.

The facade never exposes raw `SessionStorage`, mutable lane state, an
`AbortController`, a parked Promise, or a stock `Agent`.

### 4. Harness compatibility surface

The first version implements the following `AgentLane` capabilities:

- `name` and `session`;
- `getLeafId()`;
- `prompt()` through an extended idempotent admission path;
- `resume()` and `abort()`;
- `waitForIdle()` and `runWhenIdle()`;
- `peekAction()`, `executeAction()`, and `runToCompletion()`;
- model, thinking-level, and active-tool getters/setters when backed by Pi
  entries;
- lane watch for the main lane.

The implementation initially advertises a `Pick<AgentLane, ...>`-equivalent
surface rather than claiming the full interface. Unimplemented capabilities
return a typed `UnsupportedCapability` at the Studio facade. They never call a
stock Agent as a fallback.

Full `AgentLane` compatibility is a later milestone, reached only when queue,
compaction, navigation, resources, and multi-lane behavior is implemented and
tested.

### 5. Durable Session model

The runtime uses Pi's existing durable entities without redefining them:

- `MessageEntry` for user, assistant, and tool-result transcript content;
- `ModelChangeEntry`, `ThinkingLevelEntry`, and `ActiveToolsEntry` for
  model-facing configuration changes;
- `CustomEntry` for LLM Space product timeline items that are not sent to the
  model unless an explicit projector exists;
- `operation_started` for accepted run intent;
- `step_attempt` for each provider attempt and provisioned assistant result;
- `tool_started` for validated tool intent and provisioned tool result;
- `usage` for model, tool, hook, and adjustment accounting;
- `abort_requested` for durable cancellation intent;
- `operation_finished` as the final operation record.

The Session name stores the user-facing conversation title where appropriate.
Archive state, Project membership, Agent Spec identity, and Task membership
remain product metadata because they are not model transcript or execution
cursor state.

System and user-action timeline items become Pi `CustomEntry` values. The
default context builder ignores them; a custom projector must be explicitly
registered before such an entry can enter model context.

### 6. Runtime binding and identity

Every accepted run freezes enough identity to recover without silently using
new code. The Pi `operation_started.intent.resumeData` extension contains an
LLM Space runtime binding with:

- project and Agent Spec identity;
- source revision or immutable generation identity;
- model provider/model id;
- thinking level;
- active tool names;
- stable tool implementation identities and replay declarations;
- rendered or reproducibly resolvable system-prompt identity;
- runtime format version.

Large source files and tool implementations are not embedded in Session.
Recovery resolves the frozen identities through Studio's loader and runtime
registries. A missing or mismatched identity produces suspension with
`MissingIdentities`; it never substitutes the latest source silently.

`operation_started.id` is the run id and equals the caller-provided
`operationId`. Retrying the same start request with identical content returns
the existing operation. Reusing it with different content raises a command
conflict without writing Session data.

Assistant and tool-result ids are provisioned before their effects. Logical
result ids do not change across retry or restore. Tool invocation identity is
the pair `(assistantEntryId, toolIndex)`; provider `toolCallId` is validated
against the persisted assistant entry but is not the only identity.

### 7. Lane coordinator

One process-scoped coordinator owns each open `(sessionId, lane)` pair.

The coordinator provides:

- a FIFO mutation line for read/decide/write operations;
- at most one active external effect per sequential debug lane;
- one open-operation invariant per lane;
- an abort controller for the current live effect;
- wait-for-idle settlement;
- parked manual actions;
- watcher delivery after durable commits;
- transition to a permanent faulted state after storage corruption or lost
  writer ownership.

Mutation jobs may read reduced state, choose one transition, perform at most
one durable write, and publish the new committed snapshot. Provider streams,
tools, hooks, timers, and subscriber callbacks never hold the mutation line.

No code other than the Effects implementation receives the writable Pi
Session. Procedures receive capability-specific effects, which prevents a
manual action from writing or calling a provider while parked.

### 8. Recovery reducer

Open is read-only and starts no provider, tool, hook, or timer. For each lane it
performs:

1. Query open operations with limit two.
2. Treat zero as idle, one as suspended, and two as corruption.
3. Read records belonging to the open operation.
4. Read operation-owned entries from the current leaf back to the recorded
   source leaf.
5. Validate record order, ids, attempts, tool ordinals, and provisioned
   results.
6. Reduce the valid prefix into a complete lane state.
7. Derive a stable next action without writing.

The reducer is pure and total over every valid prefix. Unknown record shapes,
multiple open operations, an attempt gap, result-id mismatch, tool identity
mismatch, a record after finish, or duplicate non-identical materialization is
corruption. Corruption faults the Session; it is never treated as an idle lane.

The reducer is reimplemented from the public Pi record contract and first-party
design/tests. It is not copied through a deep import. Its behavior is pinned by
local parity fixtures so a Pi upgrade cannot change recovery silently.

### 9. Internal actions and Effects

Pi's public `ActionInfo` vocabulary is used for micro-action descriptions:

- durable append/move/fact actions;
- `stream_assistant`;
- `execute_tool`;
- hooks;
- finish actions;
- queue/deferred/timer actions when later supported.

`peekAction()` is pure and stable until the lane changes. `executeAction()`
rechecks the parked action under the mutation line, rejects a stale action,
then releases exactly that action. `runToCompletion()` repeatedly releases
actions until terminal or suspended.

All side effects pass through an injected `Effects` object:

- append record;
- append entry;
- move lane or set fact;
- stream one assistant attempt;
- execute one validated tool call;
- invoke one hook;
- wait on a timer;
- publish committed and ephemeral events.

Manual drive wraps the same Effects with `GatedEffects`; automatic drive uses
ungated Effects. Procedures are identical. For the same deterministic model
and tools, normalized durable logs from manual and automatic execution must be
identical.

### 10. Semantic Studio steps

Pi micro-actions are too fine-grained for a debugger button. The Studio facade
groups them into semantic steps.

A model step:

1. Verifies the expected next semantic action.
2. Commits `step_attempt` with attempt and assistant result id.
3. Releases one provider effect.
4. Streams deltas as ephemeral events.
5. Commits usage before result classification.
6. Commits the assistant `MessageEntry`.
7. Stops before the first local tool effect or at a terminal state.

A tool step:

1. Verifies the expected assistant entry and tool ordinal.
2. Resolves the tool and prepares/validates arguments.
3. Runs the before-tool policy phase.
4. If blocked or invalid, commits the corresponding error tool result without
   claiming that a tool side effect started.
5. If allowed, commits `tool_started` with effective args, replay policy, and
   provisioned result id.
6. Releases exactly one tool effect.
7. Runs the after-tool finalization phase.
8. Commits tool usage when present.
9. Commits one tool-result `MessageEntry`.
10. Stops before the next tool or model effect.

Debug sessions force local tool execution to sequential mode so one click
means one completed tool result. Continue may preserve configured parallel
execution only after a separate parallel-batch implementation proves ordered
result commits and recovery. The first production version uses sequential
execution for both Step and Continue to keep one execution protocol.

Provider-hosted tools remain inside the provider request. They are assistant
response activity, not local `execute_tool` actions, and cannot be stepped as
separate local tools.

### 11. Model execution

The assistant executor performs exactly one provider attempt. It uses Pi
Models and streaming APIs directly rather than invoking stock `Agent.prompt()`
or `agentLoopContinue()`.

The executor:

- builds context from the current Pi branch;
- applies registered entry projectors;
- resolves the frozen model and system prompt;
- converts to provider messages through the configured Pi converter;
- emits ephemeral text/thinking/tool-call deltas;
- returns one complete assistant message and usage;
- does not execute tools or begin a second assistant turn.

Provider retry creates a new `step_attempt` with a durable incremented attempt
number and the same logical result id. A provider request may have been billed
even when its assistant result was not committed. Recovery provides at-least-
once provider attempt semantics, not exactly-once billing.

### 12. Tool execution

Tool preparation and finalization are explicit runtime phases rather than
callbacks hidden inside stock Agent:

```text
lookup -> prepare args -> validate -> before policy
       -> tool_started -> execute -> after policy
       -> usage -> tool-result entry
```

Missing tools, argument preparation failure, schema validation failure, and a
blocked before-tool policy produce ordinary error tool-result entries. They do
not write `tool_started`, because no external tool effect was admitted.

`tool_started` stores hook-adjusted effective arguments and the replay policy
that was active when execution began. Tool execution receives a stable
idempotency key derived from Session, operation, assistant entry, and ordinal.

After-tool policy may transform content, details, error state, and usage. The
settled result is committed only after finalization. A Session write failure is
a Harness fault, not a tool error; the loop must not continue after losing its
durable boundary.

### 13. Tool crash recovery

Recovery follows this matrix:

| Durable prefix                                                          | Interpretation                      | Recovery                                                              |
| ----------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------- |
| Assistant tool call exists; no `tool_started`                           | Tool effect definitely not admitted | Expose the same clean tool breakpoint                                 |
| `tool_started`; result entry exists                                     | Tool settled                        | Skip execution and continue reduction                                 |
| `tool_started(replay=safe)`; result absent; current declaration is safe | Unknown but replayable              | Re-execute with persisted effective args and stable idempotency key   |
| `tool_started(replay=safe)`; current declaration is never/missing       | Safety weakened                     | Commit synthetic interrupted error result                             |
| `tool_started(replay=never)`; result absent                             | Unknown unsafe side effect          | Commit synthetic interrupted error result; never replay automatically |

Synthetic interruption does not rerun before/after hooks. A user-requested
manual retry of an unsafe tool is a new explicit operation or override action,
not automatic recovery, and must be visibly confirmed by the product.

Pi Session cannot guarantee exactly-once external effects. Stronger guarantees
require the tool backend to deduplicate the stable idempotency key.

### 14. Run completion

An operation is terminal only after `operation_finished` is committed.

Outcomes are:

- completed;
- failed;
- aborted;
- suspended, represented by an open operation plus recoverable state rather
  than a terminal finish record.

If the final assistant entry exists but the finish record does not, recovery
commits only the missing finish action. It must not issue another provider
request.

The completion predicate is evaluated from committed entries and tool results.
Runtime-only `terminate` hints are preserved where Pi messages support them but
are never the only evidence for recovery.

### 15. Cancellation and close

Abort order is:

1. Commit one idempotent `abort_requested` record.
2. Signal the current local provider/tool effect.
3. Allow the reducer to settle required synthetic tool results.
4. Commit `operation_finished(outcome=aborted)`.

If the process dies after step one, resume observes the abort intent and
finishes abort recovery instead of continuing the run.

Closing a runtime is a controlled crash, not abort. It stops local work and
releases repository resources without writing a terminal outcome. The open
operation remains recoverable.

All gates and hooks observe the current abort signal and remove their waiter on
abort or close.

### 16. Event and snapshot model

Runtime events have two classes:

- ephemeral: provider text/thinking/tool-call deltas and local progress;
- committed: Session entry/record/fact changes and derived semantic state.

Committed events are published only after the corresponding Session write
resolves. Each includes Session id, lane, operation id when present, Session
sequence, and enough identity to request a fresh snapshot.

Ephemeral events are never replayed after restart. When an assistant or tool
result commits, UI streaming overlays are discarded and the message is rebuilt
from the Pi Session snapshot.

RPC disconnect does not cancel execution. Reconnecting opens the Session and
continues from durable sequence. A separate explicit abort command is required
to stop a run.

### 17. Persistence and writer ownership

The first implementation uses Pi's official SQLite Session backend in a
dedicated Pi-managed database for each Studio persistence scope. Studio
metadata remains in its existing database. Separating databases avoids relying
on undocumented cross-package transaction or schema ownership.

The repository is opened once per project/application runtime and closed by
the composition root. A process-local registry ensures one open handle per
Session. Pi's SQLite fenced writer lease remains authoritative across
processes.

Lost lease permanently faults the local Session handle. No retry is attempted
through the old writer. The UI must reopen after the new owner is resolved.

Creating a product object and Pi Session is reconciled without a cross-database
transaction:

1. Create the Pi Session with a caller-provided stable id.
2. Persist the Studio/App reference to that id.
3. If step two fails, retrying with the same id reconciles the existing Pi
   Session. An unreferenced empty Session is safe to detect and clean later.

Run admission itself occurs only in Pi Session and needs no Studio pending-run
record.

### 18. Error model

Expected command rejection returns tagged results:

- lane busy;
- stale action;
- nothing to resume;
- no active operation;
- invalid message;
- missing runtime identities;
- unsupported capability;
- command conflict;
- closed runtime.

Accepted operations resolve to completed, failed, aborted, or suspended
outcomes. Provider errors, normal tool errors, missing tools, invalid arguments,
and policy blocks are durable operation/transcript outcomes.

Storage failure, lost writer lease, invalid record log, provisioned-content
mismatch, impossible state transition, or programmer defect throws a Harness
fault and permanently faults the Session handle. These failures are not
converted into model-visible tool errors.

### 19. Studio domain changes

Playground and Experiment execution identity changes from Engine Thread and
Checkpoint ids to:

- Pi `sessionId`;
- default lane, initially `main`;
- current leaf id from Session;
- optional active/suspended operation id derived from Session;
- runtime format version.

Studio Draft remains a dirty editable projection. Starting a run commits the
draft's message/config changes into Pi Session and clears the Draft. It does
not create an Engine input checkpoint.

Run history becomes a Studio ordering/reference index over Pi operation ids.
Run detail, messages, usage, and outcome are projected from Pi records and
entries. Evaluation targets reference Pi Session, operation, and leaf/entry
identity.

Studio events retain product-friendly names but are projections of committed
Pi changes. A `message.completed` event is emitted after its Pi MessageEntry;
a `tool.completed` event is emitted after its Pi tool-result entry.

### 20. App and CLI changes

The App package stops defining an authoritative model Session transcript and
Session-to-Engine Run link. Its product Session facade is backed by Pi Session:

- title maps to Pi Session name;
- model messages map to Pi MessageEntry;
- system/user-action timeline maps to Pi CustomEntry;
- current activity derives from an open Pi operation;
- run history references Pi operation ids;
- Tasks remain application metadata referencing Pi Session/operation ids.

CLI starts and watches the same runtime facade as Studio. It does not host a
second agent loop. CLI rendering consumes ephemeral stream events and committed
snapshots using the same reconciliation rule as Desktop.

### 21. Migration and rollout

Migration is entity-based, never dual-write:

1. Introduce the Pi runtime and tests without changing existing Playgrounds.
2. Create new development-only Playgrounds on runtime version `pi-session-v1`.
3. Enable new Playgrounds and Experiments to use only Pi Session execution.
4. Import selected old objects into new Pi Sessions and compare externally
   visible transcripts and run outcomes.
5. Switch default creation to Pi runtime.
6. Migrate App and CLI composition to the same runtime.
7. Remove Studio/App writes to Engine execution state after all supported
   objects use Pi runtime.
8. Retire Engine and Engine-Pi from local product execution once no supported
   reader requires their tables.

An object belongs to exactly one runtime version. Production code never writes
the same model/tool step to Engine and Pi Session. Read-only migration tools may
compare both formats.

Existing data is imported explicitly into a new Pi Session with provenance
metadata. Import does not delete or mutate the old Engine/App/Studio rows.
Automatic startup upgrade does not broadly scan or delete user data.

Rollback switches new object creation back to the old runtime while leaving
Pi Sessions intact. A Pi Session is not automatically converted back into an
Engine Thread.

### 22. Delivery phases

#### Phase 0: contracts and characterization

- Add the package boundary and exact Pi dependency.
- Run Pi Session conformance against the chosen backends.
- Capture public record-validity and Session-context fixtures.
- Define runtime snapshots, errors, effects, and stable action identity.
- Add no-effect open/restore tests.

Exit criterion: an idle/open operation can be reduced deterministically with
zero external effects.

#### Phase 1: model-only vertical slice

- Implement main-lane admission and runtime binding.
- Implement one assistant attempt, usage, message commit, finish, abort, and
  provider retry.
- Implement manual and automatic drive.
- Integrate a headless Studio facade without UI cutover.

Exit criterion: a no-tool run can be stepped, continued, crashed at every
effect boundary, reopened, and converges to the same normalized log.

#### Phase 2: sequential tools

- Implement lookup, prepare, validation, before policy, durable tool intent,
  execution, after policy, usage, and result commit.
- Implement safe/never recovery and synthetic interruption.
- Supply stable tool idempotency keys.
- Add multi-tool sequential semantic stepping.

Exit criterion: every tool crash prefix has a proven recovery outcome and no
unsafe tool is automatically replayed.

#### Phase 3: persistence and host lifecycle

- Integrate Pi SQLite backend and fenced writer lifecycle.
- Implement watch/reconnect and committed event cursoring.
- Verify close versus abort semantics.
- Integrate Desktop/CLI runtime composition.

Exit criterion: process restart, competing writer, lease takeover, and RPC
disconnect tests pass.

#### Phase 4: Studio cutover

- Replace new Playground/Experiment execution references with Pi identity.
- Adapt Draft commit, run history, evaluation targets, and UI events.
- Ship Step/Continue/Abort against the new facade.
- Add explicit old-data import.

Exit criterion: new Studio objects have no Engine Thread, Run, or Checkpoint
writes and recover entirely from Pi Session.

#### Phase 5: App/CLI cutover and retirement

- Replace App model Session projection with Pi-backed facade.
- Route CLI through the shared runtime.
- Remove obsolete local Engine execution composition and stores after data
  support policy permits.

Exit criterion: all supported local execution surfaces use one Pi Session
runtime and no duplicate authoritative transcript remains.

### 23. Security and privacy

Session records may contain prompts, effective tool arguments, model output,
tool results, and runtime binding metadata. They use the existing local data
root permissions and must not be logged to analytics or diagnostic output
without redaction.

Tool argument persistence is required for recovery. Tools that accept secrets
must pass references or redactable handles rather than raw credentials. The
runtime never persists process environment variables or resolved auth tokens
inside effective args.

The renderer never receives writable Session storage or tool executors. All
execution remains in the trusted Bun process behind typed RPC.

### 24. Observability

Runtime diagnostics include stable Session, lane, operation, action, attempt,
assistant entry, and tool ordinal identifiers. Logs distinguish ephemeral
effect progress from committed Session changes.

Metrics include:

- operations started/completed/failed/aborted/suspended;
- model attempts and retry count;
- tool executions, safe replays, and synthetic interruptions;
- recovery duration and corruption count;
- writer lease loss;
- stale Step rejection;
- Session append latency;
- semantic Step latency.

Message content and tool arguments are excluded from metrics by default.

### 25. Acceptance criteria

The design is complete when all of the following are true:

1. Pi Session is the only durable transcript and execution-state authority for
   a migrated object.
2. No production code subclasses or monkey-patches Pi Agent/Harness.
3. No unsupported Pi deep import exists.
4. Model Step returns only after one assistant entry commits.
5. Tool Step returns only after one tool-result entry commits.
6. The next semantic action is stable and can be guarded by action id.
7. Opening a Session performs no provider, tool, hook, or timer effect.
8. Manual and automatic drive produce equivalent normalized Session logs.
9. Every provider/tool durable prefix has a tested recovery outcome.
10. Unsafe unknown tool outcomes are never automatically replayed.
11. Session write failure stops execution rather than becoming a tool error.
12. Abort intent is durable before the local signal is fired.
13. Lost writer lease permanently fences the old runtime.
14. Streaming overlays reconcile to Session entries after commit/reconnect.
15. Studio run history and evaluations resolve from Pi identities.
16. New migrated objects write no Engine Thread, Run, or Checkpoint state.
17. Old data remains untouched unless the user invokes explicit import.
18. Focused, full test, typecheck, lint, and production build gates pass.

## Testing Decisions

### Primary behavioral seam

The highest and primary test seam is `StudioPiSessionRuntime`. Tests operate as
a Studio caller and assert snapshots, semantic steps, events, and restart
behavior. They do not assert coordinator fields, Promise gates, or private
procedure structure.

Required behavioral scenarios include:

- start, one model Step, one tool Step, Continue, and terminal result;
- stale Step action rejection;
- duplicate start admission with identical and conflicting payloads;
- abort before, during, and after each external effect;
- reconnect after lost ephemeral deltas;
- missing model/tool identity suspension;
- close and reopen at every durable prefix;
- imported Session rendering and evaluation references.

### Effects crash seam

`Effects` is the single lower-level fault-injection seam. A deterministic test
wrapper parks before each effect, releases zero through N effects, simulates
process loss, opens a new runtime over the same Session, verifies restore made
zero effects, resumes, and compares the final normalized Session log.

The crash matrix covers:

- before/after operation admission;
- each initial message append;
- before/during/after provider stream;
- usage before assistant append;
- assistant append before tool planning;
- before/after tool intent;
- tool side effect before result;
- before/after after-tool policy;
- tool usage and result append;
- abort intent and terminal finish;
- final assistant append before operation finish.

### Session backend seam

Run Pi's official Session conformance suite for Memory, JSONL where retained for
development, and SQLite production storage. Add writer-specific tests for:

- two repositories opening the same Session;
- lease expiry and fenced takeover;
- the old writer attempting another write;
- old close not releasing the new owner's lease;
- project/application runtime shutdown.

### Deterministic model and tool fakes

Model fakes emit deterministic text, thinking, tool calls, usage, provider
errors, retryable errors, and abort behavior. Tool fakes expose deterministic
results plus counters keyed by idempotency key. Tests assert external call
counts to prove replay decisions.

No test mocks Pi Session reduction at the primary seam. The real Session
implementation is used so transcript and record invariants remain exercised.

### Parity and compatibility

Local reducer fixtures are derived from Pi's valid-prefix and corruption cases.
They assert public behavior, not copied source structure. Pi dependency upgrades
run the same fixture corpus before any persisted-format decision.

Manual and automatic runs use identical fake effects. Their logs are normalized
by removing storage-assigned sequence, timestamps, and intentionally random ids;
all semantic records, entries, order, usage, and outcomes must match.

### Studio integration

Studio application tests verify:

- Draft commit becomes Pi entries/config state;
- Step and Continue call the one runtime seam;
- run history ordering references Pi operations;
- evaluation targets remain stable across restart;
- committed runtime events project to existing UI event semantics;
- no Engine store writes occur for Pi-runtime objects.

Desktop RPC tests verify correlation, reconnect, duplicate response handling,
and explicit abort. Renderer tests assert only presentation and store
reconciliation; they do not mock tool execution in a browser.

### Quality gates

Each delivery phase must pass focused runtime tests and TypeScript checking.
Cutover phases additionally require the full Bun test suite, zero-warning lint,
all workspace typechecks, and production renderer build.

## Out of Scope

- Forking Pi or contributing the implementation upstream as part of this work.
- Subclassing or patching stock Pi `Agent`.
- Full `AgentLane` support in the first production slice.
- Multi-lane/subagent execution in the first production slice.
- Parallel local tool stepping in the first production slice.
- Queue steering, follow-up, next-run, compaction, navigation, skills, and
  prompt-template execution until their dedicated phases are specified.
- Generic exactly-once provider billing or external tool side effects.
- Treating provider-hosted tools as separately executable local tool steps.
- Automatic destructive migration or deletion of old Engine/App/Studio data.
- Maintaining simultaneous Engine and Pi writes for the same execution.
- Remote legacy workspace execution and the static shared-thread viewer until
  a separate compatibility plan includes them.
- Changing Studio's Project, Experiment, Draft, Evaluation, or Task product
  concepts beyond replacing their execution references.

## Further Notes

The existing Pi hook research remains useful for understanding live event
ordering, but hooks are implementation phases inside this runtime, not its
source of truth. The Session recovery prototype proved that model/tool next
actions and unsafe-tool interruption can be reconstructed after dropping all
runtime objects. It did not prove provider/tool production behavior; the
Effects crash matrix is the required production evidence.

The non-fork decision deliberately trades upstream code reuse for a stable
public dependency boundary. This is acceptable because the upstream Harness
execution code is not implemented in the pinned release. The cost is that LLM
Space owns recovery correctness and must maintain the reducer/effect protocol
with the same discipline as a storage engine.

Before implementation tickets are marked ready, the team should agree that
`StudioPiSessionRuntime` is the single product seam and that the first release
uses main-lane, sequential local tools, and no unsupported fallback. Expanding
those three constraints changes the recovery and test matrix materially and
requires an explicit follow-up design decision.
