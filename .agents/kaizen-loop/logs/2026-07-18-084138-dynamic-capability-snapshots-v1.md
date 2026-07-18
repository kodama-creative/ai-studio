# Dynamic Capability Snapshots V1

- Status: done
- Outcome: completed
- Roadmap item: 14

## Trigger

The owner resolved item 14's recorded decision blocker through a one-question-
at-a-time `$grill-me` discussion after commit `18c7267`, explicitly preferring
Eve-compatible authoring and approving the consolidated implementation plan.
The implementation pass started from a clean synchronized `develop`.

## Product context and evidence

Items 12 and 13 provide verified Turn context, read-only state resolution, and
an immutable instruction snapshot. Current source still creates one static
model/tool policy per Session and persists no effective Turn capability set.
Evidence reviewed includes the roadmap/task/context, ADRs 0001-0006, current
Runtime/Server/Desktop source, Pi `0.80.3`, recent kaizen logs, capability map,
and the external sources recorded in the item-14 blocker log.

An owner-requested independent subagent rechecked Eve main at
`c1b6ad3e485f2d15a25bdb5636209aa1367a3124`: Eve has dynamic models, tools,
skills, and instructions, but no dynamic connection authoring or activation.
Its static connection registry may discover tools and resolve auth/headers at
runtime. Item 14 therefore keeps connections static and snapshots only their
effective model-visible tool surface.

## External market scan

Sources accessed 2026-07-18:

- https://eve.dev/docs/guides/dynamic-capabilities
- https://eve.dev/docs/agent-config
- https://eve.dev/docs/connections
- https://github.com/vercel/eve/tree/c1b6ad3e485f2d15a25bdb5636209aa1367a3124/packages/eve/src/context
- https://openai.github.io/openai-agents-js/guides/agents/
- https://github.com/badlogic/pi-mono/blob/main/packages/agent/src/agent-loop.ts

Table stakes are Turn-context model/tool resolution, durable definitions, and
Run-context tool filtering. LLM Space's missing capability is the stronger
Host-policy intersection and immutable, secret-free Turn snapshot while Pi
remains authoritative. Uncertainty is limited to implementation mechanics;
the owner-approved ADR fixes product, authority, and persistence behavior.

## Capability-map freshness

- `Dynamic Capability Snapshots`: confirmed absent and approved for V1.
- `Composable Static And Dynamic Instructions`: confirmed reusable Turn seam.
- `Trusted Session Context And Structured State`: confirmed resolver context.
- `Agent Definition And Runtime`: confirmed static before this implementation.

## Product north-star metric

- Name: capability-snapshot policy fidelity.
- Baseline: 0% of Turns have an authored-source × Host-policy effective
  capability snapshot.
- Target: 100% of maintained policy-matrix fixtures resolve once, stay within
  compiled source authority and Host policy, persist atomically with
  instructions, and feed identical effective capabilities to every Pi step and
  restart continuation.
- Measurement: compiler/source/bundle tests, policy and Session Store integrity
  fixtures, Pi multi-step assertions, Desktop/Server restart coverage, full
  non-packaging validation, and final Standards/Spec review.
- Guardrails: no credentials or callbacks in snapshots; no dynamic connection,
  approval, Sandbox, advanced MCP lifecycle, Pi loop fork, packaging, signing,
  notarization, or release commands.

## Candidate opportunities and recommendation

1. Main: Eve-shaped dynamic model/tools plus required Host policy and one
   immutable Turn snapshot.
2. Literal Eve session/step scopes and dynamic overrides: rejected because a
   capability-changing step violates the roadmap's Turn immutability.
3. Host-only snapshots of existing overrides: rejected because portable Agent
   source could not express the requested dynamic behavior.

## Approved V1 and non-goals

The accepted contract is recorded in ADR 0007. V1 includes dynamic model and
tool authoring, safe `modelOptions`, explicit Host policy, static connection
tool-surface provenance, atomic instruction/capability persistence, restart
rehydration, manual no-state semantics, and fail-closed policy changes.

