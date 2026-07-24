---
status: accepted
---

# Keep human tool approval outside Pi and bind it to durable operation identity

## Context

Roadmap item 18 gives every provider and executable-tool effect a durable
operation identity, exact request fingerprint, crash-aware park, and one-winner
resume claim. It deliberately does not decide whether a tool is authorized to
run. Desktop manual execution is a debugging mode rather than an authorization
record, and Sandbox chooses where an already-authorized call runs rather than
whether it may run.

Item 19 must let portable Agent source state a minimum approval requirement,
let a Host tighten it, survive process loss without redispatch, and preserve
Pi's existing ReAct and parallel-tool semantics. Approval records must not
expose authenticated principals, Host policy internals, Sandbox authority, or
resume claims to authored code, the model, or the renderer.

## Decision

### Source and Host merge monotonically

`defineTool()` and the canonical read/write/bash helpers accept one optional
`approval` value. The public helpers are `never()`, `once()`, `always()`, and
`deny(reason)`. A policy may also be a synchronous or asynchronous callback
over read-only verified Session, principal, tool, call, and input context.
Omission means source `never`.

The Host supplies an optional internal `AgentHostApprovalPolicy` with a stable,
versioned `id` and the same decision vocabulary. The effective order is:

```text
deny > always > once > never
```

The Host can therefore tighten but never weaken the source minimum. Invalid,
throwing, or inexact callback results fail closed as denial. Desktop V1 uses a
neutral Host policy and has no approval settings page. Protected Server
composition may inject a code-configured Host policy; changing its behavior
requires changing its stable policy id.

Conditional policies are evaluated for every call, including after a matching
`once` grant. A later conditional denial or stronger call-specific requirement
wins over that grant.

### Approval is compiled policy, not Pi-visible tool data

Approval stays on the Runtime-owned prepared tool and outside the Pi tool
definition. Static requirements are included in immutable Turn capability
snapshots and can be reconstructed after restart. A static tool's conditional
callback remains available from the trusted compiled Agent bundle.

Dynamic resolvers may generate tools with a static `never`, `once`, `always`,
or `deny` requirement, which is snapshotted and rehydrated. V1 rejects a
conditional callback on a dynamically generated tool: replaying that callback
after restart would require persisting executable behavior that is not part of
the existing dynamic-step closure contract. Runtime fails explicitly instead
of silently dropping or weakening the policy.

### The approval ledger binds the exact authority

Runtime Session schema V3 adds an approval ledger beside the item-18 operation
ledger. Each request binds:

- Runtime Run, durable Step and operation, Pi tool-call id, exact request
  fingerprint, tool name, and contribution identity;
- Agent artifact fingerprint plus source- and Host-policy fingerprints;
- authenticated current-principal and initiator fingerprints;
- call or Session scope, Source and Host requirements, bounded reason, state,
  and timestamps.

The safe Host/renderer projection omits principal and policy fingerprints.
Decisions contain only the exact request identity and `approved` or `denied`;
the Host derives the Session, Run, actor, authority, and expected version.
Compare-and-swap rejects stale or concurrent writers.

A successful Session-scoped approval records a `once` grant bound to the same
Session, current principal, initiator, Agent, contribution, tool, and both
policy fingerprints. Denial never grants. No decision or grant crosses a
principal, Session, Agent, tool, or changed-policy boundary.

If the Agent fingerprint, Host approval-policy id, Host capability policy, or
principal identity changes while calls remain parked, Runtime atomically marks
the affected batch `stale`, removes any unconsumed grants created by those
requests, and cancels the still-parked operations without dispatch. The old Run
then fails or is superseded through the Host's existing Run boundary. The user
chooses a new execution boundary in the same Thread; Runtime never creates a
Thread, clears history, or mutates the old decision into authority for a new
call.

### One durable batch barrier precedes all tool dispatch

Pi continues to own parallel tool execution and ReAct. Runtime evaluates every
member of one assistant tool-call batch in Pi's `beforeToolCall` seam and parks
approval-required operations before any member receives `preCall`. If one
member needs a decision, executable siblings return deferred until the whole
batch is settled. This favors a complete authorization barrier over early
sibling execution.

Approved members execute only after every request is decided. Denied or
policy-blocked members are atomically cancelled and become explicit bounded
`isError` not-run results for Pi. Known tool failures after actual dispatch
remain ordinary Pi tool results; the model may choose another attempt and
Runtime does not automatically retry.

Manual mode does not bypass approval. `Approve & run` combines human approval
and manual execution intent in one durable action, while an existing `once`
grant still does not make later manual calls automatic. Auto-once and ReAct
resume automatically only while the deciding process still owns the live Run.

### Approval never claims that an effect happened

An approval decision leaves its operation `parked`. A separate Host-authorized
CAS claim changes the operation to `preCall` immediately before dispatch.
Process loss before that claim restores `Approved — ready to resume` and
requires an explicit same-Thread resume; application startup never executes it
in the background. Process loss after the claim follows ADR 0011 and becomes
`outcomeUnknown`, never a fresh approval followed by automatic redispatch.

The approval ledger remains outside the Pi transcript and editable tool-result
text. Old Runtime Session schemas are retained but rejected clearly; V1 does
not migrate, clear, or reset development Threads or Sessions.

### Desktop and Server keep authority on the Host side

Desktop registers request id to authoritative standalone or Agent Project
Thread storage when Bun reads the Thread. Renderer RPC submits only request id
and decision. Inline tool cards show arguments, reason, Source/Host policy,
scope, execution provenance, pending/approved/denied/stale states, and
mode-appropriate actions. Run History shows `Waiting for approval` and Review;
there is no global inbox, Approve All, default keyboard approval, or implicit
Thread creation.

Protected Server exposes an authenticated, owner- and continuation-authorized
decision endpoint. Cross-principal requests remain hidden. SSE emits the safe
pending control event, parks without terminalizing, and resumes the same Run
only after the batch is fully decided.

## Considered options

- Treating Desktop manual execution as approval was rejected because editable
  debugging output is not an authenticated durable authorization decision.
- Letting Sandbox imply approval was rejected because execution location and
  authorization are orthogonal policy domains.
- Passing principal, policy fingerprints, Thread paths, or resume claims from
  the renderer was rejected because Bun already owns those authorities.
- Approving each parallel call and dispatching it immediately was rejected
  because a later sibling could require denial after an effect had started.
- Persisting dynamic conditional callbacks was rejected because the current
  dynamic-tool snapshot contract cannot safely reconstruct arbitrary new
  executable policy behavior.
- Automatic startup resume was rejected because a recorded approval is not a
  new execution intent after process loss.

## Consequences

Source can require review while Desktop and Server Hosts can only tighten it;
the exact decision survives restart and no gated call reaches dispatch without
both effective policy and a durable claim. Users can review and continue the
same Thread and Runtime Run without losing history, while changed authority
expires safely and ambiguous effects retain ADR 0011's honest stop.

V1 has no model self-approval, cross-principal grant cache, organization roles,
four-eyes workflow, external notifications, global approval inbox, policy
administration UI, OPA integration, exactly-once guarantee, compensation, or
automatic retry.
