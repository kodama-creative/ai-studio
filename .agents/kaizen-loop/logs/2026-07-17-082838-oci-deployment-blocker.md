# OCI Deployment V1 Contract Blocker

- Status: done
- Outcome: blocked
- Roadmap item: 08

## Trigger

The user requested the next bounded roadmap pass after item 07 completed. The
pass started on `develop` at `4809d18`, synchronized with `origin/develop`,
with a clean worktree. Item 08 is the lowest-numbered unchecked item whose
dependency, item 06, is complete.

## Product stage and context

Items 05 and 06 provide an inspectable artifact identity and a protected Bun
HTTP/SSE Server. ADR 0002 fixes network authentication, Server Session
ownership, the single-process atomic repository, public health/readiness,
restart behavior, and bounded graceful shutdown. It deliberately left OCI
packaging to item 08.

The remaining gap is not merely a missing Dockerfile. The compiler returns an
in-memory executable snapshot whose tool functions and connection auth/header
callbacks are not serializable; its `artifact` member is a plain-data identity
descriptor. The CLI still accepts a source directory and recompiles trusted
Agent modules at every process start.

## Evidence reviewed

- `AGENTS.md`, `LOOP_TASK.md`, `LOOP_PLAN.md`, `CONTEXT.md`, ADRs 0001-0003,
  current git status/history, capability map, and the three latest relevant
  kaizen logs.
- `packages/runtime` artifact descriptor, project loader, executable snapshot
  types and README; `packages/server` lifecycle/repository/API; `packages/cli`
  serve configuration and signal handling; root/package workspace metadata;
  and the canonical `apps/example-agent` project.
- Repository-wide searches found no OCI build command, Dockerfile,
  Containerfile, compose file, deployment artifact loader, or container
  acceptance fixture.
- Host tool discovery found no `docker`, `podman`, `buildah`, or `nerdctl`.
  This limits later local acceptance but does not cause the design blocker.
- The existing Loopany executable was not available in this shell. No Loopany
  schedule, goal, enabled state, or task-file setting was read or changed.

## External market scan

Access date: 2026-07-17.

Primary sources:

- Bun Docker guide: https://bun.com/docs/guides/ecosystem/docker
- OCI Image Configuration: https://github.com/opencontainers/image-spec/blob/main/config.md
- OCI Image Index: https://github.com/opencontainers/image-spec/blob/main/image-index.md
- Docker build best practices: https://docs.docker.com/build/building/best-practices/
- Dockerfile reference: https://docs.docker.com/reference/dockerfile/
- Docker volume storage: https://docs.docker.com/engine/storage/volumes/
- Docker multi-platform builds: https://docs.docker.com/build/building/multi-platform/

Table stakes are a trusted minimal/pinned base, multi-stage production build,
non-root runtime identity, exec-form PID 1 so `SIGTERM` reaches Bun, an explicit
stop signal, an external persistent mount, a health probe, no baked secrets,
and architecture-specific manifests under one image index when a single image
name must work on amd64 and arm64. OCI itself exposes `User`, `Env`, `Volumes`,
`Entrypoint`, `WorkingDir`, and `StopSignal`, but leaves their values to the
image producer; `Healthcheck` is reserved for compatibility rather than a
portable readiness policy.

The true product gap is therefore an approved deployment contract connecting
the LLM Space executable artifact and Server repository to those explicit OCI
choices. Copying the repository into a Bun image would demonstrate a container
but would not prove startup "from artifact" or a stable declared environment.
Uncertainty is material around artifact serialization/build boundaries,
runtime UID and pre-existing mount ownership, provider/tool/connection
environment declarations, and whether "platform-neutral" means a Linux
amd64+arm64 index in V1.

## Capability-map freshness

- `Agent Definition And Runtime`: confirmed. Artifact identity exists, but
  serialized artifact files/registries and source-declared environment
  variables remain explicit gaps.
- `Independent Agent Serving`: confirmed. Health, readiness, single-writer
  storage, environment-hosted credentials, and graceful shutdown can be reused.
