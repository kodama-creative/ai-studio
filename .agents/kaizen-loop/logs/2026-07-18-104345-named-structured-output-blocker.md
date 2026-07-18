# Named Structured Output Contracts V1 Blocker

- Status: done
- Outcome: blocked
- Roadmap item: 15

## Trigger

The owner asked to continue the next bounded roadmap pass after item 14. The
pass started from clean synchronized `develop` at `0e6ccd1` and selected the
lowest dependency-ready unchecked item. Item 10 remains blocked on 16/17 and
item 11 still lacks a real versioned schema evolution, so item 15 is next.

## Product context and evidence

Agent Studio already compiles deterministic artifacts, runs one Pi-backed
Runtime Harness in Desktop and Server, persists immutable Turn instruction and
capability snapshots, and exposes protected Pi event streaming plus one Runtime
terminal. It does not declare, select, validate, persist, or render structured
Agent results.

Evidence reviewed:

- `AGENTS.md`, `LOOP_TASK.md`, `LOOP_PLAN.md`, `CONTEXT.md`, README/package
  scripts, ADRs 0001, 0002, and 0007, the capability map, and the three most
  recent kaizen logs.
- Runtime authored definitions, compiler/artifact paths, Pi-backed
  `AgentSession`, Tool execution policy, Session Store, Runtime Run records,
  Desktop Thread/run schemas and reducer path, Server controller/repository,
  event serializer, protocol client, and typed RPC transport.
- Installed `@earendil-works/pi-ai` and `pi-agent-core` `0.80.3`, current Pi
  upstream `main`, Eve commit
  `c1b6ad3e485f2d15a25bdb5636209aa1367a3124`, and installed provider SDK
  contracts.

## External market scan

Sources accessed 2026-07-18:

- https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/types.ts
- https://github.com/badlogic/pi-mono/blob/main/packages/agent/src/types.ts
- https://eve.dev/docs/guides/client/output-schema
- https://github.com/vercel/eve/blob/c1b6ad3e485f2d15a25bdb5636209aa1367a3124/packages/eve/src/runtime/framework-tools/final-output.ts
- https://github.com/vercel/eve/blob/c1b6ad3e485f2d15a25bdb5636209aa1367a3124/packages/eve/src/harness/tool-loop.ts
- https://platform.openai.com/docs/guides/structured-outputs
- https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- https://ai.google.dev/gemini-api/docs/structured-output

Table stakes are schema-constrained generation, server-authoritative final
validation, explicit unsupported-model/provider behavior, a typed terminal
value for SDK consumers, and per-Turn scope. OpenAI, Anthropic, and Google have
provider-native response schema mechanisms. Eve chooses a portable framework
tool named `final_output`, intercepts its validated arguments, and emits
`result.completed`.

Pi exposes neither a structured-output stream option nor a structured-result
event in the pinned release or current main. Its existing portable structured
mechanism is schema-validated tool calling. Uncertainty is not whether the
capability is valuable; it is which authority and persistence contract LLM
Space should standardize without forking Pi's execution vocabulary.

Anthropic's public documentation redirected to a regional-unavailability page
from this environment; the installed official SDK `0.91.1` independently
confirms `output_config.format` JSON Schema support. Google and OpenAI public
pages were not text-extractable in this run; installed official SDK contracts
and their public guide URLs were used as supporting evidence.

## Capability-map freshness

- `Agent Definition And Runtime`: confirmed; no output definition or typed
  session result.
- `Independent Agent Serving`: confirmed; Pi events plus minimal
  `runTerminal`, text-only run request.
- `Run And Streaming`: confirmed; reduced messages and lifecycle outcomes, no
  structured terminal.
- `Dynamic Capability Snapshots`: confirmed; the existing immutable Turn seam
  can eventually bind a selected named contract but does not own one today.
- Added `Named Structured Output Contracts` as confirmed missing and
  decision-blocked.

## Product north-star metric

- Name: schema-valid completion rate on supported providers.
- Why: a typed Agent result is useful only when callers can trust that the
  selected authored contract, generated value, persisted value, and SDK value
  are identical.
- Baseline: 0%; no maintained fixture can declare or select a named output
  contract.
- V1 target: 100% of maintained supported-provider fixtures either complete
  with one schema-valid typed value identical across Runtime, Thread, restart,
  Server replay, and client consumption, or fail with the approved precise
  unsupported/invalid/missing terminal.
- Measurement: compiler/artifact determinism tests, schema corpus fixtures,
  Pi provider/tool mapping fixtures, Desktop/Server parity and restart tests,
  typed client checks, and one real supported-provider smoke when credentials
  are available.
- Guardrails: Pi retains provider/tool iteration and `AgentEvent`; no arbitrary
  caller schema, secret-bearing result metadata, unbounded repair, silent
  provider fallback, transcript corruption, packaging, signing, notarization,
  or release command.

## Candidate opportunities

