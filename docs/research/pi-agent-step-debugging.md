# pi-agent 的工具 Hook、单步执行与 Session 替换可行性

> 调研日期：2026-08-14  
> 调研对象：`@earendil-works/pi-agent-core@0.84.1`  
> 上游对应提交：[`53fa77c`（tag `v0.84.1`）](https://github.com/earendil-works/pi/tree/53fa77ccd8a279eb87e92294ef3687b03ff80112)  
> 方法：核对本仓库 `node_modules`、`bun.lock`、npm package metadata、该版本上游源码/测试/设计文档，并检查 2026-08-14 上游 `main`。本文只做研究，不修改产品代码。

> 后续决策：本文回答的是“发布版 hooks/Harness 能否直接替换现有 Engine”，答案是否定的。若产品目标明确要求 Pi Session 成为唯一事实来源，缺失 runtime 的实现方案、原型证据与迁移设计见 [`pi-session-single-step-architecture.md`](./pi-session-single-step-architecture.md)；后者是当前推荐方案。

## 结论

1. **`beforeToolCall` / `afterToolCall` 可以做进程内的工具断点 gate，但不能实现 Studio 所需的 durable 单步调试。** Hook 内 `await` 一个由 UI 释放的 Promise，确实能让当前调用栈停在工具前或工具后；但暂停状态、continuation、Hook 局部变量和待执行批次都没有持久化，进程退出后无法恢复。
2. **不能用 `{ block: true }` 或 `terminate: true` 代替“暂停”。** `block` 会把调用终结为错误 tool result；`terminate` 只是整批工具都声明终止时，跳过自动的下一次模型调用。二者都改变对话语义，不表示可恢复的暂停。
3. **`Agent` 类不是单步执行状态机。** 它提供 prompt/continue、内存 transcript、事件、abort 和队列，但没有 `stepModel()`、`stepTool()`、durable checkpoint 或重启恢复。`agentLoopContinue()` 也会自动跑 model → tools → next model，不是 one-step primitive。
4. **Studio 的 model/tool 粒度单步应继续由现有 Engine 驱动。** 当前实现已经把 Pi 限定为一个 model-step executor，把真实工具作为独立 Engine step 执行；每步完成后提交 checkpoint，Step 模式再把 Run 置为 `paused` 并释放 Worker lease。这正是 Hook 方案缺少的 durability boundary。
5. **现在不应把 Session 层“全部切成 pi-agent 实现”。** 0.84.1 虽然导出了 future-facing `AgentHarness`、v4 `Session`/`SessionRepo`、manual drive 和恢复 records，但发布实现的 prompt/resume/manual-step/hooks/events 仍统一抛 `HarnessNotImplemented`；截至调研日的上游 `main` 仍然如此。
6. **只替换 `packages/app` 的 Session 也不会给 Studio 带来单步。** Studio 不依赖 `@llm-space/app`，而是直接依赖 Engine。并且两边的“Session”不是同一个业务对象：本项目 App Session 是产品入口/时间线/Task/Run 关联，Pi Session 是 lane-based transcript tree + operation log。

建议是：**短期保留 Engine + `PiRunExecutor` 架构；不要基于两个 tool hooks 重构 Studio，也不要全量替换 Session。长期跟踪上游 `AgentHarness` durable/manual drive 真正落地后，再做一次 Engine 与 Harness 的能力/迁移评审。**

## 1. 版本与一手资料

本仓库 root catalog 声明 `@earendil-works/pi-agent-core: ^0.84.1`，`bun.lock` 实际解析到 `0.84.1`。已安装包的 `package.json` 指向官方仓库 `earendil-works/pi` 的 `packages/agent`；npm registry metadata 的 `gitHead` 为 `53fa77ccd8a279eb87e92294ef3687b03ff80112`，与上游 `v0.84.1` tag 一致。

来源：

- 本地：`package.json`、`bun.lock`、`node_modules/@earendil-works/pi-agent-core/package.json`
- [npm 0.84.1 metadata](https://registry.npmjs.org/@earendil-works/pi-agent-core/0.84.1)
- [上游 package metadata](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/package.json#L1-L60)
- [上游 0.84.1 changelog](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/CHANGELOG.md#L3-L29)

下文的“Pi Agent”特指这个版本的 `@earendil-works/pi-agent-core`，不是泛指整个 Pi monorepo。

## 2. 两个 Hook 的精确语义

### 2.1 类型

`beforeToolCall`：

```ts
(
  context: {
    assistantMessage: AssistantMessage;
    toolCall: AgentToolCall;
    args: unknown; // schema 校验后的参数
    context: AgentContext;
  },
  signal?: AbortSignal
) =>
  Promise<
    | {
        block?: boolean;
        reason?: string;
        terminate?: boolean;
      }
    | undefined
  >;
```

`afterToolCall`：

```ts
(
  context: {
    assistantMessage: AssistantMessage;
    toolCall: AgentToolCall;
    args: unknown;
    result: AgentToolResult<any>; // override 前的执行结果
    isError: boolean;
    context: AgentContext;
  },
  signal?: AbortSignal
) =>
  Promise<
    | {
        content?: Array<TextContent | ImageContent>;
        details?: unknown;
        isError?: boolean;
        usage?: Usage;
        terminate?: boolean;
      }
    | undefined
  >;
```

`afterToolCall` 是字段级 override：提供的 `content`、`details`、`usage` 会整体替换，未提供字段保留原值，没有 deep merge；它也可以把 `isError` 从 true 改成 false，反之亦然。

来源：[types.ts L52-L123](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/src/types.ts#L52-L123)、[types.ts L259-L292](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/src/types.ts#L259-L292)。

### 2.2 调用时机

一次正常工具调用的顺序是：

```text
emit tool_execution_start
  -> 查找工具
  -> prepareArguments
  -> schema validation
  -> await beforeToolCall
  -> tool.execute
  -> await afterToolCall
  -> emit tool_execution_end
  -> emit toolResult message_start / message_end
```

几个容易误解的点：

- `tool_execution_start` 在参数校验和 `beforeToolCall` **之前**就发出，因此这个事件只表示 runtime 开始处理该调用，不证明工具副作用已经启动。
- `beforeToolCall` 拿到的是校验后的 `args`，但 `toolCall` 仍是 assistant message 中的原始 block。
- `afterToolCall` 只走“已准备并调用过 `tool.execute`”的路径。工具不存在、参数校验失败、`beforeToolCall` 抛错或 block 都是 immediate outcome，不会再调用 `afterToolCall`。
- 默认 `parallel` 模式先按 source order 串行完成每个调用的 preflight/`beforeToolCall`，再并发执行允许的工具；要做逐工具的进程内 gate，至少要把 `toolExecution` 设为 `sequential`，否则放行完多个 preflight 后会并发执行。

来源：[agent-loop.ts L489-L553](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/src/agent-loop.ts#L489-L553)、[agent-loop.ts L600-L668](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/src/agent-loop.ts#L600-L668)、[agent-loop.ts L670-L758](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/src/agent-loop.ts#L670-L758)、[官方 README L104-L124](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/README.md#L104-L124)。

### 2.3 返回、错误与取消

| 情况                                         | Runtime 语义                                                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `beforeToolCall` 返回 `undefined` 或未 block | 继续执行工具                                                                                                                                     |
| 返回 `{ block: true, reason }`               | 不执行工具；生成 `isError: true` 的 tool result，content 为 reason 或默认文本                                                                    |
| `beforeToolCall` 抛错/reject                 | 被 preflight 的 `catch` 捕获；错误文本变成 error tool result；不调用 `afterToolCall`                                                             |
| `tool.execute` 抛错/reject                   | 被捕获为 error result，然后仍调用 `afterToolCall`，所以 after hook 可以改写错误                                                                  |
| `afterToolCall` 返回 override                | 按字段替换最终结果，再发 end/result events                                                                                                       |
| `afterToolCall` 抛错/reject                  | 原工具结果被替换成 Hook 错误对应的 error result                                                                                                  |
| abort                                        | 两个 Hook 都收到同一个 `AbortSignal`，Hook 自己负责响应；`beforeToolCall` 返回后 runtime 还会检查 signal 并生成 `Operation aborted` error result |

因此 Hook 不是透明 observer：block、throw 和 after override 都会修改最终 transcript。用它做 debugger gate 时，等待逻辑必须监听 `AbortSignal` 并清理 waiter，否则 `Agent.abort()` 不能保证释放一个永不 settle 的 Hook Promise。

来源：[agent-loop.ts L600-L668](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/src/agent-loop.ts#L600-L668)、[agent-loop.ts L670-L758](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/src/agent-loop.ts#L670-L758)、[Hook cancellation contract](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/src/types.ts#L270-L292)。

### 2.4 `terminate` 不是暂停

`terminate: true` 只是一个 batch-control hint。只有当前批次中**每一个 finalized tool result** 都是 `terminate === true`，loop 才不自动发下一次 LLM 请求；混合批次继续运行。低层 loop 生成标准 `ToolResultMessage` 时没有写入 `terminate`，所以它还是 runtime-only 信息，不是可重建的断点状态。

来源：[batch 判定](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/src/agent-loop.ts#L582-L584)、[toolResult message 映射](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/src/agent-loop.ts#L777-L790)、[README L122-L124](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/README.md#L122-L124)。

## 3. Hook 能否实现暂停和重启恢复

### 3.1 能做什么

Hook 是 awaited 的，所以可以实现当前进程内的 breakpoint：

```ts
beforeToolCall: async (call, signal) => {
  await debuggerGate.wait({ call, signal });
  return undefined;
};
```

`Agent` 类还会 await `processEvents()` 及每个 subscriber。它先在 `message_end` 时把 assistant message 放入 `Agent.state.messages`，再进入 tool preflight，所以这种 in-process gate 前可以让 UI 看到完整 tool call。官方测试也覆盖了 awaited subscriber barrier。

来源：[Agent event reduction/barrier](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/src/agent.ts#L537-L591)、[barrier tests](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/test/agent.test.ts#L190-L261)、[README L144-L146](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/README.md#L144-L146)。

### 3.2 不能做什么

这个 gate 持有的是：当前 JS 调用栈、未 settle Promise、闭包里的 validated args、AbortController，以及可能已完成 preflight 的同批工具。`AgentState` 只公开内存里的 messages/tools/streaming/pendingToolCalls；`Agent.sessionId` 只转发给支持 provider cache 的 backend，不是 durable Session。

重启会丢失：

- 当前暂停位于 before 还是 after；
- 当前 tool batch 中哪些调用已 preflight/执行/finalize；
- after hook 所需的原始 tool result；
- batch 的 runtime-only `terminate`；
- 如何从 assistant-ending transcript 安全恢复工具执行。

而且 `agentLoopContinue()` 明确拒绝末条为 assistant 的 context；它的用途是从 user/toolResult 末尾重试，并会继续跑完整 loop。不能在重启后把“模型刚产生 tool calls、尚未执行”的 assistant transcript 直接交给它恢复。

来源：[AgentState](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/src/types.ts#L327-L357)、[`sessionId` 语义](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/src/agent.ts#L204-L206)、[`agentLoopContinue` 前置条件](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/src/agent-loop.ts#L56-L92)。

结论：**Hook gate 最多适合作为非 durable 的临时调试/审批 UI，不可作为 Studio Run 的权威执行状态机。**

## 4. `Agent` 是否提供真正的单步状态机

没有。

`Agent` 的公共控制面是 `prompt()`、`continue()`、`abort()`、`waitForIdle()`、steer/followUp queue 和 mutable state。内部 `runPromptMessages()` / `runContinuation()` 都调用完整的 `runAgentLoop*()`；loop 在一个 invocation 中自动处理模型、整个工具批次和后续模型 turn。`shouldStopAfterTurn` 也发生在 assistant 和全部工具都完成、`turn_end` 已发出之后，只能阻止下一 turn，不能停在 model 与 tool 之间。

低层 `agentLoop()` / `agentLoopContinue()` 返回的 EventStream 也只是 observational stream；consumer 处理事件不会成为 producer phase 的 barrier。需要 barrier 时只能用 `Agent` subscriber 或直接使用 `runAgentLoop*` 的内部 sink，但两者都不增加 durable step 状态。

来源：[Agent 调用完整 loop](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/src/agent.ts#L409-L483)、[loop 自动推进](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/src/agent-loop.ts#L155-L263)、[`shouldStopAfterTurn` 时机](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/README.md#L126-L146)、[low-level stream 限制](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/README.md#L475-L509)。

## 5. 上游真正接近 Studio 单步的方向：AgentHarness

0.84.1 还导出了另一套 future-facing API：`AgentHarness` + v4 `Session`/`SessionRepo`。它的**类型和设计目标**非常接近 Studio Engine：

- `drive: "automatic" | "manual"`；manual 模式用 `peekAction()`、`executeAction()`、`runToCompletion()` 驱动；
- `ActionInfo` 区分 `stream_assistant`、`execute_tool`、`hook`、append/move、deferred fetch、sleep 等 effect boundary；
- Session record 有 `operation_started`、`step_attempt`、`tool_started`、`operation_finished`，并给工具记录 effective args、预留 result entry id 和 replay policy；
- `findOpenOperations()`、`suspended`、`resume()` 面向跨重启恢复。

来源：[AgentHarness API/types](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/src/harness/agent-harness.ts#L182-L303)、[Session records](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/src/harness/session/types.ts#L80-L212)、[Session recovery query](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/src/harness/session/types.ts#L279-L352)、[官方 Harness v2 设计的 durability/manual-drive 目标](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/docs/harness-v2.md#L20-L49)、[manual drive surface](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/docs/harness-v2.md#L733-L848)。

但这些现在只是设计方向和 compile-complete scaffold：

- `AgentHarness.create()` 遇到已有 record 就抛 `HarnessNotImplemented("create.restore")`；
- `prompt`、`resume`、`abort`、`peekAction`、`executeAction`、`runToCompletion`、hooks、events、watch/lane 等都走 `unavailable()`；
- 0.84.0 changelog 明说“unfinished operation paths reject with `HarnessNotImplemented` while durable execution is implemented”；
- 2026-08-14 检查上游 `main` 提交 [`9d2ec7f`](https://github.com/earendil-works/pi/tree/9d2ec7ffabe927bfad2214c1cee25b6632a78dcf)，这些路径仍是 stub。

来源：[0.84.1 AgentHarness implementation](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/src/harness/agent-harness.ts#L305-L420)、[hooks/events stub](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/src/harness/agent-harness.ts#L219-L234)、[0.84.0 changelog](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/CHANGELOG.md#L13-L28)、[当前 main 的同一 stub](https://github.com/earendil-works/pi/blob/9d2ec7ffabe927bfad2214c1cee25b6632a78dcf/packages/agent/src/harness/agent-harness.ts#L347-L420)。

所以不能因为类型上已经出现 `manual`/`resume`，就把它当成可用实现。长期值得对齐的是 Harness 的 effect/action vocabulary，而不是现在用 `Agent.beforeToolCall` 模拟它。

## 6. 为什么现有 Engine 更适合 Studio 单步

当前 `@llm-space/engine` 已经实现了真正的 durable step：

- `_nextExecutionStep()` 从持久化 messages 选择下一步是 model 还是 tools；Step 模式只选第一个 pending tool，也支持指定 `toolCallId`；
- `RunExecutor.executeStep()` 每次只执行 Engine 选择的一步；
- model/tool 完成分别提交 `model.completed` / `tool.completed` checkpoint；
- Step 命令验证只提交了一步，然后把 Run 持久化为 `paused`，pause 记录 checkpoint id/step/time，并释放 Worker lease；
- resume 从 Thread 的 durable head 重新读取，这是明确的 recovery boundary。

来源：`packages/engine/src/runtime/agent-engine.ts` 的 `_nextExecutionStep()`（约 L1482-L1513）、`_executeWithRunExecutor()`（约 L716-L965）、`_pauseRun()`（约 L968-L998）。

`@llm-space/engine-pi` 的分工也已经正确：

- model step 内复用 `agentLoopContinue()`，用 `shouldStopAfterTurn: () => true` 保证只取一个 assistant turn；
- Pi tool 是无副作用的 terminating stub，只负责阻止 Pi 自己进入下一模型 turn；stub tool results 被忽略；
- 真实 tool step 由 Engine 选定并独立执行、发 event、提交 checkpoint。

来源：`packages/engine-pi/src/pi-run-executor.ts` 的 `executeStep()`、`_toTerminatingPiTool()`、`_executeToolStep()`（约 L44-L250）。

这不是重复造 Pi loop：**Engine 负责 product-grade Run/Step/durability，Pi 负责 model protocol 和工具适配。** 在上游 AgentHarness 未实现前，这是更清晰的职责边界。

## 7. “Session 全切为 pi-agent”到底意味着什么

这里至少有四个名字相近但职责不同的对象：

| 对象                           | 实际职责                                                                                                                              | 与 Studio 单步的关系             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Pi `Agent.state` / `sessionId` | 进程内 transcript/runtime state；`sessionId` 只给 provider cache                                                                      | 不 durable，不能承担 Run/Step    |
| Pi v4 `Session`/`SessionRepo`  | lane-based entry tree、operation records、facts、fork/query；内存/JSONL backend，SQLite 在独立包                                      | 数据模型有潜力，但自身不驱动执行 |
| 本项目 `packages/app` Session  | 产品入口，关联默认 Engine Thread、agent/project/title/status；另有产品 timeline、Task、SessionRunLink、run intent/recovery projection | App 层能力，Studio 不依赖它      |
| 本项目 Studio + Engine         | Playground/Experiment/Draft/evaluation/run ordering + durable Thread/Checkpoint/Run/Step                                              | 当前 Studio 单步的实际 owner     |

本项目证据：

- `packages/app/src/domain.ts`：Session、三类 SessionMessage、Task、SessionRunLink、ApplicationRunIntent。
- `packages/app/src/session-application.ts`：Session API 组合 `AgentEngine` 与 App store。
- `packages/studio/package.json`：依赖 `@llm-space/engine` / `@llm-space/engine-pi`，不依赖 `@llm-space/app`。
- `packages/studio/src/studio-application.ts` 与 `playground-application.ts`：`stepRun()` / `continueRun()` 直接委托 Engine。

### 7.1 可行边界

可以单独评估的部分：

- 用 Pi `Session` entry tree/lanes 替代某些 transcript/fork read model；
- 用 Pi `SessionRepo` contract 作为一个新的 storage adapter；
- 对齐它的 operation/action vocabulary，减少未来迁移认知成本。

现在不能直接替换的部分：

- Engine Run/Step/Checkpoint、Worker lease、stream cursor 和 crash recovery；
- Studio Playground/Experiment/Draft/evaluation/run ordering；
- App 的 title/archive/project/agent identity、Task、产品/系统 timeline、SessionRunLink；
- 同一 SQLite 中 Engine/App/Studio 的既有表所有权和迁移策略。

Pi 的 SQLite backend 还是独立包 `@earendil-works/pi-session-backend-sqlite-node`，当前仓库未安装。上游 0.84.0 刚把旧 schema breaking replace 为 v4，并明确“不迁移现有 work-in-progress databases”，说明这块 API/存储仍处于快速变化期。

来源：[SQLite backend README](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/session-backends/sqlite-node/README.md)、[SQLite backend changelog](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/session-backends/sqlite-node/CHANGELOG.md#L13-L22)。

### 7.2 如果坚持“全切”

这不是接口替换，而是一次运行时重写：需要建立 Studio Experiment ↔ Pi Session/Lane、Engine Checkpoint ↔ Entry、Run/Step/Event ↔ Operation/Action/Record、Task/Timeline ↔ custom entry/独立表的完整映射，还要补齐当前上游未实现的 AgentHarness execution/recovery。结果会是我们先实现一遍上游 roadmap，等上游真正完成后再迁移一次。

因此当前版本下不建议进行。

## 8. 建议决策

### 现在

1. 保留 Studio → Engine → `PiRunExecutor`。
2. 单步语义继续定义为一个 durable committed step：model message 或一个 tool call。
3. 如果要增加“工具执行前确认/断点”，把它建模为 Engine 的 durable control state/approval，不要只挂在 Pi Hook 的未 settle Promise 上。
4. `beforeToolCall` / `afterToolCall` 仅用于策略、审计、结果改写或短生命周期的进程内 gate，不让它们成为 Run 的 source of truth。
5. 不替换 `packages/app` Session；它与 Studio 单步无直接因果关系。

### 重新评估上游 Harness 的触发条件

同时满足以下条件后再做 migration spike：

- `AgentHarness.prompt/resume/peekAction/executeAction/runToCompletion` 不再抛 `HarnessNotImplemented`；
- 官方 tests 覆盖 manual drive 的 model/tool action 与跨进程恢复；
- hooks/events/watch 与 SQLite writer lease 可用；
- tool replay、parallel batch、abort、crash matrix 的实现与设计文档一致；
- 上游给出 v4 schema 的兼容/迁移承诺；
- 能证明替换后保留 Studio 的 Experiment/Draft/evaluation 以及 App 的产品 Session/Task/timeline 语义。

到那时应比较两条路：

- Engine 保留为产品 orchestration，底层换成 Harness action executor；
- Harness 接管 Run/Step durability，Engine 收缩或删除。

在此之前，用 hooks 重写现有 Engine 会把已经持久化、可恢复的单步，降级成只在当前进程调用栈里成立的暂停。
