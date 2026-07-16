# Agent Studio Loop TODO

Source of truth: [Agent Studio Eve Gap Roadmap](./.agents/kaizen-loop/logs/2026-07-15-215209-agent-studio-eve-gap-roadmap.md)

LLM Space is an Agent Studio: Agent Project source is the portable product, Thread is the fast development/debug/evaluation surface, Pi is the runtime foundation, and Studio Desktop plus Server are two hosts of the same runtime.

## Execution Rules

- [ ] Run every numbered item as its own `$kaizen-loop`; do not combine multiple capabilities into one implementation loop.
- [ ] Re-check current Pi capabilities before designing custom runtime behavior.
- [ ] Inspect the real product, current source, latest capability map, recent logs, and current git status before recommending work.
- [ ] Give each loop one product-level metric, one main recommendation, two alternatives, explicit V1 boundaries, non-goals, and stop conditions.
- [ ] Run `$grill-me` before product-code edits. Routine defaults inside the approved roadmap are `yes`; stop for material scope, security, persistence, or data-boundary changes.
- [ ] For UI work, confirm the interaction scheme and verify through real Electrobun CEF plus a current product-design audit.
- [ ] Mark a task complete only after implementation, focused tests, relevant TypeScript checks, lint/non-packaging build checks, review, capability-map refresh, and a completed kaizen log. Never run Electrobun packaging, DMG, update-patch, signing, notarization, `build:canary`, `build:stable`, `pack*`, or release validation in this worktree.
- [ ] Preserve unrelated worktree changes. Never use this TODO as permission to revert or rewrite concurrent work.

## Primary Build-To-Server Spine

- [x] **01 — Pi Agent session authority**
  - Depends on: current runtime.
  - Run: `$kaizen-loop Make the Pi Agent-backed LLM Space session core authoritative without changing shipped behavior.`
  - Done when: existing manual, auto-once, ReAct, persistence, abort, reload, tool, and event fixtures run through one LLM Space `AgentSession` backed by Pi `Agent`; Pi owns the official loop/tool lifecycle while Thread persistence, settled manual policy, and event projection each have one documented LLM Space owner.
  - Boundary: behavior-preserving runtime convergence only; no new Server, source slot, UI, or workflow-durability claim.
  - Metric: existing runtime behavior coverage through the Pi Agent-backed session core.
  - Decision (2026-07-15): current Pi `AgentHarness` can keep a run busy on an unresolved tool Promise but cannot express LLM Space's settled manual workflow—finish the run, externally resolve/edit exact tool results, then continue without a new user message. Item 01 therefore standardizes on Pi `Agent.continue()` and an LLM Space-owned session adapter instead of waiting for or privately copying Harness lifecycle behavior.

- [ ] **02 — Inspectable compiled Agent artifact V1**
  - Depends on: 01.
  - Run: `$kaizen-loop Build an immutable, inspectable, deterministic Agent Project artifact.`
  - Done when: canonical projects build into artifacts containing source, dependency, capability, schema, runtime, and environment-requirement fingerprints.
  - Boundary: no credentials, Sessions, Thread history, Eval results, Server, container, or cloud deployment.
  - Metric: deterministic build completion without manual source repair.

- [ ] **03 — Local Server protocol V1**
  - Depends on: 02.
  - Run: `$kaizen-loop Run one compiled Agent artifact as an independent protected Bun HTTP/SSE Server.`
  - Done when: one artifact serves many isolated Sessions with authenticated requests, Channel-owned continuation tokens, Runtime-owned session/run IDs, ordered terminal events, abort, and authorized reconnect cursors.
  - Boundary: one Agent Project per deployment; no vendor channels, cloud control plane, remote agents, schedules, or multi-project loading.
  - Metric: protected streaming completion with lossless reconnect.

- [ ] **04 — Studio Server Runtime Profile and Trace handoff**
  - Depends on: 03.
  - Run: `$kaizen-loop Let Studio run and debug the same Agent through a Local Server Runtime Profile.`
  - Done when: Studio exposes Desktop-direct, Desktop-sandbox, and Local-Server profiles, explains capability differences, and opens Server runs in the same Trace inspector.
  - Boundary: no remote fleet or cloud deployment management UI.
  - Metric: equivalent fixture outcome and trace lineage across Desktop and Local Server profiles.

- [ ] **05 — OCI deployment V1**
  - Depends on: 03.
  - Run: `$kaizen-loop Package a compiled Agent as a platform-neutral OCI image running the Bun Server.`
  - Done when: a clean container starts from artifact plus declared environment, reports health/readiness, persists through a mounted storage contract, and shuts down cleanly.
  - Boundary: no Vercel, Cloudflare, Kubernetes operator, autoscaling, managed secrets, or hosted control plane.
  - Metric: clean-environment deployment completion.

