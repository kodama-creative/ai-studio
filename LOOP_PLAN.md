# Agent Studio Loop TODO

Originating product evidence: [Agent Studio Eve Gap Roadmap](./.agents/kaizen-loop/logs/2026-07-15-215209-agent-studio-eve-gap-roadmap.md)

LLM Space is an Agent Studio: Agent Project source is the portable product, Thread is the fast development/debug/evaluation surface, Pi is the runtime foundation, and Studio Desktop plus Server are two hosts of the same runtime.

Runtime architecture follows [ADR 0001](./docs/adr/0001-runtime-harness-over-pi-agent.md): an LLM Space Runtime Harness wraps official Pi `Agent`; it does not use Pi `AgentHarness` as the session core and does not reimplement Pi's ReAct loop.

## Execution Rules

- [ ] Run every numbered item as its own `$kaizen-loop`; do not combine multiple capabilities into one implementation loop.
- [ ] Re-check current Pi capabilities only when an item depends on a Pi feature or proposes custom runtime behavior; do not repeatedly reopen recorded upstream limitations without new evidence.
- [ ] Inspect the real product, current source, latest capability map, recent logs, and current git status before recommending work.
- [ ] Give each loop one product-level metric, one main recommendation, two alternatives, explicit V1 boundaries, non-goals, and stop conditions.
- [ ] Run `$grill-me` only when an item exposes an unresolved branch in the design tree. Implement approved roadmap and ADR decisions directly; stop for new material architecture, scope, security, authority, persistence, or data-boundary choices.
- [ ] For UI work, confirm the interaction scheme and verify through real Electrobun CEF plus a current product-design audit.
- [ ] Mark a task complete only after implementation, focused tests, relevant TypeScript checks, touched-file lint, applicable repository-wide checks, relevant non-packaging build checks, review, capability-map refresh, and a completed kaizen log. New regressions block completion; precisely evidenced unrelated repository debt does not. Never run Electrobun packaging, DMG, update-patch, signing, notarization, `build:canary`, `build:stable`, `pack*`, or release validation in this worktree.
- [ ] Preserve unrelated worktree changes. Never use this TODO as permission to revert or rewrite concurrent work.

## Primary Build-To-Server Spine

- [x] **01 — Pi Agent-backed Runtime Harness V0**
  - Depends on: current runtime.
  - Run: `$kaizen-loop Make the Pi Agent-backed LLM Space session core authoritative without changing shipped behavior.`
  - Done when: existing manual, auto-once, ReAct, persistence, abort, reload, tool, and event fixtures run through one LLM Space `AgentSession` backed by Pi `Agent`; Pi owns the official loop/tool lifecycle while Thread persistence, settled manual policy, and event projection each have one documented LLM Space owner.
  - Boundary: behavior-preserving runtime convergence only; no new Server, source slot, UI, or workflow-durability claim.
  - Metric: existing runtime behavior coverage through the Pi Agent-backed session core.
  - Decision (2026-07-15): current Pi `AgentHarness` can keep a run busy on an unresolved tool Promise but cannot express LLM Space's settled manual workflow—finish the run, externally resolve/edit exact tool results, then continue without a new user message. Item 01 therefore standardizes on Pi `Agent.continue()` and an LLM Space-owned session adapter instead of waiting for or privately copying Harness lifecycle behavior.

- [x] **02 — Runtime Run state machine and transactional Session Store**
  - Depends on: 01.
  - Run: `$kaizen-loop Give the Runtime Harness explicit durable Run state and one transactional Host-provided Session Store boundary.`
  - Done when: one stable Runtime Run identity spans model turns, tool steps, and durable waits; legal transitions cover `runningModel`, `runningTools`, `waitingForToolResults`, `waitingForContinue`, `completed`, `failed`, `cancelled`, `superseded`, and `outcomeUnknown`; a reference Session Store atomically persists a versioned Session snapshot, immutable Run Configuration Snapshot, and ordered Run journal, and rejects stale or concurrent writers through CAS/single-writer protection.
  - Boundary: contract, state machine, and in-memory/reference persistence only; no Desktop migration, Server, external-effect retry, exactly-once claim, compaction, approval policy, or general workflow engine.
  - Metric: deterministic state-transition and stale-writer rejection coverage across the Runtime Run matrix.

