# Dynamic Capability Snapshots Contract Blocker

- Status: done
- Outcome: blocked
- Roadmap item: 14

## Trigger

The owner asked to continue after item 13 completed and was pushed at
`754498c`. This bounded pass started from a clean synchronized `develop`.
Items 10 and 11 remain dependency-blocked, while items 12 and 13 are complete,
so item 14 is the lowest-numbered dependency-ready item. No concurrent or
ambiguous worktree change existed.

## Product stage and context

LLM Space now compiles immutable Agent artifacts and resolves trusted
instructions once per Turn into an integrity-checked Session Store snapshot.
The remaining runtime capabilities do not have the same authority model.
`agent.ts` declares one static model/reasoning pair, while a Host may override
the model, reasoning, tool set, and stream function when it creates an
`AgentSession`. Connections are compiled metadata and Desktop activates MCP
tools through Host-owned runtime configuration. There is no authored maximum,
Host policy type, dynamic resolver, merge algorithm, or effective-capability
snapshot.

## Evidence reviewed

- `AGENTS.md`, `LOOP_TASK.md`, `LOOP_PLAN.md`, `CONTEXT.md`, applicable ADRs
  0001-0006, clean starting git state, recent item-10/item-12/item-13 logs,
  current capability map, and current Runtime/Server/Desktop source.
- `AgentDefinition`, compiler snapshots, `AgentRuntime.createSession()`,
  `AgentSession`, `ToolExecutionPolicy`, Session Store configuration and
  instruction snapshots, Desktop model/MCP/tool integration, and Server
  Session creation.
- Installed Pi `0.80.3` public types and loop implementation. Pi captures
  model context and tools at provider-call time; its between-step update can
  replace context, model, and thinking level, but not tools. `StreamFn` receives
  `SimpleStreamOptions`, whose credential-bearing headers/environment and
  callback/runtime fields are not safe snapshot data.
- Current Eve dynamic-capability documentation and source, OpenAI Agents JS
  Agent/tool source, and Pi upstream loop source, all inspected on 2026-07-18.
- Read-only Loopany inspection confirmed `Agent Studio Roadmap` remains paused,
  points at `loopany/agent-studio-roadmap/README.md`, and has only the three
  item-01-era outcomes already reflected in bounded memory. No schedule, goal,
  enabled state, or task-file configuration was changed.

## External market scan

Sources accessed 2026-07-18:

- Eve Dynamic Capabilities:
  https://eve.dev/docs/guides/dynamic-capabilities
- Eve dynamic instruction lifecycle:
  https://github.com/vercel/eve/blob/main/packages/eve/src/context/dynamic-instruction-lifecycle.ts
- OpenAI Agents JS Agent configuration/source:
  https://openai.github.io/openai-agents-js/guides/agents/
  and
  https://github.com/openai/openai-agents-js/blob/main/packages/agents-core/src/agent.ts
- Pi Agent loop:
  https://github.com/badlogic/pi-mono/blob/main/packages/agent/src/agent-loop.ts

Eve establishes event-scoped dynamic resolution as table stakes: model
selection has session/turn/step precedence and fallback, while dynamic tools
can replace authored tools and the tool loop reads the current set before each
model call. OpenAI Agents JS resolves enabled function tools from `RunContext`
and fetches MCP tools for a Run, but keeps model settings and MCP lifecycle in
the Agent/Host configuration. Pi owns the provider/tool loop and accepts only
model/thinking/context updates between its internal turns.

The true LLM Space gap is not merely dynamic callbacks. It is a fail-closed,
inspectable intersection between portable authored maxima, a Host's current
policy, and a Turn resolver, persisted without secrets and held immutable for
all Pi calls in that Turn. Eve's override and step-level behavior cannot be
copied because it permits authority and capability changes that item 14
explicitly excludes. None of the sources decides LLM Space's policy shape,
failure/fallback rules, connection ownership, or safe stream-option schema.

## Capability-map freshness

- `Agent Definition And Runtime`: confirmed from current source; it has one
  static model/reasoning definition and Host session overrides, not authored
  dynamic maxima.
- `Composable Static And Dynamic Instructions`: confirmed shipped V1; its
  immutable per-Turn Session Store snapshot is the reusable persistence seam.
- `Trusted Session Context And Structured State`: confirmed; automatic
  resolvers can read verified context and state, while manual mode skips state.
- `Dynamic Capability Snapshots`: added as confirmed blocked before V1.

## Product north-star metric

- Name: capability-snapshot policy fidelity.
- Why it matters: a dynamic Agent is safe and reproducible only if every
  provider/tool action can be attributed to one exact effective capability set
  that never exceeds portable source or Host authority.
- Baseline: 0%; there is no authored maximum/Host policy intersection or
  immutable effective-capability snapshot.
- V1 target after approval: 100% of maintained policy-matrix fixtures resolve
  exactly once per Turn, remain within both policy layers, persist one
  integrity-checked secret-free snapshot, and feed the same model, tool set,
  connections, and safe stream options to every Pi provider call in that Turn.
- Measurement: exhaustive authored-max × Host-policy × resolver fixtures,
  denial/fallback cases, snapshot integrity/restart tests, Pi multi-step
  assertions, Desktop/Server integration, full non-packaging gates, and final
  Standards/Spec review.
- Guardrails: no credential/header/environment values in snapshots; no tool or
  connection activation beyond both policies; no step-scoped mutation,
  runtime discovery/plugin/path loading, permission escalation, Pi protocol
  fork, automatic operation retry, packaging, signing, notarization, or
  release command.

## Candidate product opportunities

