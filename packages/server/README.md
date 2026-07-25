# `@llm-space/server`

Protected Bun HTTP/SSE Host for one immutable compiled LLM Space Agent.

The Server owns authenticated principal/Session authorization, Channel
continuation hashes, idempotent command admission, the durable Server Session
repository, Runtime/Pi execution, restart recovery, and ordered SSE replay. It
does not own portable Agent source, vendor Channels, Desktop settings, a second
ReAct loop, or a public UI framework.

Start a project through the CLI:

```sh
LLM_SPACE_SERVER_LOCAL_DEV_KEY="$(openssl rand -base64 32)" \
  bun packages/cli/src/index.ts serve ./apps/example-agent --local-dev
```

Production uses `LLM_SPACE_SERVER_AUTH_KEYS`, a non-empty JSON array of
`{ issuer, principalId, principalType, token, tenant? }` records, where an
optional verified tenant is `{ issuer, tenantId }`. Secrets are read and
removed from the process environment before authored Agent modules load.
Outside explicit loopback `--local-dev`, startup requires `--tls-cert` plus
`--tls-key`, or one or more `--trusted-proxy` IP/CIDR entries and allowed
public Hosts. Authenticator validation and TLS secret-file reads finish before
authored Agent modules load.

Non-secret settings use CLI-over-environment-over-default precedence. Repeated
CLI values append; list environment values are JSON arrays of strings.

| CLI | Environment | Default |
| --- | --- | --- |
| `--host` | `LLM_SPACE_SERVER_HOST` | `127.0.0.1` |
| `--port` | `LLM_SPACE_SERVER_PORT` | `7331` |
| `--local-dev` | `LLM_SPACE_SERVER_LOCAL_DEV` | `false` |
| `--repository-root` | `LLM_SPACE_SERVER_HOME` | artifact-scoped home |
| `--cors-origin` | `LLM_SPACE_SERVER_CORS_ORIGINS` | disabled |
| `--allowed-host` | `LLM_SPACE_SERVER_ALLOWED_HOSTS` | bound Host |
| `--trusted-proxy` | `LLM_SPACE_SERVER_TRUSTED_PROXY_CIDRS` | disabled |
| `--tls-cert` | `LLM_SPACE_SERVER_TLS_CERT` | disabled |
| `--tls-key` | `LLM_SPACE_SERVER_TLS_KEY` | disabled |
| `--max-active-runs` | `LLM_SPACE_SERVER_MAX_ACTIVE_RUNS` | `4` |
| `--continuation-ttl-seconds` | `LLM_SPACE_SERVER_CONTINUATION_TTL_SECONDS` | `86400` |
| `--shutdown-timeout-seconds` | `LLM_SPACE_SERVER_SHUTDOWN_TIMEOUT_SECONDS` | `30` |

Local-dev HTTP CORS origins must themselves use `localhost`, `127.0.0.1`, or
`::1`; all other allowed browser origins require exact HTTPS origins.

## Protocol

```text
GET  /v1/health
GET  /v1/ready
POST /v1/sessions
POST /v1/sessions/:sessionId/runs
GET  /v1/sessions/:sessionId/runs/:runId/events
POST /v1/sessions/:sessionId/runs/:runId/abort
POST /v1/sessions/:sessionId/runs/:runId/budget
POST /v1/sessions/:sessionId/runs/:runId/approvals/:requestId
POST /v1/sessions/:sessionId/continuation/rotate
POST /v1/sessions/:sessionId/continuation/revoke
```

All private operations require a principal Bearer credential and the
Session-bound `LLM-Space-Continuation` header. Creation/rotation receives the
Channel-generated next credential through `LLM-Space-Next-Continuation`.
Mutation admission uses `Idempotency-Key`; event replay uses `Last-Event-ID`.

SSE `pi` data is the sanitized, version-pinned Pi `AgentEvent`. `control` adds
`toolApprovalRequired`, `sessionBudgetRequired`, `runTerminal`, and transient
`serverShutdown`, which Pi cannot express.
Each persisted event is committed before publication and uses its per-Run
sequence as the SSE `id`.

When source-owned input/output Session limits are reached, the crossing
provider call and complete tool batch remain settled and the Run stays durably
open at `waitingForBudget`. The authenticated client posts `freshWindow` or
`stop` to the budget endpoint. A fresh window advances both input/output
baselines and resumes the same Run once; Stop cancels only that Run. Server
derives usage, limits, principal, Session version, and pending Run from its
repository, so caller data cannot forge the boundary. Missing/all-zero usage
is recorded as unmetered and never estimated; compaction usage is excluded.

For authored tools, the Server projects the repository owner as Session
initiator, the authenticated request identity as current principal, optional
tenant data from the trusted authenticator, `http` channel context, and the
durable Server Run ID/order as Turn context. Model text and tool arguments
cannot override these values. Named/versioned `agent/state/*.ts` values are
stored inside the same Server Session repository and recover after restart.
Each Pi tool batch commits its validated full state snapshot once before the
next provider call. A tool, schema, or deferred-result failure rolls the batch
back while retaining Pi's normal tool-error handling; the Runtime does not
automatically replay it. An unconfirmed persistence outcome terminates the Run
as `outcomeUnknown` and is never retried automatically.

Ordered static and `turn.started` dynamic Agent instructions use that same
verified context and read-only state. The Server records one immutable
instruction snapshot under the durable Server Turn/Run ID before provider
execution, reuses it after restart, and keeps it out of the transcript and
public Pi event stream.

The complete security, storage, retention, recovery, TLS, CORS, limit, and
non-goal boundary is recorded in ADR 0002.

For the fixed non-root OCI profile, declared Agent environment, trusted proxy,
volume ownership, multi-platform build, and stop-grace contract, see
[OCI Deployment](../../docs/oci-deployment.md).
