# Example Agent

A portable LLM Space Agent Project for validating the definition, manifest,
local tool, source-declared MCP connection, skill, and desktop import workflow.
Its weather data and optional MCP fixture are deterministic and use no
credentials or live model.

## Open In LLM Space

1. In one terminal, start the deterministic MCP fixture with
   `bun .agents/kaizen-loop/fixtures/remote-mcp-fixture.mjs`.
2. In another terminal, start the desktop app from the repository root with
   `bun dev`.
3. Choose **Open Agent Project** from the welcome screen or Agent Projects
   sidebar.
4. Select this `apps/example-agent` directory.
5. Review the warning, then choose **Trust and open**. Agent Project tools are
   local code and run with your user permissions.
6. Open the default Thread. Confirm `get-weather` and
   `fixture__remote_echo`, then inspect their source chips and explicit calls.

LLM Space watches the files under `agent/`. Project Threads, messages, tool
results, and trust settings are stored under `LLM_SPACE_HOME`, not in this
directory.

## Verify Without A Model

From the repository root:

```sh
bun test apps/example-agent
```

The test loads this exact project through `@llm-space/runtime`, resolves the
model/reasoning defaults from `agent.ts`, discovers the `weather-brief` skill,
compiles the source-owned `fixture__remote_echo` allowlist without connecting,
verifies all six inspectable compiled-artifact fingerprint sections, and checks
that `get-weather({ city: "Shanghai" })` returns structured, JSON-compatible
weather data.

This project is example code for local development. It does not provide live
weather data, sandbox tool execution, or production deployment guarantees.