- [x] **03 — Desktop Thread settled-step Runtime Harness integration**
  - Depends on: 02.
  - Run: `$kaizen-loop Move Desktop Thread debugging onto the Runtime Harness and its Session Store contract without losing editable step-by-step behavior.`
  - Done when: standalone and Agent Project Threads adapt to the Session Store as their sole durable authority; manual, auto-once, and ReAct are one Run with different durable wait boundaries; reload resumes the same Run without a synthetic user message; context, tool-call-set, Agent artifact, model, prompt, or tool-configuration edits supersede and branch instead of mutating execution history; Run History groups existing per-boundary checkpoints under the Runtime Run; and Desktop no longer owns a second ReAct or continuation loop.
  - Boundary: current standalone and Agent Project Thread debugging UX only; no standalone-Thread promotion, Server store, approval workflow, arbitrary historical event editing, or background execution.
  - Metric: settled-step parity and one-owner execution coverage through reload, edit/branch, undo, abort, and all three modes.

- [x] **04 — Safe-boundary recovery and ordered Run replay**
  - Depends on: 03.
  - Run: `$kaizen-loop Recover Runtime Runs only from durable safe boundaries and replay their ordered Host-facing events by cursor.`
  - Done when: a fresh process reconstructs an idle Session or resumes the same Run from `waitingForToolResults` or `waitingForContinue`; journal events replay in stable order from authorized cursors without duplication; concurrent resume is rejected; terminal outcomes remain terminal; and any operation interrupted after it may have started but before durable completion is recorded becomes `outcomeUnknown` and cannot auto-replay.
  - Boundary: control-plane recovery and replay only; no retry of in-flight provider/tool effects, idempotency protocol, exactly-once claim, distributed lease service, Local Server endpoint, or canonical observability Trace.
  - Metric: safe recovery/replay correctness across restart, cursor, duplicate-resume, and injected-interruption fixtures.

- [x] **05 — Inspectable compiled Agent artifact V1**
  - Depends on: 04.
  - Run: `$kaizen-loop Build an immutable, inspectable, deterministic Agent Project artifact.`
  - Done when: canonical projects build into artifacts containing source, dependency, capability, schema, runtime, and environment-requirement fingerprints.
  - Boundary: no credentials, Sessions, Thread history, Eval results, Server, container, or cloud deployment.
  - Metric: deterministic build completion without manual source repair.

- [x] **06 — Local Server protocol V1**
  - Depends on: 05.
  - Run: `$kaizen-loop Run one compiled Agent artifact as an independent protected Bun HTTP/SSE Server.`
  - Done when: one artifact serves many isolated Sessions with authenticated requests, Channel-owned continuation tokens, Runtime-owned session/run IDs, ordered terminal events, abort, and authorized reconnect cursors.
  - Boundary: one Agent Project per deployment; no vendor channels, cloud control plane, remote agents, schedules, or multi-project loading.
  - Metric: protected streaming completion with lossless reconnect.

- [x] **07 — Studio Server Runtime Profile and Trace handoff**
  - Depends on: 06.
  - Run: `$kaizen-loop Let Studio run and debug the same Agent through a Local Server Runtime Profile.`
  - Done when: Studio exposes Desktop-direct, Desktop-sandbox, and Local-Server profiles, explains capability differences, and opens Server runs in the same Trace inspector.
  - Boundary: no remote fleet or cloud deployment management UI.
  - Metric: equivalent fixture outcome and trace lineage across Desktop and Local Server profiles.
  - Decision (2026-07-21 development revision): Runtime Profile is selectable in the current Project Thread at settled checkpoints. Switching never clears messages, Run History, or Desktop Runtime Session state and never creates a Thread implicitly; historical Runs retain their effective profile, while a new execution uses the current profile and branches any incompatible wait. Local Server credentials remain Bun-private, Server lineage stays non-secret, and required Sandbox still cannot downgrade to Direct.

- [x] **08 — OCI deployment V1**
  - Depends on: 06.
  - Run: `$kaizen-loop Package a compiled Agent as a platform-neutral OCI image running the Bun Server.`
  - Done when: a clean container starts from artifact plus declared environment, reports health/readiness, persists through a mounted storage contract, and shuts down cleanly.
  - Boundary: no Vercel, Cloudflare, Kubernetes operator, autoscaling, managed secrets, or hosted control plane.
  - Metric: clean-environment deployment completion.
  - Decision (2026-07-17): ADR 0004 makes each project-specific image the deployment unit, preserves separate Agent-fingerprint and image-digest identity, compiles an engine-neutral two-stage build context, declares source-owned environment names without values, fixes a trusted-terminator/non-root/single-volume lifecycle, and requires running `linux/amd64` plus `linux/arm64` verification.

## Studio Authoring And Project Lifecycle

