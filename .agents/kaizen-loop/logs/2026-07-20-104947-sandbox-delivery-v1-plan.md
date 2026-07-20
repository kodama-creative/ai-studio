# Sandbox, Workspace, And Attachment Delivery V1 Plan

- Status: done
- Outcome: stopped for implementation approval
- Roadmap item: 17

## Trigger and starting state

The owner continued roadmap item 17 and completed the required one-question-at-
a-time `$grill-me` discussion. `develop` started clean and synchronized at
`a4c25d9`. This planning pass changed only item-17 architecture and roadmap
evidence, did not enter item 18, and did not modify Loopany schedule, goal,
enabled state, task-file configuration, or runtime state.

## Product stage and evidence reviewed

LLM Space has canonical Pi `ExecutionEnv` read/write/bash tools but no production
Sandbox provider or delivery contract. Re-read `AGENTS.md`, `LOOP_TASK.md`,
`LOOP_PLAN.md`, `CONTEXT.md`, ADRs 0003, 0004, 0006, and 0009, the current
capability map, the latest three item-16/item-17 kaizen logs, current git state,
and the prior source/CEF/provider evidence captured in the item-17 blocker.

The accepted discussion also incorporates source inspection of Vercel Eve at
commit `c61f8cae0c51c5ca285c7386460481aa3c0a82ae`. Eve has no
`defineAgent.execution.environment` property. Its reusable ideas are a
canonical Sandbox source slot, durable Session identity, one-time workspace
seed, Docker lifecycle, and attachment hydration; its backend/image/network/
environment authoring, fallback chain, weak isolation defaults, stop-only
cleanup, non-atomic staging, and custom message protocol are not adopted.

## External market and upstream scan

The planning decision reuses the item-17 discovery scan accessed 2026-07-19:

- https://code.claude.com/docs/en/sandboxing.md
- https://github.com/apple/container/blob/main/README.md
- https://github.com/apple/container/blob/main/docs/command-reference.md
- https://github.com/docker/docs/blob/main/content/manuals/engine/storage/bind-mounts.md
- https://github.com/docker/docs/blob/main/content/manuals/engine/network/drivers/none.md
- https://github.com/earendil-works/pi/blob/main/packages/agent/src/harness/types.ts
- https://github.com/earendil-works/pi/blob/main/packages/agent/src/harness/env/nodejs.ts
- https://github.com/vercel/eve/tree/c61f8cae0c51c5ca285c7386460481aa3c0a82ae

Table stakes remain explicit workspace/process isolation, fail-unavailable
behavior, credential protection, deterministic Session identity and deletion,
safe input delivery, and a Host-owned policy boundary. The true gap is not a
second filesystem API but authority over who requires isolation, who selects a
provider, which bytes enter a Session, and who retains or deletes them. The
local host still has no Docker, Podman, or Apple `container` executable, so the
real Docker acceptance must run on a suitable CI or development host.

## Capability-map freshness

`Portable Execution Tools` remains confirmed shipped. `Sandbox Workspace And
Attachment Delivery` changed from confirmed decision-blocked to confirmed
planned V1, still not shipped, with ADR 0010 and the accepted provider,
workspace, attachment, lifecycle, profile, and non-goal boundaries. No current
rendered product claim changed; Desktop Sandbox remains unavailable.

## Product north-star metric

- Name: sandbox isolation and delivery acceptance rate.
- Reason: a portable Agent must complete filesystem/process work without Host
  authority or ambiguous ownership of its workspace and inputs.
- Baseline: 0 runnable Sandbox profiles, 0 source seeds delivered, and 0
  Runtime/Server attachments staged into an isolated environment.
- Target: 100% of the required source/Host policy, fail-closed, cross-Session
  isolation, seed, attachment, restart/loss, and cleanup matrix passes, including
  one real Docker end-to-end create/seed/stage/Pi-tool/reconnect/delete path.
- Measurement: compiler/artifact fixtures, fake-provider conformance and fault
  injection, adversarial staging, Desktop/Server integration, real Docker
  acceptance, and real CEF profile/attachment audit.
- Guardrails: no Host path/source mount/write-back, secret or provider
  credential inside Sandbox, network access, silent Direct/Node fallback,
  source-owned provider configuration, new Pi message/event protocol,
  Electrobun packaging/release command, or Loopany mutation.

## Candidate product opportunities

Main recommendation: implement the ADR-0010 abstract Sandbox Requirement and
Host-owned provider seam with a minimal Docker CLI reference, one Session named
volume, one-time source seed, atomic controlled attachments, fixed isolation,
and explicit lifecycle failures.

Alternative 1: expose only a Thread Sandbox selector. Deferred because source
could not require isolation and ADR-0006 promotion could silently lose its
minimum. Alternative 2: let source configure engines/images/mounts/network.
Rejected because it inverts Host authority and makes Agents non-portable.

## V1 capability definition and non-goals

