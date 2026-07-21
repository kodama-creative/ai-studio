# Agent Debugging Parity And Local Reliability

- Status: done
- Outcome: completed after approved UI/runtime/example implementation
- Date: 2026-07-20

## Trigger and starting state

The owner asked to ignore GitHub Actions for now, make local validation pass,
verify the real Desktop Agent debugging flow, and explain why model parameters
appear unconfigurable and why the example does not define Sandbox. The branch
started synchronized with `origin/develop` at `3e6e12e`. Existing uncommitted
roadmap evidence in `CAPABILITY_MAP.md`, `LOOP_PLAN.md`, and `LOOP_TASK.md` was
preserved.

## Product stage and evidence reviewed

Reviewed `AGENTS.md`, `CONTEXT.md`, the current capability map and item-17 logs,
the Agent Project Thread composition, model editor/selector/parameter controls,
external project manager, canonical scaffolder, checked-in `apps/example-agent`,
Sandbox compiler/provider/helpers, Server teardown path, and current real-Docker
acceptance. Captured and inspected eight new screenshots from the real
Electrobun CEF renderer in
`audits/2026-07-20-180358-agent-debugging-parity/`.

The audit proves Agent Project Threads already reuse `ThreadPlayground`,
`ModelConfigEditor`, and `ModelParamsPopover`. Only Local Server sets
`configurationReadonly`; Desktop Direct and Desktop Sandbox allow Thread
overrides. Selecting GPT-5.5 correctly changes `From Agent` to
`Thread override` and exposes `Sync from Agent`.

The observed friction comes from the checked-in source model
`openai/gpt-5.3-codex` being unavailable on the current machine and the selector
and parameters affordances being mostly hover-revealed. The example and
scaffolder intentionally contain no Sandbox declaration, workspace seed, or
canonical read/write/bash helpers.

## External market scan

Primary sources accessed 2026-07-20:

- https://docs.langchain.com/langsmith/studio.md describes Studio as an agent
  IDE for visualization, interaction, debugging, assistant management, Thread
  management, and local testing.
- https://docs.langchain.com/langsmith/use-studio.md documents a visible Run
  Settings entry for selecting an assistant, editing active configurations,
  and re-running a Thread checkpoint with another selected assistant.
- https://code.claude.com/docs/en/sandboxing.md documents a discoverable
  `/sandbox` panel with Mode, Overrides, Config, dependency readiness, writable
  workspace behavior, and a concrete first Bash command.
- https://vercel.com/docs/vercel-sandbox describes Sandbox as a primitive for
  running agent output and user uploads in isolated ephemeral Linux VMs.

Table stakes are a visible run-configuration entry, explicit configuration
provenance, inspectable runtime readiness, and a runnable example that teaches
the isolated workspace/tool path. The true local gap is not a missing Thread
configuration engine; it is discoverability plus the absence of a canonical
Sandbox learning path. Uncertainty: this was a documentation-level comparator
scan, not a signed-in usability benchmark.

## Capability-map freshness

`Agent Project Activation`, `Canonical Agent Project Scaffolding`, and
`Sandbox Workspace And Attachment Delivery` were refreshed from current code,
current CEF screenshots, current Docker, and current local validation. The
configuration reuse and Sandbox runtime states are confirmed. Sandbox example
and creation-preset education remain confirmed gaps.

## Product north-star metric

- Name: canonical example debug-readiness completion rate.
- Reason: an Agent Studio example should reach an executable model/runtime
  configuration through visible controls without source repair or hidden UI.
- Baseline: the only checked-in example opens with an unavailable model on the
  current configured catalog; there is no checked-in Sandbox example, so 0/2
  target Direct/Sandbox learning paths are complete.
- V1 target: 2/2 canonical examples reach an explicit Ready configuration in
  under two minutes using only visible Desktop controls; the Sandbox example
  also exposes workspace seed, read/write/bash, and attachment entry.
- Measurement: fresh isolated CEF walkthrough at 1280×800 and 900×700, source
  inspection, persisted Thread provenance, console/overflow checks, and the
  repository example contract tests.
- Guardrails: keep Local Server read-only, do not mutate Agent source when a
  Thread override is selected, preserve undo/`Sync from Agent`, fail Sandbox
  closed, keep Direct onboarding available without Docker, and introduce no
  live-provider or credential dependency in example contract tests.

## Candidate opportunities

Main recommendation: preserve the Direct `example-agent`, add a separate
Sandbox example, and make the already-reused model selector and parameters
persistently visible. Add `Choose override` beside `Model unavailable` and route
it into the current selector.

Alternative 1: upgrade the existing example to require Sandbox. Deferred
because users without Docker would lose the basic portable-Agent onboarding
path and the example would mix Direct and isolation teaching goals.

Alternative 2: only change the hard-coded source model to a currently available
model. Deferred because model catalogs drift, hover discoverability remains,
and Sandbox still has no learnable example.

## V1 capability and interaction scheme

After V1, a user can open the Direct example, see and change its effective
model/parameters from the normal Thread row, understand `From Agent` versus
`Thread override`, reset with `Sync from Agent`, and separately open a Sandbox
example that declares `defineSandbox({})`, seeds a small workspace, exposes the
canonical read/write/bash helpers, and accepts attachments.

Approved interaction details:

- The existing model row remains the entry point; selector and parameter icons
  remain visible at rest for editable Desktop Threads.
- The selector itself stays visible beside `Model unavailable`; a second
  `Choose override` action was unnecessary and was not added.