- [x] **09 — Canonical template and capability presets**
  - Depends on: 05.
  - Run: `$kaizen-loop Create one canonical Agent template with composable presets for shipped capabilities.`
  - Done when: Studio and CLI share one atomic scaffolder; every supported preset combination builds without manual edits and is covered by a focused repository-owned conformance case.
  - Boundary: no marketplace, duplicated full templates, or templates for unshipped capabilities.
  - Metric: generated-project build success rate.
  - Decision (2026-07-17): ADR 0005 keeps portable source user-owned, requires an absent target with validated sibling staging and whole-root publication, composes the canonical base from `local-tool`, `skill`, and `mcp-connection`, defaults to local tool plus skill, and keeps exhaustive conformance repository-owned until a portable Eval protocol ships.

- [ ] **10 — Build Thread as Agent Project**
  - Depends on: 09, 12, 13, 16, and 17.
  - Run: `$kaizen-loop Turn a runnable standalone Thread into a buildable Agent Project.`
  - Done when: promotion previews and atomically materializes portable model, reasoning, prompt, variable declarations/providers, tools, and human-readable evaluation intent into source plus a fresh initial Project Thread.
  - Boundary: one-way conversion; original Thread remains independent; no conversation-example format before item 29, hidden metadata, live sync, inherited Session state, secret-store copy, Host fallback, or silent tool substitution.
  - Metric: Thread-to-buildable-Agent completion without manual source repair.
  - Decision (2026-07-17): ADR 0006 defines preview-first atomic promotion, separate Agent Variable and Session State source domains, exact or explicitly reviewed tool materialization, Sandbox-only local authority, environment aggregation, non-executable evaluation intent, no conversation examples before item 29, and a fresh independent Project Thread. Items 12, 13, 16, and 17 are now shipped, so promotion is no longer dependency-blocked and should be prioritized only against the core Build, Subagent, and Eval gaps.

- [ ] **11 — Explicit source and artifact migrations**
  - Depends on: 05 and a real schema evolution.
  - Run: `$kaizen-loop Add explicit, previewable, reversible Agent source and artifact migrations.`
  - Done when: old fixtures either migrate atomically without data loss or receive a precise unsupported-version diagnosis; Build remains read-only.
  - Boundary: no silent migration, broad compatibility shims, or automatic dependency major upgrades.
  - Metric: safe migration completion across the maintained fixture corpus.

- [x] **12 — Trusted Session context and structured state**
  - Depends on: 06.
  - Run: `$kaizen-loop Add verified Session identity context and durable typed Session state.`
  - Done when: initiator, current principal, optional tenant, and channel context are verified; Turn context, Session state, message history, and external long-term memory remain distinct.
  - Boundary: no bundled vector database, automatic memory extraction, hosted tenant database, or organization-policy UI.
  - Metric: isolated structured-state recovery after Server restart.

- [x] **13 — Composable static and dynamic instructions**
  - Depends on: 12.
  - Run: `$kaizen-loop Support composable build-time and trusted per-Turn Agent instructions.`
  - Done when: root instructions and ordered directory entries compile deterministically; dynamic instructions resolve from trusted Session context and are snapshotted per Turn through Pi.
  - Boundary: instructions cannot execute tools, load arbitrary runtime code, or expand authority.
  - Metric: deterministic, explainable instruction snapshots.

- [x] **14 — Dynamic capability snapshots**
  - Depends on: 12 and 13.
  - Run: `$kaizen-loop Resolve model, tools, connections, and stream options dynamically at each Turn inside static policy bounds.`
  - Done when: every Turn records an immutable effective-capability snapshot constrained by authored maximums and Host policy.
  - Boundary: no dynamic code discovery, runtime plugin install, arbitrary path loading, or permission escalation.
  - Metric: capability-snapshot policy fidelity.
  - Completed evidence (2026-07-18): ADR 0007 fixes the Eve-shaped Turn-only contract; compiler, closed-bundle, Runtime, Session Store, Desktop, and Server fixtures prove policy-bounded immutable snapshots, dynamic-tool restart rehydration without resolver replay, manual no-state behavior, static connection provenance, and explicit Host-policy-change termination.

- [x] **15 — Named structured output contracts**
  - Depends on: 05 and 06.
  - Run: `$kaizen-loop Wire source-declared named structured outputs through Pi, providers, Thread, and Server.`
  - Done when: Thread or Channel selects a declared contract, Runtime maps it to supported provider behavior, validates the final result, and emits a typed terminal state.
  - Boundary: no arbitrary caller-supplied schemas or unlimited automatic repair loop.
  - Metric: schema-valid completion rate on supported providers.
  - Completed evidence (2026-07-18): ADR 0008 and compiler/bundle fixtures establish source-declared named TypeBox contracts; Runtime fixtures prove exclusive Eve-shaped `final_output` execution through Pi, exact validation, zero retry, manual termination, Host limits, and atomic typed terminals; Desktop Direct, Local Server, protected Server, actual stop/restart replay, and generic client fixtures prove one selected name and identical persisted value. Eighty-four focused checks pass; the full suite passes 298/299 tests and 1166 assertions with only the unchanged Server teardown timeout debt. Real CEF audit confirms Output selection/schema detail, hidden internal mechanics, generic result/failure cards, Run History reuse, clean console output, and overflow-free 1280×800/900×700 layouts.

