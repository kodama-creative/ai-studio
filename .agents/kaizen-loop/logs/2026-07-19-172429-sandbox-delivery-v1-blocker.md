# Sandbox, Workspace, And Attachment Delivery V1 Blocker

- Status: done
- Outcome: blocked
- Roadmap item: 17

## Trigger and starting state

The owner asked to continue the roadmap after item 16. `develop` started clean
and synchronized at `c47c738`. Item 17 is the lowest unchecked dependency-ready
item. This pass did not inspect or implement item 18 and did not change any
Loopany schedule, goal, enabled state, task-file configuration, or runtime
state.

## Product stage and evidence reviewed

LLM Space now has canonical read/write/bash declarations and a Host injection
seam for Pi `ExecutionEnv`, but there is no production provider. Reviewed
`AGENTS.md`, `LOOP_TASK.md`, `LOOP_PLAN.md`, `CONTEXT.md`, ADRs 0003, 0004,
0006, and 0009, the capability map, the three latest kaizen logs, Thread
Runtime Profile types and UI, Agent definition/discovery/artifact paths,
Desktop Thread image attachments, Runtime and Server message boundaries,
workspace seed code, OCI build/acceptance code, pinned/current Pi ExecutionEnv,
local `pi-eve`, local engine availability, and current real Electrobun CEF.

The current CEF run used an isolated temporary `LLM_SPACE_HOME` and a copied
reference Agent. Its semantic Runtime Profile menu shows `Desktop Direct —
Selected`, disabled `Desktop Sandbox — Unavailable`, the exact explanation
`Unavailable until isolated workspace execution ships; never falls back.`, and
`Local Server`. The application console contained only Vite/React development
information. The temporary runtime data was removed after inspection.

## External market and upstream scan

Primary sources accessed 2026-07-19:

- https://code.claude.com/docs/en/sandboxing.md
- https://github.com/apple/container/blob/main/README.md
- https://github.com/apple/container/blob/main/docs/command-reference.md
- https://github.com/docker/docs/blob/main/content/manuals/engine/storage/bind-mounts.md
- https://github.com/docker/docs/blob/main/content/manuals/engine/network/drivers/none.md
- https://github.com/earendil-works/pi/blob/main/packages/agent/src/harness/types.ts
- https://github.com/earendil-works/pi/blob/main/packages/agent/src/harness/env/nodejs.ts

Table stakes are an explicit writable working directory and temp directory,
filesystem and network isolation enforced below the tool process, credential
protection, observable dependency readiness, strict fail-unavailable mode,
bounded Host-approved widening, and deterministic container deletion. Claude
Code exposes sandbox availability and can enforce `failIfUnavailable`; its
default unsandboxed fallback is explicitly incompatible with this roadmap's
required-sandbox boundary. Docker documents that bind mounts can mutate Host
files unless narrowed/read-only and offers `--network none`. Apple `container`
offers OCI containers, copy, mounts, exec, inspect and delete but currently
requires Apple silicon plus macOS 26 and remains pre-1.0.

The true product gap is not the Pi filesystem interface. It is the authority
and delivery contract that decides who may require isolation, which Host
provider fulfills it, which bytes enter the Session workspace, and who retains
or deletes them. Official Codex security documentation was inaccessible from
this environment through Cloudflare, while the public Codex repository only
redirected to that page. No Docker, Podman, or Apple `container` executable is
installed locally, so real provider acceptance is currently unavailable here.

## Capability-map freshness

`Portable Execution Tools` remains confirmed shipped. Added `Sandbox Workspace
And Attachment Delivery` as confirmed not shipped and decision-blocked from
current code plus current CEF evidence. Studio Local Server/Runtime Profile and
Thread attachment boundaries remain confirmed. No stale or unknown capability
was used to select the recommendation.

## Product north-star metric

- Name: sandbox isolation and delivery acceptance rate.
- Reason: a portable Agent must complete useful filesystem/process work without
  gaining Host authority or losing its Session workspace and inputs.
- Baseline: 0 runnable Sandbox profiles, 0 source workspace seeds delivered,
  and 0 Runtime/Server attachments staged into an isolated environment.
- Target: 100% of a required matrix passes for source/Host selection, unavailable
  fail-closed behavior, cross-Session filesystem isolation, immutable source
  seed delivery, traversal/symlink-safe attachments, restart retention, and
  one successful cleanup/reaping owner on a real local container provider.
- Measurement: compiler/artifact/policy fixtures, fake-provider lifecycle and
  fault injection, adversarial staging fixtures, real engine acceptance, Host
  restart/delete tests, Desktop/Server integration, and real CEF profile audit.
- Guardrails: no arbitrary Host path, Agent source mount/write-back, secret or
  provider credential copied into the container, silent Direct/Node fallback,
  source-owned engine credential, packaging/release command, or regression in
  item-16 Pi tool behavior.

## Candidate opportunities

Main recommendation: let Agent source declare only an abstract minimum
execution class (`sandbox` versus no minimum), then intersect it with a Host
Runtime Profile/policy that selects the concrete provider and may only tighten.
Use one Session-scoped OCI container, one fixed environment-addressed
`/workspace`, copied source `workspace/` seeds rather than a source bind mount,
controlled attachment staging, no network or Host secrets by default, and one
Host-owned restart/retention/reaping registry. Keep the provider contract
engine-neutral and use Docker CLI as the first reference because the desktop
ships arm64 and x64; Apple `container` remains a later adapter unless its
platform/stability boundary is explicitly accepted.

