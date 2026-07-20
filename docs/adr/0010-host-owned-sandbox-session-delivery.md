---
status: accepted
---

# Let source require Sandbox while the Host owns Session delivery

## Context

Roadmap item 16 lets canonical read/write/bash helpers borrow a Host-supplied
Pi `ExecutionEnv`, but it deliberately does not decide where that environment
comes from. Item 17 must add isolation without letting portable Agent source
choose Host engines, mounts, credentials, network, or lifecycle, and without
merging Agent source, Desktop Thread storage, Turn inputs, and live Session
files into one ownership domain.

Vercel Eve is the structural reference for a canonical Sandbox source slot, a
durable Session Sandbox, one-time workspace seeding, stable lifecycle keys, and
attachment hydration. LLM Space does not adopt Eve's authored provider/image/
environment configuration, provider fallback chain, open network, writable
root, stop-only cleanup, non-atomic staging, or custom message protocol.

## Decision

### Source declares only an abstract minimum

An Agent Project may declare a Sandbox Requirement through either:

```text
agent/sandbox.ts
```

or, when it owns a portable workspace seed:

```text
agent/sandbox/
  sandbox.ts
  workspace/**
```

The definition is a zero-configuration default export:

```ts
import { defineSandbox } from "@llm-space/runtime/sandbox";

export default defineSandbox({});
```

Presence means the Agent requires the abstract Sandbox execution class;
absence establishes no source minimum. The compiled Agent Artifact records the
requirement plus the validated seed manifest and fingerprint, but no provider,
image, command, mount, environment value, network policy, privilege, or
lifecycle configuration.

Host Runtime Profile policy chooses the concrete provider and may tighten an
Agent with no minimum from Direct to Sandbox. It can never weaken a required
Sandbox to Direct or `NodeExecutionEnv`, and no unavailable or failed Sandbox
may fall back. A required Agent creates a Desktop Sandbox Project Thread only
when the provider is available; otherwise Run is disabled with an explicit
unavailable state. An existing Direct Thread whose artifact newly requires
Sandbox becomes stale and must be replaced by a new empty Thread.

### The Host owns a narrow provider seam

`SandboxProvider` is an internal Host interface, not an authored connection or
public plugin SDK. Its stable semantic responsibilities are to report
readiness; acquire or reconnect one Sandbox by Runtime Session identity; seed
its workspace exactly once; atomically stage a Turn's approved attachments;
return the Session-scoped Pi `ExecutionEnv` and bounded workspace manifest;
stop retained resources; and delete or retry cleanup of all owned resources.
Provider-specific handles remain opaque and Host-owned.

Docker CLI is the V1 reference provider because Studio ships macOS arm64 and
x64. The provider uses a repository-owned fixed image and fixed container
arguments. Apple `container`, Vercel Sandbox, Firecracker, and other backends
may become later adapters without changing source or Runtime contracts. Source
and users cannot define dynamic Sandbox connections.

### One Sandbox and workspace belong to one Runtime Session

Each Sandbox Runtime Session exclusively owns one container and one LLM
Space-owned Docker named volume mounted only at `/workspace`. The container
uses a read-only root filesystem, a tmpfs `/tmp`, a fixed non-root user,
`--network none`, and no Host/Agent secrets, provider keys, login-shell
environment, sockets, credentials, SSH agent, or arbitrary Host mount. Numeric
CPU, memory, PID, and disk quotas are deferred; the fixed isolation boundaries
remain mandatory.

The source workspace is copied into the empty volume exactly once and then
becomes Session-owned mutable data. There is no source bind mount, merge,
sync, write-back, or implicit Studio adoption. Seed discovery accepts only
strict POSIX relative paths and ordinary files, with at most 1,000 files,
25 MiB per file, 100 MiB total, depth 20, and 240 UTF-8 bytes per path.
Symlinks, special entries, traversal, invalid paths, and limit violations fail
compilation.

Every Turn instruction snapshot includes a deterministic sorted bounded
top-level `/workspace` manifest. Workspace state does not rewind with Thread
undo, branches, Run checkpoints, or transcript edits; a clean environment
requires a new Thread and Runtime Session.

### Attachments are Turn inputs delivered into Session storage

