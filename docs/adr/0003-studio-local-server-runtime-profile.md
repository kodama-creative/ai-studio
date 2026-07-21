---
status: accepted
---

# Bind Studio execution to an explicit Thread Runtime Profile

## Context

Roadmap item 07 connects the Desktop Studio to the protected Local Server from
ADR 0002. A transport-only switch is insufficient: the Desktop Runtime Harness
would create one Runtime Run while the Server creates another, editable
Desktop history cannot seed the Server V1 text-only transcript, and the raw
continuation credential needs an owner outside Thread and Trace data.

The existing Thread Run History and `RunTraceView` are the shipped debugging
surface. The experimental Langfuse Trace sidebar is not the canonical Runtime
Trace, and Desktop sandbox execution is a later roadmap capability.

## Decision

### Thread-scoped Runtime Profile authority

Every Agent Project Thread has one selected Runtime Profile. `Desktop direct`
remains the development default. At a settled checkpoint the user may select
`Desktop direct`, `Desktop sandbox`, or `Local Server` on the current Thread.
Selection never creates or clears a Thread: transcript, Run History, and a
dormant Desktop Runtime Session remain intact. Historical checkpoints freeze
the profile that actually executed, and the profile participates in the
continuation fingerprint so a changed waiting boundary branches rather than
resuming under different authority. Profile selection is disabled while a Run
is streaming.

`Local Server` binds new execution to the currently selected compiled Agent
artifact. `Desktop sandbox` is executable only when the Host provider is ready
and never falls back to direct execution. An Agent that requires Sandbox cannot
be downgraded to `Desktop direct`.

### Desktop principal and embedded Server lifecycle

The Bun process maps a fresh per-process random Bearer key to a stable local
Desktop user principal. The issuer is `llm-space-desktop`; the principal ID is
derived from the local OS user identity and therefore remains stable across
Desktop restarts. The access key is Bun-only, is never persisted, and is not a
continuation credential.

`DesktopHost` owns a process-scoped Local Server manager. It lazily starts at
most one loopback-only, random-port Server for each artifact fingerprint,
reuses it across bound Threads, and gracefully stops all Servers during host
cleanup. Server repositories remain under the ADR-0002 per-artifact storage
root. V1 exposes no Server address, port, remote endpoint, access-key, or fleet
configuration to the renderer.

### Continuation credential custody

Raw continuation credentials are Channel-owned by the Desktop Bun process.
They live in a dedicated `LLM_SPACE_HOME/credentials/` registry with `0700`
directory permissions, `0600` file permissions, atomic writes, and entries
keyed by non-secret Desktop Thread identity plus Server Session ID. This V1 is
OS-account/file-permission protection, not macOS Keychain encryption.

The renderer sends only an opaque Thread/profile reference. Bun performs all
Server requests. A continuation token never crosses renderer RPC and never
enters Agent source, Thread JSON, Run snapshots, Trace data, analytics, logs,
or errors. The credential survives Desktop restart for authorized reconnect
and is revoked/deleted when the owning Thread is deleted or explicitly
detached.

### Server lineage and one Run authority

Local Server Threads persist only non-secret Server lineage: profile kind,
artifact fingerprint, and Server Session ID. Each Run History checkpoint uses
the authoritative Server Run ID as its Runtime Run ID and records the same
artifact, Session, and Run lineage. A Local Server Run neither creates nor
updates Desktop `runtimeSession`; the Server Session Store is its sole execution
authority and Run History is a reduced Desktop projection of authorized Pi
events. A pre-existing Desktop Runtime Session may remain dormant on the Thread
so returning to a Desktop profile does not destroy the user's debug state.

The profile, lineage, artifact fingerprint, Session ID, and Run ID may cross
renderer RPC. Bearer keys, continuation tokens, Server URLs, and ports may not.

### Artifact drift

A Local Server profile remains bound to its selected artifact fingerprint.
When current Agent source compiles to another fingerprint, the profile becomes
stale. An already-created Run may finish, reconnect, or abort, but no new Turn
may start afterward. The old Run remains inspectable. Selecting the latest
artifact detaches the old Server binding and updates the current Thread profile;
it does not reinterpret historical checkpoints or copy state into the Server.

### Studio interaction

The Agent Project Thread header exposes `Desktop direct`, `Desktop sandbox`, and
`Local Server`, explains their capability differences, and reports preparing,
ready, running, reconnecting, unavailable, and stale states. Local Server locks
Agent model, prompt, tools, and projected transcript; only one trailing
pure-text user draft may be submitted. Server terminal Runs open and select the
corresponding snapshot in the existing Run History `RunTraceView`, where
non-secret lineage is visible.

The existing Run/Stop actions and Command-Enter shortcut remain the execution
entry points. Profile selection is keyboard-operable and restores focus to its
trigger. Narrow layouts must not overflow.

## Consequences

Studio can compare Desktop-direct, Sandbox, and protected Local-Server execution
in one development Thread without inventing a second protocol or Runtime Run.
Restart reconnect is possible without putting a bearer secret in editable
product data, and every historical Server checkpoint remains attributable to
one immutable artifact and Server Session.

Local Server Threads intentionally lose Desktop-only editing, manual settled
tool results, execution-mode toggles, attachments, and historical rerun. V1
does not provide Keychain encryption, remote Server management, actual sandbox
execution, transcript migration, canonical cross-host instrumentation, a raw
event viewer, or cloud/fleet lifecycle.
