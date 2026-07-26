# Packaged Agent Bundle Compiler Prerequisite

- Status: completed
- Outcome: packaged Agent bundle compiler prerequisite shipped locally
- Roadmap context: prerequisite to Item 22
- Date: 2026-07-26

## Trigger and starting state

The owner asked to continue `LOOP_PLAN.md`. `develop` started clean and matched
`origin/develop` at `d7bcd66cd06fbade14e937303a0bd4c8c879b323`, immediately
after Session Token Budget V1 shipped.

The intended next roadmap item was General Limits V2. Discovery and real
Desktop inspection were authorized; product-code changes were not made because
the evidence exposed a prerequisite regression that changes the correct plan.

## Product stage and evidence reviewed

The product remains in development, but current data must not be cleared or
silently substituted. Reviewed `AGENTS.md`, `CLAUDE.md`, README, `LOOP_PLAN.md`,
the current capability map, the complete Item 21 log, ADR 0014, Runtime limit
types, durable Run/operation/session boundaries, Desktop Agent activation and
streaming, Server capacity, Electrobun build resources, and the Runtime Agent
bundle compiler.

Fresh CEF evidence is under
`audits/2026-07-26-103139-general-limits-v2-discovery/`:

- the ordinary Thread has no generic limit surface and no visible overflow;
- `apps/example-agent` becomes `invalid` in the real packaged dev app;
- Bun RPC reports a missing packaged
  `Resources/app/bun/validate-authored-source.ts`;
- `Resources/app/bun/` contains `index.js` and the native addon, while
  `createAgentProjectBundle()` derives three compiler helper source paths from
  its rebased `import.meta.url`;
- source-level compiler tests pass because those files exist in the repository.

This is a packaged-runtime boundary regression introduced by durable frozen
Agent bundle persistence. It blocks every Desktop Agent Project before an Item
22 Agent limit can be rendered or executed.

## External market scan

Primary sources accessed 2026-07-26:

- OpenAI Agents JS running agents and source:
  https://openai.github.io/openai-agents-js/guides/running-agents/
  and https://github.com/openai/openai-agents-js/blob/main/packages/agents-core/src/run.ts
- Pydantic AI usage limits:
  https://ai.pydantic.dev/api/usage/
- Claude Agent SDK TypeScript:
  https://platform.claude.com/docs/en/agent-sdk/typescript
- Vercel AI SDK loop control:
  https://ai-sdk.dev/docs/agents/loop-control
- LangGraph recursion limit:
  https://docs.langchain.com/oss/javascript/langgraph/errors/GRAPH_RECURSION_LIMIT
- Eve Agent config at fixed current main
  `05f348023d4268c974c225c1189a283ace20b742`:
  https://github.com/vercel/eve/blob/05f348023d4268c974c225c1189a283ace20b742/docs/agent-config.md#L122-L168

Table stakes are per-run loop fuses: OpenAI has `maxTurns`, Pydantic provides
request/tool/token limits, Claude exposes turns and USD budget, AI SDK composes
stop conditions, and LangGraph caps recursive steps. Most fail or stop a run;
Eve's durable human continuation is specific to Session tokens. The true future
LLM Space gap is a small, attributable per-Run safety policy, not one UI that
conflates Host concurrency, schedules, and child inheritance.

That new functionality is deferred by stronger local evidence: the current
packaged Desktop cannot activate an Agent at all. Market parity does not
justify building Item 22 on a broken execution surface.

## Capability-map freshness

- `Agent Project Activation`: confirmed regression from current CEF and Bun RPC;
  changed from shipped to packaged-Desktop blocked.
- `Agent Session Token Budgets`: Runtime/Server remain shipped, but current
  Desktop interaction is blocked by Agent activation.
- Added `General Runtime Limits`: confirmed missing from current UI/code, with
  the Item 22 scope conflict recorded.
- No unknown product boundary drives this recommendation.

## Product north-star metric

Name: **packaged Agent activation integrity**.

Why it matters: LLM Space cannot debug or constrain an Agent if the same
trusted project that passes source tests cannot compile and open in the shipped
Desktop runtime.

Baseline: zero successful packaged CEF activations for the checked-in example
after frozen-snapshot persistence; both workspace discovery and explicit open
show `invalid`.

