# Eve Subagent Sandbox / Workspace Sharing Semantics

- Access date: 2026-07-27
- Official repository: <https://github.com/vercel/eve>
- Verified current `HEAD`: `632605f097c583e6667578a9b296c334f69e9121`
- Verification: `git ls-remote https://github.com/vercel/eve.git HEAD` and a checkout of that exact commit
- Scope: root built-in `agent` copies, declared local `agent/subagents/<id>/`, nested local subagents, and remote agents

## Bottom line

Eve deliberately has **two local sharing modes**, not one universal isolation rule:

1. The root-only built-in `agent` tool creates a fresh child Session that is a copy of the root Agent. It has fresh transcript and `defineState`, but it shares the root Agent's sandbox, `/workspace`, tools, connections, auth context, and sandbox configuration. Its writes are immediately visible to the root. This is the mode for several workers collaborating on the same files.
2. A declared `agent/subagents/<id>/` specialist is a separate Agent node. It inherits none of the root's authored slots, gets its own child Session and sandbox, and uses only its own workspace seed. If it declares no sandbox, Eve supplies the framework default **for that child**; it does not reuse the parent's sandbox.

This distinction is explicit in the official Subagents documentation and is enforced by a narrow source-code exception: only a built-in call whose name is exactly `agent` receives the parent's persisted sandbox state and parent sandbox Session ID. All other local children use their own child Session ID and active Agent node's sandbox registry.

Primary sources:

