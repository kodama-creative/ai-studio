# Vercel Eve Session 数据存储实现研究

日期：2026-08-09  
上游快照：[`vercel/eve@f835ad57409ddf33cd21c52947ec27e8c7024bb7`](https://github.com/vercel/eve/tree/f835ad57409ddf33cd21c52947ec27e8c7024bb7)（Eve 0.31.3）

## 结论

Eve 没有定义常规的 `SessionRepository`、`MessageRepository` 或 `SessionEventLog`，也没有在 Eve 进程中自己维护一套数据库加 worker thread。它把 durable execution 整体建立在 Workflow World 上：

| 逻辑数据 | Eve 的 durable carrier | 消费方式 |
| --- | --- | --- |
| Session 程序状态 | Workflow step result 中的 `DurableSessionState.snapshot` | 下一 durable step 读取并 hydrate |
| 模型消息 | `DurableSession.history: ModelMessage[]`，属于完整 Session snapshot | 下一模型 step 直接使用完整 history |
| 面向 Channel/UI 的事件 | Workflow run 的 append-only stream | 按 `startIndex` replay 或持续 follow |
| 发给 Session 的命令 | Workflow durable hook | 长生命周期 driver 从 hook async iterator 消费 |
| run / step / hook 的恢复信息 | Workflow World 自己的 run、step、event、hook store | Workflow 调度器重放、恢复和重投递 |

因此，Eve 的消息历史不是由事件流投影出来的，也不是每条消息独立存储。`history` 是 Session snapshot 内的一整个数组；事件流服务于外部观察、流式响应和 replay。Workflow step result 才是 Session program memory 的原子持久化边界。

这意味着当前 Harness 的 `SessionRepository + SessionEventLog + SessionCommandQueue` 在逻辑职责上与 Eve 对齐；主要差异不是接口数量或命名，而是 Eve 的三类数据都处在同一个 durable Workflow substrate 中。当前独立文件 adapter 没有天然提供 snapshot、事件和 command ack 之间的跨存储原子性与 fencing。

## 1. Session snapshot 如何保存

Eve 的 `DurableSessionState` 是 Workflow step 之间传递的可序列化 state handle。新版本会在其中直接嵌入版本化的 `DurableSessionSnapshot`：

```ts
interface DurableSessionState {
  version: 1;
  sessionId: string;
  continuationToken: string;
  emissionState: HarnessEmissionState;
  hasProxyInputRequests: boolean;
  snapshot?: DurableSessionSnapshot;
}

interface DurableSession {
  sessionId: string;
  continuationToken: string;
  history: ModelMessage[];
  state?: SessionStateMap;
  sandboxState?: SandboxState;
  agent: { system: string };
  // limits、output schema、subagent、compaction accounting 等
}
```

源码注释直接规定：session-mutating step 将当前 snapshot 放进 `DurableSessionState` 返回，**Workflow step result 是 Session program memory 的原子持久化边界**。[`durable-session-store.ts`](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/execution/durable-session-store.ts#L1-L16) [`DurableSessionState` / `DurableSession`](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/execution/durable-session-store.ts#L52-L103)

每个 `turnStep()` 开头通过 `readDurableSession()` 取出 snapshot，hydrate 为 live `HarnessSession`；step 结束后用 `createDurableSessionState({ session })` 把完整的新 snapshot 放进返回值。`continue`、`park` 和 `done` 分支都会携带它。[读取](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/execution/workflow-steps.ts#L151-L168) [checkpoint](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/execution/workflow-steps.ts#L463-L543)

`snapshot` 是可选字段，仅为兼容旧的 in-flight run。旧版本把 snapshot 写进 namespace 为 `"eve.session"` 的 Workflow stream；兼容读取使用 `startIndex: -1` 读取 stream tail。当前路径不再把这个 stream 当主要 Session store。[legacy fallback](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/execution/durable-session-store.ts#L118-L175)

## 2. Messages 实际怎么存

Eve 将模型上下文命名为 `history`，类型是 AI SDK 的 `ModelMessage[]`。它直接嵌在 `DurableSession` 中，而不是：

- 一条消息一条 DB row；
- 从 `message.*` event 重建；
- 只保存外部可见的 user/assistant 文本。

`history` 包含模型下一次调用需要的完整消息结构，包括 user、assistant、tool call、tool result、approval response 等。Session 新建时 `history: []`，每次 hydrate 原样恢复。[创建与刷新](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/execution/session.ts#L73-L139) [project / hydrate](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/execution/session.ts#L166-L280)

清空上下文时，Harness 直接把 snapshot 中的 `history` 替换为 `[]`，同时发出 `context.cleared`；压缩时则将整个 `history` 替换为 `compacted.messages`。这再次证明 snapshot 中的 history 是模型状态真源，stream event 只是 durable notification。[clear / compact](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/harness/tool-loop.ts#L585-L642) [event contract](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/protocol/message.ts#L484-L520)

## 3. 哪些字段不持久化

`projectToDurableSession()` 有意去掉当前 deployment 可以重新构造的 live/runtime 对象：

- model reference 与 compaction model reference；
- tool implementations；
- reasoning / dynamic-model runtime metadata；
- context-window 和 compaction threshold 配置。

持久化的则是跨 step 必须连续的数据：

- `history`；
- authored/session state；
- sandbox state；
- continuation identity；
- resolved limits 与 output schema；
- subagent depth / budget；
- compaction accounting；
- 上次应用的 system prompt snapshot。

hydrate 时使用 durable snapshot 加当前 deployment 的 `turnAgent` 恢复 live Session，因此正在运行的长期 Session 可以在后续 turn 使用新 deployment 的 model/tool 配置，同时保持历史与业务状态。[源码](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/execution/session.ts#L166-L280)

## 4. Event stream 如何保存和读取

长生命周期 `workflowEntry()` 为每个 Session run 获取一个 `driverWritable`。turn step 把 protocol event stamp 一次后编码为 NDJSON，再写入这个 parent writable。stamp 后的 `id` 和 `at` 一并持久化，所以断线重连或 replay 不会重新生成 event identity。[driver writable](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/execution/workflow-entry.ts#L129-L151) [event write](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/execution/workflow-steps.ts#L329-L343) [durable metadata contract](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/protocol/message.ts#L52-L70)

外部通过 `getRun(sessionId).getReadable({ startIndex })` 读取：

- 非负 `startIndex` 是零基 stream position，可用于 replay/follow；
- `getTailIndex()` 获取当前 tail；
- `-1` 是 tail-relative 读法，Eve 也用它读取 legacy Session snapshot tail。

[`workflow-runtime.ts`](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/execution/workflow-runtime.ts#L189-L233) [`startIndex` contract](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/channel/types.ts#L503-L540)

## 5. Session command 如何保存和异步消费

Eve 不使用应用层 DB queue。`resumeHook(token, payload)` 把 delivery 持久化给 Workflow hook；长生命周期 driver 用 `createHook()` 得到 async iterator 并等待下一条命令。

`SessionCommandInbox` 同时 multiplex：

- 一个 Session 生命周期内稳定的 command token；
- 一个可以 rekey 的 Channel continuation token；
- rekey 前已经 committed 的旧 alias delivery，仍保证只消费一次。

[`session-command-inbox.ts`](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/execution/session-command-inbox.ts#L1-L180) [`resumeHook` dispatch](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/execution/workflow-runtime.ts#L240-L279)

这里没有用户代码创建的 worker thread。异步消费由 Workflow driver、durable hook 和 Workflow queue/redelivery 协作完成；每个 turn 再作为 child workflow 在 latest deployment 上运行。

但 hook inbox **不是通用 durable FIFO**。Eve 官方契约说明：活跃 turn 期间到达的多个 delivery 只会在特定 workflow boundary 被 drain，可能合并进下一 turn，是否 drain 取决于 workflow 和 transport timing。要求确定性顺序的 Channel 应等待 `session.waiting` 后再发下一条，或在业务/Channel 层自己排队。[官方 delivery contract](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/docs/concepts/execution-model-and-durability.mdx#L69-L94)

所以当前 Harness 的 per-Session FIFO queue 是比 Eve 更强的语义，不应该为了表面一致而降级。

## 6. 本地开发的物理存储

Eve dev 模式在 CLI 父进程中创建 stock `@workflow/world-local`，并显式把 `dataDir` 设置为项目目录下 `.eve/.workflow-data`。父进程持有它是为了让 run、queue 和 stream 状态跨 Nitro dev worker 热重载存活。[`development-world-server.ts`](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/internal/workflow/development-world-server.ts#L35-L88) [`local-world-data-directory.ts`](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/internal/workflow/local-world-data-directory.ts#L1-L7)

`@workflow/world-local@5.0.0-beta.34` 自身是文件系统实现，不是 SQLite：

- run、step、Workflow event、hook 为 JSON entity/event files；
- stream chunk 位于 `streams/chunks/<streamName>/`，按 monotonic ULID 排序的 `.bin` 文件保存；
- `streams/runs/<runId>.json` 记录 run 与 stream 的关联；
- 使用 temp-file/rename、exclusive create、hard-link promotion、`proper-lockfile` 和 recovery marker 处理并发与 crash window；
- queue/redelivery 由 Workflow World 与 `@vercel/queue` 组合负责。

这一层是 Workflow DevKit 的实现细节，不是 Eve 对 agent 作者暴露的 storage API。生产部署通常选择 `@workflow/world-vercel`；自托管也可提供自定义 World package。Eve 只把 `"local"` / `"vercel"` 映射到相应 package specifier。[world target](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/internal/workflow/world-target.ts#L1-L12)

## 7. 与当前 Harness 的对应关系

| Eve | 当前 Harness | 判断 |
| --- | --- | --- |
| Workflow step result snapshot | `SessionRepository` | 职责对应；当前 snapshot 的 `messages` 对应 Eve `history` |
| Workflow run stream | `SessionEventLog` | 职责对应；都是 replayable/followable event log |
| Workflow hook inbox | `SessionCommandQueue` | 职责对应；Harness 显式暴露 FIFO、claim、lease、recover |
| Workflow driver + child turn workflow | `AgentSessionImpl` 的异步 worker/scheduler | 行为目标对应，执行 substrate 不同 |
| Workflow World 的统一 durability | 三个独立 adapter | 当前最明显差异 |

当前抽象无需为了“像 Eve”而合并成一个 `SessionStore`。相反，三个窄 seam 使本地文件、业务数据库和后续 runtime migration 更容易逐步接入。不过，生产级 DB adapter 最终应提供更深的一体化 transaction/fencing 能力，例如让以下操作在同一个 storage transaction 中完成：

1. 校验 command lease/fencing token；
2. 保存 Session checkpoint；
3. append terminal/boundary events；
4. ack command 或记录 outbox。

可以新增一个可选的组合能力（例如 `DurableSessionStore` / `SessionPersistenceTransaction`），同时保留现有三个最小接口供文件实现和测试使用。不要把 Eve 的 `Workflow` 物理 API 复制进 Harness，也不要要求 `packages/runtime` 一次性迁移。

还有一项需要明确记录的 durability 差异：Eve 在 step 粒度 checkpoint。已完成 step 直接 replay journal result，不重新执行；中断的 step 会重跑，旧 attempt 已写入 stream 的 event 保留，新 attempt 使用新 event id，而 Session history 最终只保留完成的 attempt。因此 event stream 本身不是 Session state 的 event-sourcing log，外部副作用仍须幂等。[官方 crash/replay contract](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/docs/concepts/execution-model-and-durability.mdx#L57-L67) [stream retry semantics](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/docs/concepts/sessions-runs-and-streaming.md#L107-L141)

当前 Harness 的恢复策略是 lease 超时后把中断 turn 结算为 cancelled/waiting，再消费后续命令；它还没有 Eve 那样的 step journal/replay。两者都是合理的实现等级，但 API/文档中应避免把前者描述为“等价 Eve durability”。下一阶段优先级应是：

1. snapshot revision / CAS 与原子 fencing validation；
2. snapshot + event + command ack 的 composite checkpoint 或 transactional outbox；
3. 稳定 event id 和 retry/attempt 语义；
4. 只有确实需要恢复昂贵的模型/tool step 时，再引入 step journal，而不是先复制完整 Workflow engine。

## 一句话回答

Eve 将完整消息历史作为 `DurableSession.history` 嵌入 Workflow step snapshot，把 UI/Channel events 放在独立的 Workflow run stream，把输入命令放在 durable hooks；本地由 `.eve/.workflow-data` 下的文件型 Workflow World 持久化，生产交给 Vercel 或自定义 World。当前 Harness 的三类存储 seam 在职责上是合理复刻，真正需要补强的是统一 transaction/fencing，而不是另造一个逐消息 `MessageRepository`。
