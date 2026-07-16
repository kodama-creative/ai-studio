# Pi and frontend-compatible Server protocol research

Date: 2026-07-16
Scope: roadmap item 06 protocol decision only; no implementation decision beyond the approved Local Server boundary.

## Confirmed decision

After reviewing the alternatives, the product decision is to use Pi's message
protocol for item 06 rather than introduce an LLM Space message vocabulary.
The public execution payload is a version-pinned, sanitized Pi `AgentEvent`.
LLM Space adds only the Server transport/control layer Pi does not own: persisted
SSE sequence/`id`, authenticated Session/Run routing, continuation credentials,
authorized replay, and explicit Server-only terminal/control conditions such as
recovery `outcomeUnknown` and shutdown. The optional AI SDK UI and AG-UI
projections researched below are deferred compatibility references, not item-06
message authorities.

## Superseded pre-confirmation recommendation

The following recommendation records the option considered before the user
selected Pi `AgentEvent`. It is historical research only and is superseded by
the confirmed decision above and ADR 0002. In particular, item 06 does **not**
define a second LLM Space execution-message vocabulary or ship an AI SDK UI
projection.

Pi has a useful **in-process UI event model**, a narrow browser-to-provider `streamProxy()` SSE client, and a first-party **process-local JSONL RPC client**. It does not have a complete versioned Agent HTTP/SSE protocol, React UI kit, durable replay cursor, or authenticated remote Session protocol that LLM Space can adopt unchanged.

The pre-confirmation recommendation was:

1. Keep one LLM Space-owned, versioned, durable Server event journal as the canonical wire contract. Each event has `schemaVersion`, `sessionId`, `runId`, a persisted monotonic `sequence` (also the SSE `id`), a stable semantic event `type`, and sanitized `data`.
2. Project Pi events into that contract. Do not expose raw `AgentEvent` or raw `AssistantMessageEvent` as the public wire format.
3. Ship a small browser-safe TypeScript client/reducer for the canonical protocol (Session creation, run creation, continuation header, abort, reconnect with `Last-Event-ID`, and normalized message/tool/reasoning state).
4. Add an **AI SDK UI Message Stream v1 adapter** as a projection of the same journal, not as another execution path or persistence authority. This gives React/Vue/Svelte `useChat` compatibility and makes Vercel AI Elements/Chatbot UI reusable. LLM Space-specific run terminals (`outcomeUnknown` in particular), exact durable cursor behavior, authorization, and continuation rotation remain in the canonical client/protocol.

AG-UI plus CopilotKit is the other credible frontend ecosystem: it is a better
semantic reference for complete Agent Run lifecycle, state, and activities, but
its standard caller-owned input/Run shape and pre-1.0 event churn make it a
second projection target rather than the canonical item-06 Store/wire schema.

This is “one canonical protocol, multiple read adapters,” not two agent runtimes. For item 06, the canonical protocol and its TypeScript client are required; an AI SDK projection is the preferred frontend compatibility adapter if the item includes UI SDK compatibility. A full Chatbot fork, Redis resumable-stream setup, or UI component library is not required to prove independent serving.

## What Pi actually provides

### `pi-agent-core`: an in-process lifecycle/event API

