# Pi ReAct runtime reuse research

Date: 2026-07-14; rechecked 2026-07-15
Scope: installed `@earendil-works/pi-agent-core` 0.80.3, current npm/upstream 0.80.7, current LLM Space runtime, and Desktop Thread execution.
Primary sources: the installed 0.80.3 package, the official `earendil-works/pi` `v0.80.3` tag, upstream main at `5e336cfa808c7b6056f168d42482c27f3acfc5cc`, current npm metadata, and this repository.

## Conclusion

**LLM Space can use Pi's same low-level ReAct loop for Thread debugging, but the right reusable stateful primitive is Pi `Agent`, not the current `AgentHarness` API.**

Pi `Agent` owns `state.messages`, accepts initial messages, calls the same `runAgentLoop`/`runAgentLoopContinue`, and exposes `continue()`. With a runtime-owned persistence adapter and uniform per-run tool wrappers, it can express all three existing Desktop modes:

| LLM Space mode        | Pi `Agent` policy                                                                                                                                                                                      | Result                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Manual / step-by-step | Every tool is replaced by a deferred placeholder executor returning `terminate: true`; after the user supplies real results, replace the placeholder `toolResult` messages and call `agent.continue()` | Same model-turn boundary as today; no extra user message  |
| Auto-run once         | Execute real tools, then force `terminate: true` on **every** result in the batch                                                                                                                      | Tools execute once; no automatic next model turn          |
| ReAct                 | Execute real tools without `terminate`                                                                                                                                                                 | Pi continues model -> tools -> model until the loop stops |

`AgentHarness` cannot currently reproduce the manual boundary faithfully. It requires a Pi `Session`, executes or blocks every tool call before the turn ends, and has no public continuation method. `appendMessage(toolResult)` can persist an external result, but `prompt()` always adds a new user message; `nextTurn()` also queues a user message. A custom `SessionStorage` alone does **not** solve this missing lifecycle operation.

The 2026-07-15 recheck found the same boundary in upstream/npm 0.80.7: `AgentHarness` still calls `runAgentLoop()` for its turn entry points and exposes no `continue()`/`runAgentLoopContinue()` path or transcript-replacement operation.

The recommended V1 is therefore:

1. `AgentRuntime` loads and validates the project/definition when the runtime is built and owns its project snapshot and defaults.
2. `runtime.createSession(...)` constructs a Pi `Agent` and a runtime-owned session journal/repository internally; callers never pass a Pi `Session`.
3. `RuntimeSession` is the only public session surface. It projects Pi events/messages to Thread, owns manual placeholder replacement, and persists transcript mutations.
4. Keep Pi `Session`/`AgentHarness` as a future option after either upstreaming a true `AgentHarness.continue()` plus transcript import/replacement semantics, or replacing the Harness runner with an LLM Space session runner around the low-level loop.

This avoids implementing a new ReAct loop. It does require an LLM Space session adapter because Pi `Agent` deliberately owns only in-memory transcript state, while Thread needs persistence, editing, undo/rerun, and placeholder-result replacement.

## Evidence

### 1. `Agent`, `AgentHarness`, and the low-level APIs share one ReAct loop