A Turn attachment is a Host-approved immutable descriptor whose bytes become
Session-owned workspace data when staging succeeds. V1 accepts ordinary files
only, with at most 20 files per Turn, 25 MiB per file, and 100 MiB per Turn.
Directories, symlinks, archive expansion, inherited permissions, traversal,
duplicate or ambiguous destinations, and arbitrary Host paths are rejected.
Staging is all-or-nothing and completes before Pi receives the Turn; failure
blocks Run and permits retry or removal without a partial Turn delivery.

Desktop keeps its existing attachment menu and adds `From Files` for a Sandbox
Thread. Bun owns `Utils.openFileDialog`, validation, hashing, and direct
staging; Host paths and large base64 payloads never cross renderer RPC. The UI
shows preparing/staging/failure states and locks the attachment descriptor once
Run starts. V1 adds no drag-and-drop, directory upload, or archive extraction.

Attachments remain in Pi-native user text/image content and workspace paths;
the workspace manifest remains in the instruction snapshot. LLM Space adds no
new streaming event or message vocabulary and does not copy Eve's
`eve-sandbox:` protocol.

### All model-triggered operations stay inside the Sandbox

The provider exposes the container through Pi's existing `ExecutionEnv`.
Every model-triggered filesystem or shell operation runs through a fixed
helper inside the container, including per-command PID/process-group abort.
Runtime never translates an environment path and performs the operation on the
Host. Tool authors own individual tool failures and Runtime does not
automatically rerun them.

Manual mode still acquires the real Sandbox, seeds or reconnects the workspace,
stages attachments, and records the manifest; only canonical tool execution is
deferred. There is no separate stateful/stateless Agent class.

### Profiles, Servers, and lifecycle fail closed

Desktop quit stops the container but retains its Runtime Session and named
volume. Restart reconnects the same container/volume; loss of the container
may reconstruct it only when the volume remains intact. A missing or corrupt
volume means the workspace is lost: the old Thread remains inspectable but can
never Run again, and the user must create a new Thread. The Host must not
reseed or silently recreate the same Session.

Thread deletion first records a cleanup tombstone, then deletes the owned
container and volume. Partial cleanup keeps the tombstone and is retried; no
silent TTL deletes a Sandbox while its Thread exists.

Protected Server composition may accept a Host-injected `SandboxProvider`.
The Native Server may use Docker when its Host supplies that provider. The
project-specific OCI deployment fails closed for required-Sandbox Agents in V1
because it must not mount a Docker socket or reuse its own application
container as the tool Sandbox.

V1 does not add a Sandbox workspace explorer or export/adopt flow. Explicit
export or adoption, source write-back, numeric resource quotas, multi-provider
selection, dynamic connections, and richer fleet/cleanup operations require
later capabilities.

### Acceptance is interface-first with one real provider proof

The provider conformance and fault matrix must prove source/Host policy
intersection, fail-unavailable behavior, cross-Session isolation, deterministic
one-time seed delivery, adversarial atomic attachment staging, Pi tool/abort
execution, restart retention, lost-workspace honesty, and tombstoned cleanup.
Most lifecycle detail may evolve behind the provider interface, but item 17
closes only after one real Docker end-to-end path creates a Session, seeds and
stages inputs, executes Pi tools, reconnects, and deletes the container and
volume. Fake-provider tests alone cannot satisfy the Done-when claim.

## Considered options

- A Thread-only Sandbox selector with no source minimum was rejected because a
  required Agent could accidentally run Direct and ADR 0006 promotion could
  not preserve its execution requirement.
- Source-owned engine, image, environment, network, mount, and retention
  settings were rejected because they invert Host authority and make source
  non-portable.
- Host bind mounts were rejected because they expose Host path semantics and
  can mutate Host files. A named volume keeps the workspace provider-owned.
- Recreating a missing workspace from source was rejected because it presents
  a new filesystem as continuation of the old Runtime Session.
- An interface-only delivery with fake tests was rejected because it cannot
  demonstrate real isolation or lifecycle cleanup.

## Consequences

Agent source gains a narrow Eve-shaped way to require isolation while Hosts
retain provider, security, and lifecycle authority. Session workspace and Turn
attachments are durable enough for useful agent work without becoming source
or Thread transcript data, and item 16 tools retain their Pi contracts.

The Docker provider is intentionally a minimal reference rather than a
container-management product. V1 accepts fixed network denial and delayed
resource quotas, has no workspace export UI, and cannot run required-Sandbox
project OCI deployments until a separate safe provider is injected.
