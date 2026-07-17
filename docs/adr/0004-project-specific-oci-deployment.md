---
status: accepted
---

# Package each Agent as a project-specific OCI deployment image

## Context

Roadmap item 08 must deploy one compiled Agent through the protected Bun Server
without renaming a mutable source checkout as an artifact or introducing a
generic runtime loader. The item-05 artifact descriptor identifies an immutable
compiled Agent, but executable tool functions and connection credential
callbacks still live in its in-memory snapshot. ADR 0002 fixes the Server's
network, repository, credential, and shutdown semantics but intentionally does
not choose an OCI build, runtime-user, mounted-storage, or platform contract.

## Decision

### Deployment unit and build boundary

Each project-specific OCI image is the immutable **Agent Deployment Image**.
It contains exactly one Agent Artifact and the protected Bun Server. V1 does
not define a separately serialized executable artifact, generic Server image,
runtime artifact mount, registry product, or dynamic loader.

The CLI exposes:

```text
llm-space build [agent-project-directory] --target oci --output <directory>
```

It atomically creates a standard engine-neutral OCI build context and never
invokes Docker, Podman, Buildah, a registry, or a release service. The context
contains a Host bootstrap bundle, a separately loadable self-contained Agent
bundle, `artifact.json`, `environment.json`, a healthcheck script, and a
`Containerfile`. It contains no editable Agent source, host `node_modules`,
runtime package installation, credential, or secret value.

All non-built-in Agent, tool, connection, and local/npm dependencies must be
closed into the Agent bundle. An unresolved or external dependency fails the
build. V1 does not require every Agent Project to own a `package.json` or
`bun.lock`; item 09 remains responsible for the canonical template and preset
lifecycle.

The base is the official `oven/bun` Debian image at the exact Bun version used
to compile the artifact and at a repository-maintained OCI image-index digest.
Floating tags and build-time latest-version lookup are forbidden. The same
architecture-neutral build context produces `linux/amd64` and `linux/arm64`
manifests under one OCI image index.

### Identity

The Agent Artifact fingerprint and OCI image digest remain distinct. Runtime
Session lineage and artifact drift continue to use the item-05 fingerprint;
the image digest identifies the complete deployment bytes, including Server,
base image, and container configuration. OCI labels expose only non-secret
artifact schema/fingerprint, base digest, and available source revision.
Operators pin deployments by image digest rather than mutable tag.

At startup, the embedded descriptor, `artifact.json`, and compiled snapshot
fingerprints must agree before readiness. A compatible Server image update may
reuse a volume when the Agent fingerprint remains unchanged; an actual schema
change requires the explicit migration path from item 11.

### Declared environment and secret custody

`defineAgent()` gains a source-owned environment-requirement map. Each unique,
valid environment name declares `kind: "config" | "secret"`, an explicit
`required` boolean, and an optional non-sensitive description. Secret defaults
are forbidden. The compiled artifact contains names and classifications, never
runtime values. Agent, provider, tool, and connection requirements use this one
map; the Agent cannot redefine Server Host variables.

The generated `environment.json` combines Agent requirements with the fixed
OCI Host contract. V1 accepts Agent/provider/tool/connection secret values only
through the runtime process environment. It adds no secret-file convention,
managed-secret integration, or resolver product. Existing non-OCI direct-TLS
file handling remains available through `llm-space serve`, but the OCI V1
production profile uses an external trusted TLS terminator.

The image bootstrap has no authored code in its initial module graph. It
validates Host configuration, reads and parses `LLM_SPACE_SERVER_AUTH_KEYS`,
deletes that Server-only value from `process.env`, validates Agent environment
requirements and artifact identity, and only then dynamically imports the
Agent bundle. Agent-declared secrets remain process-scoped because current
trusted Pi providers and authored callbacks consume that boundary. No secret
may enter image config/history/layers, build context, artifact, log, error,
health/readiness response, Session repository, or Trace.

### Fixed OCI runtime profile