- `Studio Runtime Profiles And Server Trace Handoff`: confirmed but not changed;
  item 08 has no Desktop UI surface.
- `OCI Agent Deployment`: added as confirmed blocked from current code and host
  tooling evidence.
- Product-design audit and Electrobun CEF are not applicable because this pass
  changes no UI or product interaction.

## Product north-star metric

- Name: clean-environment deployment completion.
- Why it matters: a portable Agent is deployable only when an operator can
  start the exact built capability on a fresh host without repository source
  repair or implicit local state.
- Baseline: zero OCI image/build contract and zero clean-container acceptance
  runs; only source-directory `llm-space serve` is available.
- V1 target: one deterministic example Agent starts from the approved image and
  declared runtime environment on a clean Linux container, becomes healthy and
  ready, completes an authenticated Server run, retains the Session across
  container replacement on the declared mount, and settles cleanly on
  `SIGTERM`; the same image reference resolves the approved architecture set.
- Measurement: clean build with no host `node_modules`, image inspection,
  health/readiness requests, authenticated run/replay, stop/recreate persistence,
  graceful-shutdown timing and terminal-state assertions, architecture
  inspection, package tests/TypeScript/lint/non-packaging bundles, and final
  Standards/Spec diff review.
- Guardrails: no baked credentials, root runtime by accident, writable Agent
  source, hidden storage outside the mount, shared/distributed writer claim,
  new wire protocol, cloud/operator scope, Electrobun packaging, signing,
  notarization, or release command.

## Candidate product opportunities

1. Main recommendation: approve an OCI deployment ADR before implementation.
   It must choose the executable artifact/build boundary, exact declared
   environment and secret injection contract, non-root UID/GID plus fresh and
   existing mount ownership rules, and the Linux architecture set.
2. Alternative: copy the monorepo and Agent Project source into `oven/bun` and
   run the existing CLI. Rejected for V1 because startup still compiles mutable
   source and the image does not establish a standalone compiled-artifact
   contract or minimal build context.
3. Alternative: create a generic Server image that accepts a mounted artifact
   at runtime. Deferred because it first requires a serialized executable
   artifact format and dynamic trusted loader, broadening item 08 into the
   artifact-registry/loading architecture explicitly excluded from item 05.

## Main recommendation

Keep ADR 0002's HTTP/SSE, Server lifecycle, repository, and secret-redaction
contracts unchanged. Before writing product code, approve a narrow item-08 ADR
that answers:

1. Is each project-specific image itself the immutable deployment artifact,
   built from trusted source and a locked workspace, or must the runtime load a
   separately serialized artifact? What files and executable callbacks cross
   that boundary, and how is the item-05 fingerprint verified?
2. Which non-secret environment names are declared by the Agent/runtime, how
   are provider/tool/connection secret values injected only at container run
   time, and are file-based secrets part of V1?
3. Which fixed non-root UID/GID runs Bun, which path is the sole writable
   Server mount, and who initializes or repairs ownership for empty and
   pre-existing volumes without silently escalating to root?
4. Does platform-neutral V1 require both `linux/amd64` and `linux/arm64` under
   one OCI image index, and what is the accepted native/emulated CI evidence?

The preferred narrow direction is a project-specific immutable image rather
than a generic dynamic artifact loader, but that preference is not approved and
no implementation may encode it yet.

## V1 capability definition

After approval, an operator can build one immutable Agent deployment image,
provide only the declared non-secret configuration and runtime-injected
secrets, mount the documented single-writer Server data path, observe existing
`/v1/health` and `/v1/ready`, and stop/recreate the container without losing a
settled Session. The Bun process receives `SIGTERM` directly and uses the
existing bounded shutdown behavior.

Explicit non-goals: Vercel, Cloudflare, Kubernetes operator, autoscaling,
managed secrets, hosted control plane, dynamic multi-project loading,
distributed/shared storage, public artifact registry, SBOM, signing,
attestation, or a new message protocol.

