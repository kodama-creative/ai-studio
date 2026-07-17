# OCI Deployment

LLM Space can compile one Agent Project into an engine-neutral OCI build
context. The resulting image is project-specific: it contains one immutable
Agent Artifact and the protected Bun Server, with no editable project source,
runtime package installation, or host `node_modules`.

## Generate a build context

Run the CLI with Bun 1.3.14:

```sh
bun packages/cli/src/index.ts build ./apps/example-agent \
  --target oci \
  --output ./oci-context
```

The output directory must not exist. Creation is staged beside the destination
and refuses to overwrite another path. The CLI only writes this standard
context; it never invokes an image engine or registry.

```text
oci-context/
├── Containerfile
├── agent.bundle.mjs
├── artifact.json
├── bootstrap.mjs
├── environment.json
└── healthcheck.mjs
```

`artifact.json` retains the Agent fingerprint used for Session lineage.
The OCI image digest identifies the larger deployment, including the Server,
base image, and image configuration. These identities are intentionally
different.

The generated `Containerfile` pins
`oven/bun:1.3.14-debian` to the repository-maintained image-index digest. An
OCI build fails when the local Bun compiler does not match that locked version.

## Build with an OCI engine

Docker Buildx can create the required two-platform OCI image index without
publishing it:

```sh
docker buildx build \
  --file ./oci-context/Containerfile \
  --platform linux/amd64,linux/arm64 \
  --output type=oci,dest=agent-image.tar \
  ./oci-context
```

For one local architecture, Docker, Podman, and Buildah consume the same
context:

```sh
docker build -f ./oci-context/Containerfile -t example-agent:local ./oci-context
podman build -f ./oci-context/Containerfile -t example-agent:local ./oci-context
buildah bud -f ./oci-context/Containerfile -t example-agent:local ./oci-context
```

Publishing, mutable-tag policy, retention, signing, and attestations belong to
the operator. LLM Space V1 does not provide a registry or release service.

## Declare Agent environment

Agent source owns names and classifications, never values:

```ts
import { defineAgent } from "@llm-space/runtime";

export default defineAgent({
  model: "openai/gpt-5.3-codex",
  environment: {
    LOG_LEVEL: {
      kind: "config",
      required: false,
      description: "Optional application log level"
    },
    OPENAI_API_KEY: { kind: "secret", required: true }
  }
});
```

`environment.json` lists these requirements and the fixed Host contract. It
never contains runtime values. Do not use build arguments, `ENV`, copied files,
or image labels for secrets. Supply values only through the container runtime's
environment or its environment-backed secret integration.

The required Host inputs are:

| Name | Meaning |
| --- | --- |
| `LLM_SPACE_SERVER_AUTH_KEYS` | Non-empty JSON array of `{ issuer, principalId, principalType, token }` records. |
| `LLM_SPACE_SERVER_TRUSTED_PROXY_CIDRS` | JSON array of exact trusted TLS-terminator IPs or CIDRs. |
| `LLM_SPACE_SERVER_ALLOWED_HOSTS` | JSON array of accepted public Host values. |

Optional Host inputs are `LLM_SPACE_SERVER_CORS_ORIGINS`,
`LLM_SPACE_SERVER_MAX_ACTIVE_RUNS`,
`LLM_SPACE_SERVER_CONTINUATION_TTL_SECONDS`, and
`LLM_SPACE_SERVER_SHUTDOWN_TIMEOUT_SECONDS`. The last defaults to eight
seconds in the OCI profile. Bind address (`0.0.0.0`), port (`7331`), local-dev
mode (`false`), repository root (`/var/lib/llm-space`), and the embedded Agent
cannot be overridden.

The bootstrap validates Host and Agent requirements and artifact integrity
before importing authored code. It parses and removes
`LLM_SPACE_SERVER_AUTH_KEYS` from `process.env` before that import. Startup
errors are intentionally generic so configuration and credentials do not enter
logs.

## Proxy and network topology

The image expects a trusted external TLS terminator. The proxy must connect
from a configured trusted address, preserve one allowed public `Host`, and
provide one unambiguous HTTPS signal through `Forwarded: proto=https` or
`X-Forwarded-Proto: https`. Conflicting or repeated forwarding claims fail
closed. Business routes still require Bearer principal and Session
continuation authorization.

The in-image readiness probe uses `http://127.0.0.1:7331/v1/ready`. Only
loopback peers may reach `/v1/health` and `/v1/ready` without proxy proof;
this exception never applies to business routes.

## Storage and runtime user

The image runs as fixed UID/GID `1000:1000` and declares
`/var/lib/llm-space` as its only persistent volume. A Docker named volume is
the simplest fresh-volume choice:

```sh
docker volume create example-agent-data
```

For a bind mount, the operator must prepare compatible ownership before
startup, for example on Linux:

```sh
sudo install -d -o 1000 -g 1000 -m 700 /srv/example-agent
```

The runtime never elevates, changes ownership, repairs, or empties a mount.
An unwritable path, another active Server writer, another Agent fingerprint,
or an unsupported repository schema fails before readiness. The volume is
single-Server, single-writer storage; shared network filesystems, replicas,
autoscaling, migration automation, backup, retention, and deletion are not
provided by V1.

## Run and stop

The following is illustrative; place the Server behind the trusted proxy
described above and use an operator-managed secret source in production:

```sh
docker run --name example-agent \
  --publish 127.0.0.1:7331:7331 \
  --volume example-agent-data:/var/lib/llm-space \
  --env LLM_SPACE_SERVER_AUTH_KEYS \
  --env LLM_SPACE_SERVER_TRUSTED_PROXY_CIDRS='["172.17.0.1/32"]' \
  --env LLM_SPACE_SERVER_ALLOWED_HOSTS='["agent.example.com"]' \
  --env OPENAI_API_KEY \
  example-agent:local
```

The exec-form entrypoint makes Bun PID 1 and the image declares `SIGTERM`.
The default Server drain is eight seconds, so configure a container stop grace
of at least ten seconds:

```sh
docker stop --time 10 example-agent
```

If `LLM_SPACE_SERVER_SHUTDOWN_TIMEOUT_SECONDS` changes, keep the container
grace at least two seconds longer. Timed-out external effects retain the
Server's honest `outcomeUnknown` recovery semantics; they are not replayed
automatically.

## Verification

The non-release `OCI` GitHub Actions workflow generates the context, builds and
runs `linux/amd64` and `linux/arm64` under Buildx/QEMU as needed, and verifies
image configuration, readiness, authenticated Session persistence,
single-writer and permission failures, artifact mismatch, credential absence,
`SIGTERM`, and the two-platform index. It does not push, sign, notarize, or
release an image. A live Pi Run is added only when a real OpenAI credential is
available; otherwise that optional check is reported as skipped.
