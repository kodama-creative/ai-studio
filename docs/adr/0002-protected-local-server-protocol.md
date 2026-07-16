---
status: accepted
---

# Serve one compiled Agent through a protected local protocol

## Context

Roadmap item 06 requires one compiled Agent artifact to run independently as a
Bun HTTP/SSE Server and serve many isolated Runtime Sessions. ADR 0001 assigns
durable Session authority to a Host-provided Session Store, but it does not
choose the Server Host's identity, transport, continuation credential,
persistence, replay, or shutdown policies. Those policies must be explicit
before exposing Runtime execution outside Desktop RPC.

Pi supplies the execution message model (`AgentEvent`) but not a durable remote
Session protocol. In particular, Pi does not own authenticated principals,
Runtime Session/Run IDs, continuation credentials, persisted SSE cursors,
restart recovery, or the Runtime `outcomeUnknown` terminal.

## Decision

### Deployment and authentication

The V1 Server binds to `127.0.0.1` by default. Loopback HTTP is available only
in explicit local-dev mode and still requires a configured Bearer key mapped to
the built-in local-dev principal; there is no anonymous fallback or generated,
printed default credential.

Non-loopback service requires either Bun TLS or an explicitly configured
trusted TLS terminator. Terminator mode accepts business requests only from an
exact trusted proxy IP/CIDR, requires a non-conflicting forwarded HTTPS signal,
and validates the public Host. Direct plaintext bypass is rejected. Only
minimal liveness and readiness endpoints are public.

`ServerAuthenticator` fails closed and returns an identity shaped as:

```ts
interface ServerPrincipal {
  issuer: string;
  principalId: string;
  principalType: "service" | "user";
}
```

V1 built-ins are an explicit loopback local-dev principal and a static Bearer
keyring supplied by the Host environment/config. Multiple rotated access keys
may map to the same principal. There is no JWT, OIDC, OAuth, cookie, anonymous
principal, admin override, delegation, sharing, or ownership transfer in V1.
Production startup fails without a real authenticator. Server-only secret
values are never accepted as CLI arguments, persisted in project source or the
Session repository, or written to logs.

### Session ownership and continuation credentials

A Session is permanently owned by the exact `(issuer, principalId)` that
created it. Continue/run, observe/reconnect, abort, rotate, and revoke require
that principal plus the Session continuation credential. Missing Sessions,
wrong owners, and invalid/expired/revoked continuation credentials are
indistinguishable `404` responses.

The Channel or TypeScript client generates each continuation token from at
least 32 CSPRNG bytes and sends it in a dedicated header. The Server validates
the format and stores only a SHA-256 hash bound to Session, owner, generation,
and absolute expiry. One generation is active. Default TTL is 24 hours,
configurable from one minute through 30 days, without sliding refresh. Rotate
atomically installs a new full-TTL generation; revoke and expiry disable all
access but do not delete data. An already-authorized open stream remains valid
after rotation.

Session creation, Run creation, and rotation require `Idempotency-Key`.
Idempotency records are scoped to owner, resource, and operation and persist
with the Session. An exact retry returns the original non-secret response; a
key reused with different input returns `409`. Run creation records only after
capacity is available and the Run is durably created. A rotated predecessor
token may replay only the exact rotation response while the resulting
generation remains active; it cannot authorize any other operation.

### Server repository

`ServerSessionRepository` is Server-owned and separate from Desktop Thread
storage. It stores one atomic envelope per Session under
`LLM_SPACE_SERVER_HOME`, or otherwise under:

```text
~/.llm-space/servers/<artifactFingerprint>/
```

The envelope contains owner identity, continuation hash/generation/expiry,
idempotency records, the Runtime Session record, transcript, and ordered public
events. Updates use a temporary file, flush, atomic rename, and CAS. Directories
are `0700`; files are `0600`. One process exclusively owns the data root. V1
has no database, shared filesystem coordination, distributed lease, silent
migration, or multi-process writer. Artifact mismatch refuses recovery.

Retention is indefinite by default. Expiry/revoke disables access but retains
the Session. There is no remote delete API; operator cleanup is permitted only
while the Server is stopped.

### HTTP command and event surface

V1 exposes:

```text
GET  /v1/health
GET  /v1/ready
POST /v1/sessions
POST /v1/sessions/:sessionId/runs
GET  /v1/sessions/:sessionId/runs/:runId/events
POST /v1/sessions/:sessionId/runs/:runId/abort
POST /v1/sessions/:sessionId/continuation/rotate
POST /v1/sessions/:sessionId/continuation/revoke
```

Session creation creates an empty Server-owned Session/Runtime identity. Run
creation accepts only:

```json
{ "input": { "type": "text", "text": "..." } }
```

The Server transcript is the sole model-context authority. The frozen artifact
owns model, reasoning, instructions, tools, and connections. Callers cannot
supply IDs, history, model/config overrides, attachments, multimodal content,
or structured input. Run creation persists before returning `202`. One Run may
be active per Session and Server V1 executes ReAct mode only.

Commands and observation are separate. Disconnect never aborts a Run. Abort is
an idempotent explicit command: active work is aborted and settled as
`cancelled`; a terminal Run returns its existing outcome.

### Pi messages, durable ordering, and replay

Public execution messages use the version-pinned Pi `AgentEvent` protocol, not
a second LLM Space text/reasoning/tool vocabulary. The Server explicitly
serializes known Pi fields, preserves authorized user-visible message/tool
data, usage and model identity, removes provider continuity signatures and
opaque metadata, and replaces raw errors with safe codes/messages. Non-finite,
cyclic, or otherwise non-JSON Pi/tool data fails the Run as
`event_not_serializable` rather than being silently changed.

