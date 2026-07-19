# ExecutionEnv-Backed Built-In Tools Blocker

- Status: done
- Outcome: blocked
- Roadmap item: 16

## Trigger and starting state

The owner asked to continue the roadmap after item 15. `develop` started clean
and synchronized at `5d79f95`. Item 16 is the lowest unchecked dependency-ready
item; this pass did not inspect or implement item 17.

## Product stage and evidence reviewed

LLM Space has portable authored function and MCP actions, Runtime capability
snapshots, protected Server execution, and host-bound Desktop built-ins. It has
no portable filesystem/process action whose authority can later move unchanged
between Node and Sandbox.

Reviewed `AGENTS.md`, `LOOP_TASK.md`, `LOOP_PLAN.md`, `CONTEXT.md`, ADRs 0001
and 0006, the capability map, the three latest kaizen logs, Runtime authoring,
compiler, bundle, prepared-tool and Session paths, Desktop built-ins, Server and
Desktop Session construction, pinned Pi 0.80.3 types/source maps, and current Pi
upstream source/tests.

## External market and upstream scan

Sources accessed 2026-07-19:

- https://github.com/earendil-works/pi/blob/main/packages/agent/src/harness/types.ts
- https://github.com/earendil-works/pi/blob/main/packages/agent/src/harness/env/nodejs.ts
- https://github.com/earendil-works/pi/blob/main/packages/agent/test/harness/nodejs-env.test.ts
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/read.ts
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/write.ts
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/bash.ts

Pi's table-stakes backend contract is already sufficient: structured fallible
filesystem/shell calls, stable error codes, addressed and canonical paths,
explicit symlink metadata, abort, timeout, stdout/stderr callbacks, temporary
files, large-output capture, and best-effort cleanup. Pi coding-agent tools show
the expected read pagination/truncation, whole-file write, streamed shell,
timeout, and pluggable-operation behavior, but their defaults directly use the
host and their implementations depend on coding-agent/TUI concerns.

The true gap is therefore LLM Space authority wiring, not another filesystem
abstraction. Uncertainty is limited to API evolution beyond the inspected
current `main`; the repository remains pinned to 0.80.3.

## Capability-map freshness

`Agent Action Authoring`, `Agent Definition And Runtime`, and `Runtime Recovery
And Replay` remain confirmed. Added `Portable Execution Tools` as confirmed not
shipped and decision-blocked. No rendered-product audit was required because
item 16 is a Host-neutral source/runtime contract with no approved UI change.

## Product north-star metric

- Name: ExecutionEnv portability of built-in tools.
- Reason: a source-authored action must behave identically when its execution
  location moves from the Node reference adapter to the item-17 Sandbox.
- Baseline: 0/3 portable helpers; Desktop read/write/bash directly use host
  filesystem/process APIs and Project source cannot request ExecutionEnv.
- Target: 3/3 identical authored tool contracts pass the required path,
  symlink, abort, timeout, streaming, failure, and cleanup matrix against both
  explicit NodeExecutionEnv and isolated/fake ExecutionEnv adapters.
- Measurement: shared contract fixtures plus compiler/artifact/bundle, Runtime,
  capability-policy, Node adapter, fake adapter, abort and cleanup tests.
- Guardrails: zero direct Node filesystem/process imports in portable helpers;
  no implicit tools; no Desktop/Server fallback environment; no policy bypass;
  Pi remains the tool loop; item 17 retains Sandbox/workspace/attachment and
  cleanup/retention ownership; all existing non-packaging gates remain green.

## Candidate opportunities

Main recommendation: add three declaration-only, framework-owned authored
helpers whose compiled tools require an explicitly Host-supplied Pi
ExecutionEnv. Arbitrary `defineTool()` callbacks keep their current bounded
context. Missing environment authority fails before provider execution.

Alternative 1: expose ExecutionEnv on every `ToolContext`. This is flexible but
turns all authored code into filesystem/process-capable code and silently
expands the permission surface, so it requires explicit owner approval.

Alternative 2: wrap Pi coding-agent read/write/bash tools and their operation
interfaces. This reuses mature behavior but retains host defaults and imports
coding-agent-specific concerns instead of making ExecutionEnv authoritative.

## Recommended V1 and why now

The declaration-only direction is the narrowest capability that unblocks item
17 and ADR 0006 promotion without granting unrelated authored functions new
authority. Source identity remains filename-owned; artifact and capability
snapshots can record the helper kind while executable authority remains
Host-supplied and absent by default.

V1 includes only read, whole-file write, and bash definitions; exact Pi
ExecutionEnv calls; bounded outputs/timeouts; abort and streamed shell updates;
and Node/fake conformance. It excludes sandbox/container construction,
workspace seeds, attachments, Desktop/Server fallback, generic permissions,
approvals, edit/grep/tree helpers, and provider-owned cleanup/retention.

## Acceptance and implementation plan

After owner decisions:

1. Record the permission and lifecycle contract in an ADR if the grilling
   discussion confirms the recommendation.
2. Add browser-safe authored helper definitions and deterministic compiler,
   artifact, bundle, and capability identity.
3. Add a required Host ExecutionEnv injection seam without a default and adapt
   only the three framework helpers to Pi tools.
4. Implement one shared behavior suite against explicit NodeExecutionEnv and a
   controlled fake/isolated adapter, including path, symlink, abort, timeout,
   streaming, output limits, errors, and cleanup ownership.
5. Run focused/full Bun tests, all relevant TypeScript, lint, browser/Bun
   bundles, renderer-only Vite where affected, diff review, capability/roadmap
   updates, and Standards/Spec review. Do not run Electrobun packaging or
   release commands.

Stop if the design requires generic authored environment access, a Desktop or
Server host fallback, sandbox-provider behavior from item 17, new persistence,
or a permission/approval policy not explicitly accepted.

## Approval and `$grill-me`

Implementation is not approved because the first design-tree decision changes
the Agent permission model. The owner previously confirmed that Sandbox
provides the environment; the unresolved question is who in authored source
may receive that authority. `$grill-me` is paused on that one question.

## Work and verification

No product code was changed and item 16 remains unchecked. Read-only source,
type, upstream, and git inspection established the blocker. Documentation-only
changes are subject to lint and `git diff --check` before commit. No CEF,
packaging, signing, notarization, release, or Loopany mutation command ran.

## Review, risks, and follow-ups

The main risk is permission laundering: placing raw ExecutionEnv on generic
ToolContext would let any authored tool obtain filesystem and process authority
even when the product intended only explicit read/write/bash capabilities.
The second risk is pre-empting item 17 by letting Runtime or Desktop own
environment creation, cleanup, workspace retention, or fallback.

After the permission surface is decided, the grilling sequence still needs to
resolve path/symlink semantics, output and timeout bounds, streamed-update
shape, and the exact owner of ExecutionEnv cleanup. Item 17 remains the next
provider capability only after item 16 satisfies its Done-when contract.

## Outcome

Blocked before implementation on a new permission-model decision. Stop after
item 16 discovery and ask only whether ExecutionEnv authority is restricted to
framework declarations or exposed to every authored tool.
