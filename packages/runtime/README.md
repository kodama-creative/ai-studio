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
  `defineTool()`, the bounded `ToolContext`, and the zero-configuration
  `defineReadTool()`, `defineWriteTool()`, and `defineBashTool()` declarations.
- `@llm-space/runtime/state` is the authored structured-state contract. It
  exports `defineState()` handles whose live values exist only inside a
  Host-verified Runtime Session scope.
- `@llm-space/runtime/instructions` exports `defineInstructions()` and
  `defineDynamic()` for ordered static and trusted per-Turn instructions.
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
runtime/state/               verified context and step-atomic structured state
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
- compiled Agent, instruction, tool, connection, skill, and state capabilities;
- local tool input/output schemas and named/versioned state schemas;
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
├── instructions/
│   ├── *.md
│   └── *.{ts,js}
├── tools/
│   └── *.ts
├── state/
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

## Composable Turn instructions

The required `instructions.md` is always first. An optional flat
`agent/instructions/` directory adds `.md`, `.ts`, and `.js` entries in stable
code-point filename order; nested directories, symbolic links, and other file
types are rejected. Markdown is static. A static code entry default-exports
`defineInstructions({ markdown })`:

```ts
import { defineInstructions } from "@llm-space/runtime/instructions";

export default defineInstructions({ markdown: "Keep answers concise." });
```

A dynamic entry uses Eve's `turn.started` authoring shape and may return
branded instructions or `null`:

```ts
import {
  defineDynamic,
  defineInstructions,
} from "@llm-space/runtime/instructions";
import preferences from "../state/preferences";

export default defineDynamic({
  events: {
    "turn.started": (_event, { session }) => defineInstructions({
      markdown: `Principal: ${session.auth.current.principalId}; locale: ${preferences.get().locale}`,
    }),
  },
});
```

Instruction code may import only the instructions SDK and static files under
the Agent's `state/` directory. That state graph is itself limited to relative
state files, `@llm-space/runtime/state`, and `typebox`; dynamic imports,
`require`, tools, Node built-ins, packages, and other project source are
rejected before the module executes. Direct Host/runtime escape hatches such
as `Bun`, `process`, `fetch`, `globalThis`, `eval`, `Function`, workers, and
`import.meta` are rejected in the instruction/state source graph as well; the
same validation runs independently against closed-bundle source.

The Runtime resolves dynamic entries once from the Host-verified, deeply
immutable Session/Turn context and read-only Session state before Pi's first
provider call. It records the ordered entries, combined Markdown, Agent
fingerprint, Turn ID, and SHA-256 instruction fingerprint atomically in the
Session Store. Every provider call in that Turn receives those exact bytes;
reload or continuation reuses the stored snapshot instead of rerunning code.
Resolution or persistence failure blocks provider execution. Instructions do
not become transcript messages or Pi events, and they cannot invoke tools or
expand Runtime authority. Manual debugging still resolves context-dependent
instructions but intentionally provides no Session State scope.

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
  execute({ city }, { abortSignal, callId, session, toolName }) {
    console.log(session.auth.current.principalId, session.turn.id);
    return { city, summary: `${city} is sunny` };
  },
});
```

Portable filesystem and shell authority is available only through three
canonical framework helpers:

```ts
// agent/tools/read.ts
import { defineReadTool } from "@llm-space/runtime/tools";

export default defineReadTool();
```

The equivalent `tools/write.ts` and `tools/bash.ts` files use
`defineWriteTool()` and `defineBashTool()`. Filenames and helper kinds must
match, declarations accept no configuration, and dynamic tool resolvers cannot
create them. Ordinary `defineTool()` callbacks do not receive an
`ExecutionEnv`.

The Host supplies a Session-scoped Pi `ExecutionEnv` through
`createSession({ executionEnv })`. Runtime binds it only to helpers that remain
in the final effective capability snapshot. Without one, a selected helper
fails before provider execution with `executionEnvUnavailable`; a helper
filtered out by Host policy or the Turn request requires no environment.
Runtime never creates a Node/Desktop/Server fallback and never owns cleanup.
The three helpers use Pi read pagination/truncation, whole-file write, shell
capture, streamed updates, abort, timeout, nonzero-exit, and full-output-path
semantics. Sandbox provisioning, workspace/attachment delivery, retention, and
cleanup are Host responsibilities outside this V1.

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

## Verified context and structured Session state

State is declared in `agent/state/*.ts` with a stable qualified name, positive
version, TypeBox schema, and finite JSON initial value:

```ts
import { defineState } from "@llm-space/runtime/state";
import { Type } from "typebox";

export default defineState({
  name: "weather.requested-cities",
  version: 1,
  schema: Type.Object({ cities: Type.Array(Type.String()) }),
  initial: { cities: [] },
});
```

Tools import the handle and use `get()`/`update()` only during managed Runtime
execution. `get()` returns a deeply frozen JSON snapshot. `update()` validates
the replacement immediately and makes it visible to every concurrently
executing tool in the same Pi model step. Parallel writes to the same handle
are last-actual-write-wins; there is no model-order guarantee.

One automatic tool step uses one temporary shared Map. Only after every tool,
output, and state value validates does the Runtime replace the full state
snapshot through one Session Store CAS before Pi may start the next provider
call. A tool throw, error result, validation failure, or deferred result
discards every temporary update from that step; Pi retains its normal tool-error
recovery behavior. The Runtime does not automatically replay the tool. A
persistence failure never reruns tools: the Run terminates as
`outcomeUnknown` when effects may already have happened, and tool authors own
external-effect idempotency.

The Host must supply immutable `AgentSessionContext`: Session ID, initiator,
current principal, optional tenant, channel, and Turn ID/sequence. The Runtime
does not derive it from messages, tool arguments, or model output, and neither
context nor state is inserted into Pi events or model history. State is limited
to 64 slots, 64 KiB per slot, and 256 KiB total. Unknown/removed definitions,
version mismatches, and schema drift block execution; V1 never drops, resets,
migrates, or retries them automatically.

Turn context, Session state, transcript history, and external long-term memory
remain separate domains. Desktop Project Threads and Server repositories adapt
their existing Runtime Session record to the same Session Store authority;
standalone Threads without authored state remain unchanged.

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

Execution modes are `manual`, `autoOnce`, and `react`. `manual` is a development
debugging mode: authored tools are not executed and the step does not enter a
state scope, so Session State is neither read, updated, nor committed. Deferred
tool results remain internal control messages and are exposed as pending calls
until the Host supplies real results and calls `continue()`. Automatic modes use
the same state scope and rollback behavior for every Agent; execution semantics
do not branch based on whether the Agent happens to declare state slots.

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
transition again. Desktop Threads and Server repositories persist this record
as their sole Session Store authority. The optional `snapshot.state` envelope
remains absent for legacy/stateless Sessions.

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
