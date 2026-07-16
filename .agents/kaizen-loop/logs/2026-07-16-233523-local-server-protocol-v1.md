# Local Server Protocol V1

- Status: done
- Outcome: completed
- Roadmap item: 06

## Trigger

The user requested the next bounded roadmap pass and completed an explicit
requirements grill for item 06. The pass starts on `develop` at `0b6a1db` with
one owned untracked research note and no unrelated worktree changes. The
Loopany schedule, goal, enabled state, and task file remain untouched.

## Product stage and context

Items 01-05 provide a Pi `Agent`-backed Runtime Harness, explicit durable Run
state and CAS Session Store seam, Desktop Thread persistence, safe restart and
replay primitives, and a deterministic inspectable compiled Agent artifact.
The missing Build-to-Server link is an independent protected Host that owns
authenticated Sessions, continuation credentials, durable Server storage, and
lossless HTTP/SSE reconnect without changing Pi's ReAct authority.

## Evidence reviewed

- `AGENTS.md`, `LOOP_TASK.md`, `LOOP_PLAN.md`, `CONTEXT.md`, ADR 0001, repository
  scripts/exports, current source and tests, git state, capability map, and the
  latest item-04/item-05/item-06-blocker kaizen logs.
- The Runtime Harness Session Store/recovery/replay seams, `AgentSession` Pi
  event projection, compiled artifact snapshot, CLI composition, and current
  browser-safe core transport/reducer patterns.
- Installed Pi 0.80.3 `AgentEvent`, `AssistantMessageEvent`, `streamProxy`, and
  first-party Coding Agent JSONL RPC sources.
- The accepted Local Server decisions recorded in ADR 0002.

## External market scan

Access date: 2026-07-16. Primary-source research is captured in
`.agents/kaizen-loop/research/pi-frontend-server-protocol.md`.

- Pi source and package docs establish its in-process `AgentEvent`, compact
  provider `streamProxy`, and JSONL embedding protocol, but no authenticated
  durable Agent Server or React UI SDK.
- Vercel AI SDK UI Message Stream documents SSE message/tool/reasoning parts and
  UI hooks/components, but delegates durable replay/storage and lacks Runtime
  `outcomeUnknown` semantics.
- AG-UI documents Run/message/tool/state events plus `@ag-ui/client` and
  CopilotKit UI, but its caller-owned input/state shape and evolving pre-1.0
  event surface do not match the approved Server authority boundary.

Table stakes are authenticated HTTP, explicit Run lifecycle, streaming
message/tool events, abort, reconnect, and safe frontend consumption. The true
gap is not another agent loop or UI protocol: it is a Server Host that persists
Pi execution events and Runtime terminals under one authorized cursor. UI
projections remain later adapters.

## Capability-map freshness

- `Agent Definition And Runtime`: confirmed from item-05 artifact and Runtime
  fixtures; independent serving remains missing.
- `Runtime Recovery And Replay`: confirmed from item 04; it provides safe
  control-plane recovery but no principal-authenticated Server adapter.
- `Independent Agent Serving`: confirmed missing from source and package
  inspection; this pass implements only its approved V1 boundary.
- No Desktop UI changes are planned, so rendered-product evidence and
  product-design audit are not applicable.

## Product north-star metric

- Name: protected streaming completion with lossless reconnect.
- Why it matters: the portable Agent is not independently deployable until a
  Channel can authenticate, start one durable Run, lose its connection, and
  recover every event and the unique terminal without source repair.
- Baseline: zero independent Server endpoints, authenticated clients,
  continuation credentials, or Server Session repositories.
- V1 target: a deterministic compiled fixture completes through the protected
  Bun Server; a forced mid-stream disconnect resumes from `Last-Event-ID` with
  no skipped/duplicated persisted events and receives exactly one durable
  `runTerminal`.
- Measurement: real local HTTP/SSE integration fixtures, restart/recovery,
  owner/token/idempotency/limits/TLS/CORS matrices, focused and full Bun tests,
  all TypeScript projects, lint, browser bundle, renderer-only Vite, diff check,
  and two-axis review.
- Guardrails: one artifact/project, no vendor Channel, cloud control plane,
  remote Agent, schedule, multi-project loading, provider/tool retry,
  exactly-once claim, sandbox claim, Desktop model settings, UI change,
  packaging, signing, notarization, or release command.

## Candidate product opportunities

1. Main recommendation: implement the accepted protected Local Server and
   browser-safe client over the existing artifact/Runtime/Pi seams.
2. Alternative: expose Pi `streamProxy` directly; rejected because it makes the
   caller own model/context and has no Server tools, durable Session, cursor, or
   Runtime terminal.
3. Alternative: adopt AI SDK UI or AG-UI as the Server authority; deferred as a
   read adapter because neither owns the approved continuation/recovery model.

## Main recommendation

Create a separate `@llm-space/server` Host package and `llm-space serve`
composition. Persist one atomic Server envelope per Session, execute the frozen
artifact through the existing Runtime/Pi layer, publish sanitized Pi events
plus one minimal Server terminal, and prove the full flow through the
framework-neutral client.

## V1 capability definition

One trusted compiled Agent artifact serves many principal-owned isolated
Sessions. A Channel-generated continuation credential and authenticated
principal authorize Run creation, observation, abort, and token lifecycle.
Commands are separate from durable SSE replay. Disconnect never aborts work;
restart either replays a settled Run or records honest `outcomeUnknown`.

Explicit non-goals are the item-06 boundary in ADR 0002: vendor Channels,
attachments/multimodal input, client configuration overrides, public UI hooks,
cloud/OCI control plane, schedules, sandboxing, distributed storage/leases,
external-effect retry/idempotency, exactly-once, Session deletion, dynamic
artifact loading, and multi-project service.

