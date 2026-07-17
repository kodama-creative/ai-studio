# Composable Turn Instructions V1

- Status: done
- Outcome: completed
- Roadmap item: 13

## Trigger

The owner asked to continue the roadmap after item 12 was completed and pushed
at `fed4e81`. The pass started from a clean synchronized `develop`. Item 10
remains dependency-blocked. Item 11 still lacks its declared prerequisite—a
real source/artifact schema evolution and maintained old fixture—so item 13 is
the lowest dependency-ready item.

## Product stage and context

LLM Space now has deterministic Agent artifacts, Host-verified Session/Turn
context, durable typed Session state, protected Server Sessions, and Desktop
Project Thread Session Store handoff. Agent instructions remain one required
root Markdown string compiled into the artifact and reused unchanged. Authors
cannot split standing rules by concern or resolve trusted per-Turn identity,
channel, tenant, or state into an inspectable prompt snapshot.

## Evidence reviewed

- `AGENTS.md`, `LOOP_TASK.md`, `LOOP_PLAN.md`, `CONTEXT.md`, applicable ADRs
  0001-0004 and 0006, clean starting git status, recent item-09/item-10/item-12
  logs, current capability map, and Runtime/Server/Desktop source.
- Pi Agent `0.80.3` public types and implementation: `AgentState.systemPrompt`
  is captured into the context sent to `runAgentLoop`; its current
  `prepareNextTurnWithContext` can replace context between model steps, so one
  resolved system prompt can remain stable for the whole Runtime Turn without
  inventing a message protocol.
- Existing Eve instruction/state research plus current Eve main source and
  docs inspected on 2026-07-18.
- Current OpenAI Agents JS agent documentation inspected on 2026-07-18.

## External market scan

Sources, accessed 2026-07-18:

- Eve Instructions: https://eve.dev/docs/instructions
- Eve compiler/lifecycle source:
  https://github.com/vercel/eve/blob/main/packages/eve/src/compiler/normalize-instructions.ts
  and
  https://github.com/vercel/eve/blob/main/packages/eve/src/context/dynamic-instruction-lifecycle.ts
- OpenAI Agents JS Agents:
  https://openai.github.io/openai-agents-js/guides/agents/

Eve treats root instructions plus a flat filename-ordered directory as one
always-on prompt. Static TypeScript resolves at build time; dynamic instruction
entries resolve at Session/Turn boundaries, remain stable across tool/model
steps, and stay outside conversation history. OpenAI Agents JS likewise accepts
sync/async instruction functions over `RunContext`.

Table stakes are composable static source, trusted runtime context, stable
per-Run resolution, and no transcript injection. The LLM Space opportunity is
stronger explainability and authority: exact source provenance and fingerprint,
Host-verified context plus read-only typed Session state, one immutable Turn
snapshot passed through Pi, and Host-owned Session Store recording.

Uncertainty: neither product defines LLM Space's source/artifact identity,
Desktop authority handoff, failure policy, or durable snapshot schema. Eve uses
`localeCompare`; LLM Space uses code-point ordering for cross-environment
determinism.

## Capability-map freshness

- `Agent Definition And Runtime`: confirmed; one required root
  `instructions.md` compiles into one opaque string.
- `Trusted Session Context And Structured State`: confirmed shipped V1;
  verified context and typed Session state are available at Runtime boundaries.
- `Run And Streaming` / `Runtime Recovery And Replay`: confirmed; Runtime Runs
  and Session Store snapshots provide the existing Turn durability seam.
- `Composable Static And Dynamic Instructions`: absent before V1 and to be
  added during this loop.

## Product north-star metric

- Name: deterministic, explainable instruction snapshots.
- Why it matters: trusted context only becomes useful for Agent behavior when
  the exact prompt sent to Pi is reproducible, attributable, and stable for the
  full Turn.
- Baseline: 0%; only one root Markdown string exists, with no entry provenance,
  dynamic resolution, Turn snapshot, or reload reuse.
- V1 target: 100% of the maintained fixture matrix produces the exact same
  ordered source/bundle snapshot; context/state changes affect only the next
  Turn; reload/manual continuation reuses the recorded bytes; every Pi provider
  call observes the recorded fingerprint's exact prompt.
- Measurement: discovery/compiler/bundle/artifact tests, Runtime state/context
  resolver and Pi-stream assertions, Session Store/recovery fixtures,
  Server/Desktop integration, example Agent conformance, full repository gates,
  and final Standards/Spec review.
- Guardrails: no instruction text in transcript or Pi events; no resolver tool
  execution or authority expansion; state is read-only; no source/runtime secret
  copy; unchanged manual tool semantics; no packaging/signing/notarization or
  release commands.

## Candidate product opportunities

1. Main recommendation: Eve-shaped composable source with build-time static
   entries and trusted `turn.started` dynamic entries, frozen into one
   provenance-rich Runtime instruction snapshot used by Pi.
2. Alternative: static directory composition only. Deferred because it does
   not satisfy item 13 or unblock trusted variables in item 10.
3. Alternative: inject dynamic instructions as system/custom transcript
   messages. Rejected because it confuses prompt configuration with durable
   conversation history and leaks internal context into events/inspection.

## V1 capability definition

- Keep required root `instructions.md` first.
- Add flat non-recursive `instructions/` entries in code-point filename order.
- Support `.md`, build-time `defineInstructions({ markdown })`, and Eve-shaped
  `defineDynamic({ events: { "turn.started": ... } })` TypeScript entries.
- Give dynamic resolvers immutable verified context and read-only access through
  imported state handles; accept only branded instruction output or null.