Target: the checked-in example opens `ready`, creates/opens its Project Thread,
and persists a closed frozen Agent snapshot from the packaged Bun process. A
source A wait remains recoverable after sync to B and Desktop restart. No
compiler step references repository-only or unshipped `.ts` paths.

Measurement: one packaged-runtime acceptance invokes Agent open through real
Electrobun RPC; CEF verifies ready Build/Thread state; deterministic source and
packaged compiler tests compare artifact/bundle bytes; the existing A→B frozen
snapshot restart regression remains green.

Guardrails: retain source import confinement, dynamic-tool transformation,
closed deterministic bundles, fingerprint verification, Bun-only executable
bytes, fail-closed restoration, user data, Sandbox/approval/budget semantics,
app size discipline, lint/typecheck/tests/Vite, clean console, and zero page
overflow. Do not ship a hidden dependency on repository source or an entire
development `node_modules` tree.

## Candidate product opportunities

### Main recommendation: package-self-contained Agent bundle compiler

Repair the boundary before Item 22. Build or embed an explicit closed compiler
support artifact that the packaged Bun process can locate without deriving
TypeScript paths from bundled `import.meta.url`. Keep Runtime/CLI source use and
Desktop packaged use behind one deep compiler interface, then add a packaged
Electrobun acceptance that opens the checked-in example and exercises frozen
snapshot persistence/restart.

Why now: this restores the core Agent build/debug workflow and preserves the
new durability guarantee. Every Agent-only roadmap item, including General
Limits, depends on it.

### Alternative 1: continue General Limits V2 now

Deferred because source-only tests could pass while the real Desktop remains
unable to open the Agent. It would add unverifiable product surface and compound
the packaging defect.

### Alternative 2: remove durable frozen snapshots or copy raw development dependencies

Removing frozen snapshots breaks the accepted same-Run restart contract.
Copying the repository Runtime source and broad `node_modules` tree into the app
would be a fragile size/security boundary. Either requires a new decision and
is inferior to one intentional closed support artifact.

## V1 capability definition

After the prerequisite fix:

- `createAgentProjectBundle()` has an explicit compiler-support boundary that
  works from repository source, CLI, tests, and packaged Desktop;
- packaged compilation preserves the exact authored-source validation,
  dynamic-tool transform, bundled project reconstruction, and closure checks;
- compiler-support identity/version is validated and included in deterministic
  acceptance evidence;
- Desktop keeps persisted bundles and artifact descriptors under its existing
  Bun-only project snapshot directory;
- missing or mismatched support fails with a concise Host diagnostic without
  clearing the Project, Thread, or prior snapshot;
- real `bun run dev:cef` activation of `apps/example-agent` reaches ready Build
  and Thread state, and restart restores a frozen snapshot.

Explicit non-goals: General Limits product fields/UI, schedules, Subagents,
public plugin SDK, runtime package downloads, network compilation, copying the
whole repository or development dependency tree, weakening import validation,
or migrating/clearing current project data.

## Acceptance and audit plan

- Add a top-level Runtime compiler test for an explicit closed support artifact
  and mismatch/missing failure.
- Add a Desktop packaged-context acceptance that detects repository-only source
  path dependencies and invokes the real RPC activation path.
- Preserve existing deterministic, source-edit-during-capture, invalid-import,
  frozen A→B restart, Sandbox, and Server tests.
- Run all package tests, eight TypeScript projects, lint, Vite, real Docker, and
  `git diff --check`; do not run Actions, signing, notarization, or release.
- Re-run real CEF at 1280×800 and 900×700, verifying ready Agent, Build/Thread,
  restart, console, accessibility text, and overflow.
- Update ADR 0014, capability map, roadmap evidence, and this decision record;
  perform fixed-point Standards/Spec review before commit and push.

## Implementation plan and approval status

Approval status: approved after `$grill-me`; implementation and local
acceptance are complete.

1. Runtime owns one explicit compiler-support boundary:
   `createAgentProjectBundle(agentRoot, { compilerSupportPath? })`. Source and
   CLI callers omit it; packaged Desktop passes it explicitly. There is no
   environment variable or path guessing.
2. Trace Electrobun's Bun bundle/resource path and select the smallest closed
   support artifact; stop for renewed approval if the only viable solution is
   shipping repository source or broad development dependencies.