## Studio Authoring And Project Lifecycle

- [ ] **06 — Canonical template and capability presets**
  - Depends on: 02.
  - Run: `$kaizen-loop Create one canonical Agent template with composable presets for shipped capabilities.`
  - Done when: Studio and CLI share one atomic scaffolder; every supported preset combination builds without manual edits and includes a focused test or eval case.
  - Boundary: no marketplace, duplicated full templates, or templates for unshipped capabilities.
  - Metric: generated-project build success rate.

- [ ] **07 — Build Thread as Agent Project**
  - Depends on: 06.
  - Run: `$kaizen-loop Turn a runnable standalone Thread into a buildable Agent Project.`
  - Done when: promotion previews and atomically materializes portable model, reasoning, prompt, variables, tools, examples, and evaluation intent into source plus an initial Project Thread.
  - Boundary: one-way conversion; original Thread remains independent; no hidden metadata, live sync, secret copy, or silent tool substitution.
  - Metric: Thread-to-buildable-Agent completion without manual source repair.

- [ ] **08 — Explicit source and artifact migrations**
  - Depends on: 02 and a real schema evolution.
  - Run: `$kaizen-loop Add explicit, previewable, reversible Agent source and artifact migrations.`
  - Done when: old fixtures either migrate atomically without data loss or receive a precise unsupported-version diagnosis; Build remains read-only.
  - Boundary: no silent migration, broad compatibility shims, or automatic dependency major upgrades.
  - Metric: safe migration completion across the maintained fixture corpus.

- [ ] **09 — Trusted Session context and structured state**
  - Depends on: 03.
  - Run: `$kaizen-loop Add verified Session identity context and durable typed Session state.`
  - Done when: initiator, current principal, optional tenant, and channel context are verified; Turn context, Session state, message history, and external long-term memory remain distinct.
  - Boundary: no bundled vector database, automatic memory extraction, hosted tenant database, or organization-policy UI.
  - Metric: isolated structured-state recovery after Server restart.

- [ ] **10 — Composable static and dynamic instructions**
  - Depends on: 09.
  - Run: `$kaizen-loop Support composable build-time and trusted per-Turn Agent instructions.`
  - Done when: root instructions and ordered directory entries compile deterministically; dynamic instructions resolve from trusted Session context and are snapshotted per Turn through Pi.
  - Boundary: instructions cannot execute tools, load arbitrary runtime code, or expand authority.
  - Metric: deterministic, explainable instruction snapshots.

- [ ] **11 — Dynamic capability snapshots**
  - Depends on: 09 and 10.
  - Run: `$kaizen-loop Resolve model, tools, connections, and stream options dynamically at each Turn inside static policy bounds.`
  - Done when: every Turn records an immutable effective-capability snapshot constrained by authored maximums and Host policy.
  - Boundary: no dynamic code discovery, runtime plugin install, arbitrary path loading, or permission escalation.
  - Metric: capability-snapshot policy fidelity.

- [ ] **12 — Named structured output contracts**
  - Depends on: 02 and 03.
  - Run: `$kaizen-loop Wire source-declared named structured outputs through Pi, providers, Thread, and Server.`
  - Done when: Thread or Channel selects a declared contract, Runtime maps it to supported provider behavior, validates the final result, and emits a typed terminal state.
  - Boundary: no arbitrary caller-supplied schemas or unlimited automatic repair loop.
  - Metric: schema-valid completion rate on supported providers.

## Pi Execution, Safety, And Durability

- [ ] **13 — ExecutionEnv-backed built-in tools**
  - Depends on: 01.
  - Run: `$kaizen-loop Add authored read, write, and bash helpers that execute only through Pi ExecutionEnv.`
  - Done when: the same tool contracts pass against Node and isolated/fake ExecutionEnv implementations with correct path, symlink, abort, timeout, streaming, and cleanup behavior.
  - Boundary: no direct Desktop/Server host filesystem access, implicit default tools, or policy bypass.
  - Metric: ExecutionEnv portability of built-in tools.

- [ ] **14 — Sandbox, workspace, and attachment delivery V1**
  - Depends on: 13.
  - Run: `$kaizen-loop Provide a Pi ExecutionEnv sandbox contract, local container reference provider, workspace seeds, and controlled attachments.`
  - Done when: authored environment selection works, required sandbox failure never downgrades silently, `workspace/` seeds an isolated Session, attachments are safely staged, and cleanup/retention is verified.
  - Boundary: no Vercel Sandbox, Firecracker fleet, arbitrary host paths, or source write-back without explicit Studio adoption.
  - Metric: sandbox isolation and delivery acceptance rate.