Stop condition reached: any container implementation now would silently choose
new architecture, security, permission, persistence, and data-ownership rules.

## Acceptance and audit plan

After ADR approval, acceptance must use an actual OCI-compatible engine or CI
runner and a build context without host dependencies. It must inspect the image
user/entrypoint/stop signal/declared volume and platforms; prove no secret is in
image history/config/layers; start with a fresh mount and declared environment;
check liveness before readiness and readiness after recovery; create and
complete an authenticated deterministic run; force observation reconnect;
stop with `SIGTERM`; recreate on the same mount; and verify persisted replay
without duplicate events. A wrong/unwritable mount and missing required
environment must fail before readiness with safe output.

Relevant Bun tests, package TypeScript, repository lint, browser/Server
non-packaging bundles, renderer-only Vite, `git diff --check`, and two-axis
Standards/Spec review remain required. No UI audit is planned.

## Implementation plan and approval status

1. Human approves the four OCI deployment contract branches above and records
   them in an accepted ADR.
2. Add the smallest artifact-aware build command and project-specific image
   layout permitted by that ADR, without adding a generic registry or loader.
3. Reuse the CLI/Server endpoints and shutdown path; add only the container
   entrypoint/configuration and declared storage/environment surface.
4. Add clean-engine acceptance for health/readiness, auth/run/replay,
   stop/recreate persistence, secret absence, non-root permissions, and the
   approved platforms.
5. Run all non-packaging gates and review, then update roadmap/capability/log
   evidence and check item 08 only if every Done-when clause is demonstrated.

Approval status: item-08 outcome is pre-approved, but implementation is blocked
on new material architecture, security, permission, persistence, and data
ownership decisions.

## `$grill-me` requirements discussion

Not invoked. `LOOP_TASK.md` requires the executor to stop rather than let an
agent choose a new design branch. The four human decisions are recorded above
for a future approval discussion.

## Work performed

- Reconciled the current artifact and Server implementation against item 08.
- Confirmed the protected Server lifecycle can be reused but the deployment
  artifact and container contracts do not exist.
- Completed a current primary-source OCI/Bun/Docker market scan.
- Checked local container-engine availability.
- Updated only roadmap operating evidence, capability evidence, and this log;
  no product code or Loopany configuration changed.

## Verification and product-design audit results

No implementation was attempted, so code tests, TypeScript, lint, container
execution, and UI audit are not applicable. The repository began clean and
synchronized. `git diff --check` passes, and the final documentation diff was
reviewed against both repository standards and the item-08 Done-when contract.
No Electrobun packaging, signing, notarization, release, or other forbidden
command ran.

## Review

The source-copy Dockerfile shortcut was reviewed against the item-05 and
item-08 contracts. It would rename a source checkout as a compiled artifact,
leave build inputs and environment implicit, and choose root/volume/platform
behavior by accident. A generic mounted-artifact image would require a new
serialized executable format and runtime trust boundary. Neither is a safe
pre-approval slice.

The existing Server already has appropriate endpoint and signal primitives;
those do not resolve the new image and storage-ownership choices. Lack of a
local container engine is an additional future verification dependency, not a
reason to invent or weaken the contract.

Final review found no standards or spec mismatch in the bounded blocker
record. The roadmap item remains unchecked, the capability map distinguishes
confirmed shipped Server behavior from the blocked deployment surface, and no
implementation claim exceeds current evidence.

## Follow-up product bets

1. Resume item 08 after approving its OCI deployment ADR.
2. Item 09 canonical template work remains separate and must not begin in this
   pass.
3. Artifact registries, SBOM/signing/attestation, and hosted deployment remain
   possible later bets, not V1 scope.

## Outcome

Blocked. Item 08 remains unchecked. Human approval is required for the
executable artifact/build boundary, declared environment and runtime secret
injection, fixed non-root identity and mounted-storage ownership/bootstrap, and
the target Linux architecture set. This pass stops without product code and
does not begin item 09.
