# Studio Server Runtime Profile And Trace Handoff

- Status: done
- Outcome: blocked pending human decisions
- Roadmap item: 07

## Trigger

The user requested the next bounded roadmap step after item 06 landed on clean
`develop` at `d8a1b0a`. This pass selected the lowest dependency-ready item,
item 07. The existing Loopany loop is paused and its schedule, goal, enabled
state, and task file were not changed.

## Product stage and context

The product can author and run one portable Agent Project directly in Desktop,
persist Runtime Run checkpoints in each editable Thread, inspect those runs in
Run History, and independently serve the compiled Agent through protected
HTTP/SSE. Studio cannot yet choose that Server as an execution location.

## Evidence reviewed

- `AGENTS.md`, `LOOP_TASK.md`, `LOOP_PLAN.md`, `CONTEXT.md`, ADRs 0001/0002,
  the current capability map, recent item-05/item-06 logs, git history/status,
  package exports, Desktop RPC composition, Agent Project manager/Thread pane,
  Thread Runtime Session/store, Run History inspector, Trace workbench, Server
  protocol/client, and sandbox/Trace follow-up roadmap boundaries.
- Fresh Electrobun CEF inspection at 1280×800 with an isolated
  `LLM_SPACE_HOME` and the checked-in example Agent. Current Agent Project Build,
  Project Thread, Run History, and experimental Traces empty states were
  inspected through DOM, screenshots, overflow checks, and console output.
- Product Design saved-context preflight found no saved user context. Current
  repository UI patterns and tokens therefore remain the visual authority.

## External market scan

Access date: 2026-07-17.

- LangSmith Studio connects both deployed graphs and a locally running Agent
  Server, explicitly identifies the local server URL, and hands traced runs
  back into Studio for debugging or local cloning:
  https://docs.langchain.com/langsmith/quick-start-studio and
  https://docs.langchain.com/langsmith/observability-studio
- LangGraph distinguishes lightweight direct local development from a heavier
  production-like local Server and documents the capability/storage differences:
  https://docs.langchain.com/langsmith/local-dev-testing
- AI SDK DevTools treats a run as a multi-step interaction, groups steps under
  one run, stores captured data locally, and warns that prompts/tool/provider
  payloads are sensitive plaintext:
  https://ai-sdk.dev/docs/ai-sdk-core/devtools

Table stakes are an explicit execution target, visible capability differences,
local Server readiness/error states, one run lineage, and an immediate path from
execution to inspection. The true LLM Space gap is not a fleet console or a new
trace UI: it is preserving one understandable Thread/Run identity while Server
Session authority and credentials remain outside editable Thread data.

Uncertainty: LangSmith is graph/cloud-oriented and AI SDK DevTools intentionally
captures raw provider data that ADR 0002 forbids here. Their interaction jobs
are useful evidence; their storage/security models are not implementation
targets.

## Capability-map freshness

- `Independent Agent Serving`: confirmed from item 06.
- `Run And Streaming`: confirmed for Desktop direct execution.
- `Debug Timeline`: confirmed for the existing `RunTraceView` inspector.
- `Studio Runtime Profiles And Server Trace Handoff`: confirmed missing and
  blocked on new decisions; added in this pass.
- The experimental Langfuse Trace sidebar is confirmed to be a different
  capability and is not used as a substitute for item 32 canonical Trace.

## Product north-star metric

- Name: equivalent fixture outcome with explicit cross-host lineage.
- Why it matters: users must know that the Agent they debugged directly is the
  Agent the Local Server executed, and must reach the same evidence without
  guessing which process or transcript was authoritative.
- Baseline: zero Runtime Profile controls and zero Studio-initiated Server runs.
- V1 target: one deterministic Agent fixture produces the same user-visible
  final output in Desktop-direct and Local-Server profiles; the Server result
  records artifact fingerprint plus authorized Server Session/Run IDs and opens
  in the existing Run History inspector.
- Measurement: focused parity/lineage/restart/error fixtures, real loopback
  HTTP/SSE, normal/narrow CEF workflow audit, keyboard/focus/overflow/console
  checks, relevant TypeScript/lint/tests, non-packaging bundles/Vite, and
  Standards/Spec review.
- Guardrails: no secret in Thread/source/run/trace/analytics data, no dual
  Runtime Run authority, no silent sandbox fallback, no caller history/config
  override, no remote fleet UI, no item-32 canonical Trace, no packaging or
  release command, and preserved Desktop-direct behavior.

## Candidate product opportunities

1. Main recommendation: bind one immutable Runtime Profile to an Agent Project
   Thread before its first run, embed a protected loopback Server for
   Local-Server Threads, persist secrets separately from Thread data, and map
   Server lineage into normal Run History inspection.
2. Alternative: connect Studio to a user-managed `llm-space serve` URL/token.
   Deferred because it introduces remote endpoint/credential management and
   fleet-like error/security states outside item 07.
3. Alternative: expose profile descriptions only and keep all runs Desktop
   direct. Rejected because it cannot meet the Local-Server outcome/lineage
   metric.