Non-goals are dynamic connections, session/step resolution, approval,
Sandbox, advanced connection refresh/schema drift, limits, hooks, Trace/UI,
provider-specific options, credentials, and automatic retry.

## Acceptance and implementation plan

1. Add Eve-compatible definitions and deterministic compiled artifact/bundle
   identity, including durable inline dynamic-tool step metadata.
2. Add typed Host policy, pure resolution/validation, normalized safe options,
   and integrity-derived capability snapshots.
3. Atomically persist instruction and capability setup; bind the snapshot to
   Pi and enforce current policy on continuation.
4. Provide explicit Desktop and Server policies and preserve static connection
   lifecycle.
5. Run focused/full Bun tests, all relevant TypeScript projects, lint,
   Runtime browser/Bun and Server Bun bundles, renderer-only Vite, diff review,
   capability/roadmap updates, and final Standards/Spec review.

No UI changes are planned, so CEF/product-design audit is not applicable.

## Approval and `$grill-me`

Approved. The owner resolved source shape, Eve event/failure/override behavior,
model fallback, Thread request precedence, Host policy, safe options, manual
mode, policy tightening, restart closure capture, static connections, resolver
scope, atomic persistence, and journal visibility, then approved the
consolidated implementation plan.

## Work performed

Implemented Eve-shaped Turn-only dynamic model and tool authoring without an
Eve dependency. The compiler fingerprints dynamic resolver contributions,
assigns inline tool callbacks stable step IDs, captures JSON closure values,
and carries an artifact-owned step record through source and closed bundles.
Restart rehydrates the recorded tool from that record without a global
registry, resolver replay, prior tool replay, or persisted source code.

Added explicit serializable Host policy and authored-source request bounds for
models, reasoning, safe model options, static/dynamic tool contributions, and
static connection tool provenance. Thread values enter only as explicit Turn
overrides. Invalid names/numbers, denied or unavailable choices, unavailable
remote tools, dynamic collisions, non-JSON closures, unknown persisted option
keys, artifact/request drift, and policy drift fail before Pi. Policy drift is
reported as `hostPolicyChanged` by Desktop and Server without changing Pi's
event protocol.

Instructions and capabilities resolve from one Turn view and commit in one
Session Store CAS. Manual mode records the same snapshot without a state scope
and keeps tools deferred. Static Sessions without restart authority memoize one
in-memory Turn snapshot; dynamic capability Projects require an explicit
Session Store. Shared authored-tool compilation owns input/output validation,
ToolContext creation, JSON serialization, and Pi adaptation across source,
bundle, and dynamic rehydration.

## Verification and review

- Focused acceptance: 59 tests passed across Runtime/compiler, Session Store,
  Desktop streaming, and Server terminal behavior.
- Full `bun test`: 284 tests, 283 passed, 1116 assertions. The only failure is
  the unchanged fixed-point Server timeout `aborts explicitly while observation
  disconnect remains passive`.
- Runtime, Server, Desktop, Core, CLI, example, and root TypeScript checks
  passed; root lint and `git diff --check` passed.
- Runtime root/client/harness browser bundles, Runtime Node and Server Bun
  bundles, and renderer-only Vite passed. Vite retained only its existing
  large-chunk advisory. No UI changed, so CEF/product-design audit was not
  applicable.
- Independent Standards and Spec reviews drove removal of a global step
  registry, module splitting/naming, shared tool adapters/AST analysis,
  explicit request provenance, intrinsic option validation, fail-fast remote
  tool handling, exact output-schema snapshots, and closure/name validation.
  Final re-reviews returned clear pass.

## Review and remaining risks

No remaining Standards or Spec findings. Trusted authored code can choose JSON
closure values; V1 structurally excludes Runtime-owned secret-bearing option,
connection, and callback fields but does not claim semantic secret-taint
analysis inside trusted source. Hostile-code isolation remains item 17.

## Follow-up bets

Items 19 and 23 retain durable approvals and advanced connection lifecycle.

## Outcome

Completed roadmap item 14 and stopped before item 15.
