---
status: accepted
---

# Keep complete Runtime history while projecting compacted branch context

## Context

Runtime Session schema V3 durably identifies Runs, wait checkpoints, provider
and tool operations, approvals, instructions, capabilities, and structured
state. It does not preserve an immutable message history or the parent relation
between Runs. Desktop therefore presents recent full Thread snapshots as a
flat, capped list, and restoring an older snapshot cannot say whether the next
execution continues or forks. Pi also receives the complete mutable Thread or
Server transcript on every provider request, so a long Session eventually
exceeds the selected model's context window.

Pi Agent Core 0.80.3 already exposes pure context estimation, cut-point,
compaction, and `SessionTreeEntry` projection helpers. Adopting Pi's
`AgentHarness`, `Session`, or repository would create a second durable
authority and weaken the crash rules established by ADR 0011. LLM Space needs
those computations behind its existing Session Store CAS seam.

## Decision

### Runtime owns an immutable checkpoint tree; Hosts own editable projections

Runtime Session schema advances from V3 to V4. A V4 Session snapshot contains
one versioned history ledger with:

- content-addressed immutable message entries linked to their preceding entry;
- stable branches with a creation ordinal, mutable display label, divergence
  checkpoint, and current head;
- immutable checkpoint records linked to a parent checkpoint and the message
  head captured at that boundary;
- successful compaction records with their source head, first retained entry,
  model/configuration identity, summary fingerprint, and token evidence; and
- explicit current branch and current checkpoint pointers.

The Runtime Store remains a deep module. `startRun` accepts the selected
working base and the Host's complete working messages. The Store validates the
base, reuses the longest immutable message prefix, appends only the changed
suffix, chooses continuation versus fork, and commits the Run/branch/message
identities atomically under expected-version CAS. Callers never allocate branch
ordinals, infer descendants, or manufacture history-entry fingerprints.

Desktop `Thread.context.messages` remains an editable working copy. It persists
the selected `{ branchId, checkpointId }` execution base as Thread draft
metadata so undo, redo, restart, and explicit Restore preserve user intent.
Server transcript remains the protected active-path projection/cache in the
same repository envelope as Runtime. Neither Host may independently rewrite
the Runtime ledger. Inspect is transient; Restore edits only the Host working
copy and selected base. Neither creates a Runtime Run, branch, checkpoint, or
provider operation.

Local Server create-Run commands carry the selected Runtime working base and
the Server validates that it belongs to the authenticated Session. Execution
from an older Server checkpoint reconstructs input from the immutable
checkpoint transcript, creates the Runtime child branch before external work,
and returns the authoritative Runtime Session/checkpoint projection in the
terminal event. Branch rename is likewise a Server-owned authenticated
mutation; Desktop only persists the returned projection.

### A Run chooses the branch before any external work

The first Run creates `Main`. If a selected checkpoint is the selected
branch's head, `startRun` continues that branch. If it has descendants,
`startRun` allocates the next monotonically numbered branch (`Branch 2`,
`Branch 3`, and so on), links it to the selected checkpoint, and records the
new Run on that branch in one commit before compaction or the main provider
call. A later failed, cancelled, or outcome-unknown Run remains on that branch
for audit.

Branch ids and creation ordinals never change or recycle. Labels are trimmed,
non-empty, length-bounded, and case-insensitively unique within a Session. A
separate CAS mutation renames any branch, including Main, without creating a
Run/checkpoint or entering Thread content undo/redo. V1 has no branch deletion,
merge, or rebase.

Every settled Runtime boundary records a new immutable checkpoint whose parent
is the previous checkpoint in that Run or the Run's selected base. The branch
head and Session current checkpoint advance only with that checkpoint. Complete
original message values remain retained even after compaction.

### Compaction is a visible pre-provider Runtime phase

Runtime checks automatic compaction only when a user starts the next Run and
before that Run's first main provider request. It does not compact during model
streaming, tool execution, approval waits, application startup, or background
idle time. The threshold uses the resolved model's actual `contextWindow`, the
latest valid provider usage when available, Pi estimation for trailing
messages, and Pi's pinned default reserve/recent-token settings. This is context
management, not Item 21 token-budget enforcement.

Runtime adapts the active immutable path into temporary Pi
`SessionTreeEntry[]`, calls Pi's public pure preparation/projection helpers, and
does not persist Pi Session objects. A selected prior compaction is inserted at
its exact source-head boundary; Pi then projects its summary plus the retained
recent messages. The visible Host transcript stays full fidelity.