## Main recommendation

Use a Thread-scoped execution authority rather than a per-click transport
toggle. Desktop-direct remains the default. Local-Server creates a protected
Server Session for that Thread and thereafter treats Server context as
authoritative while projecting safe Pi events into the existing editable
workbench and `RunSnapshot` inspector. Desktop-sandbox is visible but explicitly
unavailable until its later sandbox capability ships; it never falls back to
Desktop direct.

This direction preserves the current product vocabulary and avoids turning the
experimental Langfuse sidebar into a premature canonical Runtime Trace.

## V1 capability definition

Proposed user-visible behavior, pending approval:

- An Agent Project Thread header exposes a Runtime Profile control with
  `Desktop direct`, `Desktop sandbox`, and `Local Server` plus concise capability
  differences.
- Desktop direct retains today’s editable transcript, manual/auto-once/ReAct
  controls, Desktop model configuration, and Runtime Run behavior.
- Desktop sandbox is visible as unavailable with the reason and no fallback.
- Local Server uses the frozen Agent source, Server Host model credentials,
  ReAct execution, reconnect/abort/terminal semantics, and a Server-owned
  transcript. It exposes readiness, preparing, running, reconnecting, terminal,
  stale-artifact, and unavailable states.
- A completed Server run is selected automatically in the existing Run History
  inspector and shows non-secret artifact/Session/Run lineage.
- Changing authority after the first run creates a new Thread instead of
  migrating or silently reinterpreting existing history.

Explicit non-goals: remote endpoints, token-entry UI, cloud/fleet management,
actual sandbox execution, raw trace/event viewer, canonical instrumentation,
cross-profile transcript migration, multi-project Server deployment, or
provider/tool exactly-once claims.

## Acceptance and audit plan

- Deterministic direct-vs-Server fixture comparison for final messages, tool
  result, terminal outcome, artifact fingerprint, and Server lineage.
- Focused tests for profile gating, secret exclusion, restart/reconnect, abort,
  stale artifact, missing Host model credentials, Server unavailable, and no
  sandbox fallback.
- Fresh Electrobun CEF product-design audit at 1280×800 and 900×700 covering
  entry, profile explanation, Local Server ready/run/reconnect/error/trace, the
  unavailable sandbox explanation, keyboard/focus, overflow, and console.
- Repository tests, six TypeScript projects, lint, browser/Bun bundles,
  renderer-only Vite, diff check, and two-axis review. Electrobun packaging,
  signing, notarization, and release commands remain prohibited.

## Implementation plan and approval status

1. Resolve the `$grill-me` decisions below and record an ADR because they add
   security, persistence, and data-ownership semantics.
2. Add the minimal Thread Runtime Profile and non-secret Server lineage schema,
   with migration-safe defaults to Desktop direct.
3. Add Desktop Bun composition for protected per-artifact loopback Server
   lifecycle and separate secret custody; expose only typed profile/run RPC.
4. Adapt authorized Server Pi events into the existing Thread reducer and
   normal Run History inspector without creating a second ReAct loop or
   canonical Trace format.
5. Add the confirmed interaction, errors, parity diagnostics, tests, CEF audit,
   review, capability evidence, commit, and push.

Approval status: blocked. No product code was changed.

## `$grill-me` requirements discussion

Code-resolvable facts are settled: the existing Trace target is Run History;
Server is ReAct-only and owns transcript/model configuration; sandbox is not
implemented; direct transport substitution would create a second Runtime Run
identity; raw continuation credentials cannot enter Thread data.

Decision 1 is pending: whether Runtime Profile authority is immutable per
Thread after its first run, with a profile change creating a new Thread rather
than migrating history. Subsequent decisions depend on this answer: secret
registry/restart behavior, local Server lifecycle scope, lineage schema,
artifact drift, and detailed profile interaction.

## Work performed

Discovery, market scan, current CEF inspection, capability-map refresh, blocker
analysis, north-star definition, recommendation, alternatives, interaction
proposal, acceptance plan, and first grill question. No product implementation.

## Verification and product-design audit results

Discovery-only CEF checks found the current app operational at 1280×800 with no
document horizontal overflow and only Vite/React development console messages.
A completion audit is pending implementation approval. No product-code gate was
applicable because no product code changed.

## Review

Self-review found that treating Local Server as a simple transport dropdown
would violate existing authority boundaries: Desktop and Server would each
claim a Runtime Run, editable Thread history could not seed the Server-owned
transcript, and the raw continuation credential would lack an approved owner.
The pass therefore stopped instead of implementing an unsafe approximation.

## Follow-up product bets

1. Item 08 OCI packaging after item 07 establishes the Studio/Server handoff.
2. The later sandbox/workspace/attachment capability that makes
   Desktop-sandbox truly available.
3. Item 32 canonical cross-host Trace and instrumentation after this V1 lineage
   handoff proves the required fields.

## Outcome

Blocked pending the first human design-tree decision. Item 07 remains unchecked.
The next pass must resume this same grill and must not start item 08.
