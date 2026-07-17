# OCI Deployment V1 Decision And Implementation Plan

- Status: done
- Outcome: design approved; implementation awaiting approval
- Roadmap item: 08

## Trigger

The user asked to begin the decisions blocking roadmap item 08. The decision
session started from clean, synchronized `develop` at `dd77365`, after the
bounded blocker pass had already confirmed that current executable snapshots
are not serialized deployment artifacts.

## Product stage and context

The Agent Artifact and protected Server exist, but the product has no
deployment-image boundary. This session resolved the architecture, security,
permission, persistence, lifecycle, and verification branches that the roadmap
executor was forbidden to choose autonomously. No product implementation was
authorized or attempted.

## Evidence reviewed

- `AGENTS.md`, roadmap/executor/context documents, ADRs 0001-0003, current
  source/artifact/Server/CLI/example-project contracts, capability map, recent
  kaizen logs, and clean git state.
- Official Bun Docker image guidance and source. The Debian and Alpine images
  define `bun` as UID/GID `1000:1000`, while the application image must
  explicitly select that user.
- OCI image configuration/index, Docker build, Dockerfile, volume, signal,
  healthcheck, and multi-platform primary documentation from the preceding
  blocker pass.
- Current Pi provider documentation confirms provider credentials are resolved
  through environment input; the current OpenAI built-in offers no general
  local base-URL override suitable for a deterministic production-image smoke.
- The repository has only an Electrobun release workflow and this host has no
  Docker, Podman, Buildah, or nerdctl, so container execution requires a new
  non-release CI gate or future local engine.

## External market scan

Access date: 2026-07-17. Sources and table-stakes conclusions remain those in
the completed blocker record:

- https://bun.com/docs/guides/ecosystem/docker
- https://github.com/opencontainers/image-spec/blob/main/config.md
- https://github.com/opencontainers/image-spec/blob/main/image-index.md
- https://docs.docker.com/build/building/best-practices/
- https://docs.docker.com/reference/dockerfile/
- https://docs.docker.com/engine/storage/volumes/
- https://docs.docker.com/build/building/multi-platform/
- https://github.com/oven-sh/bun/blob/main/dockerhub/debian/Dockerfile

The approved contract uses a pinned official base, closed production bundle,
non-root runtime, explicit single-writer volume, direct PID-1 signal handling,
readiness healthcheck, runtime-only secrets, and two platform manifests. The
true differentiation is that these defaults bind to LLM Space's immutable
Agent and protected Server authority rather than being a generic Dockerfile.

## Capability-map freshness

- `Agent Definition And Runtime`: confirmed; ADR 0004 preserves item-05 Agent
  identity and adds no generic artifact loader.
- `Independent Agent Serving`: confirmed; OCI reuses ADR 0002 protocol,
  principal, repository, recovery, and shutdown semantics.
- `OCI Agent Deployment`: updated from blocked to approved design with
  implementation pending.
- No Desktop UI changes are planned, so CEF and product-design audit remain not
  applicable.

## Product north-star metric

- Name: clean-environment deployment completion.
- Why it matters: an Agent is deployable only when the exact built capability
  starts on a fresh Linux host without source repair or implicit local state.
- Baseline: no OCI build context or clean-container acceptance exists.
- V1 target: the same image reference resolves running amd64 and arm64
  variants; each becomes healthy/ready from declared environment, creates an
  authenticated persistent Session, stops through SIGTERM, and recovers the
  Session after container replacement on the same mount.
- Measurement: context determinism and secret-absence tests, bundle/bootstrap
  fixtures, image inspection, actual two-platform container smoke, optional
  live provider Run when credentials exist, package/repository gates, and final
  Standards/Spec review.
- Guardrails: no secret in build/image/product data, root runtime, hidden
  persistent path, shared writer, source recompilation at startup, new message
  protocol, test provider in production, cloud control plane, registry push,
  packaging, signing, notarization, or release command.

## Candidate product opportunities

1. Approved main recommendation: a project-specific Agent Deployment Image
   built from a standard engine-neutral context.
2. Rejected: source-copy image running `loadAgentProject()` at startup; it does
   not satisfy compiled-artifact or closed-build semantics.
3. Deferred: generic Server image plus mounted serialized artifact; it requires
   a new executable format, dynamic trust boundary, and registry/loader
   lifecycle beyond V1.

## Main recommendation and V1 capability

ADR 0004 is the accepted contract. The CLI compiles one project into a
self-contained two-stage bootstrap/Agent bundle and standard Containerfile.
The resulting project-specific image runs behind a trusted TLS terminator as
UID/GID `1000:1000`, persists only at `/var/lib/llm-space`, validates declared
environment before readiness, reports readiness through OCI healthcheck, and
drains for eight seconds under a default ten-second SIGTERM grace period.

The image supports linux/amd64 and linux/arm64 under one image index. It keeps
the Agent Artifact fingerprint distinct from the full OCI digest. It neither
publishes nor signs an image and does not add a cloud, registry, managed-secret,
sandbox, distributed-storage, or deployment-UI product.

## `$grill-me` requirements discussion

The user confirmed every material branch one at a time:

1. project-specific image as deployment unit;
2. explicit compiled environment requirements;
3. runtime-environment secret injection only;
4. fixed non-root `1000:1000`;
5. `/var/lib/llm-space` single-writer mount with no runtime chown/repair;
6. linux/amd64 plus linux/arm64 image index;
7. readiness as OCI healthcheck and separate liveness;
8. eight-second Server drain within a ten-second stop grace;
9. CLI-generated standard context without engine invocation;
10. exact Bun Debian base version and digest;
11. `defineAgent().environment` as source ownership;
12. trusted external TLS terminator as OCI production baseline;
13. separate Agent fingerprint and OCI digest;
14. fixed container topology with bounded environment overrides;
15. self-contained dependency closure with no install in image;
16. bootstrap secret scrubbing before dynamic Agent import;
17. optional live-provider smoke without weakening readiness; and
18. a non-release GitHub Actions two-platform execution gate.

