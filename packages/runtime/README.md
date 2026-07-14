# `@llm-space/runtime`

Pi-native runtime for LLM Space Agent Projects.

The runtime owns three boundaries:

- load one immutable portable Agent source snapshot;
- resolve its authored model/reasoning defaults;
- execute stateful sessions through Pi `Agent` and its native ReAct loop.

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

`RuntimeSession` does not expose or accept a Pi `Session`. Hosts provide the
durable transcript through `initialMessages` and the optional persistence
driver. Desktop Project Threads are the durable authority; runtime sessions
own live prompt/tool/continuation execution.

Execution modes are `manual`, `autoOnce`, and `react`. Manual deferred tool
results remain internal control messages and are exposed as pending calls until
the host supplies real results and calls `continue()`.