1. Main recommendation: use Eve's `final_output` framework-tool method through
   Pi's existing tool-call protocol, but keep LLM Space's named authored
   contract ceiling and existing Pi event vocabulary. Put the validated typed
   value on an approved existing Runtime/Server terminal and durable Run
   record rather than inventing Eve's `result.completed` event.
2. Provider-native response formats first: potentially stronger enforcement,
   but Pi does not expose them and a Host `onPayload` patch layer would become
   a provider-specific fork with unclear support and fallback semantics.
3. Parse final assistant JSON text: simplest transport shape, but weaker than
   tool/schema generation, conflates prose with typed output, and creates a
   repair/parser protocol outside Pi.

## Main recommendation and why now

The Eve-shaped framework tool best matches the owner's prior direction to
reuse Eve behavior and the existing requirement to keep Pi's message protocol.
Pi already carries typed tool arguments and tool results through Desktop and
Server serializers. The Runtime can reserve one internal tool name, validate
the final arguments, terminate the Pi tool batch, and derive the typed outcome
without another provider loop.

This is only a recommendation, not approval. Eve permits caller-supplied
schemas and emits its own event; both conflict with current LLM Space
boundaries. The exact authored source and durable terminal contracts remain
material product/architecture decisions.

## Proposed V1 capability definition

After approval, an Agent Project declares a bounded set of named JSON output
contracts. A Project Thread or protected Channel request selects only one of
those names for one Turn. Runtime includes the selected contract in immutable
Run/Turn identity, exposes a reserved Pi-visible final-output tool, validates
the exact JSON result once under a finite failure policy, and makes the same
typed value available after Desktop/Server restart and replay.

Explicit non-goals remain caller-supplied schemas, schema-generated forms,
provider-specific public options, hidden metadata, an independent output
event vocabulary, and unlimited automatic repair.

## Acceptance and audit plan

- Compiler/source/bundle tests for deterministic names, schema identity,
  collisions, invalid schemas, and artifact drift.
- Runtime fixtures for valid, invalid, missing, duplicate, mixed-tool, manual,
  abort, restart, and finite-repair behavior while Pi remains the loop.
- Desktop Direct and Local Server parity for selection, result display,
  durable Run History, reopen/replay, and typed client extraction.
- Unsupported provider/model behavior must fail before paid inference or with
  the exact approved terminal, never silently downgrade.
- The concrete Thread interaction must be approved before UI code, then
  verified in real Electrobun CEF with product-design audit, keyboard/focus,
  narrow viewport, persistence, and console checks.
- TypeScript, lint, focused/full tests, browser/Bun bundles, renderer-only Vite,
  diff review, and Standards/Spec review; no Electrobun packaging.

## Implementation plan and approval status

Not approved. Once the design is resolved:

1. Record an ADR covering authored contract shape, protocol/terminal ownership,
   failure/repair semantics, persistence, and UI/Channel selection.
2. Compile named schemas into artifact identity and validate exact Host
   selection before Pi execution.
3. Add the approved Pi/provider adapter and schema validator without a second
   loop or public message vocabulary.
4. Persist the selected contract and typed terminal atomically across Runtime,
   Thread, and Server, then expose it through the browser-safe client.
5. Add the approved Thread selector/result interaction and complete the audit
   and validation matrix.

Stop conditions are any Pi behavior that requires a custom ReAct loop,
unbounded retry, silent provider downgrade, ambiguous transcript ownership,
or an unapproved source/protocol/schema migration.

## `$grill-me` requirements discussion

Not started because the discovery pass found a material architecture and
persistence blocker. The first owner decision is whether to approve the main
execution/protocol direction: Eve-style intercepted `final_output` through Pi
tool calls, no Eve `result.completed` event, with the typed value attached to
the existing Runtime/Server terminal and durable Run authority.

Further one-question-at-a-time decisions would then resolve source layout,
schema dialect, defaults/selection, provider support, finite failure behavior,
manual mode, result visibility, and migration/versioning.

## Work performed

No product code was changed. The roadmap, executor memory, and capability map
were updated with the confirmed blocker and evidence. Loopany schedule, goal,
enabled state, and task file were not modified.

## Verification and review

- Current source, installed dependencies, Pi upstream, Eve source, and provider
  SDKs were inspected read-only.
- No rendered-product audit was run because no structured-output UI exists and
  this pass made no UI change.
- Documentation diff review and `git diff --check` are required before commit.
- Product tests, TypeScript, lint, and builds are not applicable to this
  documentation-only stopped pass.

## Remaining risks and follow-up bets

Using the final-output tool must reserve collision behavior, avoid exposing it
as an ordinary user tool, and define what happens if a model mixes it with
other tool calls. Native provider schemas may later become an optimization only
if Pi exposes a stable portable capability contract; they must not silently
change correctness. Item 29 will consume these contracts for portable Evals,
and item 11 may become eligible only after a real versioned source/artifact
schema evolution is deliberately introduced.

## Outcome

Blocked before implementation on a new architecture/protocol/persistence
decision. Ended the pass without starting another roadmap item.
