# ExecutionEnv-Backed Authored Tools V1

- Status: done
- Outcome: completed
- Roadmap item: 16

## Trigger and starting state

The owner approved continuing item 16 after the permission, lifecycle, failure,
and persistence decisions were resolved one question at a time. `develop`
started clean and synchronized at `134fc04`, the item-16 blocker record. This
pass changed only item 16 and stopped before item 17.

## Product stage and evidence reviewed

LLM Space already had portable source-owned local/MCP actions, immutable Agent
artifacts and per-Turn capability snapshots, Pi Agent execution, Desktop Direct
and protected Server hosts, but no portable source declaration for filesystem
or process work. Reviewed `AGENTS.md`, `LOOP_TASK.md`, `LOOP_PLAN.md`,
`CONTEXT.md`, ADRs 0001, 0006, and 0009, the capability map, the three latest
kaizen logs, current compiler/bundle/Runtime/Session Store/Desktop/Server code,
the complete item-16 diff, and pinned Pi 0.80.3 ExecutionEnv, truncation, shell
capture, Node adapter, result, error, and cleanup behavior.

## External market and upstream scan

The approved implementation reused the discovery scan accessed 2026-07-19:

- https://github.com/earendil-works/pi/blob/main/packages/agent/src/harness/types.ts
- https://github.com/earendil-works/pi/blob/main/packages/agent/src/harness/env/nodejs.ts
- https://github.com/earendil-works/pi/blob/main/packages/agent/test/harness/nodejs-env.test.ts
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/read.ts
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/write.ts
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/bash.ts

Pi's table-stakes contract is Host-neutral fallible filesystem/shell execution,
addressed and canonical paths, provider-owned symlink policy, stable file and
execution errors, abort, timeout, streamed stdout/stderr, temporary full-output
files, truncation, and best-effort environment cleanup. The true missing
capability was narrow LLM Space authority wiring rather than a second
filesystem abstraction. Current-main evolution beyond the pinned 0.80.3 API is
the only upstream uncertainty.

## Capability-map freshness

`Portable Execution Tools` changed from confirmed blocked to confirmed shipped
V1. Its current evidence now covers authored declarations, compiler/artifact/
bundle identity, immutable Turn snapshots, Runtime binding and preflight,
Desktop/Server failure projection, shared Node/fake conformance, persistence,
and cleanup ownership. The Sandbox provider and delivery boundary remains a
visible item-17 gap. No rendered-product audit was applicable because this
capability adds no UI or interaction surface.

## Product north-star metric

- Name: ExecutionEnv portability of built-in tools.
- Reason: the same source-authored action must keep its contract when execution
  moves from the explicit Node reference adapter to an isolated Sandbox.
- Baseline: 0/3 portable helpers before item 16; Desktop built-ins were
  host-bound and Agent source could not request ExecutionEnv authority.
- Target: 3/3 canonical helper contracts pass the same path, symlink, abort,
  timeout, streaming, failure, truncation, and cleanup matrix against explicit
  Node and isolated/fake environments.
- Result and measurement: target met by the shared Runtime behavior suite plus
  compiler, artifact, bundle, capability-policy, persistence, Desktop, and
  protected Server fixtures.
- Guardrails: no generic ToolContext authority, direct Desktop/Server host
  filesystem/process access, implicit helper, fallback environment, automatic
  retry, Runtime cleanup, persisted environment configuration, new Pi event,
  Electrobun packaging, release command, or Loopany configuration mutation.

## Candidate opportunities and recommendation

The implemented recommendation was three canonical, declaration-only,
framework-owned helpers receiving only an explicitly Host-supplied Pi
ExecutionEnv. Arbitrary `defineTool()` remains bounded. This unblocks the
item-17 provider and ADR-0006 promotion path with the smallest permission
surface.

Alternative 1, exposing ExecutionEnv on every ToolContext, was rejected because
it silently grants every authored callback filesystem/process authority.
Alternative 2, importing coding-agent tools, was rejected because their host
defaults and coding-agent/TUI concerns do not make ExecutionEnv the sole
Runtime authority.

## V1 capability and explicit non-goals

`tools/read.ts`, `tools/write.ts`, and `tools/bash.ts` may default-export their
matching zero-configuration helper. Compiler artifacts and Turn snapshots carry
the fixed helper kind/schema/requirement, and Runtime binds the final effective
tool only to a borrowed Session environment. Manual mode defers helpers;
autoOnce and ReAct execute through Pi. Missing authority fails before provider
execution with `executionEnvUnavailable`.

V1 excludes Sandbox/container construction, workspace seeds, attachments,
environment selection/configuration, retention and cleanup policy, approval,
edit/grep/list/tree helpers, source write-back, dynamic helpers, generic
permissions, and Desktop/Server fallback authority.

