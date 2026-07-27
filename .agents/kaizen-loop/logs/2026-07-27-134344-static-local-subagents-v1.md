# Static Local Subagents V1

- Status: draft
- Outcome: revised architecture and Desktop interaction approved; implementation in progress
- Roadmap context: Item 27
- Date: 2026-07-27

## Trigger and starting state

The owner asked to continue `LOOP_PLAN.md` after Agent Project Debug Workbench
V1 shipped. `develop` started clean and synchronized at
`7afc7e61ea82f40284ec692f55ea83a4506a7ff8`. Product code has not been changed
in this discovery turn.

## Product stage and diagnosis

LLM Space is a development-stage local Agent Studio. Agent Project source is
authored in an external editor; Desktop now owns read-only source/artifact
inspection and explicit user-directed Thread debugging. The remaining active
core candidates are Item 10 Thread-to-Project promotion, Item 27 static local
Subagents, and Item 29 portable Eval suites.

The thinnest core boundary is composition. A current artifact and Runtime
Session describe exactly one Agent. A user cannot declare a specialist, give it
fresh context and its own capabilities, delegate a task, or trace its result
back to the parent. Thread promotion improves creation convenience, while
portable Evals extend an already shipped interactive evaluation surface;
neither closes this missing execution class.

A historical `back` branch at commit `907f933` contains a pre-Harness
Specialist prototype and audit. It is useful evidence that the interaction can
work, but it predates the current Runtime state machine, safe recovery,
Sandbox, durable approvals, token budgets, and per-Run model-call fuse. It is
not present on `develop` and must not be cherry-picked as the implementation.

## Evidence reviewed

- Repository contract, `LOOP_PLAN.md`, current capability map, current git
  status, and the three latest kaizen logs.
- Current Runtime discovery/compiler, compiled snapshot/artifact/bundle,
  `AgentSession`, capability snapshots, Session Store, operation ledger,
  Sandbox, approval, token-budget, and model-call-limit boundaries.
- Current Desktop External Agent Project manager/view, artifact summary,
  Project Thread streaming, Run History/trace view, typed RPC, and the seeded
  ordinary Thread tool schemas.
- The seeded ordinary Thread `agent` function is only a schema. It has no Bun
  executor, Agent Project source, child artifact, independent Runtime Session,
  or lineage and is therefore not a shipped Subagent capability.
- A fresh isolated real Electrobun CEF run opened the checked-in example through
  actual Bun RPC. The Ready artifact showed six capabilities—Instructions, two
  tools, state, skill, and connection—with no Subagent. The document/body fit
  1280×800 and the console contained only Vite/React development messages. The
  temporary runtime root was removed.
- The 2026-07-15 delegation decision/prototype was inspected as historical
  evidence. Its product concepts remain useful, but its interruption-only
  recovery and exclusions for Sandbox/approval/budgets are obsolete.

## External market scan

Primary sources accessed 2026-07-27:

- Eve Subagents at commit `632605f097c583e6667578a9b296c334f69e9121`:
  https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/docs/subagents.mdx
- Eve Project Layout at the same commit:
  https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/docs/reference/project-layout.md
- OpenAI Agents JS orchestration guide:
  https://openai.github.io/openai-agents-js/guides/multi-agent/
- OpenAI Agents JS agents-as-tools guide:
  https://openai.github.io/openai-agents-js/guides/tools/#4-agents-as-tools
- OpenAI Agents JS implementation at commit
  `070b395d279c0b9828ee50c8196db374c48ce904`:
  https://github.com/openai/openai-agents-js/blob/070b395d279c0b9828ee50c8196db374c48ce904/packages/agents-core/src/agent.ts

Table stakes are consistent across both products: the parent either keeps
conversation control and calls a child as a tool, or explicitly hands off the
conversation. For LLM Space, the manager/agent-as-tool form is the fit because
the current Project Thread must remain the one user-facing debug line. A child
needs fresh history, explicit input, its own loop and capabilities, stable
identity, observable nested execution, and safe cancellation/wait behavior.

