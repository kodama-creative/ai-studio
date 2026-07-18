# Named Structured Output Contracts V1

- Status: done
- Outcome: completed
- Roadmap item: 15

## Trigger and context

The owner approved the item-15 blocker recommendation and completed a
one-question-at-a-time `$grill-me` design discussion after commit `5dbccad`.
Implementation starts from clean synchronized `develop`. ADR 0008 records the
approved authored, Pi protocol, failure, persistence, Server/client, and Studio
interaction contract.

## Evidence and market scan

Evidence carries forward from the item-15 blocker log: current Runtime,
Desktop, Server, Pi `0.80.3` and upstream, Eve structured-output source/docs,
and the installed OpenAI, Anthropic, and Google SDK contracts. Eve's
`final_output` technique is reused while its caller-supplied schema and custom
`result.completed` protocol are not.

Sources accessed 2026-07-18:

- https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/types.ts
- https://github.com/badlogic/pi-mono/blob/main/packages/agent/src/types.ts
- https://eve.dev/docs/guides/client/output-schema
- https://github.com/vercel/eve/blob/c1b6ad3e485f2d15a25bdb5636209aa1367a3124/packages/eve/src/runtime/framework-tools/final-output.ts
- https://github.com/vercel/eve/blob/c1b6ad3e485f2d15a25bdb5636209aa1367a3124/packages/eve/src/harness/tool-loop.ts
- https://platform.openai.com/docs/guides/structured-outputs
- https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- https://ai.google.dev/gemini-api/docs/structured-output

## Capability-map freshness

`Named Structured Output Contracts` is confirmed shipped as V1.
`Agent Definition And Runtime`, `Run And Streaming`, `Dynamic Capability
Snapshots`, and `Independent Agent Serving` are confirmed reusable seams.

## Product north-star metric

- Name: schema-valid completion rate on supported fixtures.
- Baseline: 0%; no maintained fixture declares or selects a named output.
- Target: 100% of maintained fixtures either complete with one identical
  schema-valid typed value across Runtime, Thread, restart, Server replay, and
  client consumption, or produce the exact approved terminal failure.
- Measurement: compiler/artifact, Runtime/Pi, Session Store, Desktop Direct,
  Local Server, browser client, persistence/replay, and real CEF fixtures.
- Guardrails: Pi retains provider/tool iteration and `AgentEvent`; no caller
  schema, second loop/event vocabulary, automatic repair, silent fallback,
  transcript corruption, secret-bearing result, packaging, signing,
  notarization, or release command.

## Recommendation, alternatives, and approved V1

The approved main recommendation is an exclusive internal `final_output` Pi
tool backed by source-declared TypeBox contracts and the existing durable Run
terminal. Provider-native response formats remain deferred because Pi exposes
no stable portable contract; parsing assistant JSON remains rejected because
it weakens generation and invents a fallback protocol.

ADR 0008 is the complete V1 definition and non-goal boundary.

## Approval and `$grill-me`

Approved. The owner resolved source layout, schema dialect, selection/default
scope, transcript versus terminal authority, zero repair, exclusivity,
reserved-name collision, manual behavior, model prerequisites, Host size
limits, Studio placement/result card, Local Server editability, additive
protocol compatibility, client generics, and provider schema normalization.

## Implementation and acceptance plan

1. Compile deterministic named output definitions into source, artifact, and
   schema identity.
2. Add immutable selection, exclusive Pi terminal-tool behavior, exact
   validation/size/failure semantics, and atomic durable terminal result.
3. Extend Server and browser client additively.
4. Persist and render Thread selection/results in Desktop Direct and Local
   Server without exposing internal tool mechanics.
5. Run focused/full Bun tests, every relevant TypeScript project, lint,
   non-packaging browser/Bun bundles, renderer-only Vite, diff review, real CEF
   product audit, capability/roadmap updates, and final Standards/Spec review.

## Work performed

Added public `@llm-space/runtime/outputs` authoring with filename-owned flat
discovery, TypeBox compilation, canonical schema fingerprints, and strict
rejection of nested, symbolic, non-regular, unsupported, duplicate, invalid,
extended, or reserved sources. Output definitions now survive immutable
snapshots, inspectable artifact capability/schema identity, and executable
closed bundles.

Runtime now injects one internal sequential `final_output` Pi tool only for a
selected compiled name. Raw arguments are checked before Pi coercion; duplicate
or mixed batches are blocked for every sibling before execution; manual mode
automatically executes only this internal terminal tool. Valid JSON terminates
with the original Pi assistant/tool-result evidence retained. Invalid, missing,
and oversized values fail once with the three approved codes and no repair,
retry, prose parsing, downgrade, compatibility probe, or provider fork. Host
size authority defaults to 256 KiB and is bounded to 1–768 KiB.

Run configuration now binds contract name, schema fingerprint, and effective
size limit. The completed Runtime Run atomically stores the exact JSON value;
Session Store mutation and hydration validate JSON shape, configured identity,
size, completion, and missing-result invariants. Review found and fixed a stale
Turn bug so a later Text Run can never reuse a prior structured result.