## Acceptance and implementation plan

The accepted plan was to record ADR 0009, add browser-safe canonical authoring,
compile immutable helper identity into artifact and closed bundle, add one
optional Host injection seam, adapt read/write/bash with Pi primitives, reject
renaming/dynamic construction, fail only final effective helpers without an
environment, prove Node/fake conformance and secret-free persistence, propagate
stable Desktop/Server terminals, then run all non-packaging gates and review.
Stop conditions were any new generic permission, Host fallback, Sandbox
provider, persistence ownership, or cleanup decision.

## `$grill-me` requirements discussion and approval

The owner approved: declaration-only helpers; canonical filenames; no generic
ToolContext authority; provider-owned path/symlink/confinement semantics;
Host/Sandbox Session-scoped borrowing; no fallback or Runtime cleanup; final
effective-tool preflight; Pi read/write/bash inputs, truncation, shell capture,
updates, errors and nonzero-exit behavior; no retry; manual deferral; immutable
secret-free capability identity; and item-17 ownership of provider/workspace/
attachments/retention/cleanup. ADR 0009 records the resulting accepted design.
No ambiguity remained that required expanding the approved architecture.

## Work performed

- Added `defineReadTool()`, `defineWriteTool()`, and `defineBashTool()` plus the
  branded zero-configuration definition and authored virtual-module exports.
- Added compiler diagnostics for renamed helpers and dynamic helper creation;
  artifact and bundle reconstruction preserve fixed capability identity.
- Added Host `executionEnv` session injection, effective-capability preflight,
  Session Store validation, and environment-free snapshot rehydration.
- Implemented read pagination/head truncation, whole-file UTF-8 write, and Pi
  `executeShellWithCapture` bash with existing update callbacks and full-output
  evidence. Helpers never call `cleanup()` and never retry.
- Added stable Runtime/Desktop/Server `executionEnvUnavailable` propagation
  without a Desktop or Server fallback environment.
- Updated architecture guidance, Runtime authoring documentation, ADR 0009,
  the capability map, roadmap, and bounded executor memory.

## Verification and audit results

- 52 focused checks pass: 38 Runtime compiler/bundle/behavior checks, 13 Desktop
  streaming checks, and one real protected Server integration check.
- The shared Node/fake suite proves relative paths and parent creation, UTF-8
  byte reporting, read pagination, symlink delegation, streamed stdout/stderr,
  nonzero exit as completion, >50 KiB truncation and environment-addressed
  full-output path, file abort, explicit shell cancellation, timeout, no retry,
  and zero Runtime cleanup calls.
- Full `bun test` runs 308 tests: 307 pass with 1210 assertions. The only
  failure is the unchanged fixed-point Server test `aborts explicitly while
  observation disconnect remains passive`, whose hook times out after ten
  seconds. Every item-16 test passes.
- Root, Runtime, Core, Server, CLI, example Agent, and Desktop TypeScript pass.
  Root lint, Runtime root/client/harness browser bundles, Runtime Node/Server
  Bun bundles, the Server Bun bundle, renderer-only Vite, and diff whitespace
  checks pass. Vite reports only its existing large-chunk advisory.
- Product-design/CEF audit was not applicable: no renderer surface changed.
  No Electrobun packaging, signing, notarization, release, or Loopany mutation
  command ran.

## Review, fixes, and remaining risks

Standards review found no remaining layering, naming, generated-file,
TypeScript, Pi-loop, or Host-composition violation. Spec/ADR review confirmed
canonical-only authority, dynamic rejection, effective snapshot gating,
secret-free persistence, Pi semantics, no retry/fallback/cleanup, manual
deferral, and stable Desktop/Server failure projection.

Two in-scope review findings were fixed before closure: write success initially
reported JavaScript code units as bytes, so it now reports actual UTF-8 bytes
with a non-ASCII regression assertion; and the portability matrix now asserts
Pi's explicit cancelled bash result against both environments in addition to
file abort and shell timeout. The remaining risk is expected: no production
Host supplies an isolated ExecutionEnv until item 17, so canonical helpers fail
closed today rather than downgrading to host authority.

## Follow-up product bets

Item 17 can now supply the unchanged contract through a local container
Sandbox, seed a Session workspace, stage controlled attachments, and own
retention/exactly-once cleanup. Item 19 later adds approval without changing
where tools execute. ADR-0006 Thread promotion remains blocked only on the
Sandbox delivery prerequisite among the item-16/17 pair.

## Outcome

Roadmap item 16 is complete and its Done-when portability matrix is
demonstrated. The north-star target is met, the capability map is current, and
this pass stops before item 17.
