# Local Server Protocol V1 Security And Persistence Blocker

- Status: done
- Outcome: blocked
- Roadmap item: 06

## Trigger

The user requested the next bounded roadmap pass after item 05 completed. The
pass started on `develop` at `2b52b5f`, synchronized with `origin/develop`, with
a clean worktree. Item 06 is the lowest-numbered dependency-ready item.

## Product stage and context

Items 01-05 provide one Pi `Agent` execution owner, a Host-neutral Runtime
Harness and Session Store contract, safe recovery/replay, and an immutable
inspectable compiled Agent artifact. There is no independent Server package,
Server Session Store adapter, inbound identity contract, continuation-token
issuer, or Server-owned persistence root. Desktop remains the only production
Host and its Thread document remains its Session Store.

## Evidence reviewed

- `AGENTS.md`, `LOOP_TASK.md`, `LOOP_PLAN.md`, `CONTEXT.md`, ADR 0001, current
  git state/history, package scripts/exports, Runtime README, and item-03
  through item-05 kaizen logs.
- Current capability map, compiled artifact descriptor, Runtime Harness
  Session Store/recovery/replay contracts, and the legacy core streaming
  implementation.
- The originating Agent Studio gap-roadmap record, including its Local Server
  acceptance language: protected HTTP/SSE, production identity, distinct
  continuation-token authority, rotation/revocation, restart, isolation,
  reconnect, and no Desktop dependency.
- Current Loopany state and recent outcomes. `Agent Studio Roadmap` remains
  paused; this pass does not change its schedule, goal, enabled state, or task
  file.

## External market scan

Access date: 2026-07-16.

Primary sources:

- https://www.rfc-editor.org/rfc/rfc6750
- https://html.spec.whatwg.org/multipage/server-sent-events.html
- https://bun.com/docs/runtime/http/server
- https://eve.dev/docs/guides/auth-and-route-protection.md

RFC 6750 places bearer credentials in the Authorization header, requires TLS,
and calls for bounded lifetime, audience restriction, and replay mitigation.
WHATWG SSE defines `text/event-stream`, automatic reconnect, event `id`, and
`Last-Event-ID`; these transport semantics do not decide who may reconnect to
which Session. Bun supplies the HTTP/SSE primitives but no identity, token, or
repository policy. Eve demonstrates a fail-closed ordered authenticator model
and explicitly separates route authentication from session authorization; it
also warns that loopback-only development identity is not a production
authenticator.

Table stakes are therefore fail-closed authentication before model work,
principal/session authorization, TLS or a declared trusted termination
boundary, scoped revocable continuation credentials, durable ordered event
identity, and a repository that can enforce isolation across restart. The true
local gap is not an HTTP handler: it is an approved security and data-ownership
contract for the first independent Host. Uncertainty is material because the
current roadmap intentionally names outcomes but does not select these
policies.

## Capability-map freshness

- `Agent Definition And Runtime`: confirmed on 2026-07-16; the artifact and
  Runtime Harness are ready for another Host.
- `Run And Streaming`: confirmed for Desktop, not for an independent protected
  network Host.
- `Runtime Recovery And Replay`: confirmed at the Host-neutral control-plane
  seam; principal authorization must happen before a Server supplies replay
  scope.
- `Independent Agent Serving`: confirmed missing on 2026-07-16 from source,
  package, protocol, and persistence inspection.
- No rendered UI is involved. Product-design audit and Electrobun CEF are not
  applicable.

## Product north-star metric

- Name: protected streaming completion with lossless authorized reconnect.
- Why it matters: the Build-to-Server spine is not real until one compiled
  Agent can serve isolated callers without exposing another Session or losing
  or duplicating ordered events.
- Baseline: zero independent Server endpoints, authenticated clients,
  continuation credentials, or Server Session repositories.
- V1 target: one authenticated client completes a turn, reconnects from an
  exclusive cursor without loss/duplication, aborts safely, and cannot access a
  different principal's Session; restart preserves the declared durable
  boundary.
- Measurement: unauthorized/forbidden, token rotation/revocation, Session
  isolation, event order/terminal/reconnect, abort, restart, and no-Desktop
  focused fixtures plus all repository gates.
- Guardrails: no credentials in source/artifact/events, no anonymous production
  fallback, no token in URLs, no duplicate Pi loop, no exactly-once claim, no
  vendor channel/cloud/OCI scope, and no packaging/release commands.

## Candidate product opportunities

1. Main recommendation: approve a Local Server security/persistence ADR before
   implementation. It must settle inbound authenticator and principal shape,
   TLS termination, Session authorization, opaque continuation-token
   issuance/binding/rotation/revocation, Server Session Store ownership/root,
   atomicity/restart/retention, and the HTTP/SSE reconnect/abort surface.
