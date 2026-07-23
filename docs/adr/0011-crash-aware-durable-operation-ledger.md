---
status: accepted
---

# Keep ambiguous effects stopped behind a durable operation ledger

## Context

The Runtime Harness already gives one Runtime Run a stable identity, immutable
configuration, ordered journal, CAS-protected Session state, safe manual wait
recovery, and honest Run-level `outcomeUnknown` recovery. It does not identify
individual provider or tool effects. A process can therefore lose the result
after a provider or tool may have run, and cannot distinguish a reusable
completion from an ambiguous external effect.

Vercel Eve is the structural reference for stable step identity and replay of
completed step results. LLM Space deliberately does not copy Eve's automatic
rerun of interrupted steps: current provider, MCP, authored-tool, and
`ExecutionEnv` adapters do not prove that an interrupted effect is idempotent.

## Decision

### Pi keeps the loop; the Session Store keeps durable authority

Pi `Agent` continues to own provider streaming, ReAct turns, parallel tool
batches, abort settlement, and prompt-free continuation. Runtime wraps Pi's
`streamFn` and executable-tool seams; it does not adopt Pi `AgentHarness`, copy
the agent loop, or introduce a workflow DSL.

The existing Host-provided Session Store remains the only durable Runtime
authority. Its schema advances without an implicit migration. Unsupported old
Sessions stay untouched and fail with `unsupportedSessionSchema`; Runtime never
drops, resets, or silently rebuilds them.

### Stable identity is hierarchical and Runtime-owned

One Runtime Run contains monotonically numbered Steps. A Step contains one
provider operation and the tool operations requested by that provider result:

```text
Runtime Run
└─ Step: <run id>:step:<sequence>
   ├─ provider: <step id>:provider
   └─ tool: <step id>:tool:<Pi tool-call id>
```

Each operation records its kind, request fingerprint, Session Store-controlled
attempt, idempotency mode, and one of `preCall`, `completed`, `failed`,
`cancelled`, `parked`, or `outcomeUnknown`. Reusing an operation identity with a
different request fingerprint fails closed before dispatch. V1 idempotency mode
is `none`; authored source gains no `idempotencyKey` declaration. Existing
`session + turn + callId` context remains sufficient for a tool author to derive
an application idempotency key. A future trusted Host adapter may add verified
idempotency evidence, but metadata alone must never authorize retry.

### Intent precedes dispatch and completion precedes Pi continuation

Runtime atomically persists `preCall` before invoking a provider or executable
tool. Each Step also records the Pi transcript message count immediately before
its provider dispatch. A provider terminal message and its bounded replay
envelope are persisted before the terminal stream event is released to Pi.

Tool calls in one Pi response share one Session-state transaction. Their
completed/failed operation records are therefore held only in process until the
whole batch settles, then committed atomically with the validated Session-state
replacement before Pi may start the next provider request. A process loss before
that commit leaves `preCall`, which is intentionally ambiguous. A failed or
deferred tool batch still discards authored state exactly as before.

The Host persists the public Pi transcript before Runtime checkpoints that
Step. On recovery, Desktop and Server give Pi only the durable prefix recorded
by the active Step, then let the operation ledger replay the proven result.
Recovery never scans for an equal assistant message or guesses a boundary from
content, so repeated identical historical messages cannot be truncated.

A completed replay envelope contains only the normalized JSON material needed
to reconstruct the Pi provider message or tool outcome. It excludes secrets,
headers, credentials, callbacks, signals, raw response objects, and unrestricted
transport payloads. The limits are 1 MiB per operation and 4 MiB per active
Step. Replay material is removed once the Step reaches a durable checkpoint;
operation identity, state, request/result fingerprint, size, and timestamps
remain. Oversize or non-serializable material after possible dispatch becomes
`outcomeUnknown`, never a truncation or retryable failure.

### Recovery replays proof, never intent

Recovery follows one fixed crash matrix:

- before durable `preCall`, dispatch cannot have occurred and recovery may
  restart from the preceding checkpoint;
- durable `preCall` without a durable terminal becomes `outcomeUnknown`;
- durable `completed` or `failed` with an exact fingerprint replays its envelope
  without invoking the adapter;
- durable `parked` remains waiting and only a Host-authenticated CAS resume may
  release the same operation;
- a completion-store failure, serialization failure, size failure, or request
  fingerprint mismatch fails closed;
- an operation with an unknown child elevates the authoritative Runtime Run to
  `outcomeUnknown` and Pi never receives a partial tool-result batch.

Known tool failures retain Pi's existing behavior: Pi receives `isError: true`,
and ReAct may let the model choose another call. Runtime does not itself retry.
Known in-process provider retry behavior is unchanged. Only restart-time
ambiguity is categorically non-retryable.

### Cancellation is evidence-based

Cancellation before dispatch, or an adapter-proven not-started operation, is
`cancelled`. Once dispatch may have happened, a local abort signal is not proof
of the external outcome and recovery records `outcomeUnknown`. A known durable
completion wins over a later local abort.

### Parking is generic but approval remains separate

V1 includes an internal park record with stable `parkId`, reason, resume-schema
fingerprint, and parked Session version. The Host must authenticate the caller
outside Runtime and resume through expected-version CAS. Runtime creates no new
public secret token. Roadmap item 19 later supplies approval policies and UI.

### Desktop preserves explicit user control

Desktop reuses the existing `Outcome unknown` tool card, duplicate-side-effect
warning, and Run History terminal label. It adds no global Retry action or
operation inspector. An explicit retry starts a new Run branch in the same
Thread from the user-selected tool location; it never mutates the terminal Run,
clears messages, or implicitly creates a Thread. Canonical operation tracing is
reserved for roadmap item 32.

For workspace Threads and Agent Project Direct/Sandbox execution, the existing
Thread file remains the single authority for both transcript and Runtime
Session. Bun serializes field-level read/modify/write commits through that file
and publishes the newest Session snapshot back to the renderer for normal
settlement; it does not create a parallel transcript or Session database.
Imported Trace workbenches remain on their existing trace-owned persistence
path and are not a durable-execution surface in item 18; integrating operation
durability with canonical Trace remains roadmap item 32.

## Considered options

- Automatically rerunning interrupted Eve-style steps was rejected because
  current adapters provide no general idempotency proof.
- Treating a local abort as cancellation was rejected because remote work may
  already have completed.
- Exposing an authored `idempotencyKey` flag was rejected because a declaration
  cannot prove external effect safety.
- Persisting raw streams or unlimited provider/tool payloads was rejected for
  privacy, secret-retention, and bounded-storage reasons.
- Adding a generic operation dashboard was rejected because existing Desktop
  terminal and explicit retry surfaces are sufficient for V1; trace inspection
  is a separate capability.

## Consequences

Durably completed bounded provider/tool results can be reused after process
loss, while every ambiguous effect stops honestly and is never automatically
repeated. The policy may conservatively classify a crash after `preCall` but
before actual dispatch as unknown. That false positive is accepted in exchange
for never presenting at-least-once external work as exactly once.

V1 does not provide distributed leases, heartbeats, compensation, workflow
graphs, generic retries, approval policy, an exactly-once guarantee, or semantic
parity with Eve. Later capabilities can build approvals, OAuth resume,
schedules, Subagents, and canonical Trace on the same park and operation
identity without weakening this default.