## Pi Execution, Safety, And Durability

- [x] **16 — ExecutionEnv-backed built-in tools**
  - Depends on: 04.
  - Run: `$kaizen-loop Add authored read, write, and bash helpers that execute only through Pi ExecutionEnv.`
  - Done when: the same tool contracts pass against Node and isolated/fake ExecutionEnv implementations with correct path, symlink, abort, timeout, streaming, and cleanup behavior.
  - Boundary: no direct Desktop/Server host filesystem access, implicit default tools, or policy bypass.
  - Metric: ExecutionEnv portability of built-in tools.
  - Completed evidence (2026-07-19): ADR 0009 restricts ExecutionEnv authority to canonical zero-configuration static read/write/bash helpers. Compiler/artifact/bundle and immutable Turn snapshots retain helper identity without environment data; Runtime binds only a Host-supplied Session environment after effective capability filtering and Desktop/Server fail before Pi with `executionEnvUnavailable` without fallback. One shared Node/fake suite proves paths, symlinks, UTF-8 writes, pagination, abort/cancellation, timeout, streamed updates, truncation/full-output paths, nonzero exits, no retry, and zero Runtime cleanup; 52 focused checks and all non-packaging gates pass, with only the unchanged full-suite Server teardown timeout debt.

- [x] **17 — Sandbox, workspace, and attachment delivery V1**
  - Depends on: 16.
  - Run: `$kaizen-loop Provide a Pi ExecutionEnv sandbox contract, local container reference provider, workspace seeds, and controlled attachments.`
  - Done when: authored environment selection works, required sandbox failure never downgrades silently, `workspace/` seeds an isolated Session, attachments are safely staged, and cleanup/retention is verified.
  - Boundary: no Vercel Sandbox, Firecracker fleet, arbitrary host paths, or source write-back without explicit Studio adoption.
  - Metric: sandbox isolation and delivery acceptance rate.
  - Blocked evidence (2026-07-19): current Runtime can borrow an ExecutionEnv but neither source nor Thread can require/select Sandbox, Agent discovery has no `workspace/` slot, attachments are Desktop-only inline images, and no Host owns Session container retention or cleanup. Real CEF still exposes disabled `Desktop Sandbox — Unavailable`; the development host has no Docker/Podman/Apple-container engine. Implementing V1 must newly decide source-minimum × Host-profile authority, reference engine/image, fixed workspace persistence/reaping, attachment identity/limits/ownership, network/secret exposure, and cleanup failure semantics. The first `$grill-me` owner decision is whether source may require the abstract Sandbox class while Host chooses the provider and may tighten but never weaken that requirement; item 17 remains unchecked.
  - Decision (2026-07-20): ADR 0010 resolves the blocker with an Eve-shaped zero-configuration `agent/sandbox` requirement, Host-owned provider policy that may tighten but never weaken, a minimal Docker CLI reference provider, one named volume mounted at `/workspace` per Runtime Session, one-time bounded source seed, atomic bounded Turn attachments over Pi-native content, fixed no-network/no-secret isolation, honest lost-workspace failure, and tombstoned cleanup. The implementation is interface-first but still requires one real Docker create/seed/stage/tool/reconnect/delete proof before this item may be checked; implementation awaits explicit approval.
  - Implementation evidence (2026-07-20): source/compiler/artifact/bundle support the abstract Sandbox minimum and bounded immutable workspace seed; Desktop and protected Server fail closed without a Host provider; the Docker reference supplies a fixed non-root/read-only/no-network container, one Session-owned named volume, Pi `ExecutionEnv`, atomic Host-approved attachment delivery, crash-aware seed identity, restart/reconstruction, honest loss, and tombstoned cleanup. The collision trigger now uses a bounded immediate watcher while preserving the concurrent atomic path; the complete 42-assertion real-Docker matrix passes 10/10 sequentially on local OrbStack with no residual resources. The Server abort fixture now honors an already-aborted signal, bringing the full local suite to 338/338 non-Docker tests; all TypeScript configurations, lint, unsigned Desktop canary packaging, and the real CEF Direct/Sandbox audit pass. On 2026-07-26 the owner reaffirmed local-first acceptance and the current Docker acceptance passed again; deferred Actions are not a completion blocker.