The low-level loop has two entry points: `runAgentLoop()` adds prompt messages, while `runAgentLoopContinue()` starts from an existing context whose last LLM-visible message is not an assistant message. Both enter the same internal `runLoop()` implementation ([official source](https://github.com/earendil-works/pi/blob/v0.80.3/packages/agent/src/agent-loop.ts#L95-L155)).

Pi `Agent.prompt()` delegates to `runAgentLoop()`, and `Agent.continue()` delegates to `runAgentLoopContinue()` ([official source](https://github.com/earendil-works/pi/blob/v0.80.3/packages/agent/src/agent.ts#L334-L429)). `AgentHarness.executeTurn()` also delegates to `runAgentLoop()` ([official source](https://github.com/earendil-works/pi/blob/v0.80.3/packages/agent/src/harness/agent-harness.ts#L531-L606)). Therefore choosing `Agent` does not fork or reimplement ReAct behavior; it changes the state/persistence wrapper around the same loop.

The loop itself streams an assistant response, executes its tool-call batch, appends the resulting `toolResult` messages, and continues only when the batch does not terminate ([official source](https://github.com/earendil-works/pi/blob/v0.80.3/packages/agent/src/agent-loop.ts#L192-L218)).

### 2. Pi `Agent` has the transcript and continuation semantics Thread needs

`Agent` is documented in source as owning the current transcript. Its initial state accepts `messages`, and the public state exposes a writable `messages` array ([official source](https://github.com/earendil-works/pi/blob/v0.80.3/packages/agent/src/agent.ts#L67-L99), [state contract](https://github.com/earendil-works/pi/blob/v0.80.3/packages/agent/src/types.ts#L316-L347)). This permits a runtime adapter to seed a session from a saved Thread and to replace deferred tool results before continuation.

`continue()` performs no prompt insertion. It validates the existing transcript and invokes the continuation loop; the last message may be a user or tool-result message, but not an assistant message ([official source](https://github.com/earendil-works/pi/blob/v0.80.3/packages/agent/src/agent.ts#L347-L375), [continuation implementation](https://github.com/earendil-works/pi/blob/v0.80.3/packages/agent/src/agent.ts#L412-L429)). This matches Desktop's current “fill tool results, then Continue” behavior.

On each `message_end`, `Agent` appends the message to `state.messages` before awaiting subscribers. It also tracks active tool call ids from `tool_execution_start` through `tool_execution_end` ([official source](https://github.com/earendil-works/pi/blob/v0.80.3/packages/agent/src/agent.ts#L520-L574)). A runtime adapter can therefore project and persist one authoritative event sequence.

### 3. `terminate: true` can express manual and auto-once boundaries, with constraints

Pi executes the tool first, then creates a `toolResult` message and evaluates termination. A batch terminates only when it is non-empty and **every finalized tool result** has `terminate === true` ([official source](https://github.com/earendil-works/pi/blob/v0.80.3/packages/agent/src/agent-loop.ts#L395-L448), [parallel path and all-results rule](https://github.com/earendil-works/pi/blob/v0.80.3/packages/agent/src/agent-loop.ts#L451-L545)). `afterToolCall` may override `terminate` after real execution ([official source](https://github.com/earendil-works/pi/blob/v0.80.3/packages/agent/src/agent-loop.ts#L671-L713)).

Consequences:

- **Auto-once is direct:** execute the real tools and force `terminate: true` on every finalized result. The full batch completes and is recorded, but the next provider turn is skipped.
- **ReAct is direct:** execute real tools and leave `terminate` unset.
- **Manual is an adapter convention, not a native pause:** deferred wrappers must return placeholder results with `terminate: true`. When the user executes/edits tools, the runtime atomically replaces those placeholder `toolResult` messages in `Agent.state.messages`, persists that mutation, and calls `continue()`.
- The policy must cover every call in a batch. Mixing terminating and non-terminating results causes the loop to continue.
- Deferred results should carry an application marker such as `details: { deferred: true }`; otherwise Pi's normal event sequence makes the placeholder look like a completed execution.

This is already the technique behind current Desktop step-by-step execution. `streamAgent()` converts every advertised Thread tool to a no-op Pi tool whose result has `terminate: true` ([current source](../../../packages/core/src/server/agent/stream.ts#L143-L177)). Desktop later executes tools outside the model stream and writes outputs onto the Thread ([current source](../../../apps/desktop/src/components/thread-playground/stores/thread-store.ts#L367-L464)); the next turn lowers those nested outputs to Pi `toolResult` messages ([current source](../../../packages/core/src/client/converters.ts#L17-L57)). The store repeats model turns only in ReAct mode ([current source](../../../apps/desktop/src/components/thread-playground/stores/thread-store.ts#L1124-L1158)). Moving this policy behind `RuntimeSession` preserves the behavior while removing the second, Desktop-owned ReAct loop.

### 4. Pi does not provide a true “pause before tool execution” state

`beforeToolCall` runs after argument validation. Returning `{ block: true }` does not leave the call pending; it creates an immediate error tool result ([official source](https://github.com/earendil-works/pi/blob/v0.80.3/packages/agent/src/agent-loop.ts#L562-L625)). `terminate` is assessed only after finalized results exist. `shouldStopAfterTurn` also runs only after tool execution and `turn_end` ([official source](https://github.com/earendil-works/pi/blob/v0.80.3/packages/agent/src/agent-loop.ts#L218-L253)).

A tool executor could return a Promise that waits for UI approval, but that keeps the run active and is not a durable pause: the prompt has not settled, process restart cannot resume the Promise, and the existing Thread “idle with pending calls, later Continue” contract is lost. Placeholder-result replacement is the smaller and already-proven compatibility technique.

### 5. Why current `AgentHarness` is not enough

`AgentHarnessOptions.session` is required ([official source](https://github.com/earendil-works/pi/blob/v0.80.3/packages/agent/src/harness/types.ts#L798-L834)). Each turn rebuilds its messages from `session.buildContext()` ([official source](https://github.com/earendil-works/pi/blob/v0.80.3/packages/agent/src/harness/agent-harness.ts#L314-L357)), and every `message_end` is immediately appended to that session before the event reaches subscribers ([official source](https://github.com/earendil-works/pi/blob/v0.80.3/packages/agent/src/harness/agent-harness.ts#L488-L515)). This is useful for an append-only execution session.

However, its public run methods are `prompt`, `skill`, and template invocation. `appendMessage()` only writes a message, while `nextTurn(text)` queues a new user message; there is no equivalent of `Agent.continue()` ([official source](https://github.com/earendil-works/pi/blob/v0.80.3/packages/agent/src/harness/agent-harness.ts#L608-L684)). Since its private execution path always creates a user message and calls `runAgentLoop()`, an adapter cannot resume from an externally supplied tool result without adding a user message or reimplementing private Harness lifecycle code.

The current LLM Space prototype exposes this mismatch directly: base `AgentRuntime.createSession()` accepts both `session` and `loadProject`, then loads the project during session creation ([current source](../../../packages/runtime/src/agent-runtime.ts#L17-L60)); `AgentRuntimeSession` simply forwards `prompt`, `nextTurn`, and `append`-free Harness operations and has no continuation method ([current source](../../../packages/runtime/src/agent-runtime-session.ts#L28-L127)). `LocalAgentRuntime` already proves the Pi Session can be created internally by a repo and hidden from application callers ([current source](../../../packages/runtime/src/node/local-agent-runtime.ts#L22-L84)), but that hides the object without fixing manual continuation.

### 6. Pi Session tree: valuable, but not a drop-in Thread store

Pi `Session` is an append-only tree over a `SessionStorage`. Its context is rebuilt from the active path and includes messages plus the last thinking/model/active-tools state; compaction changes which messages are projected ([official source](https://github.com/earendil-works/pi/blob/v0.80.3/packages/agent/src/harness/session/session.ts#L22-L80)). Appending a message gives it the current leaf as parent, and `moveTo()` changes the active branch ([official source](https://github.com/earendil-works/pi/blob/v0.80.3/packages/agent/src/harness/session/session.ts#L82-L140)). The storage/repository contracts support create, open, fork, list, and delete ([official source](https://github.com/earendil-works/pi/blob/v0.80.3/packages/agent/src/harness/types.ts#L422-L478)).

That tree does not have an in-place “replace this tool result” operation. A runtime-owned adapter can persist `Agent` events without exposing Pi Session, but deferred-result replacement must be handled explicitly:

- for append-only Pi storage, move the leaf to the parent before the placeholder results and append the resolved results as a new branch; or
- use an LLM Space session journal that supports Thread's transcript replacement/undo semantics and optionally export to Pi entries later.

Arbitrary Thread edits, rerun-from-message, undo/redo, and prompt-variable snapshots are also LLM Space product semantics, not Pi Session semantics. Treating a Pi Session as a passive event sink is therefore insufficient unless the adapter owns bidirectional message/entry identity and branching.

## Minimal runtime/session adapter

The smallest coherent public boundary is:

```ts
const runtime = await createAgentRuntime({
  projectRoot,
  models,
  // loads definition/instructions/tools/skills here
});

const session = await runtime.createSession({
  id,
  model, // optional override of runtime definition
  reasoning, // optional override of runtime definition
  initialMessages,
});

session.setExecutionMode("manual" | "autoOnce" | "react");
await session.prompt(message);
await session.resolveToolResults(results); // replaces deferred placeholders
await session.continue(); // no new user message
```

Internally, `RuntimeSession` should own:

- one Pi `Agent` for transcript, events, and the shared low-level ReAct loop;
- one persistence driver created by the runtime (Thread-backed for Desktop; JSONL or another repo for headless);
- conversion between LLM Space messages and Pi messages, including stable tool-call identity;
- uniform tool policy wrappers for each run mode;
- atomic placeholder-result replacement and persistence;
- project snapshot refresh at a turn boundary, updating the Agent's prompt/tools/resources without reconstructing the session.

The public API should expose neither Pi `Session` nor writable Pi `Agent.state`. That keeps the runtime as the single owner and prevents Desktop and headless hosts from developing different continuation rules.

## Stop conditions and limitations

- Do not claim native Pi manual pause/approval: 0.80.3 does not have one.
- Do not build only a custom `SessionStorage` under `AgentHarness`; it cannot add the missing continuation entry point.
- If placeholder tool-result events are unacceptable for traces/evaluations, stop and either upstream a first-class suspended tool-call protocol or implement an LLM Space loop/session runner around `runAgentLoopContinue`.
- If full Pi Harness compaction/tree navigation must ship in the same V1, the `Agent` adapter is insufficient without additional integration. That should be a separate capability slice or an upstream Harness extension.

## Recommendation

Proceed with **Pi `Agent` + runtime-owned LLM Space `RuntimeSession` adapter**. It is the only 0.80.3 path that simultaneously reuses Pi's actual ReAct loop, supports initial/editable Thread messages, and resumes external tool results without inventing an extra user turn. Keep Pi Session persistence behind the adapter only where its append-only tree is useful; do not make a Pi Session a required `createSession()` argument.