- [ ] **15 — Durable execution V1**
  - Depends on: 01, 03, and stable Session storage.
  - Run: `$kaizen-loop Add crash-aware durable execution around Pi save points and Session state.`
  - Done when: provider/tool operations record idempotency and pre-call/completed/failed/cancelled/parked/outcome-unknown states; injected crash points recover safely or stop honestly.
  - Boundary: no exactly-once guarantee, arbitrary workflow DSL, or claim of full distributed workflow durability.
  - Metric: safe recovery or explicit unknown state across the crash matrix.

- [ ] **16 — Durable human-in-the-loop approvals**
  - Depends on: 15.
  - Run: `$kaizen-loop Add source-minimum, Host-tightenable approvals with durable park and resume.`
  - Done when: `always`, `once per session`, `never`, and conditional policies merge safely; approvals survive restart and no call executes without the effective decision.
  - Boundary: approval decides whether; sandbox decides where. No model self-approval or cross-principal approval cache.
  - Metric: approval integrity across restart and resume.

- [ ] **17 — Pi compaction and Session tree UX**
  - Depends on: 01.
  - Run: `$kaizen-loop Expose Pi-native compaction, branches, summaries, labels, and checkpoints in Studio.`
  - Done when: long Sessions compact the model context while retaining complete event/message history and navigable branches.
  - Boundary: no new summarization engine, destructive history deletion, or hidden branch mutation.
  - Metric: long-session continuation with complete audit history.

- [ ] **18 — Session Token Budget V1**
  - Depends on: 01 and provider usage.
  - Run: `$kaizen-loop Add source-owned input and output token budgets based only on real provider usage.`
  - Done when: consumption is visible and Runtime pauses before the first forbidden next model call, offering explicit stop or fresh-window decisions.
  - Boundary: no estimated enforcement for missing usage, cost/turn/tool/time limits, compaction, or ordinary Thread budgets.
  - Metric: exact budget-boundary stop correctness.

- [ ] **19 — General Limits V2**
  - Depends on: 18, 15, and 24 for complete inheritance validation.
  - Run: `$kaizen-loop Generalize limits to cost, turns, tools, time, concurrency, schedules, and parent-child aggregation.`
  - Done when: every limit has a deterministic persisted terminal/paused state; Host and child policy can only tighten source limits.
  - Boundary: no billing system, provider quota guarantee, or organization-policy admin product.
  - Metric: complete and attributable policy enforcement.

## Connections And Lifecycle Hooks

- [ ] **20 — Advanced MCP connection lifecycle**
  - Depends on: current MCP support and 11.
  - Run: `$kaizen-loop Extend project MCP connections with dynamic discovery, allow/deny, listChanged, and safe schema-drift handling.`
  - Done when: changing remote tool sets refresh safely or block stale schemas without leaking credentials or breaking unrelated connections.
  - Boundary: no OAuth, OpenAPI, deployable stdio, or MCP resources/prompts unless separately approved.
  - Metric: safe remote-tool freshness.

- [ ] **21 — OAuth connection lifecycle**
  - Depends on: 09, 15, 16, and 20.
  - Run: `$kaizen-loop Add Host-managed per-user/service OAuth with durable authorization resume.`
  - Done when: a principal-required flow parks at the tool call, completes consent, keeps tokens outside model/Thread/source/artifact/Trace/Eval data, and resumes the same step.
  - Boundary: no hosted identity product or universal vendor catalog.
  - Metric: authorization-to-resumed-tool completion.

- [ ] **22 — OpenAPI connections**
  - Depends on: 09 and shared connection policy.
  - Run: `$kaizen-loop Compile selected OpenAPI operations into controlled source-owned Agent tools.`
  - Done when: selected operations, auth, requests, responses, schemas, drift, and redaction are validated and traced.
  - Boundary: no automatic exposure of every operation, full client generator, or arbitrary browser scraping.
  - Metric: compiled-operation contract correctness.

- [ ] **23 — Typed lifecycle hooks**
  - Depends on: 01, 09, 11, and 15 for side-effect semantics.
  - Run: `$kaizen-loop Add deterministic typed Agent lifecycle hooks that cannot bypass policy.`
  - Done when: hooks can observe or boundedly transform instructions, provider options, tool calls/results, compaction, Session events, and instrumentation with stable ordering and Trace attribution.
  - Boundary: no runtime hook install, durable-log mutation, hidden external side effects, or bypass of approvals/sandbox/limits/Host policy.
  - Metric: deterministic, non-escalating Hook execution.

## Orchestration, Evaluation, And Ecosystem