- [x] **18 — Durable execution V1**
  - Depends on: 04 and 06.
  - Run: `$kaizen-loop Add crash-aware durable execution around the Runtime Harness journal and Pi provider/tool operation boundaries.`
  - Done when: provider/tool operations record idempotency and pre-call/completed/failed/cancelled/parked/outcome-unknown states; injected crash points recover safely or stop honestly.
  - Boundary: no exactly-once guarantee, arbitrary workflow DSL, or claim of full distributed workflow durability.
  - Metric: safe recovery or explicit unknown state across the crash matrix.
  - Shipped evidence (2026-07-23): ADR 0011 and Runtime Session schema v2 add one Run → Step → provider/tool operation ledger with durable `preCall`, `completed`, `failed`, `cancelled`, `parked`, and `outcomeUnknown` states; exact request/result fingerprints; bounded replay envelopes; retained settlement metadata; one-winner park CAS; and an exact pre-provider transcript boundary. Pi still owns ReAct. Workspace Threads and stateless/stateful Agent Project Direct/Sandbox Threads serialize Session/transcript commits through their existing Thread file, while Server restart recovery queues replay proven completions from its repository; neither adapter repeats ambiguous work. Imported Trace workbenches remain item-32 scope. The top-level crash matrix covers fresh-store completion replay, mixed tool batches, thrown and returned-error tool outcomes, completion-write failure, cancellation, park/resume, oversize/non-JSON results, and old-schema rejection. Adapter tests prove Desktop fresh-controller and Server fresh-controller replay without provider redispatch plus boundary recovery without content-equality guessing. Local verification passed Runtime 167 (1 Docker acceptance skip), Server 27, Desktop 107, Core/CLI/examples 64, all TypeScript projects, lint, diff checks, renderer-only Vite, and a fresh real CEF 1280×800 Blank Thread/model-selector/Run-History guardrail. Actions and Electrobun packaging/release were intentionally not run per owner direction.

- [x] **19 — Durable human-in-the-loop approvals**
  - Depends on: 18.
  - Run: `$kaizen-loop Add source-minimum, Host-tightenable approvals with durable park and resume.`
  - Done when: `always`, `once per session`, `never`, and conditional policies merge safely; approvals survive restart and no call executes without the effective decision.
  - Boundary: approval decides whether; sandbox decides where. No model self-approval or cross-principal approval cache.
  - Metric: approval integrity across restart and resume.
  - Shipped evidence (2026-07-24): ADR 0012 adds `defineTool({ approval })`, canonical helper options, `never`/`once`/`always`/`deny`, conditional policy evaluation, and the monotonic Source × Host lattice. Runtime Session schema v3 keeps exact principal/Agent/tool/policy-bound requests and Session grants beside item-18 operation identity; approve remains parked until a separate CAS dispatch claim, denied calls become known not-run Pi errors, changed Agent/Host/principal authority becomes durable `stale`, and a full parallel batch clears policy before any sibling dispatch. Desktop Bun accepts only request ID plus decision and exposes inline pending/approved/denied/stale state, decision-specific same-Thread resume, Run History review, and safe Direct/Sandbox/Local Server provenance. Protected Server adds an authenticated approval endpoint, browser client, SSE wait, code-configured Host policy, same-Run restart resume, and cross-principal hiding. Dynamic tools retain static requirements but reject dynamically generated conditional callbacks that cannot be safely rehydrated. Final local acceptance passed 384 Bun tests including real Docker, all eight TypeScript projects, root lint, renderer Vite, diff checks, and real CEF pending/deny audits at 1280×800 and 900×700 with no page overflow or application console errors. Actions and packaging/release were omitted per owner direction.

