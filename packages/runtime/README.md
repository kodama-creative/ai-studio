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
  project discovery/compilation, `AgentRuntime`, `AgentSession`, the
  `PreparedAgentTool` host contract, and `LocalAgentRuntime`. It does not
  re-export the root entrypoint.

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
└── skills/
    └── <name>/SKILL.md
```

`agent.ts` default-exports a typed definition:

```ts
import { defineAgent } from "@llm-space/runtime";

export default defineAgent({
  model: "openai/gpt-5.3-codex",
  reasoning: "high",
});
```

The model string splits on its first `/`. Reasoning accepts
`provider-default`, `none`, `minimal`, `low`, `medium`, `high`, and `xhigh`;
`none` maps to Pi's internal `off` value.

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

Execution modes are `manual`, `autoOnce`, and `react`. Manual deferred tool
results remain internal control messages and are exposed as pending calls until
the host supplies real results and calls `continue()`.