Alternative 1: make Sandbox a Thread-only profile with no source requirement.
This is simpler but cannot satisfy authored environment selection, allows a
required Agent capability to be accidentally run Direct, and leaves ADR-0006
promotion unable to express its Sandbox minimum.

Alternative 2: let Agent source name Docker/Apple engines, images, mounts,
network, and retention. This is flexible but makes portable source Host-specific
and lets source request authority and lifecycle policy, so it is deferred as an
unsafe inversion of Host ownership.

## Main recommendation and why now

The abstract-source-minimum × concrete-Host-provider split matches existing
artifact identity, immutable Thread Runtime Profiles, and item-14 policy
intersection. It also lets item 10 promote filesystem/bash intent without
silently choosing a local engine. Item 16 has removed the tool-contract risk;
item 17 must now resolve the surrounding authority before more capabilities
depend on it.

## Recommended V1 capability and non-goals

After V1, an author can require the abstract Sandbox class. Studio can create a
fresh Desktop Sandbox Thread only when its local provider is ready; the profile
never downgrades. One container belongs to one Runtime Session, sees only a
fixed workspace namespace, receives a validated copy of optional portable
`agent/workspace/` seed bytes and controlled Host attachments, survives the
approved restart window, and is deleted with its owned workspace by one
lifecycle manager.

The proposed minimal policy is network disabled and no Agent/provider/Host
secret values inside helper processes. Exact source syntax, provider/image,
workspace persistence window, attachment representation/limits, crash reaper,
and cleanup retry semantics remain subject to owner decisions. V1 excludes
Vercel Sandbox, Firecracker fleet, arbitrary mounts, source write-back,
approval, cloud orchestration, registry product, source-owned provider config,
and generic network/credential forwarding.

## Acceptance and audit plan

Acceptance must prove an actual container cannot read another Session, Agent
source, Desktop data, credentials, or undeclared Host paths; cannot use network
under the V1 default; can execute the item-16 tools inside `/workspace`; and
retains/deletes only the approved bytes across normal stop, Desktop restart,
crash recovery, explicit Thread/Session deletion, and partial cleanup failure.
Workspace discovery must reject symlinks and unsupported entries. Attachments
must reject traversal, duplicate/ambiguous names, symlinks, oversized payloads,
unsupported types if constrained, and partial staging.

The future UI audit must verify provider readiness/unavailable/error states,
fresh-Thread profile selection, required-source behavior, immutable profile
after first Run, attachment staging status/failure, keyboard and focus behavior,
narrow layout, clean console, and never-fallback copy. Real engine acceptance
is a hard gate; fake adapters alone cannot close the roadmap item.

## Implementation plan and approval status

If approved, first record a Sandbox authority ADR, then add the source minimum
and artifact identity, Host policy intersection, a provider/lifecycle contract,
portable workspace discovery and immutable seed fingerprinting, attachment
input/staging types, a real local-container adapter, Desktop Sandbox profile
binding, Server/Runtime propagation, retention/reaping, adversarial tests, real
engine acceptance, real CEF audit, all TypeScript/lint/non-packaging builds, and
two-axis review.

Implementation is not approved. Stop if source can choose concrete Host
provider details, if a required Sandbox could downgrade, if staging needs an
arbitrary Host path/source mount, if secrets/network are exposed without a new
decision, if cleanup ownership is ambiguous, or if no real engine can be used
for acceptance.

## `$grill-me` requirements discussion

The design tree contains new permission, persistence, and data-ownership
decisions, so the roadmap requires owner approval one question at a time. The
first pending question is: may Agent source require the abstract Sandbox class,
with Host policy choosing the concrete provider and allowed to tighten a Direct
Agent to Sandbox but never weaken a required Sandbox to Direct? Provider,
workspace, attachment, network/secret, retention, and cleanup questions follow
only after this authority relationship is fixed.

## Work and verification

No product code was changed. The capability map, roadmap evidence, bounded
executor understanding, and this log record the changed blocker. The isolated
CEF development run was the repository-approved `dev:cef` path; no Electrobun
packaging, canary/stable build, signing, notarization, or release command ran.
Documentation lint and diff checks pass, and the final diff contains only this
item-17 discovery evidence.

## Review, risks, and follow-ups

Review confirmed that reusing Desktop's application `workspace/` would merge
Thread/project storage with sandbox Session data, while reusing inline image
messages as general attachments would merge transcript evidence with staged
files. Both would be data-ownership errors. It also confirmed that Apple
`container` cannot be the sole reference provider while macOS x64 remains a
shipped architecture, and that a fake-only Docker adapter cannot demonstrate
the Done-when isolation claim.

After the authority decision, the next highest-risk questions are the concrete
reference engine/image and whether Session workspace is retained through Host
restart. Only then should attachment identity and cleanup/reaping be fixed.

## Outcome

Blocked before implementation on new source/Host permission, provider,
workspace persistence, attachment ownership, network/secret, and cleanup
decisions. Item 17 remains unchecked. Stop this pass and ask the first
source-minimum versus Host-authority question; do not enter item 18.