- [x] **20 — Runtime Harness compaction and branch UX**
  - Depends on: 04.
  - Run: `$kaizen-loop Add Runtime Harness compaction, summaries, labels, checkpoints, and navigable Session branches without changing the durable authority.`
  - Done when: long Sessions compact Pi's model context while the Session Store retains complete journal/message history, Run lineage, and explicit navigable branches.
  - Boundary: no new summarization engine, destructive history deletion, hidden branch mutation, or adoption of Pi `AgentHarness`/`Session` as the durable authority.
  - Metric: long-session continuation with complete audit history.
  - Shipped evidence (2026-07-25): ADR 0013 and Runtime Session schema V4 add content-addressed immutable messages, parent-linked checkpoints, stable labeled branches, current/working-base identity, and durable summary provenance under the existing Session Store CAS authority. Starting from the current settled tip continues its branch; only executing from an explicitly restored older checkpoint atomically creates a child branch before external work. Pi 0.80.3 public compaction helpers project a durable summary plus recent messages through Pi's existing `Agent`/`convertToLlm` path, while summary calls use the crash-aware provider ledger and ambiguous effects remain `outcomeUnknown` without automatic retry. Desktop keeps the editable Thread as the working copy, exposes Branch → Run → compaction/checkpoint history, Restore/Return to current, rename, keyboard navigation including inspector Escape, a read-only summary inspector with covered/retained entry identities, a main-list compaction boundary, visible `Compacting context…`, and current-tip-only `Compact now` that never calls the main provider or creates a message/checkpoint. Unknown summary outcomes require explicit duplicate-cost confirmation before a new operation is created. Local Server validates the selected working base, rebuilds fork input from the authoritative checkpoint transcript, returns the Runtime Session/checkpoint terminal projection, persists rename through authenticated Server authority, and includes the working base in create/query idempotency; explicit Local Server `Compact now` remains outside V1. V3 bytes are retained and rejected explicitly without migration or reset. Final local acceptance passed Core 41, Runtime 199 (one opt-in Docker acceptance skip), Server 29, and Desktop 117 tests: 386 pass and one skip overall; all eight TypeScript configurations, lint, diff checks, and renderer Vite passed. Crash fixtures include known summary failure, summary-completion persistence uncertainty, compaction-record commit retry with replay-stable synthetic timestamps, and 60 sequential Runtime Turns/checkpoints followed by two historical forks and restart. A real Electrobun CEF audit at 1280×800 and 900×700 found no critical/high issue, application console error, or page overflow and confirmed the message boundary, inspector provenance, Escape navigation, and guarded unknown-summary retry. Narrow whole-workbench density and formal ARIA tree semantics remain V2 follow-ups. Eve alignment and final fixed-point Standards/Spec reviews found no blocker. Actions and packaging/release were intentionally omitted per owner direction.

- [x] **21 — Session Token Budget V1**
  - Depends on: 04 and provider usage.
  - Run: `$kaizen-loop Add source-owned input and output token budgets based only on real provider usage.`
  - Done when: consumption is visible and Runtime pauses before the first forbidden next model call, offering explicit stop or fresh-window decisions.
  - Boundary: no estimated enforcement for missing usage, cost/turn/tool/time limits, compaction, or ordinary Thread budgets.
  - Metric: exact budget-boundary stop correctness.
  - Shipped evidence (2026-07-25): ADR 0014 adds independent source-owned `maxInputTokensPerSession` / `maxOutputTokensPerSession` limits and Runtime Session schema V5 lifetime totals, dual baselines, unmetered-call disclosure, append-only budget decisions, and `waitingForBudget` under the existing CAS authority. Main-provider usage settles exactly once with the durable operation; missing/all-zero usage contributes zero without estimation, auxiliary compaction is excluded, and a narrow Pi 0.80.3 wrapper patch exposes its existing post-turn stop hook. The crossing call and complete approval/tool batch are retained before the same Run parks. Desktop Direct/Sandbox, embedded Local Server, and protected Server expose authenticated fresh-window or Stop decisions; grant advances both baselines and resumes once, while Stop cancels only the active Run. Active Runs resolve the immutable configuration fingerprint through Bun-only persisted Agent bundles, so A remains A across source sync to B and Desktop restart; only a new Run selects B. Model/branch changes do not reset budget, restart restores waits, and explicit Project Thread Duplicate is the only path to a fresh Session without copied budget/history/branch/Server authority. Final local acceptance passed 429 non-Docker tests plus the 42-assertion real-Docker case, all TypeScript projects, lint, renderer Vite through real CEF, and diff checks. The real Electrobun audit at 1280×800 and 900×700 confirmed exact usage, confirmations, restart, Run/Cmd+Enter focus, read-only boundaries, no page overflow, and no application console errors. Eve alignment passed at `vercel/eve@05f348023d4268c974c225c1189a283ace20b742`; compaction and task/subagent inheritance remain explicit V1 differences. Actions and packaging/release were intentionally omitted per owner direction.

- [x] **22 — General Limits V1 (closed at the model-call fuse)**
  - Depends on: 21 and 18.
  - Run: `$kaizen-loop Add one deterministic per-Run model-call fuse without broad quota management.`
  - Done when: source freezes a default-25 or explicit-unlimited model-call limit, Runtime blocks the first forbidden main-provider dispatch, and Desktop/Server retain an attributable terminal.
  - Boundary: no tool quota, cost, duration, Host/organization policy, schedules, or parent-child aggregation without new product evidence.
  - Metric: first forbidden physical model dispatch remains zero.
  - Shipped evidence (2026-07-26): ADR 0015 adds source-owned `maxModelCallsPerRun`, materialized to 25 unless explicitly `false`, with positive-safe-integer compilation, immutable per-Run configuration, and Runtime Session schema V6 failure attribution. Runtime counts unique durable main-provider dispatch claims, including known failure and unknown outcome while excluding replay, cancelled claims, and auxiliary compaction. The first forbidden claim fails the same Run as `runLimitExceeded` before physical dispatch; tools, approvals, token-budget windows, Threads, and Sessions are not reset or retried. Desktop Direct/Sandbox/Local Server and protected Server project the same authority; the Desktop header, Run History, inspector, and toast are read-only. Focused provider fixtures keep the first forbidden physical dispatch at zero, all local suites/typechecks/lint pass, and isolated real CEF evidence at 1280×800 and 900×700 confirms default, explicit-unlimited, reached, history, inspector, console, and overflow states. The owner closed active quota work at this coherent V1; cost, tool, time, Host, schedule, and child policy reopen only with concrete product evidence.