Eve's current declared Subagents additionally establish required description,
path-derived tool identity, independent discovery, fresh state, build-time name
collision rejection, child Session streams, proxied interactive waits, and
recursive cancellation. Eve also ships root-copy, nested, remote, Workflow,
and caller-supplied `outputSchema` variants; those exceed one LLM Space V1.

The true missing capability is not a generic `agent` tool. It is a portable,
inspectable specialist boundary that compiles with the Project, executes with
the same Desktop/Server Runtime semantics, and never hides authority, resource,
or recovery lineage behind opaque tool text.

Uncertainty remains around exact child capability and wait projection seams in
the current Runtime. The approved plan must pass `$grill-me` before product
code. No external source was used to justify silently retrying child effects or
sharing parent transcript/Sandbox.

## Capability-map freshness

- Added `Static Local Subagents`: missing on `develop`, freshness confirmed
  from current source, fresh real CEF, and the divergent historical prototype.
- Refreshed `Agent Project Activation` to the shipped no-implicit-Thread
  boundary established by Debug Workbench V1.
- Refreshed `Thread-To-Agent Project Promotion`: dependency-unblocked but
  deferred; Item 17 is locally shipped under the owner-approved policy.
- Refreshed `Evaluation Workspace`: interactive Thread evaluation is shipped,
  while portable source Eval suites are wholly missing.
- No unknown boundary drives the recommendation.

## Product north-star metric

Name: **trace-complete specialist delegation completion rate**.

Why it matters: LLM Space can claim to build and debug a composed Agent only
when a parent can delegate to source-declared specialist behavior and the user
can prove exactly which child identity, context, capabilities, authority,
resource limits, work, and result were involved.

Baseline: 0%. No `develop` artifact can declare a child Agent; no parent tool
call can create or link an independent child Session/Run.

V1 target: 100% of a checked-in deterministic parent→child→parent acceptance
corpus completes or terminates with a stable child link. Every delegation
exposes child source/artifact identity, Session/Run, status, explicit task,
model, capabilities, main-model-call/token/provider-cost accounting, waits/tool
evidence, terminal outcome, and exact result returned to the parent. The link
survives restart, and child history contains zero implicit parent transcript
messages.

Measurement: compiler/artifact fixtures plus deterministic parent/child Runtime
streams, Desktop and protected-Server integration, restart/recovery fixtures,
real Docker for child Sandbox, and real CEF inspection at 1280×800. The owner
explicitly removed 900-pixel-width pages from the acceptance requirement.

Guardrails: no implicit Thread/tab creation or selection; no parent transcript,
state, attachment descriptor, secret, or connection-auth copy; shared Sandbox
is selected only by the frozen source/Host rule below; no weaker Host/approval
policy; no tool-call quota; every Agent enforces only its own source-declared
model-call and token limits; tool failures stay ordinary Agent-visible results
while ambiguous effects never auto-retry; parent abort cascades during the
initial active dispatch without filesystem rollback; Desktop and Server share
identity/persistence semantics; no console error,
visible overflow, persistence loss, or regression in existing single-Agent
workflows.

## Candidate product opportunities

### Main recommendation: Static Local Subagents V1

Add one-level, source-declared local specialists with independent child Runtime
Sessions, explicit-message delegation, non-escalating policy, parent/child
lineage, aggregate usage, and a Desktop child-run inspector.

This is selected now because Debug Workbench closed the previous Build surface
bottleneck, while Subagents remain the largest missing core execution ability
in the Eve comparison. The current Harness, safe recovery, Sandbox, approvals,
budgets, and default-25 fuse now exist, so V1 can be integrated honestly rather
than reproducing the obsolete interruption-only prototype.

### Alternative 1: Portable Eval suites

Defer one loop. Portable cases, assertions/judges, thresholds, and reproducible
reports are a core Agent Studio gap, but users already have Thread-owned run
comparison and structured rubrics. Evals should validate composed Agents after
the missing composition primitive exists.

### Alternative 2: Thread-to-Agent Project promotion

Defer. Its dependencies are now unblocked and ADR 0006 fixes a safe preview-
first contract, but it is a conversion workflow rather than a missing Agent
execution class. External-editor source development plus canonical scaffolding
already provides a working creation path.

