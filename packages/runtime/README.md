# `@llm-space/runtime`

Pi-native runtime for LLM Space Agent Projects.

The runtime owns three boundaries:

- load one immutable portable Agent source snapshot;
- resolve its authored model/reasoning defaults;
- execute stateful sessions through Pi `Agent` and its native ReAct loop.

## Entrypoints

- `@llm-space/runtime` is the authored and cross-environment contract. It
  exports `defineAgent()`, authored/compiled definition types, project
  diagnostics and manifest types, execution-mode types, and pure comparison
  helpers.
- `@llm-space/runtime/node` is the Bun/Node host contract. It exports local
  project discovery/compilation, the inspectable compiled artifact descriptor,
  `AgentRuntime`, `AgentSession`, the `PreparedAgentTool` host contract, and
  `LocalAgentRuntime`. It does not re-export the root entrypoint.
- `@llm-space/runtime/harness` is the cross-environment Host contract for
  durable Runtime Run state. It exports the Run state machine, Session Store
  interface, typed conflicts, and an in-memory reference adapter.
- `@llm-space/runtime/client` is the browser-safe Local Server client. It owns
  authenticated commands, Channel-generated continuation credentials,
  fetch-based SSE parsing, exact sequence replay, and Pi `AgentEvent` typing;
  it does not import Bun/Node Server code or persist credentials automatically.
- `@llm-space/runtime/tools` is the authored local-action contract. It exports
  `defineTool()` and the bounded `ToolContext`.
- `@llm-space/runtime/connections` is the authored remote-action contract. It
  exports `defineMcpClientConnection()` for Streamable HTTP MCP connections.
- `@llm-space/runtime/server` is a minimal Bun-only type surface used by a
  closed deployment Server bundle. It avoids importing compiler discovery or
  source-loading side effects.

## Architecture

Runtime source follows the same responsibility flow as Eve while retaining
LLM Space's Pi-native and local-filesystem boundaries:

```text
public/definitions/          authored helpers and interfaces
shared/                      authored/compiled data and pure contracts
internal/authored-definition/ validation of imported authored values
node/discover/               non-executing source discovery and diagnostics
node/compiler/               trusted Bun compilation and normalization
runtime/agent/               immutable Agent snapshot and model preparation
runtime/sessions/            stateful Agent session interface and lifecycle
runtime/harness/             durable Run state and transactional Session Store
execution/                   Pi tool policy, deferred state, and event projection
```

Dependencies flow downward through those responsibilities. `public/` and
`shared/` never import Node code. Discovery never imports or executes authored
modules; only the trusted compiler does. Runtime and execution never import a
Desktop host. Small behavior fragments remain with their owning module rather
than becoming pass-through helpers.

Definitions progress through explicit representations:

```text
AgentDefinition -> CompiledAgentDefinition -> resolved runtime model
```

`loadAgentProject()` returns an immutable compiled snapshot with a versioned
plain-data `artifact` descriptor. The descriptor derives its overall identity
from six independently inspectable SHA-256 sections:

- portable source files by logical path;
- authored bundled dependencies, separate from their entry source;
- compiled Agent, instruction, tool, connection, and skill capabilities;
- local tool input/output schemas;
- the exact Bun compiler, resolved runtime dependencies, and production runtime
  source build;
- the minimum Bun environment requirement.

Entries and object keys use code-point ordering before hashing, so repeated
builds and equivalent project copies at different absolute paths produce the
same descriptor. The legacy snapshot `fingerprint` is the descriptor's overall
fingerprint. The descriptor contains only logical IDs and fingerprints: it
does not contain resolved connection credentials, callback results, Sessions,
Thread history, or Eval results. Executable callbacks remain in the trusted
in-memory snapshot and resolve credentials only during Host activation.

Prepared tools similarly keep Pi's internal deferred-result marker inside the
execution layer. Hosts provide typed executable/deferred tools and observe
typed session events; they do not create Pi placeholder messages.

V1 requires:

```text
agent/
├── agent.ts
├── instructions.md
├── tools/
│   └── *.ts
├── connections/
│   └── *.ts
└── skills/
    └── <name>/SKILL.md
```