Source uses `agent/sandbox.ts` or `agent/sandbox/sandbox.ts` with
`agent/sandbox/workspace/**`, default-exporting `defineSandbox({})`. Host policy
selects an internal provider and may tighten but never weaken. One Runtime
Session owns one fixed Docker container and named `/workspace` volume, retains
it across Host restart, stages bounded Turn inputs atomically, and deletes both
resources through a retryable tombstone. Canonical tools execute through Pi's
unchanged `ExecutionEnv`; Pi-native text/image content remains authoritative.

V1 excludes workspace explorer/export, explicit adoption or source write-back,
numeric resource quotas, provider selection/dynamic connections, Vercel/
Firecracker/Apple adapters, arbitrary mounts/Host paths, network/secrets,
drag-and-drop/directories/archive extraction, approval, and fleet operations.

## Acceptance and audit plan

Acceptance must cover deterministic source/artifact identity; required versus
Host-tightened policy; provider unavailable without fallback; seed validation
limits and symlink/special-file rejection; cross-Session isolation; atomic
attachment limits/traversal/duplicate failure; manual and automatic mode
binding; in-container read/write/bash/abort; Host restart reconnect; container
reconstruction with an intact volume; permanent inspectable failure for a lost
volume; and tombstoned partial cleanup retry.

One real Docker path is a hard completion gate even though the capability is
interface-first. The CEF audit must verify Desktop Sandbox readiness,
unavailable/lost/staging states, `From Files`, descriptor locking, retry/removal,
new-Thread recovery, keyboard/focus behavior, narrow layouts, no overflow, and
a clean console. No workspace explorer/export is expected.

## Implementation plan and approval status

1. Add the browser-safe zero-configuration Sandbox definition plus discovery,
   compiler, artifact, bundle, and strict workspace-seed validation.
2. Add Host policy intersection and immutable Desktop Sandbox Runtime Profile
   identity, including stale Direct and unavailable/lost failure projection.
3. Define the internal `SandboxProvider`/Session lease and staging/lifecycle
   contracts, fake conformance suite, and Host-owned registry/tombstones.
4. Implement the fixed Docker CLI provider, repository-owned image/helper,
   named-volume seed/reconnect/reconstruct/stop/delete behavior, and Pi
   `ExecutionEnv` adapter with process-group abort.
5. Add Turn attachment descriptors and atomic staging through Desktop Bun RPC;
   reuse Pi-native message content and add only the confirmed Sandbox
   attachment interaction states.
6. Allow protected Server provider injection while making the project OCI
   required-Sandbox path fail closed without Docker socket/self-container use.
7. Run focused and full tests, all relevant TypeScript, lint, browser/Bun
   bundles, renderer-only Vite, real Docker acceptance, real CEF audit, diff
   review, two-axis Standards/Spec review, and capability/roadmap/log updates.

Product-code implementation is not yet approved. Stop if implementation needs
source-configured provider authority, weaker network/secret isolation,
arbitrary Host paths or mounts, workspace recreation disguised as continuation,
a new message protocol, numeric resource policy, export/adoption, or another
architecture/security/permission/persistence/data-ownership decision.

## `$grill-me` requirements discussion

The owner confirmed all material decisions one at a time: abstract source
minimum and Host tightening; Docker reference seam; one Sandbox per Runtime
Session; one-time Session-owned workspace; Turn-owned attachment descriptors
with Session-owned bytes and exact limits; fixed no-network/no-secret image;
restart retention and tombstoned cleanup; no Thread-history rewind; Desktop and
Server profile authority; Pi-native message content; Bun-owned native file
selection/staging; in-container helper execution and process-group abort;
manual-mode real binding; source seed limits and manifest; named-volume rather
than Host bind storage; honest missing-volume failure; no workspace explorer/
export; deferred numeric quotas; and interface-first delivery with one real
Docker proof. Shared understanding was explicitly confirmed.

## Work performed

Added accepted ADR 0010 and the resolved Sandbox domain terms. Updated the
roadmap, bounded executor understanding/timeline, and capability map from
decision-blocked to planned V1. No product code or runtime data changed and
item 17 remains unchecked.

## Verification and review

Repository `bun run lint:check` and `git diff --check` pass. Documentation-only
review confirms the diff contains only accepted item-17 decisions, consistently
marks the capability planned/not shipped, leaves item 17 unchecked, does not
enter item 18, and does not modify Loopany configuration. TypeScript, tests,
bundles, and product-design/CEF acceptance are not applicable until product
implementation is approved.

## Follow-up product bets

After item 17, item 10 may use the shipped Sandbox contract for promotion.
Later capabilities may add numeric quotas, workspace export/adoption, Apple or
remote providers, and richer fleet cleanup without widening Agent source.

## Outcome

The architectural blocker is resolved and the item-17 implementation plan is
ready for explicit approval. Stop before product code; keep item 17 unchecked.