## Connections And Lifecycle Hooks

- [ ] **23 — Advanced MCP connection lifecycle**
  - Depends on: current MCP support and 14.
  - Run: `$kaizen-loop Extend project MCP connections with dynamic discovery, allow/deny, listChanged, and safe schema-drift handling.`
  - Done when: changing remote tool sets refresh safely or block stale schemas without leaking credentials or breaking unrelated connections.
  - Boundary: no OAuth, OpenAPI, deployable stdio, or MCP resources/prompts unless separately approved.
  - Metric: safe remote-tool freshness.

- [ ] **24 — OAuth connection lifecycle**
  - Depends on: 12, 18, 19, and 23.
  - Run: `$kaizen-loop Add Host-managed per-user/service OAuth with durable authorization resume.`
  - Done when: a principal-required flow parks at the tool call, completes consent, keeps tokens outside model/Thread/source/artifact/Trace/Eval data, and resumes the same step.
  - Boundary: no hosted identity product or universal vendor catalog.
  - Metric: authorization-to-resumed-tool completion.

- [ ] **25 — OpenAPI connections**
  - Depends on: 12 and shared connection policy.
  - Run: `$kaizen-loop Compile selected OpenAPI operations into controlled source-owned Agent tools.`
  - Done when: selected operations, auth, requests, responses, schemas, drift, and redaction are validated and traced.
  - Boundary: no automatic exposure of every operation, full client generator, or arbitrary browser scraping.
  - Metric: compiled-operation contract correctness.

- [ ] **26 — Typed lifecycle hooks**
  - Depends on: 04, 12, 14, and 18 for side-effect semantics.
  - Run: `$kaizen-loop Add deterministic typed Agent lifecycle hooks that cannot bypass policy.`
  - Done when: hooks can observe or boundedly transform instructions, provider options, tool calls/results, compaction, Session events, and instrumentation with stable ordering and Trace attribution.
  - Boundary: no runtime hook install, durable-log mutation, hidden external side effects, or bypass of approvals/sandbox/limits/Host policy.
  - Metric: deterministic, non-escalating Hook execution.

## Orchestration, Evaluation, And Ecosystem

- [ ] **27 — Static local Subagents**
  - Depends on: 12, 14, 18, and 19.
  - Run: `$kaizen-loop Add statically authored local Subagents with explicit delegation and parent-child lineage.`
  - Done when: `subagents/<id>/` produces independent child Sessions; permissions only narrow; Trace and budget/cost aggregate to the parent.
  - Boundary: no dynamic Agent generation, arbitrary project loading, Remote Agent, ACP, or A2A.
  - Metric: delegated outcome with complete authority/resource lineage.

- [ ] **28 — Schedules**
  - Depends on: 06, 12, 18, 22, and 26.
  - Run: `$kaizen-loop Add authored schedules with fresh-Session defaults, stable run identity, retries, and audit.`
  - Done when: cron/interval triggers handle timezone/DST, missed runs, overlap, retry, idempotency, cancellation, disable, and optional explicit continuation.
  - Boundary: no hosted scheduler control plane, dynamic schedules V1, or implicit interactive-Thread reuse.
  - Metric: scheduled-run reliability without unmarked duplicate work.

- [ ] **29 — Portable Eval suites and Studio Thread validation**
  - Depends on: 05, 10, and 15 where structured outputs are evaluated.
  - Run: `$kaizen-loop Add executor-neutral source Eval suites that Studio can validate interactively in Threads.`
  - Done when: cases, deterministic assertions, code graders, model judges, thresholds, CI outcomes, and provenance-rich reports work without binding the suite to an execution location.
  - Boundary: no hosted Evals Server and no writing reports into portable source.
  - Metric: reproducible evaluation for the same artifact and controlled environment.