SSE uses two event names:

- `pi`: sanitized Pi `AgentEvent`, including Pi `agent_end`.
- `control`: the minimal Server control union Pi cannot express.

After Runtime state and transcript are committed, every Run persists exactly
one `runTerminal` control with `completed`, `failed`, `cancelled`, or
`outcomeUnknown`. Pi `agent_end` closes the Pi lifecycle; `runTerminal` is the
authoritative durable Server terminal, after which the Run has no more
persisted events. Shutdown sends an unpersisted `serverShutdown` control with a
retry hint; heartbeat is an unpersisted SSE comment.

Every persisted event has a per-Run decimal sequence beginning at 1. The
sequence is the SSE `id`, strictly increases, and is committed before send.
`Last-Event-ID` must name a real event in the requested Run; replay is exclusive
after it, followed by live tail. Multiple authorized observers are allowed.
Terminal streams replay then close. A slow observer exceeding a 1 MiB pending
buffer is disconnected and may reconnect from its last cursor.

### Limits, execution, and lifecycle

JSON bodies are limited to 64 KiB, UTF-8 text input to 32 KiB, continuation
headers to 1 KiB, `Last-Event-ID` to 64 bytes, individual SSE events to 1 MiB,
and each observer buffer to 1 MiB. Oversized requests receive `413` before
mutation. An oversized runtime event creates a small `event_too_large` failed
terminal; payloads are never truncated. V1 adds no transcript, Session, or
token budget.

The Server loads, validates, and freezes one trusted compiled artifact before
readiness. It does not watch source or dynamically load/install code. Tools and
connections run in the same Bun process with the OS user's permissions; V1
makes no sandbox claim. Pi built-in `Models` resolves the artifact-selected
model/reasoning. Credentials, base URL, and headers come from the Server Host,
never Desktop `models.json` or Session input. Missing model configuration fails
startup. Readiness validates known local configuration without paid/network
provider or MCP probes.

The default global active-Run limit is four, configurable from 1 through 64.
Capacity returns `429` with `Retry-After` without queueing or creating a Run.
Replay, tail, abort, and token operations do not consume capacity. There are no
priorities, per-principal quotas, or distributed concurrency claims.

Startup recovers every Session before readiness. Persisted `runningModel` or
`runningTools` work becomes one `outcomeUnknown` terminal and is never retried.
Shutdown rejects new Sessions/Runs, notifies observers, aborts active Runs, and
drains for a configurable 1-300 seconds (default 30). Settled drains persist
`cancelled`; a timed-out operation receives no fabricated terminal and is
classified unknown at next startup. Repository flush/close runs last and
cleanup is best-effort across Sessions.

### Browser client and CORS

`@llm-space/runtime/client` is a browser-safe, framework-neutral client for the
command surface and `AsyncIterable<AgentEvent | ServerControlEvent>` streams.
It uses fetch-based SSE so it can send authentication, continuation, and cursor
headers. It advances only after a parsed delivered sequence, deduplicates exact
replays, rejects gaps, reconnects transient disconnects with jittered capped
backoff and `Retry-After`, and stops on terminal, caller cancellation, or a
non-retryable response. Cancelling observation does not call abort. The client
does not automatically persist continuation credentials.

CORS is disabled by default. Browser access requires an exact origin allowlist;
wildcards, reflected origins, cookies, credentials mode, and `Origin: null` are
not supported. Production origins require HTTPS; explicit local-dev origins may
use loopback HTTP. Only the protocol methods/headers receive a minimal
preflight. Requests with a disallowed Origin are rejected, while authenticated
non-browser clients without Origin remain valid. Responses vary on Origin and
Host validation protects loopback DNS rebinding.

### Composition and configuration

A private `@llm-space/server` workspace package owns Bun HTTP, authentication,
the repository, Runtime/Pi orchestration, and process lifecycle.
`@llm-space/runtime` remains Host-neutral. `@llm-space/cli` adds:

```text
llm-space serve [agent-project-directory]
```

The CLI loads the current Agent Project once through `loadAgentProject()`, then
starts the Server with that immutable snapshot. `startAgentServer(config)` also
accepts an explicit read-only Host configuration for tests/embedding. Portable
Agent source cannot configure auth, TLS, CORS, storage, or capacity. Non-secret
configuration follows CLI-over-environment-over-default precedence; secrets
come only from the Host environment/resolver and are scrubbed from the process
environment before authored code loads. V1 has no configuration hot reload.

### Errors and privacy

Inbound authentication failures return `401`, `WWW-Authenticate`, and
`Cache-Control: no-store`. Hidden Session/owner/continuation failures return the
same `404`. Invalid requests/cursors return `400`, active-Run conflicts `409`,
capacity `429`, and readiness `503`. Error bodies use a versioned safe JSON
shape. No response or local log contains stacks, raw provider errors,
credentials, internal paths, repository contents, or auth/token headers.

`/v1/health` reports minimal liveness. `/v1/ready` reports only ready/not-ready
and requires valid artifact, repository lock/recovery, authenticator, and known
model/credential configuration. Neither endpoint reveals artifact, model,
path, Session, or deployment details.

## Consequences

The Local Server can prove protected streaming completion and lossless replay
without making Pi, Desktop, a UI framework, or an in-memory process the durable
authority. Pi upgrades now require an explicit public-protocol compatibility
review. Channel vendor normalization, attachments, approvals, durable external
effect idempotency, OCI packaging, sandboxing, Studio Server profiles, shared
Trace, and public UI adapters remain later roadmap items.
