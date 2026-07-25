---
status: accepted
---

# Pause Runtime Sessions at source-owned provider-token boundaries

## Context

Agent Projects can run multi-turn ReAct loops through one durable Runtime
Session. Provider-reported usage is visible after a turn, but before this
decision an Agent author could not bound cumulative main-provider input or
output tokens. A crossing response could therefore be followed immediately by
another provider call.

The durable operation ledger already commits a terminal main-provider message
before exposing it to Pi and safely replays known completions. Runtime Session
schema V4 already owns Runs, waits, checkpoints, branches, compaction, and
recovery. Token enforcement must reuse that authority without estimating
missing usage, interrupting a paid crossing call, losing its tool effects, or
turning Desktop state into policy authority.

Pi Agent Core 0.80.3 exposes `shouldStopAfterTurn` in its functional loop but
does not forward it through the stateful `Agent` wrapper used by LLM Space.

## Decision

### Agent source declares two independent Session limits

`defineAgent({ limits })` accepts `maxInputTokensPerSession` and
`maxOutputTokensPerSession`. Each value is either a positive safe integer or
`false`; omission and `false` mean uncapped. The normalized limits participate
in the compiled Agent definition, artifact fingerprint, closed bundle, and
immutable Runtime Run configuration snapshot.

Limits are source-owned V1 policy. Desktop does not offer a Thread override,
and changing model, provider, reasoning, checkpoint, or branch does not reset
the Session's usage. Host tightening, general cost/turn/tool/time limits, and
parent-child aggregation remain later work.

### Runtime schema V5 owns lifetime totals and window baselines

Runtime Session schema V5 adds a versioned budget snapshot containing lifetime
main-provider input/output totals, independent input/output baselines, an
unmetered-call count, and an append-only sequence of waiting/granted/stopped
decisions. Each wait records the immutable Agent fingerprint and limits, the
reached axes, exact window usage, lifetime totals, both pre-grant baselines,
active Run, and decision status.

Only settled main-provider terminal messages contribute. A completion or
known failure with non-zero provider input/output usage is counted exactly
once in the same Session Store commit as its durable operation settlement.
Durable replay does not count it again. Missing, invalid, or all-zero usage
contributes zero and increments `unmeteredProviderCalls`; Runtime never
estimates it. Ambiguous `outcomeUnknown` work retains the existing fail-closed
behavior and receives no guessed usage.

Compaction summary-provider operations are auxiliary durable operations and do
not contribute to this V1 budget. Cache, reasoning, and total-token fields do
not become independent enforcement axes.

### The crossing call and complete tool batch settle before the wait

Runtime tests current-window usage before every main-provider dispatch and at
Pi turn boundaries. A call that reaches or crosses a limit completes, its
message and usage settle, and any tool calls in that response follow the
existing approval and full-batch durability rules. Runtime then transitions
the same active Run to `waitingForBudget` before the next main-provider call.

LLM Space carries a narrow Bun patch for Pi Agent Core 0.80.3 that forwards the
existing `shouldStopAfterTurn` callback through `Agent`. This avoids a second
ReAct loop, synthetic transcript messages, or tool-only termination behavior.
The patch should be removed when the upstream wrapper exposes the hook.

### Continue and Stop are explicit CAS decisions on the same Run

An authenticated Host may decide a pending wait with only one of two actions:

- `freshWindow` atomically advances both baselines to the current lifetime
  totals and resumes the same Run once;
- `stop` cancels only the active Run and retains totals, baselines, Session
  history, and editable Thread state.

Both decisions require the current Session version and pending Run, so
concurrent or stale decision makers cannot both win. App exit is not Stop: an
undecided wait survives restart. A later user-selected execution point uses the
existing Thread/checkpoint behavior; budget handling never chooses or creates
a Thread or branch. Explicit Project Thread duplication creates a new Thread
and Runtime Session, copying editable content/configuration but not budget,
Run History, checkpoint/branch authority, or Server identity.

Desktop Direct, Desktop Sandbox, embedded Local Server, and protected Server
all project the same Runtime wait and decision. Renderer requests carry only
the decision identity; Bun/Server derive Session, Run, usage, limits, and CAS
version from trusted state. Protected Server publishes a
`sessionBudgetRequired` control event and accepts the decision through an
authenticated Run endpoint.

### An active Run keeps its compiled Agent across source sync and restart

Desktop resolves an active Run through its immutable Runtime Run configuration,
not the mutable Agent provenance copied onto the editable Thread. Each valid,
trusted compiled Agent snapshot is stored Bun-side as a self-contained bundle
and matching artifact descriptor under
`projects/<projectId>/snapshots/<fingerprint>/`. The renderer and Thread file
receive only the fingerprint; authored executable code remains inside the Bun
trust boundary.

If Agent A waits, source rebuilds and syncs to B, and Desktop restarts, a grant
loads A from that durable bundle and continues the same Run. A later new Run
uses B because its new configuration records B's fingerprint. A missing,
malformed, or mismatched bundle blocks the old Run; Desktop never substitutes
current source or a fallback runtime.

### Unsupported V4 bytes remain untouched

Development V4 Runtime Sessions are retained and rejected explicitly. Runtime,
Desktop, and Server do not clear, rewrite, infer, or silently migrate them.

## Considered options

- Preflight token estimation was rejected because provider tokenization and
  cache accounting differ and the requirement is exact real usage.
- Stopping the crossing provider stream was rejected because it can discard a
  paid result and leave operation outcome ambiguous.
- Resetting totals or creating a new Thread on grant was rejected because the
  decision is a new accounting window inside the same Session and execution
  point remains user-owned.
- Implementing a second loop around Pi was rejected because Pi remains the
  owner of model/tool lifecycle.
- Counting compaction was rejected because auxiliary context management is not
  the authored main-session token job in V1.

## Consequences

Authors can bound independently reported input and output consumption for a
Runtime Session. Users see exact current-window and lifetime usage, and no next
main-provider call begins after a reached boundary without an explicit fresh
window. Crossing output, tool approvals/results, Session history, and restart
recovery remain durable.

The guarantee is intentionally provider-evidence based: unmetered calls are
visible but cannot be enforced exactly. Limits are not billing or provider
quota guarantees. V1 does not include cost, turn, tool, time, concurrency,
schedule, compaction, ordinary Thread, organization policy, or subagent budget
aggregation.
