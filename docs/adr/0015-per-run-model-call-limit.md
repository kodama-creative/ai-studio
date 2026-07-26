---
status: accepted
---

# Fail Runtime Runs at a source-owned model-call boundary

## Context

Agent Projects can execute multi-turn ReAct Runs. Session token budgets bound
reported provider usage, but an unmetered or low-token loop can still issue an
unbounded number of main-model requests. Runtime already owns durable provider
operation identities, replay, Run configuration snapshots, and terminal state,
so the safety boundary can be enforced without a second agent loop or a
renderer-owned counter.

Roadmap Item 22 also names tool, cost, duration, concurrency, schedule, Host,
and parent-child policy. Those axes do not share one deterministic V1 boundary.
In particular, tool retries and approvals already belong to Pi and the Runtime
Harness, schedules belong to Item 28, and child aggregation depends on Item 27.

## Decision

### Agent source owns one per-Run limit

`defineAgent({ limits })` accepts `maxModelCallsPerRun`. A positive safe integer
sets the maximum number of main-model calls in one Runtime Run. Explicit
`false` is unlimited. Omission materializes `25` during normalization, including
when the Agent declares no other limits.

The normalized value is frozen into the compiled Agent snapshot, artifact
fingerprint, and immutable Runtime Run configuration. An active or historical
Run therefore keeps source A after a source rebuild to B; only a later explicit
Run uses B. Desktop and Server Hosts expose the value but cannot edit, loosen,
reset, or grant it in V1.

Zero, negative, fractional, unsafe-integer, unknown, and otherwise invalid
values fail Agent compilation.

### A call is consumed at its durable main-provider claim

The initial main-model request is call 1. Runtime checks the frozen limit while
claiming a new durable provider operation and before physical provider
dispatch. The operation ledger is the counting authority:

- unique main-provider operations count once;
- completed, failed, and `outcomeUnknown` operations count;
- a cancelled operation known not to have run does not count;
- replay of an existing operation does not count again;
- auxiliary compaction provider operations carry a provider slot and do not
  count.

Tool calls do not have a V1 quota. Their failure, retry, approval, parallel
batch, and durability behavior is unchanged.

### The first forbidden call terminally fails the same Run

When a new claim would be call `limit + 1`, Runtime atomically transitions the
current Run to `failed` before dispatch and stores this attributable failure:

```text
runLimitExceeded / modelCalls / limit / consumed / attempted
```

Runtime Session schema V6 validates the failure against the Run's frozen
configuration and durable main-provider operation count. Journal
reconstruction retains the same reason. The Runtime error, Server terminal,
Desktop RPC stream, Thread Run History, and trace inspector project this
durable authority rather than deriving it from a UI counter.

The failure is not a budget wait. There is no Continue, grant, reset, hidden
retry, automatic Thread, or automatic Session. Approval resume, process
recovery, and durable replay retain the original Run and count. A normal
explicit user Run action creates a new Runtime Run with a fresh count from the
user-selected current or restored execution point.

### Desktop presents read-only status

For a numeric limit, an Agent Project Thread header shows
`Model calls n/limit`. Explicit `false` hides the status. Reaching the boundary
uses error styling, a `Run limit reached` toast, and a persisted
`Model limit reached · n/limit` Run History and inspector reason. No editor,
popover, dialog, setting, reset action, or shortcut is added.

## Considered options

- A tool-call quota was deferred because tool execution is not the same policy
  seam as a main-provider dispatch and would complicate established retry,
  approval, and batch behavior.
- A renewable allowance was rejected because a per-Run runaway fuse should
  terminate attribution clearly; Session token budgets already own explicit
  fresh-window continuation.
- Counting Pi turns was rejected because provider operation identity gives a
  stronger physical-dispatch and replay guarantee.
- Counting compaction was rejected because auxiliary context maintenance is
  not an authored main-agent request in V1.
- Renderer counters and Host environment configuration were rejected because
  neither is durable Run authority.

## Consequences

Every compiled Agent is bounded to 25 main-model calls per Run unless its
source explicitly chooses another positive safe integer or `false`. The first
forbidden physical provider dispatch remains zero, including durable replay
and restart paths, while completed model and tool effects remain inspectable.

V1 does not claim cost, token estimation, tool, duration, CPU, concurrency,
schedule, provider quota, Host/organization tightening, or parent/subagent
aggregation. Those remain separate roadmap work.