Protected Server Run creation accepts only an optional declared name and keeps
legacy text-only idempotency identity compatible. Server execution, repository
terminal persistence, SSE replay, and the browser-safe generic client expose
the same typed value through the existing schema-version-1 `runTerminal`; Pi
events remain unchanged.

Agent Project Threads persist optional selection and forward only its name in
Desktop Direct and Local Server profiles. The Output selector sits between
Tools and Variables with Text plus compiled names and a read-only schema view.
The reserved tool is hidden behind one memoized structured-output card with
pretty JSON, copy, collapse, fingerprint, and stable failure copy; the same
card appears in live messages and Run History. Standalone Threads have no
Output row, and selection is locked while running.

Repository architecture guidance, ADR 0008, the capability map, roadmap item,
and bounded executor memory were refreshed. Loopany schedule, goal, enabled
state, and task-file configuration were not changed.

## Verification and product-design audit

- Focused closure verification passes 84 compiler/Runtime/Core/Desktop/Server/
  client checks. It covers valid, missing, invalid, oversized, mixed, duplicate,
  manual, collision, idempotency, atomic persistence, stale-prior-result,
  output-selection branching, generic typing, and a real Server stop/restart
  whose replayed terminal equals the original terminal exactly.
- Full `bun test` runs 299 tests: 298 pass with 1166 expectations. The only
  failure is the unchanged fixed-point Server test
  `aborts explicitly while observation disconnect remains passive`, whose hook
  times out after 10 seconds; every item-15 test passes.
- Root, Runtime, Core, Server, CLI, example Agent, and Desktop TypeScript pass.
  Root lint and `git diff --check` pass.
- Runtime root/client/harness browser bundles, Runtime Node/Server Bun bundles,
  the Server Bun bundle, and renderer-only Vite pass. Vite retains only its
  existing large-chunk advisory.
- No Electrobun packaging, canary/stable build, signing, notarization, release,
  or Loopany mutation command was run. `bun run dev:cef` was used only for the
  documented real-renderer development audit path.
- Current real-CEF combined audit at
  `.agents/kaizen-loop/audits/2026-07-18-175602-named-structured-output/`
  verifies selection, schema detail, success and stable failure cards, hidden
  internal mechanics, semantic controls, Run History reuse, clean console
  output, and 1280×800/900×700 layouts with no document overflow. The isolated
  environment had no configured live model; deterministic Pi/Server fixtures
  prove execution, while screenshots use small persisted typed terminal data.

## Review and remaining risks

The main-agent diff review fixed three in-scope findings before closure:

1. A new Text Run could discover an older Turn's `final_output` evidence when
   extracting the terminal; extraction is now bounded to messages created by
   the current Run and has a focused regression test.
2. Unsupported and nested `outputs/` entries were initially ignored; discovery
   now fails every entry outside a flat regular `.ts|.js` file contract.
3. Failure terminals were durable in Run History but not projected beside the
   current transcript; the latest matching terminal now renders the same
   stable card in the message flow and hides on a new run or selection change.

Clipboard failures now use the existing toast pattern, and renderer-side tool
details are JSON-validated before projection.

The independent Standards review found and the final diff resolves: Local
Server output selection incorrectly inheriting configuration read-only state;
multiple primary exports in the Desktop parser and Runtime output module; and
duplicated `final_output` identity. The parser and Runtime responsibilities are
now split into named modules, while one browser-safe Runtime constant owns the
reserved identity. The review's optional broader JSON-validation consolidation
was not adopted: compiler, Runtime persistence, Core compatibility parsing, and
renderer projection are separate trust boundaries and retain intentionally
local rejection checks rather than sharing a cross-layer authority.

The independent Spec review found and the final diff resolves: Desktop waiting-
Run continuation identity omitted the output selection; Server replay did not
explicitly bind its terminal to the authoritative Runtime Run; and Run History
rendered a successful output twice. Output selection now participates in the
continuation fingerprint with a branching regression test; repository terminal
creation, synthesis, and startup validation use or compare Runtime authority;
the Server integration test performs an actual restart/replay; and snapshot
messages hide the internal output card when the terminal card is present.

Final main-agent re-review against AGENTS.md and ADR 0008 found no remaining
hard Standards or Spec divergence after these fixes.

Remaining evidence limits are a credential-backed live-provider smoke, formal
assistive-technology coverage, and clipboard-permission behavior. None changes
the V1 correctness contract: tool-capable model selection remains an explicit
user prerequisite, and provider-native response formats remain deferred until
Pi exposes a stable portable seam.

## Follow-up product bets

Item 29 can consume named contracts for executor-neutral Evals. Provider-native
structured formats may later optimize generation behind the same contract and
terminal only through a stable Pi API. Schema-generated forms, contract
migrations, and provider compatibility tables remain intentionally deferred.

## Outcome

Completed roadmap item 15 and stopped before item 16. The north-star target is
met for maintained fixtures: every selected-contract case either preserves one
identical schema-valid value across Runtime, Thread, restart, Server replay, and
client consumption or terminates with the exact approved stable failure.
