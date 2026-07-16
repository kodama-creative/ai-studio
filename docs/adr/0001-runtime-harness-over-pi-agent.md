---
status: accepted
---

# Build the Runtime Harness over Pi Agent

LLM Space will build its Host-neutral Runtime Harness over official Pi `Agent`, which retains provider streaming and model/tool iteration, rather than adopting Pi `AgentHarness` or copying Pi's private loop lifecycle. Pi `AgentHarness` cannot settle at Desktop Thread tool calls and later continue from externally supplied results without a synthetic user message; the LLM Space layer therefore owns durable Runtime Run identity, Session Store coordination, execution-mode waits, continuation, and Host-facing event projection while leaving the ReAct loop to Pi.

## Consequences

Desktop Threads and future Server repositories implement one Session Store boundary, while Pi's in-memory state is never the durable authority. A logical Runtime Run may outlive an individual Pi invocation and process: manual and auto-once modes enter durable waits, configuration or historical-context edits supersede and branch the Run, and interrupted external operations remain outcome-unknown until a later durability capability can recover them safely.
