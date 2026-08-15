# Basic Agent

This project contains only Agent-authored code:

```text
agent/agent.ts
agent/instructions.md
agent/tools/word-count.ts
```

Open it in the installed Studio:

```sh
bun run dev
```

Or execute one input with the configured model from `defineAgent()`:

```sh
bun run exec "hello local agent"
```

Host composition, SQLite, streaming, model configuration, and terminal
rendering are supplied by LLM Space rather than copied into the Agent Project.