- [Official Subagents docs, built-in copy semantics](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/docs/subagents.mdx#L8-L23)
- [Official Subagents docs, isolation matrix and rationale](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/docs/subagents.mdx#L64-L84)
- [Source: only built-in `agent` forwards parent sandbox identity/state](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/packages/eve/src/execution/subagent-tool.ts#L104-L140)
- [Source: sandbox provider uses the override or otherwise the child Session](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/packages/eve/src/context/providers/sandbox.ts#L19-L49)

## Comparison table

| Boundary | Root built-in `agent` copy | Declared local subagent | Nested declared subagent | Remote agent |
| --- | --- | --- | --- | --- |
| Agent definition | Root Agent again | Own directory / graph node | Own nested directory / graph node | Separate deployment |
| Child Session / stream | Fresh | Fresh | Fresh | Fresh remote Session |
| Transcript | Fresh; parent history not copied | Fresh; parent history not copied | Fresh | Fresh; parent history not copied |
| `defineState` | Fresh, never shared | Fresh, never shared | Fresh, never shared | Owned by remote deployment |
| Tools / connections | Root's, except root-only `agent` and `Workflow` | Only child-authored slots plus framework defaults | Only nested child-authored slots plus defaults | Remote deployment's surface |
| Session principal | Parent auth context is forwarded locally | Parent auth context is forwarded locally | Parent auth context is forwarded locally | Service identity by default; principal metadata only if explicitly forwarded |
| Sandbox definition | Root's | Child's; framework default if absent | Nested child's; framework default if absent | Remote deployment's |
| Backend sandbox handle / container / VM | Same logical sandbox as parent | Independent per child Session and node | Independent per child Session and node | Independent remote Host lifecycle |
| `/workspace` | Shared; writes immediately visible | Independent; seeded only from child's authored workspace | Independent; seeded only from nested child's workspace | Remote deployment's workspace |
| Attachments | Not passed as delegation input; already-staged parent files are reachable only through the shared workspace and an explicitly communicated path | Not passed and not reachable through the independent workspace | Same as declared child | Not passed; request body contains message/schema, not files |
| Cancellation | Child turn is cancelled; shared filesystem is not transactionally rolled back | Child turn is cancelled recursively | Same | Authenticated remote cancel request |

## Root built-in `agent`: what is shared

The built-in tool accepts `{ message, outputSchema? }`. The child does not see parent history, but the documentation says it uses the root's instructions, connections, auth, sandbox, and tools (apart from root-only tools), while starting with fresh conversation history and fresh state. Writes are immediately visible to the root. Multiple built-in calls emitted in one model response execute concurrently; Eve explicitly advises non-overlapping write scopes.

The implementation does not merely copy sandbox configuration. `buildSubagentRunInput()` puts `parentSandboxState` and `sandboxSessionId: session.sessionId` into the child adapter state only when `action.subagentName === "agent"`. The sandbox context provider then uses that parent Session ID and state when resolving the handle. Consequently, the root and all built-in copies point at the same backend Session/container/VM and the same `/workspace` namespace.

This also implies that sandbox-session configuration is shared: network policy, brokered egress behavior, files written by `onSession`, long-running processes, and any prior sandbox mutations belong to the one logical sandbox. `defineState` remains separate because state belongs to the fresh child Session rather than the sandbox.

Primary sources:

- [Subagents docs: copy, shared writes, parallel-write warning](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/docs/subagents.mdx#L10-L23)
- [Subagents docs: explicit root-copy exception and fresh state](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/docs/subagents.mdx#L80-L84)
- [Sandbox docs: stable per-Session sandbox identity](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/docs/sandbox.mdx#L64-L71)
- [Source: built-in-only parent sandbox forwarding](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/packages/eve/src/execution/subagent-tool.ts#L104-L140)

### Concurrency and write conflicts

Shared workspace is an intentional collaboration feature, not a transactional filesystem. Parallel built-in copies can see one another's writes immediately. The documented safety model is author discipline: give parallel workers non-overlapping write scopes. The source does not add per-file locks, copy-on-write branches, merges, or rollback around subagent cancellation.

Therefore a suitable Eve-aligned use case is “several copies of the same coding Agent work on different files in one checkout.” It is not safe to assume deterministic concurrent edits to the same file. A write completed before cancellation remains a normal mutation in the shared sandbox; cancellation stops active turns, not filesystem effects. The no-rollback statement is an implementation inference from the cancellation and sandbox code, not a sentence currently stated verbatim in the docs.

## Declared local subagent: what is isolated

Discovery treats `agent/subagents/<id>/` as an independent Agent root. It owns its instructions, tools, connections, skills, hooks, sandbox, workspace seed, and optional nested subagents. Missing slots resolve to framework defaults rather than the root's corresponding slots.

At runtime, Eve resolves each declared child into a distinct graph node with its own tool registry, subagent registry, and sandbox registry. Each delegation starts a new task-mode child Session and records its returned `childSessionId`. Sandbox keys include both `sessionId` and `nodeId`, preventing declared children from colliding with the root or with another child Session even when their sandbox source paths are similar.

Primary sources:

- [Subagents docs: declared layout and own sandbox](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/docs/subagents.mdx#L35-L62)
- [Subagents docs: no inheritance and framework-default fallback](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/docs/subagents.mdx#L64-L84)
- [Source: each local dispatch starts a child runtime and records a child Session](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/packages/eve/src/execution/dispatch-runtime-actions-step.ts#L121-L177)
- [Source: sandbox template and Session keys partition by graph node and child Session](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/packages/eve/src/runtime/sandbox/keys.ts#L52-L68)
- [Source: durable sandbox Session key includes both `sessionId` and `nodeId`](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/packages/eve/src/runtime/sandbox/keys.ts#L121-L145)

### When the child has no sandbox declaration

It still has a sandbox. Eve's general contract is “every Agent has exactly one,” and a working sandbox exists by default. The runtime sandbox registry substitutes `defaultSandbox()` when the active Agent node has no authored sandbox. Because declared children do not receive the built-in parent's `sandboxSessionId` override, this default is instantiated under the child Session and node, not shared with the parent.

The chosen backend is environment-sensitive: hosted Vercel first, then Docker, microsandbox, or just-bash based on availability. “No child sandbox declaration” therefore means “independent default sandbox,” not Direct execution and not parent inheritance.

Primary sources:

- [Sandbox docs: every Agent has a default working sandbox](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/docs/sandbox.mdx#L1-L10)
- [Source: per-Agent sandbox registry falls back to framework default](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/packages/eve/src/runtime/sandbox/registry.ts#L32-L81)

## Workspace seeds, handles, and lifecycle

For a declared child, only files under that child's `sandbox/workspace/**` seed its `/workspace`; the root seed is not copied or mounted. The workspace is then durable for that child Session. Eve's backend lifecycle contract persists `/workspace` across turns/reconnects for the same logical Session, reattaches after server restart where supported, and rotates to a replacement sandbox only when the sandbox definition, seed content, or `revalidationKey` changes.

The Eve server stops active sandbox compute at shutdown, but keeps reattachable Session state. A built-in root copy has no independent sandbox compute to retain or clean up because its handle is the parent's logical sandbox. A declared child has its own child-Session handle and lifecycle. Each new delegation call creates a new child Session, so a later new call does not implicitly resume an earlier child's workspace.

Primary sources:

- [Sandbox docs: authored seed mapping](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/docs/sandbox.mdx#L73-L92)
- [Sandbox docs: persistence, replacement, shutdown, and reattachment](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/docs/sandbox.mdx#L186-L190)
- [Source: child dispatch creates a fresh child Session](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/packages/eve/src/execution/dispatch-runtime-actions-step.ts#L121-L177)

## State, attachments, connections, and credentials

### State and transcript

Both local modes create fresh child Sessions and fresh durable `defineState`; neither sees the parent's conversation history. The parent must put all task context into `message`. The built-in copy's shared sandbox is therefore a data plane, not transcript/state inheritance.

Source: [Subagents docs, state/history and message boundary](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/docs/subagents.mdx#L19-L23), [declared/built-in state matrix](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/docs/subagents.mdx#L64-L88).

### Attachments

No subagent tool shape includes attachments: it is strictly `{ message, outputSchema? }`, and the local child `RunInput` similarly contains only the formatted message and optional schema. Eve's ordinary channel attachment pipeline stages bytes to the current Session's sandbox, but subagent dispatch does not restage or forward them.

Consequences:

- A built-in copy can access a file already staged in the parent's sandbox because the workspace is shared, but the parent must communicate the relevant path in `message`; transcript/attachment metadata is not automatically copied.
- A declared or nested child cannot access the parent's staged attachment because its workspace is independent. The current declared-subagent tool schema offers no file argument or automatic transfer.
- A remote request body likewise contains message/schema and callback metadata, not attachment bytes or parent sandbox paths.

Primary sources:

- [Source: strict subagent input schema](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/packages/eve/src/runtime/subagents/registry.ts#L25-L43)
- [Source: local child input carries only message and output schema](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/packages/eve/src/execution/subagent-tool.ts#L104-L140)
- [Official channel docs: ordinary attachments are staged to the current sandbox](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/docs/channels/custom.mdx#L314-L361)

### Local connections, auth, and sandbox credentials

The built-in copy uses the root Agent's authored connections and auth. A declared child sees only its own connection definitions. Local child creation does forward the current/initiator Session auth contexts and channel capabilities so child tools and approval flows can operate as the same principal; this is identity/context propagation, not inheritance of the root's connection registry or secret values.

Sandbox credentials follow the sandbox identity. A built-in copy shares any parent sandbox network policy or credential-brokering setup. A declared child executes its own sandbox `onSession` under its own Agent definition and child Session, where it may derive configuration from the forwarded principal. Eve's documented broker keeps secret values outside the sandbox process.

Primary sources:

- [Subagents docs: connection/auth inheritance versus own connections](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/docs/subagents.mdx#L19-L23), [slot matrix](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/docs/subagents.mdx#L64-L84)
- [Source: local child receives auth/initiator/capabilities but no parent connection registry](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/packages/eve/src/execution/subagent-tool.ts#L51-L73), [constructed RunInput](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/packages/eve/src/execution/subagent-tool.ts#L104-L140)
- [Sandbox docs: brokered credentials remain outside sandbox](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/docs/sandbox.mdx#L212-L229)

## Nested and remote agents

A declared subagent may declare nested subagents. The same declared-Agent rule repeats at every authored node: the nested child has its own slots, child Session, and sandbox/default sandbox. The built-in `agent` exception is root-only, so declared or built-in children cannot invoke another root copy. Cancellation walks active descendants recursively.

Remote agents run in a separately deployed Eve application. Only the delegation message, optional output schema, callback data, and configured transport auth cross the network. Parent principal forwarding is opt-in; Eve documents that only principal metadata crosses, never tokens or credentials, and the remote deployment mints its own connection credentials. Its sandbox/workspace/container lifecycle is therefore wholly remote-owned. Parent cancellation sends an authenticated cancel request to the remote child Session.

Primary sources:

- [Subagents docs: nested graph and root-only built-in](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/docs/subagents.mdx#L86-L92)
- [Subagents docs: recursive local/remote cancellation](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/docs/subagents.mdx#L107-L111)
- [Source: cancellation targets adopted local and remote child Session IDs concurrently](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/packages/eve/src/execution/cancel-descendant-turns-step.ts#L23-L70)
- [Remote-agent docs: separate deployment and lowered input](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/docs/guides/remote-agents.md#L1-L50)
- [Remote-agent docs: identity metadata, never credentials](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/docs/guides/remote-agents.md#L64-L84)
- [Remote-agent docs: lifecycle and cancellation](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/docs/guides/remote-agents.md#L86-L98)

## Documented rationale and implications for LLM Space

Eve's rationale is explicit:

- Built-in copies share sandbox and tools because they are “copies of the same agent working on the same files.”
- Declared subagents are for a different prompt/role, a narrower tool surface, or an independent runtime context, so their authored slots and sandbox are isolated.

For an Eve-aligned LLM Space design, “always separate parent/child Sandbox” would miss the first collaboration scenario. The closest semantic split would be:

- **Same-Agent worker/copy delegation:** optionally share a Session workspace/sandbox under an explicit, inspectable mode; warn or constrain parallel overlapping writes.
- **Declared specialist delegation:** default to an independent child Session sandbox and workspace seed; no implicit attachments, parent transcript, tools, connections, or state.

If LLM Space V1 only implements declared static specialists, independent sandbox is aligned with Eve's declared-subagent behavior. Shared sandbox becomes relevant only if V1 intentionally supports a root-copy / same-project worker concept, or adds an explicit shared-workspace contract. It should not be silently inferred merely because one Agent calls another.

Sources: [Eve's explicit exception rationale](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/docs/subagents.mdx#L80-L84), [when to split](https://github.com/vercel/eve/blob/632605f097c583e6667578a9b296c334f69e9121/docs/subagents.mdx#L113-L115).

## Uncertainties and cautions

1. The final link in `docs/sandbox.mdx` says “each subagent gets its own sandbox,” but the dedicated Subagents page and source code establish the built-in root-copy exception. Read that shorthand as referring to declared subagents, not the built-in `agent` copy.
2. Eve documents non-overlapping write scopes for parallel root copies, but it does not specify filesystem conflict detection, locking, merging, or rollback. Source inspection found no such mechanism around delegation/cancellation; absence of rollback is therefore an evidence-backed implementation inference.
3. The attachment conclusion describes the current subagent input/RunInput contract at the verified commit. A caller could manually encode data or a path in `message`, and authored tools could transfer data out-of-band; those are application behaviors, not automatic Eve attachment sharing.
4. Backend-specific shutdown/deletion details vary. The stable framework contract is per-Session identity, persistence/reattachment where supported, replacement on sandbox-definition changes, and compute shutdown with the Eve server. This note does not claim identical container deletion policy across Vercel, Docker, microsandbox, just-bash, or custom backends.
5. Eve is explicitly beta; these semantics may change. Commit-pinned links above are the authority for this comparison, while live pages are [eve.dev/docs/subagents](https://eve.dev/docs/subagents), [eve.dev/docs/sandbox](https://eve.dev/docs/sandbox), and [eve.dev/docs/guides/remote-agents](https://eve.dev/docs/guides/remote-agents).
