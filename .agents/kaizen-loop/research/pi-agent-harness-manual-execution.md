# Pi AgentHarness manual execution research

Date: 2026-07-15

Scope: installed `@earendil-works/pi-agent-core` 0.80.3, npm `0.80.7`, upstream `main`, and the current LLM Space manual execution contract.

Primary sources:

- Installed package: `/Users/feng/Projects/ai-studio/node_modules/@earendil-works/pi-agent-core` at 0.80.3; lock entry at `/Users/feng/Projects/ai-studio/bun.lock:379`.
- npm 0.80.7 (`gitHead` `818d67457cdd6b60bce6b121d16b23141c252dd8`): [registry metadata](https://registry.npmjs.org/@earendil-works%2fpi-agent-core/0.80.7), [tag source](https://github.com/earendil-works/pi/tree/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/agent).
- Upstream `main` at research time: [`5e336cfa808c7b6056f168d42482c27f3acfc5cc`](https://github.com/earendil-works/pi/commit/5e336cfa808c7b6056f168d42482c27f3acfc5cc).
- Current repository runtime and focused behavior tests.

The relevant Harness, agent-loop, Agent, Session, repo/storage, and type sources are byte-identical between npm tag 0.80.7 and upstream `main`. The installed 0.80.3 package has the same material limitation described below.

## Decision

**Do not make `AgentHarness` the LLM Space session core. Keep the official Pi `Agent` as the model/tool loop core and implement LLM Space session semantics around it.**

`AgentHarness` supports one kind of manual execution: a tool's `execute()` can return a Promise that remains pending until the host supplies a result. That keeps the entire Harness run busy. It does **not** support LLM Space's current settled manual contract:

1. the model emits tool calls;
2. the run settles and the Thread remains durable and editable;
3. the host later records exact `toolResult` messages, including after UI delay or reload;
4. the model resumes from those results without a synthetic user message.

The missing operation is a public Harness equivalent of `Agent.continue()` / `runAgentLoopContinue()`. Transcript seeding is possible and transcript branching is possible, so those are not by themselves decisive blockers. The lack of prompt-free continuation is decisive.

## Current LLM Space contract

`AgentSession` creates Pi `Agent` with the Thread transcript as `initialState.messages`, exposes the public transcript from `Agent.state.messages`, replaces internal deferred results with exact host results only while idle, and calls `Agent.continue()` ([current `AgentSession`](../../../packages/runtime/src/runtime/sessions/agent-session.ts#L32-L135)).

The manual tool policy returns hidden placeholder results with `terminate: true`, later replaces every pending placeholder atomically, and restores placeholders when a persisted Thread ends at an assistant tool-call message ([current policy](../../../packages/runtime/src/execution/tool-execution-policy.ts#L53-L138)). The focused fixture proves the required boundary: `prompt()` settles with no real tool execution, the host persists a real `toolResult`, then `continue()` yields the next assistant without another user message ([current fixture](../../../packages/runtime/src/runtime/agent/agent-runtime.test.ts#L96-L168)). Desktop reload/continue reconstructs a runtime session from the Thread messages and invokes `session.continue()` ([Desktop continuation](../../../apps/desktop/src/bun/streaming/stream-thread.ts#L194-L213)).

This is intentionally a settled, durable boundary, not an approval Promise inside an active run.

## What AgentHarness can and cannot do

### 1. Every public turn entry adds a user message

Harness's public model-running methods are `prompt()`, `skill()`, and `promptFromTemplate()`. All three call the private `executeTurn()`. That method unconditionally starts with `createUserMessage(text)`, optionally prepends queued next-turn messages, then invokes `runAgentLoop()` ([Harness turn runner](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/agent/src/harness/agent-harness.ts#L531-L655)).

There is no public `continue()` or retry-from-context method. `nextTurn(text)` only converts text to a user message and queues it; it does not start a run. A later `prompt()`/`skill()`/template invocation consumes that queued user message and still adds the invocation's own user message ([queue and append APIs](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/agent/src/harness/agent-harness.ts#L657-L684)).

`appendMessage(toolResult)` only appends to the Session, or queues the append while Harness is busy. It never starts provider inference. Therefore “append exact result, then `nextTurn()`” is not continuation; it still needs a later synthetic prompt.

### 2. A pending tool Promise is manual, but not settled manual

Pi's tool contract allows `execute()` to return a Promise and passes it the active abort signal ([tool contract](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/agent/src/types.ts#L349-L396)). A host can retain a resolver keyed by `toolCallId` and resolve it after human action.

However, the low-level loop awaits that Promise before it can finalize the tool result ([execution await](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/agent/src/agent-loop.ts#L668-L709)). Until resolution there is no `tool_execution_end`, `toolResult` message, `turn_end`, Harness `save_point`, `agent_end`, or Harness `settled`. Harness remains busy. The event/persistence order after resolution is controlled by the loop and Harness ([tool finalization](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/agent/src/agent-loop.ts#L711-L791), [Harness persistence and save points](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/agent/src/harness/agent-harness.ts#L462-L515)).

This approach changes shipped behavior:

- the original run never settles at the pending-tool boundary;
- no durable exact result exists until the pending Promise resolves;
- process reload cannot resume the Promise;
- Thread edits and reruns occur while Harness still considers the turn active;
- abort depends on the tool honoring its signal, because Harness aborts and then waits for idle ([Harness abort](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/agent/src/harness/agent-harness.ts#L970-L1001)).

It is a useful approval pattern for a continuously running agent, but it is not a replacement for LLM Space manual mode.

### 3. Tool hooks cannot suspend and later resume a settled run

The `tool_call` hook can only allow execution or return `block`; blocking immediately becomes an error tool result, not a pending call ([prepare/block behavior](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/agent/src/agent-loop.ts#L602-L665)).

The `tool_result` hook runs only after `execute()` has completed. It may patch `content`, `details`, `isError`, and `terminate` ([Harness hook bridge](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/agent/src/harness/agent-harness.ts#L399-L447), [result finalization](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/agent/src/agent-loop.ts#L711-L748)). `terminate: true` can settle after a placeholder tool result, but no Harness API can later continue from its replacement.

### 4. Prompt/context-hook workarounds still create a synthetic turn

A possible workaround is to call `harness.prompt(SENTINEL)`, inject exact tool results through `before_agent_start`, and remove the sentinel from the provider's context in the `context` hook. This is not faithful:

- `executeTurn()` always creates the sentinel user message and only appends hook-provided messages; hooks cannot replace the base prompt.
- `runAgentLoop()` emits `message_start`/`message_end` for every prompt before provider inference ([prompt event ordering](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/agent/src/agent-loop.ts#L95-L117)).
- Harness appends every `message_end` to its Session before subscribers observe the event ([persistence ordering](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/agent/src/harness/agent-harness.ts#L488-L505)).
- A `context` hook changes model input only. Hiding the sentinel additionally requires a deliberately filtering SessionStorage and event adapter.

That preserves neither the authoritative transcript nor event fixtures; it only hides the synthetic user turn in several places.

### 5. Session can seed and branch, but has no transcript replace operation

Harness accepts an application-created `Session`, so an existing Thread can be seeded before constructing Harness by appending messages or by providing a storage initialized with entries. `InMemorySessionStorage` explicitly accepts initial entries ([Session APIs](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/agent/src/harness/session/session.ts#L137-L337), [in-memory seed](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/agent/src/harness/session/memory-storage.ts#L42-L61)).

Session is an append-only tree. The storage interface has append and leaf movement, and repositories have create/open/list/delete/fork; there is no `replaceMessages()`, clear, update-entry, or Harness `setSession()` ([storage/repo contracts](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/agent/src/harness/types.ts#L441-L479)). `Session.moveTo()` can branch before placeholder results and append real results, or the application can build a fresh Session and Harness from a Thread snapshot. Both can represent editing/reload with an adapter, but neither solves the missing prompt-free continuation.

### 6. Calling runAgentLoopContinue beside Harness bypasses Harness

Pi exports exactly the needed low-level operation: `runAgentLoopContinue()` starts from a context ending in a user or tool-result message and emits no prompt events ([continuation loop](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/agent/src/agent-loop.ts#L120-L143)).

Harness does not import or expose it. The state needed to call it faithfully—`createTurnState`, `createLoopConfig`, `createStreamFn`, `handleAgentEvent`, phase, abort controller, pending session writes, save points, and settlement—is private ([Harness internals](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/agent/src/harness/agent-harness.ts#L157-L205)). An external call can reuse the same Session object but not the Harness lifecycle. Recreating that lifecycle outside Harness would be the private runner copy item 01 intended to avoid.

## Why Pi Agent is the correct base

Pi `Agent` already packages the supported lifecycle around both official loop entry points:

- construction accepts `initialState.messages`;
- assigning `agent.state.messages` replaces the top-level transcript array;
- `continue()` requires an existing user/tool-result tail and adds no user message;
- its private continuation runner calls official `runAgentLoopContinue()`;
- it retains Pi's tool lifecycle, streaming, queueing, event reduction, abort signal, and idle semantics.

See [Agent state and continuation](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/agent/src/agent.ts#L240-L375) and [Agent loop delegation](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/agent/src/agent.ts#L396-L455).

The resulting ownership should be:

| Owner | Responsibilities |
| --- | --- |
| Pi `Agent` | provider turn loop, tool execution lifecycle, streaming, event ordering, abort, prompt-free continuation |
| LLM Space `AgentSession` | Thread transcript authority, manual deferred-result policy, exact result replacement, persistence, editing/reload projection, product execution modes |
| LLM Space runtime/project layer | agent definition, resources, tools, system prompt, and thin prompt-template/skill invocation adapters |

This is not a custom ReAct loop: every provider/tool turn still runs through Pi's official `Agent`, which delegates to Pi's official `runAgentLoop()` and `runAgentLoopContinue()`. The custom code is the product-specific session/persistence adapter that Harness cannot currently express.

## Recommendation for roadmap item 01

Replace “Pi AgentHarness alignment” with **“Pi Agent session-core alignment.”** Consider it complete when manual, auto-once, ReAct, persistence, abort, reload, tool, and event fixtures run through one LLM Space `AgentSession` backed by Pi `Agent`, and remaining duplicate Desktop/core session semantics have one documented owner.

Do not wait for or patch Harness for this item. Reconsider Harness only if it gains a public prompt-free continuation API with its normal persistence/save-point/event lifecycle, plus a supported strategy for replacing or rebuilding an authoritative editable transcript.