`agent.ts` default-exports a typed definition:

```ts
import { defineAgent } from "@llm-space/runtime";

export default defineAgent({
  model: "openai/gpt-5.3-codex",
  reasoning: "high",
  environment: {
    OPENAI_API_KEY: { kind: "secret", required: true },
  },
});
```

The model string splits on its first `/`. Reasoning accepts
`provider-default`, `none`, `minimal`, `low`, `medium`, `high`, and `xhigh`;
`none` maps to Pi's internal `off` value.

The optional `environment` map declares required or optional runtime input
names as `config` or `secret`. It may include a non-sensitive description but
never a default or value. Names and classifications participate in the Agent
Artifact fingerprint. Hosts remain responsible for supplying values without
copying them into source, artifacts, Sessions, Threads, Traces, or logs.

`createAgentProjectBundle()` captures two identical project copies and emits a
self-contained executable Agent bundle plus the unchanged artifact descriptor.
The split capture prevents self-mutating authored imports from changing the
compiled bytes. The bundle embeds and verifies the full descriptor and closes
authored local/npm dependencies without retaining absolute project paths.

## Actions

Local action identity is the exact tool filename stem. Authors provide schemas
and JSON-compatible results; runtime validates and adapts them to Pi:

```ts
import { defineTool } from "@llm-space/runtime/tools";
import { Type } from "typebox";

export default defineTool({
  description: "Return the weather for a city.",
  inputSchema: Type.Object({ city: Type.String() }),
  outputSchema: Type.Object({ city: Type.String(), summary: Type.String() }),
  execute({ city }, { abortSignal, callId, toolName }) {
    return { city, summary: `${city} is sunny` };
  },
});
```

Project-scoped MCP connections are flat files under `connections/`. Their file
stem owns the connection name, and an exact non-empty allowlist controls the
remote tools exposed as `<connection>__<tool>`:

```ts
import { defineMcpClientConnection } from "@llm-space/runtime/connections";

export default defineMcpClientConnection({
  url: "https://mcp.example.com",
  description: "Project weather data.",
  auth: async () => ({ token: await resolveToken() }),
  headers: () => ({ "X-Workspace": "demo" }),
  tools: { allow: ["forecast"] },
});
```

Discovery never imports authored modules or resolves credentials. Auth/header
callbacks run only in Bun when a Project Thread activates or reconnects. The
runtime uses per-Thread clients, does not retry `tools/call`, and persists only
safe provenance/schema fingerprints through the Desktop host—not URLs,
headers, tokens, callback results, clients, or readiness.

Build the runtime before creating a session:

```ts
import { LocalAgentRuntime } from "@llm-space/runtime/node";

const runtime = await LocalAgentRuntime.create({
  agentRoot: "/absolute/project/agent",
  models,
});

const session = await runtime.createSession({
  id: "thread-id",
  initialMessages,
  executionMode: "react",
});

session.subscribe((event) => console.log(event.type));
await session.prompt("Hello");
```

`AgentSession` does not expose or accept a Pi `Session`. Hosts provide the
durable transcript through `initialMessages` and the optional persistence
driver. Desktop Project Threads are the durable authority; runtime sessions
own live prompt/tool/continuation execution.

The session core deliberately uses Pi `Agent`, not `AgentHarness`. Pi `Agent`
owns the official provider stream, ReAct/tool lifecycle, abort settlement, and
prompt-free `continue()` loop. LLM Space `AgentSession` owns only product
semantics Pi does not provide: execution-mode policy, settled manual tool
placeholders, exact result replacement, public event projection, and the host
persistence boundary. This is the single Agent Project session owner; hosts
must not drive a second ReAct or continuation loop.

`AgentHarness` is not a compatible replacement for this boundary today. Its
public turn entry points always add a user message, and its append-only Session
does not replace an editable Thread transcript. Harness compaction and Session
tree capabilities may be adopted later only through a separately approved
integration that preserves settled manual continuation.