## V1 capability definition

After V1, a Project may declare a direct child under
`agent/subagents/<id>/`. Its `agent.ts` requires a description. The child is
compiled and fingerprinted as an independent Agent boundary and appears to the
parent model as one bare path-derived tool named `<id>` with input
`{ message: string }`; collisions with root tools or connection-exposed names
fail the build.

The child receives only the explicit message plus trusted principal/tenant/
channel context with fresh child Session/Turn identities. It receives no parent
transcript, state, tool results, prompt, capabilities, or filesystem. It may use
the currently shipped child-safe Agent slots—model/reasoning/limits/environment,
static or dynamic instructions and tools, skills, typed state,
Sandbox/workspace, ExecutionEnv helpers, and tool approvals. Child connections,
child Subagents, and delegation-time structured output selection are rejected in
V1; only final assistant text returns to the parent model.

Each call creates a fresh durable child Session and Run linked to the exact
parent Session/Run/tool call and frozen root/child artifacts. Child state is
always independent. Sandbox uses the owner-approved data-plane rule: an absent
child Sandbox declaration shares the parent's effective Sandbox/workspace; a
declared `defineSandbox({})` shares only when its compiler/Host-derived internal
revalidation fingerprint matches the parent's, otherwise it receives an
independent child Sandbox. `defineSandbox({})` remains zero-configuration and
portable source never supplies the key, provider, or lifecycle. Approving the
delegation tool never blanket-approves child tools; child approval waits remain
individually inspectable and resumable.

The child uses the normal Pi-backed ReAct loop. Tool failures remain visible to
the child Agent so it may adapt; Runtime does not automatically retry ambiguous
effects. Parent cancellation cascades during the initial active child dispatch
but never rolls back completed shared-workspace writes. Cancellation propagation
while resuming a previously parked child is deferred. Safe waits recover through current Runtime
CAS/journal rules; no restart creates a duplicate child or effect. All siblings
may execute in parallel, including children sharing one Sandbox. V1 adds no
serialization, file lock, merge, or rollback; the parent must give parallel
children non-overlapping write scopes in their explicit messages.

Every Agent enforces only its own declared limits. Parent model calls consume
only the parent Run's `maxModelCallsPerRun`; each child has its own default 25
or explicit source value. Token budgets are likewise Session-local. No limit is
inherited, propagated, aggregated for enforcement, or deducted across the tree.
Non-cancelled main model calls, provider-reported tokens, and provider-reported
cost aggregate read-only in the Desktop parent inspector. Unmetered disclosure,
duration, and Server-side aggregate projection are deferred. V1 adds no tool,
cost, time, or organization quota.

Subagent dispatch never automatically copies attachment descriptors or bytes.
When Sandbox is shared, the parent may pass explicit `/workspace/...` paths in
`message` and the child can read already-staged files. An isolated child sees
only its own workspace seed. Cross-Sandbox attachment transfer remains a future
explicit, auditable protocol.

Desktop artifact inspection lists each Subagent and source provenance. The
parent Thread renders delegation as a normal tool card with child status and an
`Inspect child run` action. The existing inspector pattern shows child identity,
explicit task, isolated prompt/capabilities, messages, tool/approval waits,
token/cost/main-model-call usage, result, and terminal/recovery lineage while keeping the
parent Thread selected. It creates no child Thread, app tab, sidebar item, or
automatic selection. Protected Server exposes the same lineage and terminals
without inventing a second execution meaning.

Explicit non-goals: root-copy built-in Agent, nested children, handoff, dynamic
Agent creation, arbitrary project loading, remote Agent, ACP/A2A, Workflow,
background or reused long-lived children, caller-supplied arbitrary output
schemas, child connections, child-specific cancel UI, cancellation propagation
during parked-child resume, automatic effect retry, unmetered/duration/Server
aggregate views, new quota axes, source CRUD, or implicit Thread lifecycle.

## Acceptance and audit plan

1. Source/compiler fixtures prove required description, one-level confinement,
   non-executing discovery, full child fingerprints, supported/rejected slot
   matrix, symlink/path rejection, and bare-name collision failures.