- [ ] **30 — Build-time Extensions**
  - Depends on: 05, 23, 26, and 27.
  - Run: `$kaizen-loop Compose namespaced npm/local Agent capability Extensions at build time.`
  - Done when: extensions safely contribute tools, connections, skills, hooks, and complete Subagents without collisions or authority expansion.
  - Boundary: no host-instruction injection, host Agent/sandbox/schedule declaration, nested extension mounting, runtime install, or Desktop UI plugins.
  - Metric: conflict-free and policy-safe extension composition.

- [ ] **31 — Channel SDK, HTTP baseline, and one reference adapter**
  - Depends on: 06, 12, 17, 18, and 19.
  - Run: `$kaizen-loop Define the Channel contract and prove it with HTTP/SSE plus one complete vendor reference adapter.`
  - Done when: inbound normalization, auth, continuation, delivery, attachments, approvals, terminal states, retries, duplicate webhooks, and Trace correlation pass one conformance suite.
  - Boundary: no requirement to ship every Slack/Discord/Teams/Telegram/GitHub/Linear/Twilio adapter; vendor APIs stay outside Runtime core.
  - Metric: reference-adapter conformance with HTTP safety semantics.

- [ ] **32 — Unified Trace and instrumentation**
  - Depends on: 06 and extends through later loops.
  - Run: `$kaizen-loop Make one canonical Runtime Trace serve Desktop, Server, OpenTelemetry, and exporter adapters.`
  - Done when: model, tool, pause, resume, approval, connection, schedule, and Subagent edges reconstruct one run without secrets; exporter failures do not affect execution.
  - Boundary: no hosted observability backend, separate Desktop/Server trace formats, or raw secret/provider payload retention by default.
  - Metric: complete redacted run reconstruction.

## Product Priority Gate (2026-07-27)

- Active core candidates: 10 (Thread to Agent Project), 27 (static local Subagents), and 29 (portable Eval suites).
- Evidence-gated/deferred: 11 (migrations), 23-26 (connection and hook lifecycle), 28 (schedules), and 30-32 (extensions, channels, unified exporter Trace). These are not active work merely because Eve exposes them; reopen only when a concrete Agent Studio workflow requires them.
- Item 17 is complete under the owner-approved local Docker acceptance policy. Item 22 is complete at the default-25 model-call V1; broader quota axes are intentionally abandoned for now.
- Literal Eve parity is not the north star. Agent Project source is developed in an external editor; Desktop creates only the initial scaffold, then provides read-only source inspection, compiler diagnostics, artifact inspection, and user-directed Thread debugging. In-app authoring, source mutation, capability templates, and IDE behavior are explicitly abandoned.
- Completed loop: the Project pane is now a read-only Agent Project Debug Workbench with fixed VS Code/Zed/Cursor handoff, watcher-driven Building/Ready/Invalid feedback, path-specific diagnostics, and a safe compiled capability summary. Imported/scaffolded Projects and source changes do not create, clear, sync, select, or reposition a Thread automatically; frozen Thread source fields change only through explicit Sync from Agent.

## Dependency Overview

```text
01 -> 02 -> 03 -> 04 -> 05 -> 06
06 -> 07
06 -> 08

05 -> 09 -> 10 -> 29
05 -> 11
05 + 06 -> 15 -> 29

06 -> 12 -> 13 -> 14
04 + 12 + 14 + 18 -> 26

04 -> 16 -> 17
04 + 06 -> 18 -> 19
04 -> 20
04 -> 21

14 -> 23 -> 24
12 -------> 25
12 + 14 + 18 + 19 -> 27
21 + 18 + 27 -> 22
06 + 12 + 18 + 22 + 26 -> 28
05 + 23 + 26 + 27 -> 30
06 + 12 + 17 + 18 + 19 -> 31
06 -> 32
```

## Explicitly Deferred Or Excluded

- [ ] Do not add an Eve package dependency or promise Eve source/API compatibility.
- [ ] Do not add Remote Agent until Pi exposes an approved ACP/A2A path or a new product decision authorizes an adapter.
- [ ] Do not build a hosted Evals Server as part of the portable suite iteration.
- [ ] Do not require all vendor Channel adapters for core Agent Studio completion.
- [ ] Do not add runtime plugins, dynamic Desktop UI plugins, or arbitrary third-party code loading.
- [ ] Do not add hidden Agent configuration state or live Thread/Agent bidirectional synchronization.
- [ ] Do not automatically copy secret-store or environment values into source, artifacts, Threads, Traces, or Eval reports. A Thread-owned literal may enter source only through ADR 0006's exact preview and explicit sensitive-value confirmation.
- [ ] Do not silently downgrade a required sandbox.
- [ ] Do not claim exactly-once external effects.
- [ ] Do not load multiple Agent Projects into one Server deployment artifact.