Execution modes are `manual`, `autoOnce`, and `react`. Manual deferred tool
results remain internal control messages and are exposed as pending calls until
the host supplies real results and calls `continue()`.

## Local Server client

The framework-neutral client consumes the protected Server without introducing
a second text/tool event protocol:

```ts
import { createAgentServerClient } from "@llm-space/runtime/client";

const client = createAgentServerClient({
  baseUrl: "https://agent.example.com",
  authorization: () => accessToken
});
const session = await client.createSession();
const run = await client.createRun({
  sessionId: session.sessionId,
  continuationToken: session.continuationToken,
  text: "Hello"
});

for await (const event of client.streamRun({
  sessionId: session.sessionId,
  runId: run.runId,
  continuationToken: session.continuationToken
})) {
  if (event.event === "pi") {
    console.log(event.data.type);
  }
}
```

Disconnecting the iterator only stops observation. Use `abortRun()` to cancel
execution. Applications that need continuation across their own restart must
store the raw continuation token in their Channel-owned secure storage; the
Server repository stores only its hash. Streams reconnect after transient
transport failures, honor bounded HTTP/server shutdown retry hints, and accept
only contiguous events or byte-equivalent cursor replays. A terminal
`abortRun()` response includes the Run's existing outcome.

## Runtime Harness state

The Host-facing durable seam is deliberately separate from live Pi execution:

```ts
import { InMemorySessionStore } from "@llm-space/runtime/harness";

const store = new InMemorySessionStore();
const stored = await store.commit({
  sessionId: "session-one",
  expectedVersion: null,
  mutations: [{
    type: "startRun",
    runId: "run-one",
    configuration: {
      id: "config-one",
      agentSnapshotFingerprint: "agent-fingerprint",
      contextFingerprint: "context-fingerprint",
      executionMode: "manual",
      model: { provider: "openai", id: "gpt-5.3-codex" },
      toolConfigurationFingerprint: "tools-fingerprint",
    },
  }],
});

await store.commit({
  sessionId: "session-one",
  expectedVersion: stored.version,
  mutations: [{
    type: "transitionRun",
    runId: "run-one",
    to: "runningTools",
  }],
});
```

One commit atomically advances the versioned Session snapshot, preserves any
new immutable Run Configuration Snapshot, and appends ordered Run Journal
entries. Expected versions provide compare-and-swap protection: stale or
simultaneous writers cannot silently overwrite each other. Runtime Run state
persists across model, tool, and durable-wait boundaries; terminal states never
transition again. Desktop Threads persist this record as their Session Store;
future Server repositories implement the same boundary.

Fresh processes recover only from durable control-plane boundaries:

```ts
import {
  claimRuntimeRunResume,
  recoverRuntimeSession,
  replayRuntimeRunEvents,
} from "@llm-space/runtime/harness";

const recovery = await recoverRuntimeSession(store, "session-one");
if (recovery.status === "resumable") {
  // The Host first validates/persists any required tool results.
  await claimRuntimeRunResume(store, {
    sessionId: recovery.session.snapshot.id,
    runId: recovery.run.id,
    expectedVersion: recovery.session.version,
  });
}

if (recovery.status !== "missing") {
  const events = replayRuntimeRunEvents(recovery.session, {
    sessionId: recovery.session.snapshot.id,
    runId: "run-one",
  });
  const after = events.at(-1)?.cursor;
  // Passing `after` later is exclusive, so that event is not duplicated.
}
```

`waitingForToolResults` and `waitingForContinue` retain the same Runtime Run
identity. A resume claim uses the recovered Session version, so concurrent
claimants cannot both win. Persisted `runningModel` or `runningTools` work is
atomically terminalized as `outcomeUnknown`: the Harness cannot know whether an
external effect began or completed and never replays it automatically.

Replay projects the existing control-plane Run Journal in stable sequence
order. A cursor is accepted only when it identifies a real prior entry inside
the Host-authorized Session/Run scope, and replay starts strictly after it.
Principal and transport authorization remain Host responsibilities; this seam
does not add a Server protocol, retry/idempotency policy, exactly-once claim,
distributed lease, or canonical observability Trace.