- Choosing a model writes only the Project Thread override, participates in
  current undo/history, changes provenance to `Thread override`, and never edits
  `agent.ts`.
- `Sync from Agent` preserves its current reset semantics and confirmation rules.
- Local Server remains read-only. Runtime Profile changes use the current Thread
  at settled checkpoints without clearing messages, history, or Session state.
- A separate checked-in Sandbox example carries the minimum source declaration,
  workspace seed, canonical helpers, and README walkthrough. Adding a public
  scaffolder preset is deferred unless separately approved.

Explicit non-goals: no production migration for legacy Threads, model-catalog
migration policy, automatic source rewrite, new model settings surface, Sandbox
provider choice, permissions/approval UI, workspace explorer, Desktop template
entry for the Sandbox example, or paid-provider smoke in its contract test.

## Implementation and approval status

The owner approved preserving the Direct example, adding a separate repository
Sandbox example, keeping model controls visible, selecting Runtime Profiles in
the current Thread, preserving all existing debug data, using the current
profile for reruns, and ignoring legacy/production migration during development.
The requirements discussion resolved model fallback, profile/run provenance,
waiting-run branching, Sandbox lifecycle, example scope, and local-only
acceptance before implementation.

## Work performed

Work completed:

1. The Server integration fake model now handles an AbortSignal that is already
   aborted when streaming begins. Before the fix, the fixture registered only a
   future listener, hung forever, and made `afterEach` hit 10 seconds.
2. The real-Docker final-destination collision trigger now uses a bounded
   immediate watcher instead of 10 ms polling, retaining the actual concurrent
   `renameat2(RENAME_NOREPLACE)` path without changing production behavior.
3. Editable Project Threads keep the model selector and parameter actions
   visible. Repeated renderer change events preserve `threadOverride`
   provenance, and Desktop Direct/Sandbox explicitly authorize the selected
   model/reasoning/options within Host policy. Default Runtime and Local Server
   calls retain the Agent-source deny boundary.
4. Runtime Profile selection uses a typed RPC to update the current Thread.
   Direct/Sandbox/Local Server switches preserve messages, Run History, and the
   Desktop Runtime Session; leaving Sandbox stops its container but retains the
   volume. Historical checkpoints record the effective profile.
5. Runtime Profile is part of continuation identity, so changing it at a safe
   waiting checkpoint supersedes/branches the old Run instead of resuming under
   different authority.
6. Fresh in-process Sandbox acquisition is presented as `Preparing`; durable
   crash cleanup and workspace-loss states still fail closed without defaulting
   to instructions to create another Thread.
7. Added `apps/sandbox-example-agent` with `defineSandbox({})`, a README workspace
   seed, canonical read/write/bash declarations, documentation, and a source
   contract test. It remains separate from the Desktop template picker.
8. Added root `bun run test:docker` so real-provider acceptance does not require
   users to know the internal opt-in environment variable.

## Verification

- Server abort regression: 10/10 focused passes, approximately 28–29 ms each.
- Real Docker acceptance: 10/10 sequential passes, 42 assertions each.
- Residual Sandbox containers and volumes: zero.
- Focused Runtime/Desktop regressions pass, including profile preservation,
  continuation branching, acquisition status, repeated model provenance, and
  Host-authorized Desktop model override while source-deny defaults remain.
- Full repository tests after implementation: 347 passed, 1 Docker acceptance
  skipped by default, 0 failed, 1339 assertions across 348 tests / 63 files
  (`--max-concurrency=1`).
- TypeScript: all repository `tsconfig.json` projects passed.
- Lint: passed.
- Desktop Vite + unsigned Electrobun canary package: passed against a local 404
  update feed; the normal remote build first compiled successfully but GitHub
  tarball download reset during patch generation.
- Real Desktop CEF: visible selector/parameters, persisted GPT-5.4/GPT-5.5
  overrides, same-Thread Sandbox → Local Server → Sandbox switching, preserved
  Thread identity/data, fresh `Preparing` → `Ready`, and Run History labelled
  `openai-codex/gpt-5.5 · Desktop Sandbox` were verified. The external provider
  emitted no model event within one minute, so that Run was explicitly cancelled
  and persisted as Cancelled rather than being claimed complete.
- 1280×800 and 900×700 checks have no document overflow; model/Profile controls
  remain visible, and current console capture has no application error or warning.

One concurrent run of lint, TypeScript, and the full Bun suite crashed Bun
1.3.14 itself with SIGSEGV at about 2.1 GB RSS. The same gates passed when run
sequentially; this is recorded as a tooling concurrency risk, not a code failure.

## Review and follow-ups

The live CEF pass found and fixed three regressions that focused tests alone had
missed: internal cleanup tombstones leaking into UI, repeated onChange resetting
model provenance, and Runtime source authority rejecting an explicit Desktop
override. Each now has a deterministic red/green regression. No debug
instrumentation or isolated Docker resource remains. GitHub Actions remains
intentionally deferred by the owner; item 17 should not be called shipped until
the separate CI policy is resumed or explicitly waived.

## Outcome

The approved Agent debugging parity V1 is implemented and locally accepted.
The north-star target is met for both learning paths: the existing Direct path
keeps editable visible Thread configuration, and the separate Sandbox path
reaches Ready with discoverable workspace/tools without source repair. CI
shipment evidence remains deferred, and the next roadmap capability should not
be inferred from this loop.
