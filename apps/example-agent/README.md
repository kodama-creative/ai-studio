# Example Agent

A portable LLM Space Agent Project for validating the definition, manifest,
local tool, durable typed Session state, source-declared MCP connection, skill,
static local Subagent, and desktop import workflow.
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
6. Create or open a Project Thread. Confirm `get-weather`, `remember-city`,
   `fixture__remote_echo`, and `weather-writer`, then inspect their source chips
   and explicit calls. A `weather-writer` delegation creates an independent
   child Session without creating or selecting another Thread.

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
verifies the named/versioned `example.weather-session` definition across all
six inspectable compiled-artifact fingerprint sections, verifies the
`weather-writer` child artifact and explicit-message contract, and checks that
`get-weather({ city: "Shanghai" })` returns structured, JSON-compatible weather
data. `remember-city` demonstrates step-atomic state updates when run through a
Runtime Session.

This project is example code for local development. It does not provide live
weather data, sandbox tool execution, or production deployment guarantees.

## Static local Subagents

A direct child lives at `agent/subagents/<id>/`. Its `agent.ts` must define a
non-empty `description`; the directory name is the parent-visible tool name.
The tool input is always `{ message: string }`. The child receives that message
in a fresh Session and never receives the parent transcript, attachments,
model override, or secret values.

If a child does not declare `sandbox.ts`, it shares the parent's effective
Sandbox. A child that declares Sandbox shares only when its frozen internal
revalidation fingerprint matches the parent's; otherwise Desktop uses an
isolated child Sandbox. Children declare their own tools, skills, state, model,
reasoning, environment names, and limits. Child connections,
nested Subagents, and child structured outputs are intentionally unsupported in
V1.

## Build an OCI context

The example declares `OPENAI_API_KEY` as a required secret name without a
value. Generate its project-specific, self-contained OCI context from the
repository root:

```sh
bun packages/cli/src/index.ts build ./apps/example-agent \
  --target oci \
  --output ./oci-context
```

The command does not invoke Docker or publish an image. See
[OCI Deployment](../../docs/oci-deployment.md) for the locked base image,
trusted-proxy environment, non-root volume ownership, multi-platform build,
and graceful-stop contract.