2. Alternative: ship a loopback-only anonymous development server. Rejected
   because it does not satisfy protected/authenticated Server V1 or the recorded
   production-identity requirement.
3. Alternative: hard-code one environment bearer secret and use the in-memory
   Session Store. Deferred because it silently chooses credential ownership,
   cannot provide principal isolation or meaningful continuation-token
   rotation/revocation, and loses Server state on restart.

## Main recommendation

Keep the compiled artifact, Pi `AgentSession`, Runtime Harness, Session Store,
and replay cursor as the existing deep boundaries. Add no Server code until a
human-approved ADR defines the network identity and durable repository on the
outside of those seams. After approval, the smallest implementation should be
one Bun Host for one artifact, with fail-closed authentication before runtime
work and exact Session/Run-scoped replay authorization.

## V1 capability definition

After the blocker is resolved, a caller can authenticate, create or continue
one isolated Runtime Session, receive ordered SSE events with one terminal
event, reconnect after an exclusive authorized cursor, and abort the active
Run. The Server owns Runtime Session/Run IDs and its durable repository; the
Channel owns a distinct continuation credential. One deployment loads one
compiled Agent artifact.

Explicit non-goals: vendor channels, OAuth connection flows, hosted identity,
remote agents, schedules, multi-project loading, OCI/container/cloud control
plane, exactly-once effects, canonical Trace, or Studio profile UI.

Stop condition reached: implementing any runnable protected Server now would
choose a new security, permission, persistence, and data-ownership policy not
settled by the roadmap or ADR 0001.

## Acceptance and audit plan

After ADR approval, focused public-protocol tests must cover authentication and
authorization failures, token binding/rotation/revocation, concurrent Session
isolation, ordered single-terminal streaming, reconnect from beginning/middle/
end without duplicates, abort, process restart, malformed payload/cursor
handling, bounded request/event sizes, and no credential persistence. Runtime,
core, CLI, example, and Desktop TypeScript; focused/full tests and lint;
browser-safe runtime bundles; renderer-only Vite; diff review; and a two-axis
Standards/Spec review remain required. UI audit remains not applicable unless
the implementation expands into item 07.

## Implementation plan and approval status

1. Human approves the Local Server security/persistence ADR decisions listed
   in the main recommendation.
2. Add a Server-owned durable Session Store adapter and explicit repository
   root/retention contract without changing Desktop ownership.
3. Add fail-closed inbound authentication and Session authorization, then a
   distinct scoped continuation-token authority.
4. Compose one compiled artifact, runtime sessions, ordered SSE projection,
   replay cursors, abort, and graceful lifecycle in a Bun Server package.
5. Complete the acceptance matrix and shared verification before checking item
   06.

Approval status: item-06 outcome is approved, but implementation is blocked on
new material security, permission, persistence, and data-ownership decisions.

## `$grill-me` requirements discussion

Not invoked. The newly discovered decision branch is itself the mandatory
human-approval stop condition in `LOOP_TASK.md`; using an agent discussion to
select the security/persistence policy would let the executor approve its own
scope expansion. The open questions are recorded explicitly for the owner.

## Work performed

- Reconciled item-05 artifact/recovery evidence with the Local Server contract.
- Inspected current packages and confirmed that no Server/authenticator/token
  authority/durable Server repository implementation already exists to reuse.
- Completed the current primary-source market scan and separated transport
  mechanics from identity, authorization, and persistence policy.
- Recorded the new blocker without editing product code or changing Loopany.

## Verification and product-design audit results

No product implementation was attempted, so focused code tests, packaging, and
UI audit are not applicable. Starting state was clean and synchronized. No
Electrobun packaging, signing, notarization, canary/stable build, pack, release
validation, or release command was run.

## Review

The proposed shortcut—environment bearer equality plus the in-memory reference
Store—was reviewed against the roadmap and external standards. It would fail
the recorded rotation/revocation/restart/isolation expectations and silently
create the exact security/data-ownership decisions this executor is forbidden
to make. No safe implementation slice remains before approval because even the
HTTP route contract determines credential placement and reconnect authority.

## Follow-up product bets

1. Resume item 06 after approving its Local Server security/persistence ADR.
2. Item 07 Studio Server Runtime Profile only after the protected protocol is
   proven.
3. Item 08 OCI deployment only after Server environment/storage boundaries are
   stable.

## Outcome

Blocked. Item 06 remains unchecked. Human approval is required for the inbound
identity/authentication model, TLS termination boundary, Session authorization
rule, continuation-token lifecycle, and Server Session Store ownership,
durability, root, and retention policy. This pass stops before product code and
does not begin item 07.
