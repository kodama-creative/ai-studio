# `@llm-space/runtime`

Pi-native runtime for LLM Space Agent Projects.

The runtime owns three boundaries:

- discover a portable `agent/` source tree;
- compose that snapshot with Pi `AgentHarness` and real `AgentTool`s;
- create or reopen persistent Pi sessions through an injected host environment.

V1 discovers:

```text
agent/
├── instructions.md
├── tools/
│   └── *.ts
└── skills/
    └── <name>/SKILL.md
```

Tool modules default-export a Pi `AgentTool`. Instructions are required. Skills
follow the Agent Skills `SKILL.md` format and are loaded through Pi resources.

The main entrypoint is host-agnostic. `@llm-space/runtime/node` adds the local
`NodeExecutionEnv`, JSONL session repository, and Bun-powered TypeScript project
loader used by the desktop host.

```ts
import { LocalAgentRuntime } from "@llm-space/runtime/node";

const runtime = new LocalAgentRuntime({
  agentRoot: "/absolute/project/agent",
  sessionsRoot: "/absolute/project/.llm-space/sessions/target",
  models,
});

const session = await runtime.createSession({
  model: { provider: "anthropic", id: "claude-sonnet-4-5" },
});

session.subscribe((event) => console.log(event.type));
await session.prompt("Hello");
await runtime.cleanup();
```

JSONL persistence retains conversation and Pi session-tree state across process
restarts. It is not workflow-step durability: interrupted tools are not promised
exactly-once effects or crash-safe replay. Hosts remain responsible for tool
permissions, sandboxing, idempotency, credentials, and lifecycle cleanup.