The user then confirmed the consolidated shared understanding. No ambiguity
remains in target user/job, must-have behavior, non-goals, acceptance,
persistence/secret ownership, risks, or stop conditions.

## Exact implementation plan

1. Extend the runtime public Agent definition with validated immutable
   environment requirements. Compile their name/kind/required/description into
   the artifact capability and environment-requirement fingerprints. Add
   schema, normalization, duplicate/name/default rejection, deep-freeze, and
   deterministic cross-root tests without changing environment values.
2. Add a Node/Bun compiler surface that captures the already-validated project
   snapshot once and emits a closed Agent entry. Bundle all non-built-in
   authored and runtime dependencies; reject unresolved/external dependencies,
   source maps, absolute-root leakage, nondeterministic output, and any secret
   value. Prove local tool and MCP callback identity survives the bundle.
3. Add an OCI context generator under the CLI/compiler boundary. Stage output
   atomically and refuse unsafe overwrite. Emit versioned `artifact.json` and
   `environment.json`, separate bootstrap/Agent bundles, an in-image Bun
   readiness probe, and a generated `Containerfile` from the repository-locked
   exact Bun Debian image-index digest.
4. Implement the bootstrap as a deep boundary: reject arguments and mutable
   topology, parse/validate bounded Host environment, read and delete Server
   auth keys before authored imports, validate required Agent environment and
   all fingerprints, then import the Agent bundle and compose the existing
   `startAgentServer()` with built-in Pi models.
5. Make the minimal Server change required by ADR 0004 so only loopback peers
   may access public health/readiness without trusted-proxy forwarding. Keep
   Host/proxy/auth/Session checks unchanged and ahead of every business route.
   Add focused bypass, spoofing, Host, shutdown-readiness, and privacy tests.
6. Generate fixed image configuration: `0.0.0.0:7331`, non-root
   `1000:1000`, `/var/lib/llm-space` volume and repository root, exec-form Bun
   entrypoint, `SIGTERM`, readiness healthcheck, and eight-second default drain.
   Ensure no other image path is treated as persistent product state.
7. Extend `llm-space build` parsing/help for `--target oci --output`, keeping
   `serve` behavior and direct TLS unchanged. Document the declared Host/Agent
   environment, trusted-terminator topology, volume UID/GID preparation,
   digest pinning, stop-grace relationship, Buildx/Podman/Buildah consumption,
   and explicit non-goals.
8. Add deterministic tests for atomic context creation, collision/rollback,
   context contents, stable bytes, dependency closure, base lock, labels,
   environment manifest, secret scanning, and example-Agent tool execution.
9. Add one Bun-driven OCI acceptance script and a separate non-release GitHub
   Actions workflow. Build and run linux/amd64 and linux/arm64; inspect user,
   volume, entrypoint, stop signal, healthcheck, labels, base and index; exercise
   trusted-proxy Session creation, stop/recreate persistence, bad permissions,
   artifact mismatch, concurrent writer, and SIGTERM. Run a live Pi turn only
   when a real provider credential is present and otherwise report it skipped.
10. Run focused and full Bun tests, Runtime/Server/CLI/example/Desktop
    TypeScript, touched and repository lint, browser-safe Runtime bundles, Bun
    Server bundle, renderer-only Vite, `git diff --check`, the two-platform OCI
    workflow, and final Standards/Spec diff review. Update roadmap/capability
    evidence and check item 08 only after every Done-when clause is demonstrated.

Stop and return for approval if implementation needs a serialized runtime
artifact, generic loader, secret-file/resolver protocol, different UID/storage
ownership, mutable topology, additional platforms, registry publication,
sandbox, distributed storage, or any other architecture/security/persistence
branch not settled by ADR 0004. Stop as blocked if the approved two-platform
runtime verification cannot be executed.

## Approval status

The architecture and requirements are explicitly approved. Product-code
implementation has not yet been authorized after this exact plan; the next
step is to request that approval before editing implementation files.

## Work performed

- Ran the complete one-question-at-a-time `$grill-me` decision tree.
- Cross-checked Bun image user identity, Pi provider environment behavior,
  current project dependency shape, Server lifecycle, and CI availability.
- Recorded accepted ADR 0004 and stable domain language.
- Updated roadmap operating memory and capability evidence from blocked to
  approved design.
- Did not modify product code, Loopany configuration, release state, or any
  external deployment.

## Verification and review

This is a documentation-only decision gate. Product tests, TypeScript, lint,
container execution, and UI audit are not applicable until implementation.
`git diff --check` passes. Final Standards/Spec review confirms that ADR 0004
preserves ADR 0002's Pi protocol, secret custody, repository, and lifecycle
authority; keeps item 08 unchecked without implementation evidence; and does
not pull item 09 or any explicit non-goal into scope. No forbidden packaging,
signing, notarization, or release command ran.

## Follow-up product bets

1. Implement and verify item 08 after explicit approval of the exact plan.
2. Keep item 09 canonical templates separate; V1 OCI builds the current
   project shape without imposing a new per-project lockfile.
3. Revisit secret files/resolvers, registries, SBOM/signing/attestation, and
   hosted deployment only in separately approved later loops.

## Outcome

The design blocker is resolved and ADR 0004 is accepted. Item 08 remains
unchecked because no product implementation or container evidence exists yet.