The installed `@earendil-works/pi-agent-core` 0.80.3 describes `Agent` as the owner of transcript, lifecycle events, and tool execution, and exposes `subscribe(listener)` plus `abort()`/`waitForIdle()`; it does not define a network transport ([local `agent.d.ts`](../../../node_modules/@earendil-works/pi-agent-core/dist/agent.d.ts#L25), [upstream source](https://github.com/earendil-works/pi/blob/6442536b1e2586f6da29a4301a0795aab672dc63/packages/agent/src/agent.ts#L230-L321)). Its README explicitly presents events as being “for UI updates,” with the sequence `agent_start` → turn/message updates → tool execution → `agent_end` ([local README](../../../node_modules/@earendil-works/pi-agent-core/README.md#L54), [upstream README](https://github.com/earendil-works/pi/blob/6442536b1e2586f6da29a4301a0795aab672dc63/packages/agent/README.md#L54-L157)).

`AgentEvent` includes:

- agent/turn start and end;
- message start/update/end;
- tool execution start/update/end;
- whole `AgentMessage` objects, arbitrary `args`/`result`, and a nested provider-facing `AssistantMessageEvent` ([local type](../../../node_modules/@earendil-works/pi-agent-core/dist/types.d.ts#L353), [upstream type](https://github.com/earendil-works/pi/blob/6442536b1e2586f6da29a4301a0795aab672dc63/packages/agent/src/types.ts#L408-L436)).

The nested Pi AI stream is rich enough for frontend rendering: text, thinking, and tool-call start/delta/end, followed by `done` or `error` ([local `pi-ai` type](../../../node_modules/@earendil-works/pi-ai/dist/types.d.ts#L328), [upstream source](https://github.com/earendil-works/pi/blob/6442536b1e2586f6da29a4301a0795aab672dc63/packages/ai/src/types.ts#L328-L389)). Pi messages also distinguish `ThinkingContent`, `ToolCall`, `ToolResultMessage`, stop reasons, usage, and provider/model metadata ([local message types](../../../node_modules/@earendil-works/pi-ai/dist/types.d.ts#L222)).

This is not safe or stable enough to expose raw over an independent Server:

- there is no protocol version, Session/Run identifier, sequence, replay cursor, or SSE framing;
- `message_update` repeats a mutable partial message and nests a library-version-specific event;
- `args`, `result`, custom messages, and tool `details` are `any`/`unknown` and may contain values inappropriate for a public channel;
- whole assistant messages include provider/API/model identifiers, diagnostics, signatures, usage, and raw error text;
- `agent_end.messages` is a transcript-oriented aggregate rather than a single durable public terminal;
- Pi's `error`/`aborted` stop reasons describe a provider/assistant turn, while LLM Space must also represent Server recovery state such as `outcomeUnknown`.

LLM Space already demonstrates the correct ownership split internally: Desktop transports Pi events over typed RPC, while a reducer maps only selected message/tool data into UI state ([RPC transport](../../../apps/desktop/src/client/rpc-transport.ts#L18), [message reducer](../../../packages/core/src/client/reducer.ts#L36)). That projection boundary should become explicit and versioned for Server rather than serializing Pi types directly.

### Pi `streamProxy()`: a useful delta codec, not Agent serving

Pi does include a browser-oriented HTTP client: `streamProxy()` POSTs `{ model, context, options }` with bearer auth to `${proxyUrl}/api/stream`, reads SSE `data:` lines, and reconstructs the partial assistant message client-side ([local public type](../../../node_modules/@earendil-works/pi-agent-core/dist/proxy.d.ts#L1), [upstream implementation](https://github.com/earendil-works/pi/blob/6442536b1e2586f6da29a4301a0795aab672dc63/packages/agent/src/proxy.ts#L82-L116), [fetch/parser](https://github.com/earendil-works/pi/blob/6442536b1e2586f6da29a4301a0795aab672dc63/packages/agent/src/proxy.ts#L139-L207)). Its compact event union covers text/thinking/tool-call deltas and done/error, deliberately stripping repeated partial messages to save bandwidth ([local event union](../../../node_modules/@earendil-works/pi-agent-core/dist/proxy.d.ts#L9)).

This is strong evidence for delta-oriented frontend events and client-side reduction, but it delegates execution authority to the browser's `Agent`: the request contains caller-selected model, full context, headers/metadata and options; the proxy only represents a single provider stream, not agent turns, server-side tool execution, durable Sessions/Runs, replay, abort-after-disconnect, or ownership. Its parser also has no SSE `id`/`Last-Event-ID` handling. Reusing its event names where semantics match is sensible; adopting `/api/stream` as item 06's public contract is not.

### Pi Coding Agent: a typed subprocess SDK, not an Internet protocol or web UI SDK

The first-party Pi Coding Agent does have an RPC mode intended for embedding in applications, IDEs, or custom UIs. It sends commands and receives responses/events as strict LF-delimited JSON over a child process's stdin/stdout ([RPC documentation](https://github.com/earendil-works/pi/blob/6442536b1e2586f6da29a4301a0795aab672dc63/packages/coding-agent/docs/rpc.md#L1-L37)). Its TypeScript `RpcClient` starts a Node child process, writes JSONL, reads stdout, correlates command IDs, and forwards `AgentSessionEvent` to listeners ([client source](https://github.com/earendil-works/pi/blob/6442536b1e2586f6da29a4301a0795aab672dc63/packages/coding-agent/src/modes/rpc/rpc-client.ts#L1-L15), [process startup](https://github.com/earendil-works/pi/blob/6442536b1e2586f6da29a4301a0795aab672dc63/packages/coding-agent/src/modes/rpc/rpc-client.ts#L55-L139), [event listener](https://github.com/earendil-works/pi/blob/6442536b1e2586f6da29a4301a0795aab672dc63/packages/coding-agent/src/modes/rpc/rpc-client.ts#L168-L179)).

That is a useful reference for command/event separation and frontend event consumption. Pi's sample client directly renders `text_delta`/`thinking_delta`, tool start/end, and implements abort ([sample](https://github.com/earendil-works/pi/blob/6442536b1e2586f6da29a4301a0795aab672dc63/packages/coding-agent/test/rpc-example.ts#L13-L79)); its extension-UI example similarly consumes raw event discriminants ([sample UI](https://github.com/earendil-works/pi/blob/6442536b1e2586f6da29a4301a0795aab672dc63/packages/coding-agent/examples/rpc-extension-ui.ts#L510-L577)).

It is nevertheless not an answer to item 06: it is process-local JSONL, exposes Coding Agent-specific commands (model mutation, bash, forks, compaction, session paths), has no HTTP authentication/continuation capability, no durable EventSource cursor/replay contract, and no browser/React SDK. Pi's TUI and example UI are consumers, not a portable component library.

## Vercel AI SDK UI compatibility

### What is reusable

Vercel's official AI SDK defines an SSE **UI Message Stream v1** explicitly so custom backends/frontends can interoperate. A compatible response sets `x-vercel-ai-ui-message-stream: v1`; chunks are `data: <JSON>\n\n` and the stream ends with `data: [DONE]\n\n` ([official protocol docs](https://github.com/vercel/ai/blob/91a3d6e9f1e2e948dcffc5bec1b38b1c96d0b373/content/docs/04-ai-sdk-ui/50-stream-protocol.mdx#L95-L124), [SSE serializer](https://github.com/vercel/ai/blob/91a3d6e9f1e2e948dcffc5bec1b38b1c96d0b373/packages/ai/src/ui-message-stream/json-to-sse-transform-stream.ts#L1-L16)). It supplies exactly the frontend-oriented parts LLM Space needs:

- text and reasoning start/delta/end;
- streaming tool input, validated tool input, tool output/error/denial;
- step start/finish, message start/finish, error and abort;
- extensible typed `data-*` parts for LLM Space run status ([official protocol docs](https://github.com/vercel/ai/blob/91a3d6e9f1e2e948dcffc5bec1b38b1c96d0b373/content/docs/04-ai-sdk-ui/50-stream-protocol.mdx#L126-L480), [validated chunk union](https://github.com/vercel/ai/blob/91a3d6e9f1e2e948dcffc5bec1b38b1c96d0b373/packages/ai/src/ui-message-stream/ui-message-chunks.ts#L15-L170)).

The official `HttpChatTransport` permits custom request bodies, headers/credentials, endpoint URLs, and reconnect requests, so a frontend can send only LLM Space's approved text input and put bearer/continuation credentials in headers instead of adopting AI SDK's default whole-message request body ([transport options](https://github.com/vercel/ai/blob/91a3d6e9f1e2e948dcffc5bec1b38b1c96d0b373/packages/ai/src/ui/http-chat-transport.ts#L11-L114), [POST/reconnect implementation](https://github.com/vercel/ai/blob/91a3d6e9f1e2e948dcffc5bec1b38b1c96d0b373/packages/ai/src/ui/http-chat-transport.ts#L145-L268)). Its React `useChat` and equivalents can then maintain a UI message model.

For UI, Vercel's **AI Elements** is an official shadcn/ui-based component registry, so its message, reasoning, tool, conversation, and prompt components can consume AI SDK UI state without granting it runtime authority ([official overview](https://ai-sdk.dev/elements/overview)). Vercel's **Chatbot** is a larger open-source Next.js reference/template using AI SDK, shadcn/ui, persistence, and authentication—not a protocol library and not something to embed wholesale in the Electrobun app ([official repository](https://github.com/vercel/chatbot/tree/c2f8235e1f3ea903ad8b7f61447c4f74164b5c58)).

### Exact compatibility gaps

| Concern | Pi | AI SDK UI stream | LLM Space canonical requirement |
| --- | --- | --- | --- |
| Text | `text_start/delta/end` with `contentIndex` | `text-start/delta/end` with stable block `id` | Generate and persist stable message/block IDs; map deltas. |
| Thinking/reasoning | `thinking_start/delta/end`; partial messages may include signatures/redacted payload | `reasoning-start/delta/end` | Map visible reasoning only; never expose signatures/opaque provider continuity data. |
| Tool call input | Provider `toolcall_start/delta/end`; runtime later emits validated `tool_execution_start` | `tool-input-start/delta/available/error` | Map provider JSON deltas to input deltas, then publish validated input as available; do not leak unvalidated/internal details as authoritative args. |
| Tool progress/result | `tool_execution_update/end`, arbitrary result/details and `isError` | preliminary output plus output available/error/denied | Sanitize into explicit public output/error; keep a canonical execution-progress event when needed and adapt it to typed `data-*` or preliminary output. |
| Turns/steps | `turn_start/end` | `start-step/finish-step` | Straightforward projection; canonical Run remains the outer lifecycle. |
| Terminal/error | `agent_end`; provider `done/error`, assistant stop reason `error/aborted` | `finish`, `error`, `abort`, then `[DONE]` | Canonical unique terminal is `completed/failed/cancelled/outcomeUnknown`; adapter emits closest standard part plus `data-llm-space-run-terminal` so no state is lost. |
| Abort | `Agent.abort()` is in-process | frontend request abort normally closes fetch; resumable docs require a dedicated stop endpoint | Keep the already-approved explicit abort route; client disconnect never aborts execution. |
| Durable Session | Pi Coding Agent has local session files but no authenticated remote ownership contract | UI SDK expects application-owned chat persistence | LLM Space repository remains sole owner; frontend UI messages are a projection, not transcript authority. |
| Reconnect/cursor | none in `AgentEvent` or Pi JSONL | `useChat({ resume: true })` can issue GET, but official resumption requires app persistence, an active stream ID, and typically Redis/resumable-stream | Canonical persisted sequence + SSE `id` + `Last-Event-ID`; a custom LLM Space transport stores/sends the cursor. Do not adopt Redis or active-stream-only semantics. |
| SSE framing | none; Coding Agent uses JSONL | `data:` JSON plus `[DONE]`; no durable event `id` in the documented chunk format | Canonical endpoint uses standard SSE `id` and `data`; AI adapter may include SSE `id` (ignored by ordinary AI SDK parsing) while the LLM Space client uses it. |

AI SDK's own resumable-stream guide confirms the limit: the SDK supplies a `resume` option, a stream-consumption callback, and reconnect requests, while the application must provide storage, chat-to-stream tracking, POST/GET endpoints, and Redis/resumable-stream; it also warns that client abort is only a disconnect and recommends a dedicated stop endpoint ([official resumption guide](https://github.com/vercel/ai/blob/91a3d6e9f1e2e948dcffc5bec1b38b1c96d0b373/content/docs/04-ai-sdk-ui/03-chatbot-resume-streams.mdx#L8-L46), [stop semantics](https://github.com/vercel/ai/blob/91a3d6e9f1e2e948dcffc5bec1b38b1c96d0b373/content/docs/04-ai-sdk-ui/03-chatbot-resume-streams.mdx#L154-L175)). Therefore AI SDK is an excellent **rendering-stream adapter**, but not the canonical durable Session protocol.

## AG-UI compatibility

AG-UI is the strongest protocol reference when the emphasis is the whole
agent-to-user interaction rather than only chat rendering. Its official event
model includes Run lifecycle, text, reasoning, tool-call, state, activity, raw,
and custom events; `RUN_STARTED` carries `threadId`/`runId`, while every Run
must finish with `RUN_FINISHED` or `RUN_ERROR` ([official event
schemas](https://github.com/ag-ui-protocol/ag-ui/blob/a379c3e37b4cb4a0aed15f8d99b58df45e34fa3f/sdks/typescript/packages/core/src/events.ts),
[event documentation](https://github.com/ag-ui-protocol/ag-ui/blob/a379c3e37b4cb4a0aed15f8d99b58df45e34fa3f/docs/concepts/events.mdx)).
The first-party `@ag-ui/client` supplies an HTTP/SSE `HttpAgent`, event
validation/reduction, state tracking, subscribers, and a custom transport base;
CopilotKit supplies the corresponding application/UI SDK and customizable chat,
tool rendering, shared state, generative UI, and human-in-the-loop surfaces
([client README](https://github.com/ag-ui-protocol/ag-ui/blob/a379c3e37b4cb4a0aed15f8d99b58df45e34fa3f/sdks/typescript/packages/client/README.md),
[CopilotKit README](https://github.com/CopilotKit/CopilotKit/blob/7abcd216dcfb746a3d080f8e0678ba731b60cafd/README.md)).

It is still not safe to make AG-UI the item-06 persistence or authorization
authority unchanged. Its standard input is designed for interoperable agent
frontends and can carry messages, state, tools, context, and caller-selected
Run IDs, while the approved LLM Space contract accepts only text input and
makes the Server transcript, compiled artifact, Runtime Session ID, and Runtime
Run ID authoritative. The reference client is oriented around starting and
consuming a Run; AG-UI does not define LLM Space's continuation-token lifecycle,
owner checks, exact persisted `Last-Event-ID` validation, restart recovery, or
the `outcomeUnknown` terminal. Its current pre-1.0 event surface also contains
deprecated thinking events being replaced by reasoning events, which is a
concrete reason not to store an unversioned third-party union as LLM Space's
permanent journal schema.

AG-UI therefore belongs beside AI SDK UI as a projection/adapter target:

- AG-UI is the better semantic reference for Run/thread lifecycle, activities,
  tools, shared state, and richer agent-native UI.
- AI SDK UI is the lighter first rendering adapter for the current React +
  shadcn stack because `useChat` and AI Elements already consume its message
  parts.
- Neither replaces the canonical LLM Space client responsible for credentials,
  exact cursor replay, abort, restart recovery, and terminal-state fidelity.

## Recommended canonical event vocabulary

Use part-oriented stable IDs so the canonical stream is easy to reduce and maps losslessly to AI SDK UI, while keeping LLM Space Run semantics explicit:

```text
run.started
turn.started
message.started
message.text.started | message.text.delta | message.text.completed
message.reasoning.started | message.reasoning.delta | message.reasoning.completed
tool.input.started | tool.input.delta | tool.input.completed
tool.execution.started | tool.execution.updated | tool.execution.completed
message.completed
turn.completed
run.completed | run.failed | run.cancelled | run.outcomeUnknown
server.shutdown              # transient connection notice, not a Run terminal
```

Every message/block/tool call gets a Server-assigned stable ID persisted before publication. Public tool inputs are schema-validated; public results/errors pass a redaction/sanitization boundary. Pi provider diagnostics, full partial message snapshots, thought/text signatures, raw provider payloads, system instructions, credentials, headers, stacks, and repository paths are never public event data.

An AI SDK adapter maps those events to UI chunks and adds a typed `data-llm-space-run-terminal` part for the canonical terminal category. The canonical TypeScript client consumes native events directly, which preserves `sequence`, exact replay, `outcomeUnknown`, continuation rotation, and stable Server error codes even if the optional AI SDK adapter changes with a future AI SDK protocol revision.

## Rejected options

- **Raw Pi events:** fastest initially, but leaks library internals and cannot satisfy versioning, durable cursor, terminal, redaction, or recovery contracts.
- **Only a thin envelope around an unchanged raw Pi event:** adds IDs but retains the mutable/version-coupled payload and unsafe `any` fields; it does not create a genuine public boundary.
- **AI SDK stream as the only canonical protocol:** maximizes immediate React UI reuse but makes Server recovery/authorization semantics depend on a frontend rendering protocol that has no standard `outcomeUnknown` or exact durable cursor contract.
- **A bespoke UI framework:** unnecessary; AI SDK hooks and AI Elements already provide an optional rendering ecosystem once the adapter exists.
- **AG-UI as the unmodified canonical Store/wire schema:** attractive for
  agent-native UI interoperability, but its caller input/Run ownership and
  recovery semantics do not match the approved Server authority boundary;
  preserve it as an adapter target instead.

## Sources

- Installed Pi packages and current LLM Space code, linked inline above.
- Earendil Works Pi repository at commit [`6442536`](https://github.com/earendil-works/pi/tree/6442536b1e2586f6da29a4301a0795aab672dc63).
- Vercel AI SDK repository at commit [`91a3d6e`](https://github.com/vercel/ai/tree/91a3d6e9f1e2e948dcffc5bec1b38b1c96d0b373).
- Vercel Chatbot repository at commit [`c2f8235`](https://github.com/vercel/chatbot/tree/c2f8235e1f3ea903ad8b7f61447c4f74164b5c58).
- [Vercel AI Elements official overview](https://ai-sdk.dev/elements/overview).
- AG-UI repository at commit [`a379c3e`](https://github.com/ag-ui-protocol/ag-ui/tree/a379c3e37b4cb4a0aed15f8d99b58df45e34fa3f).
- CopilotKit repository at commit [`7abcd21`](https://github.com/CopilotKit/CopilotKit/tree/7abcd216dcfb746a3d080f8e0678ba731b60cafd).