- [ ] **24 — Static local Subagents**
  - Depends on: 09, 11, 15, 16, and preferably 19.
  - Run: `$kaizen-loop Add statically authored local Subagents with explicit delegation and parent-child lineage.`
  - Done when: `subagents/<id>/` produces independent child Sessions; permissions only narrow; Trace and budget/cost aggregate to the parent.
  - Boundary: no dynamic Agent generation, arbitrary project loading, Remote Agent, ACP, or A2A.
  - Metric: delegated outcome with complete authority/resource lineage.

- [ ] **25 — Schedules**
  - Depends on: 03, 09, 15, 19, and 23.
  - Run: `$kaizen-loop Add authored schedules with fresh-Session defaults, stable run identity, retries, and audit.`
  - Done when: cron/interval triggers handle timezone/DST, missed runs, overlap, retry, idempotency, cancellation, disable, and optional explicit continuation.
  - Boundary: no hosted scheduler control plane, dynamic schedules V1, or implicit interactive-Thread reuse.
  - Metric: scheduled-run reliability without unmarked duplicate work.

- [ ] **26 — Portable Eval suites and Studio Thread validation**
  - Depends on: 02, 07, and 12 where structured outputs are evaluated.
  - Run: `$kaizen-loop Add executor-neutral source Eval suites that Studio can validate interactively in Threads.`
  - Done when: cases, deterministic assertions, code graders, model judges, thresholds, CI outcomes, and provenance-rich reports work without binding the suite to an execution location.
  - Boundary: no hosted Evals Server and no writing reports into portable source.
  - Metric: reproducible evaluation for the same artifact and controlled environment.

- [ ] **27 — Build-time Extensions**
  - Depends on: 02, 20, 23, and 24.
  - Run: `$kaizen-loop Compose namespaced npm/local Agent capability Extensions at build time.`
  - Done when: extensions safely contribute tools, connections, skills, hooks, and complete Subagents without collisions or authority expansion.
  - Boundary: no host-instruction injection, host Agent/sandbox/schedule declaration, nested extension mounting, runtime install, or Desktop UI plugins.
  - Metric: conflict-free and policy-safe extension composition.

- [ ] **28 — Channel SDK, HTTP baseline, and one reference adapter**
  - Depends on: 03, 09, 14, 15, and 16.
  - Run: `$kaizen-loop Define the Channel contract and prove it with HTTP/SSE plus one complete vendor reference adapter.`
  - Done when: inbound normalization, auth, continuation, delivery, attachments, approvals, terminal states, retries, duplicate webhooks, and Trace correlation pass one conformance suite.
  - Boundary: no requirement to ship every Slack/Discord/Teams/Telegram/GitHub/Linear/Twilio adapter; vendor APIs stay outside Runtime core.
  - Metric: reference-adapter conformance with HTTP safety semantics.

- [ ] **29 — Unified Trace and instrumentation**
  - Depends on: 03 and extends through later loops.
  - Run: `$kaizen-loop Make one canonical Runtime Trace serve Desktop, Server, OpenTelemetry, and exporter adapters.`
  - Done when: model, tool, pause, resume, approval, connection, schedule, and Subagent edges reconstruct one run without secrets; exporter failures do not affect execution.
  - Boundary: no hosted observability backend, separate Desktop/Server trace formats, or raw secret/provider payload retention by default.
  - Metric: complete redacted run reconstruction.

## Dependency Overview

```text
01 -> 02 -> 03 -> 04
              \-> 05

02 -> 06 -> 07 -> 26
02 -> 08
02 + 03 -> 12 -> 26

03 -> 09 -> 10 -> 11
01 + 09 + 11 + 15 -> 23

01 -> 13 -> 14
01 + 03 -> 15 -> 16
01 -> 17
01 -> 18 -> 19

11 -> 20 -> 21
09 -------> 22
09 + 11 + 15 + 16 + 19 -> 24
03 + 09 + 15 + 19 + 23 -> 25
02 + 20 + 23 + 24 -> 27
03 + 09 + 14 + 15 + 16 -> 28
03 -> 29
```

## Explicitly Deferred Or Excluded

- [ ] Do not add an Eve package dependency or promise Eve source/API compatibility.
- [ ] Do not add Remote Agent until Pi exposes an approved ACP/A2A path or a new product decision authorizes an adapter.
- [ ] Do not build a hosted Evals Server as part of the portable suite iteration.
- [ ] Do not require all vendor Channel adapters for core Agent Studio completion.
- [ ] Do not add runtime plugins, dynamic Desktop UI plugins, or arbitrary third-party code loading.
- [ ] Do not add hidden Agent configuration state or live Thread/Agent bidirectional synchronization.
- [ ] Do not copy secrets into source, artifacts, Threads, Traces, or Eval reports.
- [ ] Do not silently downgrade a required sandbox.
- [ ] Do not claim exactly-once external effects.
- [ ] Do not load multiple Agent Projects into one Server deployment artifact.
