# Studio Server Runtime Profile And Trace Handoff

- Status: done
- Outcome: completed
- Roadmap item: 07

## Trigger

The user requested the next bounded roadmap step after item 06 landed on clean
`develop` at `d8a1b0a`. This pass selected the lowest dependency-ready item,
item 07. The existing Loopany loop is paused and its schedule, goal, enabled
state, and task file were not changed.

## Product stage and context

The product can now bind an Agent Project Thread to either Desktop Direct or a
protected embedded Local Server, keep Server execution authority and secrets
outside editable Thread data, and inspect projected Server Runs through the
same Run History surface. Desktop Sandbox remains deliberately unavailable.

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
- `Studio Runtime Profiles And Server Trace Handoff`: confirmed shipped after
  focused fixtures and the current real CEF audit.
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

Shipped user-visible behavior:

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
- Choosing another authority creates a new empty Thread instead of migrating
  or silently reinterpreting an existing draft, history, Session, or credential.

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

Approval status: approved after the completed requirements discussion below.

## `$grill-me` requirements discussion

Code-resolvable facts are settled: the existing Trace target is Run History;
Server is ReAct-only and owns transcript/model configuration; sandbox is not
implemented; direct transport substitution would create a second Runtime Run
identity; raw continuation credentials cannot enter Thread data.

The user approved the complete design tree:

- Runtime Profile is immutable after a Thread's first Run; another profile
  creates a new empty Thread without migrating or reinterpreting history.
- Bun owns a dedicated atomic `0700`/`0600` continuation-credential registry,
  preserves credentials across restart, never exposes them to renderer data,
  and revokes/deletes them with Thread deletion or explicit detach.
- A stable local Desktop principal uses a fresh process-only Bearer key; one
  protected loopback Server per artifact is lazily owned and cleaned up by the
  Desktop Host.
- Local Server persists only non-secret profile/artifact/Server Session/Run
  lineage. Server IDs are authoritative and Desktop creates no second Runtime
  Run or `runtimeSession`.
- Artifact drift makes the old Thread inspect-only after active work settles;
  current source requires a new empty Thread.
- The confirmed header interaction exposes Desktop direct, an explicitly
  unavailable Desktop sandbox, and Local Server; it constrains Server input to
  one text draft, reports lifecycle states without fallback, and hands terminal
  Runs to the existing Run History `RunTraceView` at normal and narrow sizes.

ADR 0003 records these authority, security, persistence, lineage, drift, and
interaction decisions. The user then explicitly confirmed shared understanding
and authorized implementation of item 07.

## Work performed

- Added migration-safe Thread Runtime Profile and non-secret Server lineage
  schemas. Run History validates the authoritative duplicated Server Run ID,
  while top-level profile authority survives normal Run metadata updates.
- Added a Bun-only private continuation-credential registry with atomic writes
  and `0700`/`0600` permissions, plus one process-scoped embedded Local Server
  manager per artifact with stable Desktop principal identity, restart Session
  reuse, abort settlement, credential detach/revoke, stale-artifact detection,
  reconnect status, and `DesktopHost` cleanup.
- Added a private Server-owned offline revocation command so deletion after a
  full Desktop restart and artifact drift can exclusively open the old
  repository, authorize the exact stable principal/token, revoke, close, and
  only then delete Desktop's credential without loading obsolete Agent code.
- Routed Local Server Agent Project Runs through the existing typed Desktop RPC
  message stream and the browser-safe Server client. Version-pinned Pi events
  remain the execution protocol; renderer data receives only lifecycle status
  and non-secret lineage. Server Session/Run IDs remain authoritative and no
  Desktop Runtime Session is created.
- Added Runtime Profile interaction for Desktop Direct, unavailable Desktop
  Sandbox, and Local Server; locked Server-owned configuration/history; limited
  input to one trailing pure-text draft; required a new empty Thread for profile
  or artifact changes; and handed terminal Server Runs into existing Run History
  and `RunTraceView` lineage inspection.
- Added safe profile-aware Thread creation/duplication and tests for parity,
  credentials, restart/reconnect, abort, lineage, authority, schema
  normalization, and immutable profile behavior.
- The rendered audit found one stale-state regression: `Add message` remained
  available after artifact drift. The fix locks stale transcript editing while
  preserving profile selection, latest-artifact Thread creation, and Run
  History inspection.

## Verification and product-design audit results

- Focused item-07 fixtures: 60 passed, 0 failed, 213 assertions across eight
  files, including direct-vs-Server outcome parity, restart Session reuse,
  abort settlement, private credential persistence, transport-owned lineage,
  manager reconnect callbacks, Thread authority, and schema normalization.
- Full repository: 204 passed, 0 failed, 778 assertions across 43 files.
- TypeScript: Runtime, Core, CLI, Server, example Agent, and Desktop all pass
  `tsc --noEmit`.
- Repository lint and `git diff --check` pass.
- Browser Runtime client bundles at 12.69 KB; Bun Server bundles at 6.39 MB.
- Renderer-only Vite passes with the existing large-chunk warning.
- Real Electrobun CEF audit at 1280×800 and 900×700 passes profile entry and
  explanation, disabled Sandbox/no fallback, one pure-text draft, stale recovery,
  Run History, Server lineage, keyboard menu/focus restoration, and document
  overflow checks. A three-second console observation contains only Vite and
  React development messages. Evidence is in
  `audits/2026-07-17-060917-studio-server-runtime-profile/`.
- No live paid provider call was made in the UI audit; deterministic Runtime and
  real loopback HTTP/SSE fixtures establish outcome/lineage parity. No Electrobun
  packaging, signing, notarization, or release command ran.
- A deliberately concurrent focused/full test invocation once exhausted the
  Server abort fixture's teardown timeout; the required standalone full suite
  immediately passed all 204 tests, so no product failure remains.

## Review

Self-review rejected a transport-only profile toggle and verified the final
implementation against ADRs 0002/0003: Server identity remains authoritative,
credentials never cross renderer RPC, the Server-owned transcript cannot be
reinterpreted as Desktop history, and unavailable Sandbox never falls back.
Rendered review found and fixed stale transcript editing. Initial two-axis
review also found and fixed renderer Session-ID injection, incomplete
restart-plus-drift credential revocation, per-event status rerenders, direct RPC
user actions, copy/naming violations, and lifecycle cleanup order. Final
Standards and Spec re-review found zero remaining findings.
The remaining risks are explicit deferrals: credentials use OS file permissions
rather than Keychain encryption; trusted tools retain OS-user authority; live
provider reliability is not claimed; canonical cross-host Trace and actual
sandboxing remain later roadmap items.

## Follow-up product bets

1. Item 08 OCI packaging after item 07 establishes the Studio/Server handoff.
2. The later sandbox/workspace/attachment capability that makes
   Desktop-sandbox truly available.
3. Item 32 canonical cross-host Trace and instrumentation after this V1 lineage
   handoff proves the required fields.

## Outcome

Completed. Studio exposes Desktop Direct, unavailable Desktop Sandbox, and
Local Server with explicit capability differences; the deterministic fixture
produces equivalent user-visible direct/Server outcomes, and Server artifact,
Session, and Run lineage opens in the existing Run History inspector. Item 07
satisfies its `Done when` contract, the capability map and roadmap are updated,
and this pass stops before item 08.