Summary model calls use the ADR 0011 durable provider-operation ledger. A
compaction step may contain the bounded set of provider operations required by
Pi's public helper, each with a stable slot and request fingerprint. Durable
known completions replay only into the same compaction attempt. The validated
summary record and provider-step checkpoint commit atomically before the main
provider operation can begin. Runtime never persists credentials, headers,
signals, or raw response objects in the compaction record.

Only successful validated summaries create compaction records. A known
failure, pre-dispatch cancellation, or user cancellation before dispatch stops
the Run before the main provider request and leaves the prior tree unchanged.
Once dispatch may have occurred, an abort or persistence ambiguity remains
`outcomeUnknown` under ADR 0011 and is never automatically retried. Automatic
threshold compaction fails closed; there is no "run without compacting" escape
that spends the reserved response window. An explicit retry is a new
user-started attempt and may duplicate provider cost only after the UI says so.
For an unknown summary outcome, Desktop does not create or dispatch that retry
until the user confirms a dialog stating that the prior request may have
reached the model and the new provider operation may incur the summary cost
again. Other `outcomeUnknown` operations remain fail-closed without this
summary-specific retry path.

Replay request fingerprints exclude synthetic summary-message timestamps,
which are not provider-semantic Pi input. This keeps a durably completed
summary replay-stable if committing the compaction record itself must be
retried after restart.

`Compact now` uses the same state machine and is exposed in V1 only for the
current settled branch tip. An older restored base is compacted, if required,
as the pre-provider phase of its next Run, after that Run creates the branch.

### Desktop exposes current state, working intent, and summary provenance

Run History renders Branch → Run → compaction/checkpoint rows. Stable
badges distinguish the Runtime `Current` tip, the Thread's `Working from` base,
and the locally inspected row. Clicking or keyboard Enter inspects without
mutation. `Restore here` changes the current Thread working copy and execution
base. When the base is not Current, a persistent editor banner states that the
next Run creates a branch and offers `Return to Current`.

Up/Down move through visible tree rows. Left/Right collapse, expand, or move to
the parent/first child. F2 renames a focused branch; Escape cancels rename or
returns from the inspector. Existing Command/Ctrl+Enter runs from `Working
from`. Restore has no single-key shortcut, and Compare retains its independent
selection checkbox.

Compaction appears as a read-only `Context compacted` row owned by its Run. Its
Inspector shows model, covered/retained entry boundaries, estimated and
provider-derived token evidence, and the complete copyable summary. The main
message list shows only a lightweight boundary marker, never a fabricated
system or assistant message. V1 does not permit summary editing; a new
compaction preserves the prior record.

### Unsupported V3 data is retained without migration

Development V3 Runtime Sessions are not migrated on startup, open, Restore, or
first Run. Their stored bytes remain untouched. Desktop may still display and
edit the owning Thread working copy and historical snapshots, but Runtime
execution fails explicitly with the unsupported schema version. Server also
refuses execution without rewriting its repository file. Runtime never clears,
silently replaces, or reconstructs a V3 Session. A production migration tool is
outside Item 20.

## Considered options

- Adding branch UI over capped Thread snapshots was rejected because it would
  leave context exhaustion and message authority unresolved.
- Automatically summarizing the mutable Host transcript without durable
  lineage was rejected because summary provenance and restored execution would
  be ambiguous.
- Storing a full message array on every checkpoint was rejected because edited
  branches would multiply unchanged history. Runtime instead reuses immutable
  content-addressed prefixes while preserving complete values.
- Persisting Pi Session/AgentHarness state was rejected because it would create
  a second durable authority and couple recovery to Pi repository behavior.
- Background compaction and silent fallback to the uncompressed request were
  rejected because they hide cost, failure, and the actual context seen by the
  model.
- AI-generated branch names and editable summaries were rejected because they
  add model cost and mutable provenance without helping V1 navigation.

## Consequences

A long Session can retain every original message and external-operation record
while sending a bounded summary-plus-recent projection to Pi. A user can inspect
or restore any checkpoint in the same Thread, see exactly where the next
execution starts, and create one explicit child branch without replaying
pre-fork effects. Desktop and Server share the same Runtime lineage semantics
through the Session Store interface.

V4 stores more durable data and performs stronger validation on every load and
commit. Compaction adds a visible provider request and can conservatively block
on ambiguous completion. V1 does not provide production migration, branch
deletion/merge, context search, summary editing, a new summarization selector,
hard token/cost limits, filesystem checkpointing, cross-Thread lineage,
Subagents, or canonical Trace.