2. Runtime fixtures prove explicit-message-only context, fresh state, child
   model/instructions/tools, connection rejection, tool-failure self-recovery, approvals,
   shared/isolated Sandbox selection by internal fingerprint, unrestricted
   sibling parallelism, per-Agent limits, read-only token/cost/main-model-call
   aggregation, failure, initial-dispatch cancellation without filesystem rollback, safe waits, restart, and no
   hidden retry or duplicate physical effect.
3. Desktop and protected-Server fixtures prove identical parent/child identity,
   persistence, frozen artifact selection, deletion ownership, stream/terminal
   projection, and no automatic Thread mutation.
4. Real Docker acceptance proves absent-declaration sharing, equal-fingerprint
   sharing, unequal-fingerprint isolation, explicit-path visibility, parallel
   shared writes, independent retention/reconnect, cancellation without
   rollback, and cleanup without residual resources.
5. Real Electrobun CEF covers artifact discovery, parent tool card, running/
   waiting/succeeded/failed/recovered states, child approval and tool evidence,
   inspector navigation/focus, restart, 1280×800 overflow, and console checks,
   followed by a current product-design audit. Narrow 900-pixel-width pages are
   not an acceptance gate by explicit owner decision.
6. Run focused tests, all TypeScript projects, root lint, all repository test
   files in isolated Bun processes if the known single-process memory failure
   persists, renderer Vite build, Docker acceptance, `git diff --check`, and
   fixed-point Standards/Spec review. Do not run Actions, packaging, signing,
   notarization, or release flows.

## Implementation plan and approval status

Approval status: the initial recommendation, materially revised `$grill-me`
architecture, and concrete Desktop interaction scheme are all explicitly
approved. Product-code implementation is authorized. The owner removed
900-pixel-width rendered acceptance; 1280×800 remains required.

1. Extend the public child description contract, non-executing discovery,
   immutable snapshots/artifacts/bundles, capability fingerprints, and stable
   diagnostics for one-level `subagents/<id>/`.
2. Lower each child to a prepared parent tool and add a Runtime delegation
   coordinator that creates ordinary Pi-backed `AgentSession` children through
   explicit Host-provided storage, Sandbox/ExecutionEnv, connection, approval,
   and policy resources.
3. Persist the parent edge and frozen child configuration before work begins;
   integrate safe recovery, approval waits, operation attribution, cascading
   abort, per-Agent limits, aggregate read-only usage, and shared/isolated
   Sandbox borrowing without a second ReAct loop.
4. Project one typed parent/child contract through Runtime, protected Server,
   Desktop Bun, RPC, Project Thread persistence, and Run History. Keep secret,
   Host path, credential, environment value, and Sandbox handle data out of the
   record.
5. Extend read-only artifact summary, delegation tool card, and existing trace
   inspector pattern; retain the parent Thread and explicit user selection.
6. Add one deterministic checked-in specialist fixture and user documentation,
   then execute the acceptance/audit/review plan and refresh roadmap evidence.

Stop for renewed approval if implementation requires sharing parent transcript
or attachment metadata, exposing an authored lifecycle key, sharing when the
frozen revalidation rule does not match, weakening child approvals/Host policy,
adding a new quota product, auto-retrying ambiguous effects, creating child
Threads/tabs, diverging Desktop and Server semantics, reintroducing the
historical prototype wholesale, or changing Pi/upstream instead of composing
existing public primitives.

## `$grill-me` requirements discussion

Completed its design-tree questions for the current architecture; final shared-
understanding confirmation is pending. Resolved decisions:

- Child capabilities may differ from parent capabilities, but inherit no parent
  authored slot; Host/principal and child tool approval cannot weaken.
- Child supports current model/reasoning/environment/limits, static/dynamic
  instructions/tools, ExecutionEnv helpers, skills, typed state, approvals, and
  Sandbox. Child connections, `outputs/`, and nested Subagents are rejected in
  V1.
- Limits are wholly per-Agent and never transmitted. Parent inspector aggregates
  usage for observation only.
