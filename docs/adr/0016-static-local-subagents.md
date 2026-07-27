# ADR 0016: Static local Subagents

## Status

Accepted and implemented for V1.

## Decision

An Agent Project may declare direct children under
`agent/subagents/<id>/`. Each child is a complete compiled Agent Project with a
required non-empty `description`. The directory id becomes a bare parent tool
name with the fixed input schema `{ message: string }`; build fails on tool-name
collisions. Nested Subagents, child named outputs, and child connections are
rejected in V1.

Calling the tool creates an independent child Runtime Session, Run, Turn,
transcript, state, capability snapshot, model-call limit, budget, operation
ledger, and approval ledger. Child identity is derived from frozen artifact and
parent Session/Run/tool-call lineage, so a safe wait resumes the same child.
The child sees only the explicit message plus trusted principal, tenant, and
channel context. Parent transcript, attachments, model/reasoning overrides,
connection registry, secret values, and authored state are not copied.

The Host owns persistence and resources. A child without a Sandbox declaration
shares the parent's effective Sandbox. A declared child Sandbox shares only
when its frozen revalidation fingerprint equals the parent's; otherwise it is
isolated. A Direct parent plus a Sandbox child is isolated. An unavailable
required Sandbox fails closed.

Child terminal state is persisted before the parent tool result. Approval and
budget waits remain child-owned. A safe approval wait resumes the same child and
then checkpoints the parent deferred tool step before continuing. An unknown
outcome is never retried automatically.

Desktop renders delegation as a normal tool card and opens a read-only child
inspector without creating, clearing, selecting, or moving a Thread. Run History
shows child count, model calls, tokens, and aggregate provider-reported cost.
Protected Server stores the same lineage inside the authenticated parent Session
envelope and exposes a secret-free terminal projection.

## Consequences

- Parent and child limits remain independent; V1 adds no tree-wide or tool-call
  quota.
- Siblings may run concurrently, including in a shared workspace; there is no
  lock, rollback, or filesystem merge protocol.
- Attachments are not forwarded. A parent may mention an already-visible shared
  Sandbox path in the explicit message.
- Desktop and Server V1 do not yet expose a decision entrypoint for a child token-
  budget wait, an explicit retry action, or complete restart recovery for several
  simultaneously parked siblings. The durable records reserve `retryOf` lineage
  for that later explicit retry flow.
- Parent cancellation propagates during the initial active child dispatch, but
  not yet while resuming a previously parked child. Desktop aggregation excludes
  cancelled and auxiliary provider operations; unmetered-call disclosure,
  duration, and a Server aggregate projection remain deferred.
- V1 excludes handoff, root-copy agents, dynamic or remote Agents, Workflow,
  background children, child connections, arbitrary child output schemas, and
  implicit child Threads.