## Acceptance and audit plan

The user approved public-seam TDD at the CLI, real Bun HTTP/SSE API,
browser-safe client, and observable restart behavior. The deterministic matrix
covers auth/ownership, continuation lifecycle, ingress idempotency, isolation,
cursor replay, multiple/slow observers, abort/shutdown, restart recovery,
limits, capacity, CORS/Host/TLS/proxy, Pi serialization, and browser bundling.
No UI changes are planned, so product-design audit and Electrobun CEF are not
applicable.

## Implementation plan and approval status

1. Record ADR 0002 and protocol/client types.
2. TDD vertical HTTP/client slices for health, authenticated Session creation,
   Run creation, Pi streaming, durable replay, and terminal behavior.
3. Add the atomic file repository, recovery, isolation, token/idempotency, abort,
   shutdown, capacity, and limits.
4. Add browser client, CLI/config/TLS/CORS composition, then the complete
   acceptance matrix.
5. Run all non-packaging gates, two-axis review, update product evidence,
   commit, push, and stop before item 07.

Approval status: the user explicitly confirmed every material branch and then
confirmed shared understanding and implementation authorization. No product
code was changed before that gate.

## `$grill-me` requirements discussion

Resolved decisions include trust/TLS, fail-closed identity, exact owner checks,
Channel-generated continuation credentials and expiry, Server repository
ownership/atomicity/retention, routes and SSE durability, input/config
authority, limits, model resolution, trusted execution, abort/restart/shutdown,
capacity, privacy/errors, health/readiness, Pi `AgentEvent` wire use, minimal
Server terminals, browser client/reconnect, ingress idempotency, CORS/Host,
package/CLI/config composition, local-dev credentials, and the acceptance
matrix. ADR 0002 records the result. No ambiguity remains at implementation
start.

## Work performed

Implemented the accepted V1 as three private package surfaces:

- `@llm-space/server` owns the fail-closed Bun HTTP/SSE Host, static Bearer
  authentication, exact principal/Session authorization, continuation
  rotation/revocation/expiry, atomic revisioned repository, native process
  lock, restart recovery, Pi execution serialization, capacity, limits,
  CORS/Host/TLS/trusted-terminator checks, abort, and bounded shutdown.
- `@llm-space/runtime/client` owns browser-safe continuation generation,
  idempotent Session/Run commands, strict Pi/control SSE parsing, exact cursor
  replay validation, bounded retry hints, transport reconnect, and immediate
  terminal settlement.
- `llm-space serve` composes one immutable compiled Agent with
  CLI-over-environment-over-default non-secret configuration while reading and
  scrubbing Host credentials before authored modules load.

Review fixes strengthened schema/revision CAS validation, canonical
continuation parsing, exact identity projection, full-transcript Run
configuration fingerprints, full SSE-frame event limits, atomic recovery
terminal creation, auth/model readiness, safe errors, slow/expired/revoked
observer behavior, clean-EOF reconnect, shutdown settlement ordering, native
repository ownership, strict forwarded HTTPS parsing, and public Host
validation. Private routes now authorize owner/continuation before parsing
cursor or body details, preserving the ADR's uniform hidden `404` behavior.

The research note now explicitly marks its earlier custom-protocol proposal as
superseded: the shipped execution wire is the version-pinned sanitized Pi
`AgentEvent`, with only `runTerminal` and transient `serverShutdown` added.

## Verification and product-design audit results

- Focused Server/client/serializer acceptance: 24 passed, 0 failed, 126
  assertions.
- Full repository: 195 passed, 0 failed, 729 assertions across 42 files.
- TypeScript: runtime, core, CLI, Server, example Agent, and Desktop all pass
  `tsc --noEmit`.
- Repository `bun run lint:check` and `git diff --check` pass.
- Browser client bundle passes at 12.42 KB; Bun Server bundle passes at 6.39
  MB.
- Renderer-only `bunx vite build` passes with the existing chunk-size warning.
- No Electrobun packaging, signing, notarization, or release command ran.
- Product-design audit and CEF inspection are not applicable because item 06
  adds no Desktop UI or interaction change.

## Review

The two-axis review first found stale-index gaps in startup readiness,
repository ownership/permissions, event serialization, recovery atomicity,
identity/continuation validation, observer lifecycle, configuration identity,
client reconnect, shutdown settlement, and documentation consistency. The
working-tree fixes were reconciled and verified. Final review was run again
against the complete staged snapshot. It additionally found missing unconditional
`Vary: Origin`, heartbeat buffer accounting, and timed-out shutdown lock release;
those were fixed, with a real stop/restart `outcomeUnknown` regression test.
All in-scope findings were resolved.

The remaining explicitly deferred risks match ADR 0002: same-process trusted
tools have OS-user authority, external effects are not exactly-once, storage is
single-process/local rather than distributed, and Channel/UI adapters remain
future capabilities.

## Follow-up product bets

1. Item 07 Studio Local-Server Runtime Profile and shared Trace handoff.
2. Item 08 OCI packaging after the Server storage/config contract is proven.
3. Item 31 Channel SDK and one vendor adapter after context, attachment,
   durability, and approval dependencies land.

## Outcome

Completed. Item 06 satisfies its Done when contract: one compiled Agent serves
many isolated authenticated Sessions with Channel-owned continuation tokens,
Runtime Session/Run IDs, ordered Pi plus terminal events, abort, and authorized
lossless reconnect. The roadmap, capability map, and executor understanding
are updated, and this pass stops before item 07.