The project-specific entrypoint accepts no runtime project path or arbitrary
CLI arguments. It fixes:

```text
host              0.0.0.0
port              7331
localDev          false
repositoryRoot    /var/lib/llm-space
runtime user      1000:1000
shutdown timeout  8 seconds by default
```

The required Host environment is `LLM_SPACE_SERVER_AUTH_KEYS`,
`LLM_SPACE_SERVER_TRUSTED_PROXY_CIDRS`, and
`LLM_SPACE_SERVER_ALLOWED_HOSTS`. Exact CORS origins, active-Run capacity,
continuation TTL, and shutdown timeout remain optional declared Host settings.
The Agent cannot change bind address, port, repository root, local-dev mode, or
the embedded artifact.

Production traffic must arrive through the declared trusted TLS terminator
with non-conflicting forwarded HTTPS proof and an allowed public Host. The
image does not bundle a proxy, certificate, generated credential, or anonymous
fallback. Only loopback access to the minimal `/v1/health` and `/v1/ready`
endpoints may bypass the terminator; all business routes retain ADR 0002's
proxy, Host, principal, and Session authorization.

### Storage and lifecycle

The image declares `/var/lib/llm-space` as its only persistent volume and runs
the Bun Server as fixed non-root UID/GID `1000:1000`. The image prepares that
path with matching ownership, but the runtime never elevates, changes
ownership, migrates, empties, or repairs a mounted path. The operator must
provide a writable named volume or bind mount with compatible ownership.

Unwritable storage, artifact mismatch, unsupported repository schema, or an
existing writer lock fails before readiness. The volume is one-Server,
single-writer storage; V1 makes no network-filesystem, shared-volume,
distributed-lock, replication, or autoscaling claim. Retention, stopped-Server
backup, and deletion remain operator responsibilities under ADR 0002.

The exec-form entrypoint makes Bun PID 1 and the image stop signal is
`SIGTERM`. OCI healthcheck targets readiness through an in-image Bun probe;
liveness remains independently available. Shutdown immediately fails
readiness, aborts and drains work through the existing Server lifecycle, and
closes the repository. The container stop grace period must exceed the
configured Server timeout by at least two seconds; the V1 defaults of eight
and ten seconds satisfy that relationship. Timed-out external work retains the
existing honest `outcomeUnknown` recovery behavior.

### Acceptance

A non-release GitHub Actions OCI workflow builds the standard context and
actually starts both Linux architectures, using native execution when
available and QEMU when necessary. It verifies image configuration and secret
absence, health/readiness, authenticated Session creation, fixed non-root and
volume permissions, single-writer and artifact-mismatch rejection,
`SIGTERM`, stop/recreate persistence, and the two-platform image index. It does
not push a registry image, sign, notarize, or create a release.

Container acceptance does not require paid provider access. When a real
provider credential is supplied it adds a live Pi Run; otherwise that check is
explicitly skipped while deterministic Server tests continue to prove Pi Run,
SSE terminal, abort, and reconnect semantics. Missing required production
credentials still prevent readiness; the optional live smoke does not weaken
the product contract.

## Considered options

- Copying the monorepo and Agent source into `oven/bun` was rejected because it
  recompiles mutable source at startup and does not establish an artifact or
  closed dependency boundary.
- A generic Server image with a mounted serialized artifact was deferred
  because it requires a new executable format, runtime trust boundary, and
  registry/loading lifecycle explicitly outside item 05 and item 08.
- Bundling a fake provider into the production image was rejected because it
  creates a test-only execution bypass. Deterministic injected-model tests and
  optional live smoke preserve the production boundary.

## Consequences

Every Agent change requires a new project-specific image build. Operators own
the OCI engine, image tag/digest publication, TLS terminator, runtime secret
injection, stop grace period, and single-writer volume lifecycle. The Server
protocol remains the version-pinned Pi event protocol from ADR 0002; this
decision adds no cloud control plane, managed secrets, public registry, SBOM,
signing/attestation, sandbox, distributed storage, or deployment UI.