- Resolve once before the first provider call, record exact ordered entries,
  combined Markdown, and SHA-256 fingerprint for the Turn, and reuse it across
  Pi tool/model steps and continuation/reload.
- Block resolver/source/snapshot mismatch before provider execution.

Explicit non-goals: Session-scoped resolvers, step-scoped prompt mutation,
arbitrary caller-supplied instructions, variable declarations/providers,
dynamic model/tools/connections/stream options, hooks, UI editor/preview,
instruction migration, template language, remote prompt registry, or executing
tools from instructions.

## Acceptance and audit plan

- Discovery/compiler: root-first and code-point directory order, flat regular
  files only, symlink/nested/duplicate source rejection, static TS capture,
  dynamic export validation, deterministic artifact/bundle parity.
- Runtime: immutable context, read-only state, resolver failure before provider,
  exact snapshot/fingerprint, same prompt across all Pi steps, new resolution
  only for a new Turn, no transcript/event leakage.
- Persistence/Hosts: Session Store records one immutable Turn snapshot; Server
  restart and Desktop Project Thread handoff reuse exact bytes.
- Run focused/full Bun tests, six TypeScript projects, root lint, Runtime
  browser/Bun and Server Bun bundles, renderer-only Vite, diff check, and
  Standards/Spec review.
- No UI changes are planned, so CEF/product-design audit is not applicable.

## Implementation plan and approval status

The roadmap item and its existing ADR/research boundaries are pre-approved by
the owner's request to continue. No new grill is required because the source
shape follows the previously requested Eve method and no authority/data owner
changes.

1. Add public static/dynamic instruction definitions and discovery/compiler
   support for ordered entries.
2. Carry static/dynamic provenance through snapshots, artifact identity, and
   closed bundles.
3. Add read-only Runtime resolution and one immutable Turn instruction
   snapshot applied through Pi.
4. Record/reuse the snapshot through Session Store and existing Server/Desktop
   authority adapters.
5. Update docs/capability/roadmap evidence and run all non-packaging gates.

## `$grill-me` requirements discussion

Not invoked. LOOP_TASK limits it to newly discovered design branches; this V1
uses the accepted roadmap boundary and previously researched Eve method.

## Work performed

- Added the public `@llm-space/runtime/instructions` authoring surface with
  separate `defineInstructions()` and Eve-shaped `defineDynamic()` factories.
- Added required-root-first, flat code-point-ordered `.md`/`.ts`/`.js`
  discovery, diagnostics, source/dependency fingerprinting, deterministic
  static composition, executable dynamic snapshots, and source/closed-bundle
  parity checks.
- Confined instruction code and its allowed state graph before execution:
  tools, connections, Node/package imports, dynamic import/require,
  Host/runtime globals, `import.meta`, and source outside `state/` are rejected.
  The same policy is applied independently to the separate bundle-root copy.
- Added frozen verified context plus automatic read-only state resolution,
  manual no-state-scope behavior, branded output validation, and fail-before-
  provider semantics. Dynamic projects require a Session Store.
- Added one shared canonical snapshot derivation for ordered entries, exact
  Markdown, and SHA-256. Session Store load/commit recomputes integrity, keeps
  the snapshot immutable per Turn, preserves CAS, journals the commit, and
  excludes it from Run replay.
- Applied the recorded Markdown through Pi `systemPrompt` for every provider
  call in the Turn, with no transcript/Pi-event injection. Reload/continue,
  Desktop Project Threads, and protected Server restart reuse the exact stored
  snapshot; edited Desktop prompt copies remain explicitly Host-owned.
- Consolidated Session Store commit publication into one
  `onSessionCommitted` callback, updated Runtime/Server documentation,
  capability evidence, example artifact expectations, and roadmap state.
- Did not change Loopany schedule, goal, enabled state, or task-file settings.
  The local `loopany` command was unavailable for read-only status inspection.
  No Electrobun packaging, signing, notarization, canary/stable, pack, or
  release command ran.

## Verification

- Final focused matrix: 70 Runtime/compiler/Session Store/Desktop tests passed;
  the Server principal/tenant/state/restart instruction test and canonical
  example test also passed independently.
- Full `bun test`: 268 tests, 267 passed, 1070 assertions. The sole failure is
  the pre-existing fixed-point Server timeout
  `aborts explicitly while observation disconnect remains passive`.
- Runtime, Server, Desktop, Core, CLI, and example TypeScript checks passed.
  Root lint passed.
- Runtime root/client/harness browser bundles, Runtime/Server Bun bundles, and
  renderer-only Vite passed. Vite retained only its existing large-chunk
  advisory. No UI changed, so CEF/product-design audit was not applicable.
- Final Standards review and Spec review both returned clear pass after their
  findings drove factory splitting, one Session commit callback, shared
  snapshot derivation, import/authority confinement, bundle-root validation,
  and persisted snapshot integrity verification.

## Review and remaining risks

- No remaining Standards or Spec findings.
- Instruction source validation is a bounded trusted-source contract, not a
  replacement for the later ExecutionEnv/Sandbox capability. Hostile-code
  isolation remains item 17; V1 prevents declared imports, common runtime
  escape hatches, and direct tool/policy bypass inside the approved boundary.
- The unrelated Server shutdown timeout remains repository debt and was
  reproduced unchanged from the fixed point.

## Follow-up product bets

- Item 14 can generalize the same Turn snapshot pattern to model, tools,
  connections, and stream options within authored maximums.
- Item 10 can later lower trusted variables into these dynamic instruction
  sources without copying Thread/session values.

## Outcome

Item 13 completed. The deterministic, explainable instruction-snapshot target
is met across source, closed bundle, Runtime/Pi, Session Store, Desktop, and
Server evidence. This pass stops here without starting item 14.