- Approval, tool, and budget waits remain child-owned. Approval is handled from
  the child inspector while the parent delegation waits; child token-budget
  decision UX/API is deferred.
- Eve research at
  `research/eve-subagent-sandbox-sharing-2026-07-27.md` confirmed Eve's root
  copy shares Sandbox while declared specialists isolate. The owner selected a
  deliberate LLM Space variant: absent child Sandbox shares parent; a declared
  child compares an internal compiler/Host-derived revalidation fingerprint and
  shares only on equality. Source stays `defineSandbox({})` with no config.
- Attachments never forward automatically; shared children receive only paths
  explicitly included in `message`.
- Every call owns a fresh child Session. Terminal isolated containers stop but
  retain their volume and trace until parent Thread deletion. The record reserves
  `retryOf` lineage, but explicit retry UX/API is deferred. Shared resources
  remain parent-owned.
- Ordinary tool failures remain child-visible; terminal failures return a safe
  parent error result; waits do not fabricate a result; unknown outcomes stop
  without retry.
- Tool names are bare path-derived ids with build-time collision rejection.
- Trusted principal/tenant/channel context passes, while transcript, state,
  prompts, attachment descriptors, registry, and secret values do not.
- Siblings run without concurrency restrictions even on a shared workspace;
  there is no lock, merge, or cancellation rollback.
- Parent abort cancels children during their initial active dispatch. Propagation
  during parked-child resume and child-specific cancel UI are deferred.
- Source changes update Build diagnostics only; explicit Sync is required for
  later Thread Runs, and active/waiting Runs retain frozen artifacts.
- Child lineage persists before dispatch. A durable child terminal can fill a
  missing parent result after restart without rerun; safe waits resume and
  ambiguous effects remain unknown.
- Parent model/reasoning overrides never pass to child. Root-copy `agent`
  remains out of V1.

The owner subsequently confirmed the concrete Desktop interaction:

- Project artifact summary and source list expose Subagent provenance.
- Parent delegation cards and Run History open one child inspector without a
  Thread, tab, navigation, selection, or scroll-position side effect.
- Manual mode exposes explicit `Run subagent`; automatic modes reuse existing
  tool policy. Approval waits route to the child-owned decision UI.
- Wide layout uses the existing right-side inspector pattern. The owner removed
  the proposed 900-pixel-width compact-mode acceptance gate.
- Inspector shows parent/child lineage, model, limits, shared/isolated Sandbox,
  usage, fingerprint, explicit message, child-only prompt/capabilities,
  transcript, tool results, waits, and terminal. Escape/Back restores focus.
- Opening/closing inspection writes no data; child records persist with the
  parent Thread and source changes still require explicit Sync.

## Work performed and review

Status: done.

Implemented the approved one-level source/compiler contract, frozen child
artifacts, Runtime Host boundary, independent child Session lifecycle, stable
lineage, safe waits, child approvals, per-Agent limits, Eve-aligned Sandbox
sharing/isolation, Desktop and protected-Server persistence, delegation cards,
manual invocation, child inspector, and Run History child usage. Added the
deterministic `apps/example-agent` child and ADR 0016. No child Thread is
created or selected, and no parent transcript, attachment, model override, or
secret value is copied.

Final review added Server Host approval propagation, compile-time rejection for
child connections, child model-call/token/provider-cost aggregation, and removed
an unrequested 32-child ceiling. Child token-budget decisions, explicit retry,
complete multi-sibling restart recovery, parked-child resume cancellation,
unmetered/duration/Server aggregate views, and child connections remain
documented V1 extensions.

Final acceptance uses only 1280×800 for rendered Desktop inspection by owner
decision. Actions, packaging, signing, notarization, and release are excluded.

## Follow-up product bets

- Item 29 portable Eval suites that can validate the same composed artifact in
  Desktop, Local Server, and CI without writing reports into source.
- Item 10 preview-first Thread promotion once the target Project can represent
  the final intended core source surface.
- Nested/remote Subagents, Workflow, structured delegation output, and broader
  trace export only after V1 produces real usage evidence.
