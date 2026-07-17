# Eve state concurrency and step-commit failure

Status: complete
Date: 2026-07-17
Question: What happens when parallel Eve tools mutate `defineState`, and when an external tool side effect succeeds but the durable workflow step fails to commit?

## Fixed points and source scope

- Eve source: [`vercel/eve@6a5a36afa3a8094bb4d6caa9deedf32e55bd5507`](https://github.com/vercel/eve/tree/6a5a36afa3a8094bb4d6caa9deedf32e55bd5507), the `main`/`HEAD` returned by the upstream repository on 2026-07-17.
- That tree's workspace catalog selects AI SDK `^7.0.26`, and its lockfile resolves Eve to `ai@7.0.26`: [`pnpm-workspace.yaml#L35`](https://github.com/vercel/eve/blob/6a5a36afa3a8094bb4d6caa9deedf32e55bd5507/pnpm-workspace.yaml#L35), [`pnpm-lock.yaml#L19780-L19786`](https://github.com/vercel/eve/blob/6a5a36afa3a8094bb4d6caa9deedf32e55bd5507/pnpm-lock.yaml#L19780-L19786).
- For the delegated execution behavior, this note therefore also fixes AI SDK `ai@7.0.26` at [`vercel/ai@2ba5f8abd723cb07224990e552c4926ab5f8eebc`](https://github.com/vercel/ai/tree/2ba5f8abd723cb07224990e552c4926ab5f8eebc).

Only first-party Eve docs/source/tests and the exact first-party AI SDK dependency source are used below.

## Answer in one table

| Question | Answer | Contract strength |
| --- | --- | --- |
| Are tool calls from one model step serial? | No. Eve's docs say parallel tool calls dispatch concurrently, and the delegated AI SDK execution uses `Promise.all`. | Concurrent dispatch is documented; the exact `Promise.all` mechanism is current implementation. |
| Do parallel authored tools share state? | Yes in the current implementation. All execute under one step-wide ALS scope backed by the same mutable `ContextContainer`. | Current implementation; no public isolation guarantee was found. |
| Is there locking, CAS, conflict detection, per-tool staging, transaction merge, or rollback? | No such mechanism exists in the inspected `defineState`/context/tool path. | Absence in current implementation; Eve docs make no guarantee that one exists. |
| Which write wins? | `update(fn)` synchronously reads the value currently in the shared map and immediately replaces it. For competing replacement writes to the same key, whichever `set` actually runs last wins. That order can follow async interleaving, not model tool-call order. | Current implementation inference from the direct synchronous implementation; not a documented ordering contract. |
| When is state durable? | After the whole Eve `turnStep` has finished, context and session snapshots are returned as the result of the Workflow `"use step"`; that Workflow result is the atomic persistence boundary. | Step-boundary durability is documented and stated by source comments. |
| What if an external effect happened but the step did not durably complete? | The incomplete step may run again. Eve explicitly tells authors to make charges/emails idempotent or approval-gated. It does not expose an `outcomeUnknown` settlement for this case. | Re-execution after interruption is an official documented guarantee. Exact retry count is Workflow/current-runtime behavior, not an Eve authoring guarantee. |

## 1. Parallel tools mutate one shared in-memory context

### Officially documented behavior

Eve documents a step as one model call plus its tool calls, states that it serializes durable state at each step boundary, and separately says that parallel tool calls dispatch concurrently:

- [Execution Model and Durability, lines 10-18](https://github.com/vercel/eve/blob/6a5a36afa3a8094bb4d6caa9deedf32e55bd5507/docs/concepts/execution-model-and-durability.md#L10-L18)
- [Dynamic Workflows, lines 6-9](https://github.com/vercel/eve/blob/6a5a36afa3a8094bb4d6caa9deedf32e55bd5507/docs/guides/dynamic-workflows.md#L6-L9)

The public state contract says only that `get()` reads the current value and `update(fn)` replaces it with `fn(current)`. It promises durability across step boundaries, but does **not** specify serial execution, transaction isolation, conflict detection, or write ordering:

- [State guide, lines 6-19](https://github.com/vercel/eve/blob/6a5a36afa3a8094bb4d6caa9deedf32e55bd5507/docs/guides/state.md#L6-L19)
- [`StateHandle` and `defineState`, lines 4-62](https://github.com/vercel/eve/blob/6a5a36afa3a8094bb4d6caa9deedf32e55bd5507/packages/eve/src/public/definitions/state.ts#L4-L62)

Therefore, concurrent tool dispatch and step-boundary durability are public behavior, but any stronger concurrency semantics for `defineState` are not.

### Current implementation

One `turnStep` deserializes one `ContextContainer`, then invokes the harness through `runStep` using that same object. Only after the harness completes does it serialize the context and construct the next durable session snapshot:

- [`turnStep`: load one context, run the harness, then serialize and return state, lines 119-127 and 308-390](https://github.com/vercel/eve/blob/6a5a36afa3a8094bb4d6caa9deedf32e55bd5507/packages/eve/src/execution/workflow-steps.ts#L119-L127)
- [same source, harness/serialization sequence, lines 308-390](https://github.com/vercel/eve/blob/6a5a36afa3a8094bb4d6caa9deedf32e55bd5507/packages/eve/src/execution/workflow-steps.ts#L308-L390)

`runStep` installs the container once with `AsyncLocalStorage.run()` around the entire callback. Tool promises spawned inside it inherit that same store object:

- [`withContextScope`, lines 33-65](https://github.com/vercel/eve/blob/6a5a36afa3a8094bb4d6caa9deedf32e55bd5507/packages/eve/src/context/run-step.ts#L33-L65)
- [process-wide ALS and `loadContext`, lines 98-130](https://github.com/vercel/eve/blob/6a5a36afa3a8094bb4d6caa9deedf32e55bd5507/packages/eve/src/context/container.ts#L98-L130)

The context itself is one mutable `Map<string, unknown>`. `set` overwrites a name directly; `ensure` and `entries` provide no version, lock, transaction, or mutation log:

- [`ContextContainer`, lines 30-65 and 88-95](https://github.com/vercel/eve/blob/6a5a36afa3a8094bb4d6caa9deedf32e55bd5507/packages/eve/src/context/container.ts#L30-L65)

`defineState.update` performs `ensure`, invokes the updater synchronously, and immediately calls `ctx.set`. It neither clones nor stages a value per tool:

- [`defineState.update`, lines 50-61](https://github.com/vercel/eve/blob/6a5a36afa3a8094bb4d6caa9deedf32e55bd5507/packages/eve/src/public/definitions/state.ts#L50-L61)

Eve hands its tool set to AI SDK `ToolLoopAgent` for each step:

- [`ToolLoopAgent` construction and stream/generate calls, lines 884-909 and 924-980](https://github.com/vercel/eve/blob/6a5a36afa3a8094bb4d6caa9deedf32e55bd5507/packages/eve/src/harness/tool-loop.ts#L884-L909)

In the exact locked AI SDK version, non-stream tool batches use `Promise.all(toolCalls.map(executeToolCall))`, while streamed execution collects calls and also executes the batch through `Promise.all` after `model-call-end`:

- [`executeTools`, AI SDK 7.0.26 lines 1465-1521](https://github.com/vercel/ai/blob/2ba5f8abd723cb07224990e552c4926ab5f8eebc/packages/ai/src/generate-text/generate-text.ts#L1465-L1521)
- [`executeToolsFromStream`, AI SDK 7.0.26 lines 199-238](https://github.com/vercel/ai/blob/2ba5f8abd723cb07224990e552c4926ab5f8eebc/packages/ai/src/generate-text/execute-tools-from-stream.ts#L199-L238)

Consequences of this implementation:

1. Tool executions are concurrent, but their `defineState` calls mutate the same in-memory container.
2. Each individual `update(fn)` call is synchronous and observes the map at the instant that call runs. Two simple increment updaters that execute one after another will each see the preceding write, but async work before the updater makes their arrival order nondeterministic.
3. Competing replacements of the same key are effectively last-actual-`set`-wins. There is no conflict error.
4. Multiple keys naturally coexist in the final map, but this is not a transaction merge: any tool can overwrite any imported handle, and no tool-level rollback exists.
5. Eve's state tests cover sequential updates and independent names only; no parallel state-write contract is asserted: [`state.test.ts#L25-L58`](https://github.com/vercel/eve/blob/6a5a36afa3a8094bb4d6caa9deedf32e55bd5507/packages/eve/src/public/definitions/state.test.ts#L25-L58).

## 2. External side effect succeeds, durable commit fails

### Commit sequence

For a normal authored-tool step, the current call sequence is:

1. Read the previous durable session and deserialize one context.
2. Run the model and all executable tool calls; parallel tool calls settle before the AI SDK step settles.
3. Run Eve provider commit hooks.
4. Serialize the shared durable context.
5. Project the resulting session into `DurableSessionState`.
6. Return both values from `turnStep`, which is a Workflow `"use step"`.
7. The Workflow engine durably records that step result; later steps consume the returned snapshot.

The relevant Eve sources explicitly describe Workflow step results as the atomic persistence boundary and show state embedded in the returned result:

- [`durable-session-store.ts`, lines 1-16 and 186-201](https://github.com/vercel/eve/blob/6a5a36afa3a8094bb4d6caa9deedf32e55bd5507/packages/eve/src/execution/durable-session-store.ts#L1-L16)
- [`turnStep` result construction, lines 384-440](https://github.com/vercel/eve/blob/6a5a36afa3a8094bb4d6caa9deedf32e55bd5507/packages/eve/src/execution/workflow-steps.ts#L384-L440)

If context serialization throws, or execution stops after an external call but before the Workflow result is durably completed, the attempted in-memory `defineState` changes are not a committed snapshot. They are reconstructed from the prior completed step on another attempt. The external system's already-applied effect is outside that transaction and cannot be rolled back by Eve.

### Retry and replay behavior

This is not merely an inference Eve leaves unstated. The official durability guide says:

> Completed steps never re-run; eve replays the recorded result. A step interrupted mid-execution re-runs, so make non-idempotent side effects like charges or emails idempotent, or gate them with approval.

Source: [Execution Model and Durability, lines 41-45](https://github.com/vercel/eve/blob/6a5a36afa3a8094bb4d6caa9deedf32e55bd5507/docs/concepts/execution-model-and-durability.md#L41-L45).

The repository's current real-workflow tests additionally demonstrate that a throwing state-write step is attempted again and that only the successful retry's returned snapshot becomes visible. A persistent task-step failure is observed as three retries after the first attempt (four attempts total):

- [durable state retry test, lines 67-84](https://github.com/vercel/eve/blob/6a5a36afa3a8094bb4d6caa9deedf32e55bd5507/packages/eve/src/execution/durable-session-store.integration.test.ts#L67-L84)
- [retry fixture throws on attempt 1, lines 62-89](https://github.com/vercel/eve/blob/6a5a36afa3a8094bb4d6caa9deedf32e55bd5507/packages/eve/src/internal/testing/durable-session-workflow.ts#L62-L89)
- [persistent-failure test reporting three retries / attempt 4, lines 34-50](https://github.com/vercel/eve/blob/6a5a36afa3a8094bb4d6caa9deedf32e55bd5507/packages/eve/src/execution/task-model-retry.integration.test.ts#L34-L50)

The exact attempt budget is current Workflow/runtime behavior and should not be treated as Eve's stable state API. The stable public point is more important: an uncompleted step can execute again. Eve exposes no `outcomeUnknown` state for “external effect may have happened, checkpoint did not commit,” and the inspected public docs make no exactly-once guarantee.

Tool exceptions are a separate case: AI SDK can turn a normal tool exception into a tool-error result that the model sees, allowing the containing step itself to complete. That does not solve a process crash or persistence failure after the external effect but before the containing step result commits.

## Public guarantees versus current implementation

### Public/official guarantees

- State is per Session and durable across completed workflow step boundaries.
- Parallel tool calls dispatch concurrently.
- Completed step results are replayed rather than re-executed.
- A step interrupted before durable completion re-runs.
- Authors must make non-idempotent external effects idempotent or approval-gated.
- No public guarantee was found for state-write isolation, deterministic parallel write order, CAS/conflict detection, tool-level atomicity, rollback, or exactly-once effects.

### Current implementation only

- All parallel authored tools in one step share one mutable ALS `ContextContainer`.
- Both Eve execution modes delegate tool concurrency to AI SDK 7.0.26 `Promise.all` batches.
- `defineState.update` is an immediate synchronous read/replace against that shared map.
- Same-key replacement is last-actual-write-wins without conflict detection.
- State/context and session are committed together only as the returned Workflow step result.
- The inspected Workflow tests currently exhibit up to three retries after an initial failure; this count is not a `defineState` contract.

## Direct recommendation for LLM Space item 12

Do **not** copy Eve's parallel shared-map mutation semantics. It is simple and works for advisory conversation memory, but it does not meet item 12's trusted-state and external-effect safety goals.

Keep the proposed LLM Space rule:

1. Statically declared stateful authored tools execute serially in model tool-call order for one Session; stateless tools may retain existing concurrency.
2. Each stateful tool receives a staged transaction over declared handles. Publish all its state writes atomically only after the tool succeeds; discard them on ordinary tool failure.
3. Persist the resulting state through the existing Session Store CAS. Do not silently merge a CAS conflict or re-run the tool.
4. If an external effect may have happened but the atomic Session commit fails, stop the Runtime Run as `outcomeUnknown`. Never let the model continue as if it were an ordinary tool error, and never automatically retry/replay that tool.
5. Require idempotency keys/effect receipts as a later explicit protocol for any capability that wants safe recovery; approval alone records intent, not whether an effect committed.

Eve remains a useful reference for the authored `defineState` handle and the separation between Session working memory and external long-term storage. Its current failure semantics are evidence for why LLM Space should retain the stricter `outcomeUnknown` boundary already established by roadmap item 04.
