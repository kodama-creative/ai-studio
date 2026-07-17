# Eve state model as a reference for Thread promotion

- Date: 2026-07-17
- Scope: design reference only for roadmap items 10, 12, and 13
- Eve source fixed point: [`vercel/eve@f7c69b1a2ad044a6ba89db7bb6241c469d3ef101`](https://github.com/vercel/eve/tree/f7c69b1a2ad044a6ba89db7bb6241c469d3ef101)
- Compatibility boundary: this note does **not** recommend an Eve dependency, an Eve source-format import, or a compatibility promise.

## Executive conclusion

Eve provides a useful **separation model**, not a reusable Thread-to-Agent state format:

1. Authored source declares a stable, typed state slot with `defineState(name, initial)`.
2. The runtime Session owns the slot's current value and persists it across Turns and workflow steps.
3. Trusted per-execution metadata (`ctx.session`) remains separate from authored durable state.
4. Dynamic instructions resolve at a Session or Turn boundary and are stored separately from conversation history.
5. Long-term or cross-Session memory remains an external-store concern.

LLM Space should borrow that separation while retaining its own Runtime Harness Session Store as the sole durable authority. It should **not** map every current Thread variable to Session state:

- a custom Thread variable/scenario value is currently an authoring input;
- `current_date` is trusted Turn context;
- `available_skills` is an effective-capability snapshot;
- only a future explicitly declared mutable value belongs in durable Session state.

There is no Eve source artifact that can represent or import LLM Space's current variable table, scenario variants, prompt-place snapshots, and Project promotion intent losslessly. Item 10 therefore still needs an LLM Space-owned source declaration/provider contract; Eve only validates the architectural direction.

## Primary-source findings

### 1. Authored state API

Eve's authored API is deliberately small:

```ts
const budget = defineState("my-agent.budget", () => ({ count: 0, cap: 25 }));

budget.get();
budget.update(current => ({ ...current, count: current.count + 1 }));
```

- `defineState<T>(name, initial)` returns a `StateHandle<T>` with synchronous `get()` and `update(fn)` only.
- The handle is declared once at module scope and imported by tools/hooks that use the same slot.
- `initial()` runs on first access within the active context.
- A stable string name is the durable identity. The `eve.` prefix is reserved for framework-owned keys.
- `get()` and `update()` throw outside a framework-managed runtime scope.
- The type parameter is TypeScript-only. `defineState` does not take a runtime schema, codec, migration, or validation function.

Sources:

- Official guide: [State](https://eve.dev/docs/guides/state)
- Public implementation: [`packages/eve/src/public/definitions/state.ts#L4-L62`](https://github.com/vercel/eve/blob/f7c69b1a2ad044a6ba89db7bb6241c469d3ef101/packages/eve/src/public/definitions/state.ts#L4-L62)
- Public tests for active-scope errors, reserved names, initialization, update, and independent names: [`packages/eve/src/public/definitions/state.test.ts#L10-L59`](https://github.com/vercel/eve/blob/f7c69b1a2ad044a6ba89db7bb6241c469d3ef101/packages/eve/src/public/definitions/state.test.ts#L10-L59)

The recommended source placement is ordinary agent-owned code such as `agent/lib/budget.ts`; tools import the handle. This is important for ownership: **the declaration and initial shape belong to Agent source; the live value belongs to one runtime Session.**

### 2. Session, Turn, and authored state are distinct

Eve exposes trusted execution metadata through `ctx.session`:

- `session.id`;
- `session.auth.current` for the active inbound Turn's caller;
- `session.auth.initiator` for the principal that initiated the durable Session;
- `session.turn.id` and zero-based `session.turn.sequence`;
- optional parent Session/call/Turn lineage for subagents.

The callback context also exposes sandbox and skill handles, but does not expose the mutable state map directly. Authored code reaches its own state only through a named `defineState` handle.

Sources:

- Official guide: [Session Context](https://eve.dev/docs/guides/session-context)
- Callback contract: [`packages/eve/src/public/definitions/callback-context.ts#L7-L36`](https://github.com/vercel/eve/blob/f7c69b1a2ad044a6ba89db7bb6241c469d3ef101/packages/eve/src/public/definitions/callback-context.ts#L7-L36)
- Turn and parent lineage types: [`packages/eve/src/channel/types.ts#L38-L67`](https://github.com/vercel/eve/blob/f7c69b1a2ad044a6ba89db7bb6241c469d3ef101/packages/eve/src/channel/types.ts#L38-L67)
- Auth principal shape: [`packages/eve/src/channel/types.ts#L73-L87`](https://github.com/vercel/eve/blob/f7c69b1a2ad044a6ba89db7bb6241c469d3ef101/packages/eve/src/channel/types.ts#L73-L87)

Eve explicitly positions `defineState` as short-term, conversation-scoped working memory. It is not shared with subagents. Anything that must outlive a Session, be shared across Sessions/users, or be queried independently belongs in an external store.

Source: [State — “State is never shared with subagents” and “State vs. connection-side storage”](https://eve.dev/docs/guides/state)

This aligns strongly with roadmap item 12's required distinction among Turn context, Session state, message history, and external long-term memory.

### 3. Persistence boundary and ownership

Eve serializes durable context values at workflow step boundaries. A `defineState` slot is backed by a named context key; values without a codec are stored as-is and therefore must already be serialization-safe. Step-local “virtual” context values are held separately and excluded from serialization.

Sources:

- Durable versus virtual context containers: [`packages/eve/src/context/container.ts#L6-L72`](https://github.com/vercel/eve/blob/f7c69b1a2ad044a6ba89db7bb6241c469d3ef101/packages/eve/src/context/container.ts#L6-L72)
- Serialization contract and unknown-key behavior: [`packages/eve/src/context/serialize.ts#L8-L62`](https://github.com/vercel/eve/blob/f7c69b1a2ad044a6ba89db7bb6241c469d3ef101/packages/eve/src/context/serialize.ts#L8-L62)
- Durable Session snapshot includes history and authored `state` as separate fields: [`packages/eve/src/execution/durable-session-store.ts#L69-L100`](https://github.com/vercel/eve/blob/f7c69b1a2ad044a6ba89db7bb6241c469d3ef101/packages/eve/src/execution/durable-session-store.ts#L69-L100)
- Official execution model: [Execution Model and Durability](https://eve.dev/docs/concepts/execution-model-and-durability)

The workflow step result is Eve's atomic persistence boundary. Completed steps are replayed from recorded results; an interrupted step may re-run, so external effects still require idempotency or approval.

Eve does **not** expose public state transactions, compare-and-swap, versions, multi-slot atomic commits, cross-Session reads, or queries. `update(fn)` synchronously reads and writes the current in-memory context slot. Separately, the official concurrency guidance says Eve has no durable FIFO queue for concurrent Session deliveries and recommends sending one Turn at a time or queueing at the app/channel layer for deterministic behavior.

Source: [Execution Model and Durability — resuming and message delivery/queueing](https://eve.dev/docs/concepts/execution-model-and-durability)

Implications for LLM Space:

- keep the existing Session Store's explicit `expectedVersion`/conflict behavior rather than weakening it to Eve's public handle;
- define the runtime serialization/schema and migration contract explicitly;
- do not infer that `update(fn)` alone supplies distributed transaction semantics;
- do not let source renames silently orphan state. Eve itself warns and drops an unregistered serialized key; LLM Space item 11 should instead make source/state migration explicit.

### 4. Dynamic instructions and context

Eve distinguishes static and dynamic instructions:

- `instructions.md` is static authored source;
- `instructions.ts` composes a static prompt at build time and the compiled manifest captures the result;
- an `agent/instructions/` directory is flat, non-recursive, and ordered by filename;
- `defineDynamic` resolves instructions at `session.started` or `turn.started` from trusted runtime context;
- tools may additionally resolve at `step.started`, but instructions and skills intentionally remain stable within a Turn for prompt-cache behavior.

Sources:

- Official authoring contract: [Instructions](https://eve.dev/docs/instructions)
- Official resolver guide: [Dynamic Capabilities](https://eve.dev/docs/guides/dynamic-capabilities)
- Allowed resolver events and resolve context: [`packages/eve/src/shared/dynamic-tool-definition.ts#L20-L73`](https://github.com/vercel/eve/blob/f7c69b1a2ad044a6ba89db7bb6241c469d3ef101/packages/eve/src/shared/dynamic-tool-definition.ts#L20-L73)

A dynamic resolver receives read-only Session identity/auth, channel kind/token/metadata, and visible conversation messages. It can read durable authored state through an imported `defineState` handle. Resolver outputs are stored in separate session- or turn-scoped durable context keys, flattened into the system prompt, and not added to conversation history.

Sources:

- Session/Turn instruction slots and deterministic flattening: [`packages/eve/src/context/dynamic-instruction-lifecycle.ts#L19-L48`](https://github.com/vercel/eve/blob/f7c69b1a2ad044a6ba89db7bb6241c469d3ef101/packages/eve/src/context/dynamic-instruction-lifecycle.ts#L19-L48)
- Concurrent resolver evaluation and per-source replacement: [`packages/eve/src/context/dynamic-instruction-lifecycle.ts#L50-L115`](https://github.com/vercel/eve/blob/f7c69b1a2ad044a6ba89db7bb6241c469d3ef101/packages/eve/src/context/dynamic-instruction-lifecycle.ts#L50-L115)
- Durable scope comments: [`packages/eve/src/context/keys.ts#L180-L197`](https://github.com/vercel/eve/blob/f7c69b1a2ad044a6ba89db7bb6241c469d3ef101/packages/eve/src/context/keys.ts#L180-L197)
- Model-prompt merge without history persistence: [`packages/eve/src/harness/tool-loop.test.ts#L8967-L9034`](https://github.com/vercel/eve/blob/f7c69b1a2ad044a6ba89db7bb6241c469d3ef101/packages/eve/src/harness/tool-loop.test.ts#L8967-L9034)

One important difference from LLM Space item 13 is that Eve keeps the latest Session/Turn instruction messages in durable context but does not expose an LLM Space-style immutable, inspectable “effective instruction snapshot” API. LLM Space should record the exact resolved bytes/fingerprint per Turn through Pi and the Runtime Harness rather than merely retaining the latest resolver slot.

### 5. Tools and state

Tools receive `ctx` in their `execute` callback and can call imported state handles. Hooks and channel handlers can use the same state. Dynamic resolvers may also read a handle because they execute inside the managed context.

The state declaration itself does not grant a tool, filesystem, network, or sandbox capability. Those authorities remain separate runtime surfaces. This is a useful property for promotion: declaring a state dependency must not silently expand tool authority.

Sources:

- Tool/state example: [State](https://eve.dev/docs/guides/state)
- Managed-scope list: [Session Context — “Where these APIs work”](https://eve.dev/docs/guides/session-context)
- Dynamic resolver context deliberately omits direct state access: [`packages/eve/src/shared/dynamic-tool-definition.ts#L50-L73`](https://github.com/vercel/eve/blob/f7c69b1a2ad044a6ba89db7bb6241c469d3ef101/packages/eve/src/shared/dynamic-tool-definition.ts#L50-L73)

## Comparison with current LLM Space

| Concern | Current LLM Space | Eve reference | Recommended boundary |
| --- | --- | --- | --- |
| Durable authority | Runtime Harness `SessionStore` owns versioned Run/control state; Desktop Thread persists the record | Workflow step results persist Session context/state | Keep `SessionStore` as the only authority; extend its schema instead of adding a parallel store |
| Prompt variables | Desktop/Core thread templates, scenarios, and prompt-place snapshots | No equivalent variable table or scenario format | Do not claim Eve-format compatibility; promote declarations/provider intent in an LLM Space source contract |
| Current date | Host-rendered prompt variable | Dynamic resolver could compute it, but it is not durable state | Model as trusted Turn context and snapshot the resolved value per Turn |
| Available skills | Host discovery plus selected skill formatting | Dynamic skill resolution is a capability surface | Model as effective capability snapshot, not mutable Session state |
| Custom variable value | Thread-owned authoring/scenario data, potentially private | `defineState` is mutable Session working memory | Require an explicit choice: source default/config input versus Session state; never infer from value alone |
| Identity/channel | Not yet item-12 structured state | `ctx.session` separates current caller, initiator, Turn, parent, channel metadata | Borrow the separation and verification boundary, not the exact type |
| Dynamic instructions | Roadmap item 13 | Session/Turn resolver slots, distinct from history | Resolve from trusted context/state, produce an immutable Turn snapshot, pass exact bytes through Pi |
| Long-term memory | Explicitly out of current Session state | External connection/database | Keep external memory behind a separate capability and ownership contract |

Relevant local evidence:

- `packages/runtime/src/runtime/harness/session-store.ts`: versioned `SessionStore` with `expectedVersion` and conflict errors.
- `packages/core/src/types/threads/thread.ts`: Thread variables, variants, per-place snapshots, messages, evaluations, and opaque Runtime Session record.
- `packages/core/src/thread/prompt-variables.ts`: current prompt rendering and snapshot semantics.
- `LOOP_PLAN.md` items 10, 12, and 13: promotion, trusted Session context/state, and dynamic instruction requirements.

## What to borrow

1. **Stable source-owned state declarations.** A declaration has a stable qualified key, typed shape, documented initial value/factory, and clear owning source module.
2. **Session-owned live values.** Source declares; the Host-provided Session Store persists and versions actual values.
3. **Managed runtime access only.** Tools, hooks, connections, and instruction resolvers access state only inside an active trusted execution scope.
4. **Separation from trusted context and history.** Current principal, initiator, tenant/channel/Turn context, mutable Session state, transcript, and external memory remain different fields and policies.
5. **Boundary-scoped dynamic resolution.** Instructions may resolve at Session or Turn start; they remain fixed for the Turn and are snapshotted separately from history.
6. **Source ownership without authority expansion.** A state declaration does not itself grant tools, sandbox, filesystem, network, or secret access.

## What not to copy

1. **No Eve dependency or compatibility layer.** Eve's `ContextKey`, ALS container, Workflow SDK state, manifest, and resolver sentinels are implementation-specific.
2. **No wholesale variable-to-state conversion.** The current Thread variable taxonomy mixes authoring inputs, trusted Turn data, and capability-derived values.
3. **No TypeScript-only “typed state.”** Item 12 needs Runtime-load validation, schema/version identity, diagnostics, and migration rules, not only a generic type parameter.
4. **No implicit unknown-key dropping.** Renamed/removed declarations need item-11 migration or an explicit unsupported diagnosis.
5. **No assumption of transaction semantics.** Preserve LLM Space Session Store CAS and define multi-slot/Turn commit behavior explicitly.
6. **No mutable latest-value substitute for a Turn snapshot.** Item 13 needs exact, explainable, immutable instruction bytes/fingerprints for every Turn.
7. **No state-based secret storage by default.** Environment declarations and values follow their own source/Host ownership rules; promotion must not move secrets into Session state.

## Recommended minimum integration boundary

### Item 10: Thread-to-Agent promotion

- Promote the prompt template unchanged.
- Materialize a source-owned **variable declaration/provider intent**, not a copied runtime value bag.
- Classify each reference before publication:
  - `current_date` -> trusted Turn-context provider;
  - `available_skills` -> current effective skill/capability provider;
  - custom variable -> explicit source config/default, required runtime input, or future mutable Session-state declaration;
  - environment placeholder -> environment declaration at its using MCP/tool/Agent source;
  - literal MCP header -> literal source with the already-approved sensitive-value preview and confirmation.
- Never copy `context.snapshot.variables` as live Agent state. Those are Thread execution evidence.
- Never copy the original Thread's Runtime Session record. Create a new Project Thread and fresh Session identity.

### Item 12: trusted context and structured state

- Add an LLM Space-owned, Runtime-validated state-definition contract with stable qualified keys, schema/version identity, and explicit initial semantics.
- Add verified Session context for initiator/current principal, optional tenant, channel, and Turn identity.
- Store live values in the existing Host-provided Session Store under its version/CAS boundary.
- Keep four independent domains: Turn context, durable Session state, message history, external memory.
- Define conflict behavior, atomic commit granularity, serialization limits, size/budget limits, and migration/unknown-key behavior before exposing writes.

### Item 13: dynamic instructions

- Allow ordered source entries to declare pure resolvers over verified Turn context plus read-only Session state.
- Do not allow instruction resolvers to execute tools or expand authority.
- Resolve once at the approved Session/Turn boundary; normalize deterministic order; freeze exact output bytes and a fingerprint into the Turn configuration snapshot.
- Pass the resolved instruction snapshot through the existing Pi-based Runtime Harness without inventing a new message protocol.
- Keep resolved dynamic instructions out of transcript history while retaining inspectable provenance.

## Open decisions

These decisions remain LLM Space-owned; Eve does not settle them:

1. What is the portable source syntax for variable declarations and providers: fields on `defineAgent`, a dedicated source module/directory, or both?
2. Can a promoted custom Thread variable become a source default automatically, or must the user classify it as config, secret, required Turn input, or Session state?
3. What runtime schema system and migration identity define typed Session state?
4. Are multi-slot state updates one Session Store commit, and what retry/conflict policy is visible to authored code?
5. Which verified channel/tenant attributes are safe inputs to dynamic instructions, and which are merely transport metadata?
6. Does a Project Thread initialize declared state with source defaults only, or may the promotion preview offer an explicit, separately confirmed initial-state seed?

## Recommendation

Use Eve as evidence for a three-layer model:

```text
Agent source declaration/provider
          -> trusted Turn resolver
          -> immutable Turn snapshot
                     |
                     +-> Runtime Harness / Pi

Session Store (durable values, CAS, history/control kept distinct)
```

For item 10, the safe integration is therefore **declaration promotion, not state-value promotion**. Pulling all of items 12 and 13 into item 10 is unnecessary, but item 10 must target their source seam: generate variable/provider declarations that can later resolve against trusted Turn context and durable Session state. Until those contracts exist, promotion may preview the mapping but cannot truthfully claim lossless portable variable semantics.
