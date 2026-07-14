# Example Agent

A portable LLM Space Agent Project for validating the manifest, tool, skill,
and desktop import workflow. Its weather data is deterministic and does not
use the network, credentials, or a live model.

## Open In LLM Space

1. Start the desktop app from the repository root with `bun dev`.
2. Choose **Open Agent Project** from the welcome screen or Agent Projects
   sidebar.
3. Select this `apps/example-agent` directory.
4. Review the warning, then choose **Trust and open**. Agent Project tools are
   local code and run with your user permissions.
5. Open the default Thread. With a model configured, ask for the weather in
   Shanghai and inspect the `get_weather` call and result.

LLM Space watches the files under `agent/`. Project Threads, messages, tool
results, and trust settings are stored under `LLM_SPACE_HOME`, not in this
directory.

## Verify Without A Model

From the repository root:

```sh
bun test apps/example-agent
```

The test loads this exact project through `@llm-space/runtime`, discovers the
`weather-brief` skill, and verifies that `get_weather({ city: "Shanghai" })`
returns `Shanghai: Sunny, 22°C`.

This project is example code for local development. It does not provide live
weather data, sandbox tool execution, or production deployment guarantees.