3. Deepen the Runtime compiler interface so support is explicit rather than an
   `import.meta.url` accident; preserve one primary export per file.
4. Wire the packaged asset through the Desktop composition root and Electrobun
   copy/build boundary without renderer access.
5. Add top-level source and packaged-runtime tests, then execute the acceptance
   plan and real CEF audit.
6. Only after this passes, resume Item 22 discovery as a separate loop and
   narrow it to per-Run safety limits; do not mark Item 22 complete here.

Stop conditions: support bytes cannot be made closed/deterministic, authored
import validation would weaken, executable code would cross into the renderer,
the fix requires user-data reset, package size grows without an explicit
ceiling, or packaged acceptance cannot execute the actual Bun RPC path.

## `$grill-me` requirements discussion

Completed and approved. Runtime generates one closed, minified, sourcemap-free
`agent-bundle-compiler-support.mjs` plus a JSON sidecar containing
`schemaVersion`, SHA-256, and `byteLength`. Desktop generates it before dev and
build, copies it from `apps/desktop/.generated/agent-bundle-compiler/` to the
Bun-only `Resources/app/bun/support/` tree, validates the exact bytes before
execution, and injects its path through the composition root. Missing, stale,
or mismatched support fails Desktop startup before RPC/window creation without
marking an Agent invalid or clearing Projects, Threads, or snapshots.

Compiler source edits require a Desktop dev restart; asset HMR is not in scope.
There is no artifact size cap for this prerequisite, but acceptance records the
actual byte size. Required acceptance is automated source/support equivalence
and failure coverage plus real `bun run dev:cef` activation and frozen-snapshot
restart. Actions, signed/canary/stable packaging, signing, notarization,
release, General Limits, and UI changes remain out of scope.

## Work performed

Implemented one Runtime-owned compiler-support generator, sidecar validator,
shared build plugin, and optional explicit bundle API path. Source callers
freeze one generated support per process; Desktop generates the same bytes
before dev/build, copies them to the Bun-only support resource tree, validates
them before composition, and injects the path into Agent snapshot persistence.
No dependency, user-data migration/reset, UI, General Limits field, Actions,
signed/canary/stable package, signing, notarization, release, or paid-provider
call changed.

## Verification and product-design audit

Support generation is deterministic at 4,178,318 bytes with schema version 1
and SHA-256 `2eb3534f8fe991caf3e8b3c31c299745a50bfd7077b1434a18d225336e74df68`.
Automated acceptance covers byte-identical generation from two copied checkout
roots, absence of checkout/dependency paths, missing/schema/length/fingerprint
failure, a verified-byte swap attack, exact source/support bundle equality, all
authored Runtime SDK surfaces, import confinement, capture-time source edits,
and A-waits → sync-B → Desktop restart.

Real `bun run dev:cef` copied support beside packaged `index.js`, opened the
checked-in `apps/example-agent` through the actual renderer client and RPC as
`ready`, opened Build and the default Thread, wrote the Bun-only bundle and
artifact descriptor, and restored the same Thread plus
`20da7a921def052aa3dc203965c0531769e2d24a439acdf3773d2ce90ebcf866`
fingerprint after restart. 1280×800 and 900×700 checks had no body/document
overflow and no application console error. The legacy automatic workspace seed
remains independently invalid because it still emits a bare pre-canonical tool
object; it was not changed in this prerequisite.

## Review and remaining risks

The closed support adds 4.0 MiB to the Bun resource tree and deliberately has
no current size cap; its measured size is explicit acceptance evidence.
Runtime normalizes bundled TypeScript paths to a stable virtual identity and
executes only a private copy of the once-read verified bytes, closing checkout
location drift and the validation/import race. Compiler edits require a Desktop
restart, and a missing/mismatched asset fails startup. The automatic workspace
seed debt is separate. General Limits scope remains too broad and should be
split now that activation is restored.

## Follow-up product bets

- Resume Item 22 with deterministic per-Run model/tool operation limits.
- Keep parent-child tightening with Item 27 and schedules with Item 28.
- Consider provider-reported USD cost only after missing-cost disclosure and
  auxiliary-operation accounting are separately defined.

## Outcome

Package-self-contained Agent bundle compilation and packaged Desktop
activation are restored. Item 22 product work has not started.