1. Main recommendation: define a versioned authored capability envelope and a
   separate Host policy envelope; use Eve-shaped `turn.started` resolvers only
   to select values inside their intersection, then persist one secret-free
   effective snapshot before Pi runs.
2. Alternative: follow Eve literally and let dynamic resolvers create/replace
   models and tools at session/turn/step scope. Rejected because it violates
   item 14's authored-maximum, immutable-Turn, and no-escalation boundaries.
3. Alternative: keep dynamic choice entirely Host-owned and snapshot the
   existing `createSession()` overrides. Deferred because it is safer but does
   not give portable Agent source the requested trusted per-Turn behavior or a
   declared maximum contract.

## Main recommendation

Use three explicit layers: a portable source-owned maximum, a Host-owned
policy, and a confined Turn resolver. Resolution must be monotonic: it may
only choose or narrow, never introduce a model, tool, connection, or option.
The resulting snapshot should be a distinct Session Store record linked to the
Turn and Agent fingerprint, with names/selectors and normalized non-secret
option values only. Runtime objects, tool callbacks, connection credentials,
headers, environment values, and stream functions remain Host/runtime-owned.

This is the smallest design that meets the roadmap's fidelity metric while
reusing item 13's durable Turn seam and keeping Pi's loop authoritative. It
cannot be implemented until the owner fixes what source is allowed to declare,
what the Host can constrain, how failures/fallbacks behave, and which stream
options are safe policy data.

## V1 capability definition and explicit non-goals

After approval, each automatic Turn resolves one effective model/reasoning
choice, active authored tools, active authored connections and their exposed
tool identities, and an allowlisted set of safe stream values from verified
context/read-only state. The Runtime validates the result against authored and
Host envelopes, records one immutable integrity-checked snapshot, and uses it
unchanged through every Pi model/tool step and restart continuation.

Explicit non-goals: session- or step-scoped capability changes, resolver-
created tools/models/connections, dynamic schemas or code, runtime plugin
install/discovery, arbitrary imports or paths, credentials/secrets in source
or snapshots, automatic retry/fallback not explicitly approved, connection
lifecycle redesign, public plugin SDK, policy UI, or Sandbox/ExecutionEnv work.

## Acceptance and audit plan

The future acceptance matrix must cover allowed and denied model choices,
reasoning, empty/subset/conflicting tools and connections, unavailable models,
MCP schema drift, resolver errors, Host policy tightening, unsafe/unknown stream
keys, bounds, secret exclusion, fingerprint tampering, CAS conflicts, multi-
step Pi stability, Desktop reopen, Server restart, manual mode, and artifact
drift. Focused tests, six TypeScript projects, touched and full lint, Runtime
browser/Bun and Server Bun bundles, renderer-only Vite, `git diff --check`, and
two-axis review are required. No UI is proposed, so CEF/product-design audit is
not applicable.

## Implementation plan and approval status

1. Resolve the design branches one at a time and record the accepted source,
   Host authority, persistence, failure, and safe-option contract in an ADR.
2. Add deterministic compiled authored maxima and a typed Host policy contract.
3. Add confined Eve-shaped `turn.started` resolution plus a pure fail-closed
   intersection/validation function.
4. Add a separate integrity-checked Session Store capability snapshot and
   reuse it across Pi steps, Desktop reopen, and Server restart.
5. Bind model/tools/connections/safe stream options to that snapshot, then run
   the complete non-packaging acceptance and review gates.

Approval status: blocked before implementation. The roadmap outcome is
pre-approved, but current contracts do not decide:

1. whether authored maxima live inline in `agent.ts`, in capability-specific
   source slots, or in one separate policy file;
2. the model allowlist/fallback and unavailable-model behavior;
3. the exact tool/connection maximum and whether dynamic choice selects only
   existing compiled names or may also choose connection-exposed operations;
4. the Host policy representation and whether Desktop Thread overrides are
   policy, requested choices, or both;
5. the allowlisted stream-option keys, numeric bounds, and normalization rules;
6. failure behavior for resolver errors, policy conflicts, MCP schema drift,
   and Host policy changes after a snapshot exists;
7. whether manual debugging records a capability snapshot even though it skips
   state scope, and how it treats editable Thread overrides.

## `$grill-me` requirements discussion

Invoked because these branches change portable source, security, permission,
Host authority, and Session Store persistence. Codebase facts were resolved
locally. Per the one-question-at-a-time contract, the first owner decision is
pending: choose the portable authored source shape before the dependent Host
policy, fallback, and snapshot choices are resolved. No product implementation
may begin until the full decision tree and consolidated plan are approved.

## Work performed

- Reconciled item 14 against current Runtime, compiler, Session Store,
  Desktop/Server Host integrations, Pi semantics, and current market evidence.
- Added the confirmed dynamic-capability contract blocker to the capability
  map, roadmap, and bounded executor memory.
- Performed no product-code, Loopany, packaging, signing, notarization, or
  release change.

## Verification and review

Documentation-only diff review, `git diff --check`, and repository status
inspection passed. The diff keeps item 14 unchecked, records the blocker in
bounded roadmap memory, and adds only current capability evidence. Product
tests, TypeScript, lint, and build checks are not applicable because no product
code, schema, or executable contract changed.

## Follow-up product bets

- Item 10 can consume the accepted capability snapshot through
  `available_skills` only after item 14 ships.
- Later governance/policy UI may expose Host policy, but it is not part of this
  Runtime contract loop.

## Outcome

Item 14 is blocked before implementation by unresolved source, authority,
security, and persistence decisions. The item remains unchecked and this pass
stops without starting item 15.
