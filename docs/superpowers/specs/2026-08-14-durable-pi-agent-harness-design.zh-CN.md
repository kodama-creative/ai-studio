# 可持久化 Pi Agent Harness 技术方案

**状态：** 待评审

**决策日期：** 2026-08-14

**核心决策：** LLM Space 不 fork Pi，也不继承 Pi 的内存态 `Agent`。我们只使用 Pi 公开的 Session、模型、消息、工具、Result 和 `AgentLane` 类型，自研一个基于 Pi Session 的可持久化 Harness。Pi Session 是 transcript 和执行状态唯一的持久化事实来源。

英文版见 [Durable Pi Agent Harness Design](./2026-08-14-durable-pi-agent-harness-design.md)。

## 问题陈述

Studio 需要支持跨应用重启恢复的 model/tool 单步调试。当前 Engine 通过自己的 Thread、Checkpoint、Run 和 Step 模型提供这项能力，Pi 只作为执行器使用。这导致 Pi Session 之外又存在一套执行模型，Studio 和端应用的 Session 层无法直接共享 Pi 的 transcript、branch、operation 和 recovery 语义。

Pi 的 `beforeToolCall` 和 `afterToolCall` hook 会被 `await`，因此可以暂停一个仍在当前进程中的工具调用。但这个暂停只存在于当前 JavaScript 调用栈中。Hook 不会持久化当前 action、replay policy、result identity 或恢复游标。Pi 的 stock `Agent` 还将运行生命周期封装为 private，并且不能从“assistant entry 已经持久化、其中的 tool calls 尚未执行”的状态继续。

Pi 0.84.1 已经公开了目标 Session 和 `AgentLane` 契约，但 `AgentHarness` 的执行方法仍是 scaffold。Fork Pi 会让 LLM Space 依赖不稳定的内部实现并长期承担合并成本，尤其是上游 `main` 已经从 0.84.1 的 record 设计继续演进。

因此，LLM Space 需要一个遵守 Pi 公共 Session 模型、但不依赖未完成 Harness 实现的 runtime。它必须把单步定义为 durable 语义边界，安全恢复每一个 provider/tool 崩溃窗口，并让 Studio 删除重复的 authoritative execution state。

## 方案

新增 `@llm-space/pi-runtime`，其中包含 `DurablePiAgentHarness` 和一个薄的 `StudioPiSessionRuntime` facade。

`DurablePiAgentHarness` 负责执行策略，但不定义第二套 Session 模型。它组合使用 Pi 公开的 `Session`、`SessionRepo`、`SessionTree`、`Entry`、`LaneRecord`、`Models`、`AgentMessage` 和 `AgentTool` 契约。第一阶段实现 Pi `AgentLane` 的 manual-drive 子集，后续随着能力补齐逐步达到完整的结构兼容。

第一期明确**不声明** `implements AgentLane`。公共类型只包含已经实现并通过测试的 durable 子集；queue、compaction、navigation、resource 和 multi-lane 成员不会用空实现或抛错 stub 假装兼容。

`StudioPiSessionRuntime` 是产品层唯一的测试和集成 seam。Studio 向它发送 command 和 semantic step 请求；facade 隐藏 Pi 的内部 micro-action，只返回完全从已提交 Pi Session 数据投影出来的 snapshot。

执行不变量是：

```text
durable intent -> external effect -> durable settlement
持久化意图       外部副作用          持久化结果
```

Studio 的 model step 会驱动内部 action，直到一条 assistant entry 已持久化提交。Studio 的 tool step 会驱动内部 action，直到一条 tool-result entry 已持久化提交。Continue 使用相同 driver，只是不在这些 semantic boundary 停车。重启后完全依据 Pi Session entries 和 records 重建下一 action；live `Agent`、闭包、Promise、event buffer 和 UI state 都不得参与恢复决策。

Studio 继续拥有 Project、Playground、Experiment、Draft、source revision、Evaluation、Task 和展示元数据。这些对象只引用 Pi `sessionId`、lane、operation id 以及 entry/leaf id，不复制 authoritative transcript 或 execution cursor。

## 用户故事

1. 作为 Agent 作者，我希望一次只执行一个 model step，以便在任何本地工具运行前检查 assistant 输出。
2. 作为 Agent 作者，我希望一次只执行一个本地 tool call，以便在 Agent 继续前检查工具参数和结果。
3. 作为 Agent 作者，我希望 Continue 与 Step 使用同一个 runtime，以便调试执行和普通执行不会产生语义分叉。
4. 作为 Agent 作者，我希望关闭并重新打开 Studio 后仍能恢复暂停点，以便调试不依赖单个进程生命周期。
5. 作为 Agent 作者，我希望 Studio 明确显示下一 action 是 model 还是 tool，以便每次点击都有可预测的效果。
6. 作为 Agent 作者，我希望 tool breakpoint 能证明工具尚未启动，以便在该断点恢复是安全的。
7. 作为 Agent 作者，我希望崩溃后不会自动重放 unsafe tool，以免重复产生不确定的外部副作用。
8. 作为 Agent 作者，我希望可以通过显式 policy 重放 safe tool，以便只读或幂等工作能够自动恢复。
9. 作为 Agent 作者，我希望文本和 thinking delta 立即显示，以便 model step 保持交互性。
10. 作为 Agent 作者，我希望已提交的 Session 内容替换临时 streaming 内容，以便 UI transcript 最终收敛到持久化事实。
11. 作为 Agent 作者，我希望 cancel intent 能跨进程恢复，以便 abort 不只是一个本地 `AbortController` 操作。
12. 作为 Agent 作者，我希望缺失的 model 或 tool 让恢复进入显式 suspended 状态，以免 Studio 静默替换实现。
13. 作为 Agent 作者，我希望 run 使用的 model、tools、system prompt 和 source revision 在重启后仍可识别，以便恢复具有可复现性。
14. 作为 Agent 作者，我希望 branch 和 retry 使用 Pi Session identity，以免 transcript tree 再经过另一套 checkpoint system 投影。
15. 作为 Agent 作者，我希望 usage 和 cost 能跨重启保留，以免计费信息依赖临时 UI event 重建。
16. 作为 Agent 作者，我希望 provider/tool error 成为 durable run outcome，以便重新打开 Studio 时仍能解释停止原因。
17. 作为 Agent 作者，我希望 storage corruption 和 writer conflict 显式失败，以免 runtime 猜测下一次副作用。
18. 作为维护者，我希望直接 cutover 只支持全新 Pi-backed 数据，以便代码不保留旧 runtime reader 或 migration path。
19. 作为维护者，我会在部署前自行清理旧 data root，产品代码不得扫描、迁移或删除旧数据。
20. 作为 CLI 用户，我希望 CLI 和 Studio 使用同一个 Pi Session runtime，以免执行行为取决于宿主界面。
21. 作为应用集成方，我希望只依赖一个稳定 facade，而不是直接访问 Harness，以便 Pi 升级被隔离在产品代码之外。
22. 作为工具作者，我希望声明 `safe` 或 `never` replay 语义，以便恢复器正确处理工具副作用。
23. 作为工具作者，我希望恢复后的 invocation 使用稳定 idempotency key，以便工具后端提供更强的去重保证。
24. 作为维护者，我希望 manual 和 automatic drive 产生相同的 durable log，以免调试模式形成第二套执行协议。
25. 作为维护者，我希望在每个 effect boundary 做 restart test，以便恢复行为通过证据而非推断得到保证。
26. 作为维护者，我希望 LLM Space 只依赖 Pi 的公开 exports，以免 package 升级破坏 deep import。
27. 作为维护者，我希望每个打开的 Session 只有一个 writer claim，以免多个窗口意外分叉执行。
28. 作为维护者，我希望尚未支持的 Harness 能力被明确拒绝，以免未完成能力回退到不可恢复的实现。
29. 作为评测人员，我希望 Evaluation 引用稳定的 Pi entry 和 operation，以便评分始终关联到实际被评测的 transcript。
30. 作为产品负责人，我希望切换完成后能够移除 Engine execution path，以便 Session 和 Run 语义只有一个 owner。

## 实现决策

### 1. 依赖边界

Runtime 只依赖 Pi package 正式导出的 API。禁止：

- 继承 Pi `Agent` 或 `AgentHarness`；
- monkey-patch Agent private method；
- import `dist/harness/*` 或其他未导出的 subpath；
- 将 Pi Session type 复制到 LLM Space namespace；
- 从 Agent event 反向重建 Session state；
- 将 `Agent.sessionId` 当作 durable Session identity。

新增能力时可以使用 Pi 正式导出的 message conversion、compaction、prompt-template、skill、telemetry 和 tool 类型，也可以结构化实现 Pi interface。

只要 runtime 仍持久化 0.84.1 records，Pi dependency 就必须 exact pin。每次升级都必须评审 Session format 兼容性，并明确做出迁移决策。

### 2. 模块职责

`@llm-space/pi-runtime` 拥有：

- durable command admission；
- lane coordinator 和 lifecycle；
- recovery reduction；
- next-action planning；
- model/tool execution phases；
- manual/automatic drive；
- runtime snapshot、ephemeral delta 和 Pi log change projection；
- LLM Space model/tool service 到 Pi contract 的适配；
- Bun SQLite Session repository 及其 lifecycle。

Pi 公共契约拥有：

- Session metadata、entry tree、lane pointer、record、fact 和 sequence；
- message、model identity、usage shape 和 tool call/result protocol；
- `SessionRepo` 与 `SessionStorage` contract；
- Session repository conformance 和 record semantics；
- 用于兼容的公开 `AgentLane`、`ActionInfo`、Result 和 error vocabulary。

Studio 拥有：

- Project、Playground、Experiment、Draft、source revision、Evaluation、Task、排序和展示元数据；
- 指向 Pi Session/run identity 的引用；
- 不拥有 authoritative message、checkpoint、active-run state 或 usage。

App 拥有 Pi Session 之上的产品 facade，不再持久化另一份 model transcript 或 Engine-to-Session projection。

Desktop 和 CLI 是 composition root，负责提供 data root、Models、runtime tools、environment services 和 event transport，但不自行驱动 model/tool loop。

### 3. Runtime 公共 seam

产品层只依赖下面这个概念接口：

```ts
interface StudioPiSessionRuntime {
  open(input: { sessionId: string; lane?: string }): Promise<SessionSnapshot>;

  start(input: {
    operationId: string;
    sessionId: string;
    lane?: string;
    messages: AgentMessage[];
    binding: RuntimeBinding;
  }): Promise<StepSnapshot>;

  step(input: {
    sessionId: string;
    lane?: string;
    expectedActionId: string;
    kind: "model" | "tool";
  }): Promise<StepSnapshot>;

  continue(input: { sessionId: string; lane?: string }): Promise<StepSnapshot>;

  abort(input: { sessionId: string; lane?: string }): Promise<StepSnapshot>;

  subscribe(
    sessionId: string,
    listener: (event: RuntimeEvent) => void
  ): () => void;
}
```

这个代码片段表达需要固定的架构边界，不代表最终语法。Facade 使用调用方生成的 `operationId` 做幂等 run admission。`expectedActionId` 防止用户基于过期 UI 点击 Step，并让“Step 已提交但响应丢失”的重试收敛到同一个结果。

ACP edge 只保存执行中的 command 合并状态，settle 后立即释放。Step 重试通过稳定 Pi action/result identity 重建；host-owned metadata 在同一个物理数据库中持久化 Continue 的 `commandId` receipt。ACP response 或 transcript cache 不写入 Pi log。

Facade 不暴露 raw `SessionStorage`、mutable lane state、`AbortController`、parked Promise 或 stock `Agent`。

### 4. Harness 兼容面

第一版实现以下 `AgentLane` 能力：

- `name` 和 `session`；
- `getLeafId()`；
- 通过扩展的幂等 admission path 提供 `prompt()`；
- `resume()` 和 `abort()`；
- `waitForIdle()` 和 `runWhenIdle()`；
- `peekAction()`、`executeAction()` 和 `runToCompletion()`；
- 由 Pi entries 支撑的 model、thinking-level 和 active-tool getter/setter；
- main lane watch。

第一阶段只暴露等价于 `Pick<AgentLane, ...>` 的接口，不宣称实现完整 `AgentLane`。未实现能力在 Studio facade 返回 typed `UnsupportedCapability`，绝不能回退调用 stock Agent。

只有当 queue、compaction、navigation、resources 和 multi-lane 行为全部实现并通过测试后，才升级为完整 `AgentLane` compatibility。

### 5. Durable Session 模型

Runtime 直接使用 Pi 现有 durable entities：

- `MessageEntry`：保存 user、assistant 和 tool-result transcript；
- `ModelChangeEntry`、`ThinkingLevelEntry` 和 `ActiveToolsEntry`：保存面向模型的配置变化；
- `CustomEntry`：保存默认不进入模型上下文的 LLM Space 产品 timeline；
- `operation_started`：保存已接受的 run intent；
- `step_attempt`：保存每次 provider attempt 和预分配的 assistant result；
- `tool_started`：保存已验证的 tool intent 和预分配的 tool result；
- `usage`：保存 model、tool、hook 和 adjustment accounting；
- `abort_requested`：保存 durable cancel intent；
- `operation_finished`：作为 operation 最终 record。

在合适的产品语义下，Session name 保存用户看到的会话标题。Archive state、Project membership、Agent Spec identity 和 Task membership 继续作为产品元数据，因为它们不属于 model transcript 或 execution cursor。

System 和 user-action timeline 使用 Pi `CustomEntry`。默认 context builder 忽略这些 entry；只有显式注册 projector 后，它们才允许进入 model context。

### 6. Runtime binding 与 identity

每次接受 run 时必须冻结足够的 identity，确保恢复不会静默使用新代码。完整 immutable snapshot 保存在同一物理 SQLite 中由 LLM Space 自己拥有的 `llm_space_runtime_bindings` 表。Pi `operation_started.intent.resumeData["llm-space"]` 只保存 `bindingId`、`bindingHash` 和 `formatVersion`。被引用的 binding 保存：

- Project 和 Agent Spec identity；
- source revision 或 immutable generation identity；
- model provider/model id；
- thinking level；
- active tool names；
- stable tool implementation identities 和 replay declarations；
- rendered system prompt，或可复现解析它的 identity；
- runtime format version。

Session 不嵌入大型源文件或工具实现。恢复时通过 Studio loader 和 runtime registry 解析被冻结的 identity。缺失或不匹配时返回 `MissingIdentities` 并进入 suspended，绝不静默替换为最新 source。

Admission 的写入顺序固定为 binding commit → `operation_started` → provider/tool effect。Binding 缺失或 hash 不匹配时必须 suspend，禁止回退读取最新 Agent 定义。

`operation_started.id` 同时作为 run id，并等于调用方提供的 `operationId`。使用相同内容重试 start 时返回已有 operation；相同 id 携带不同内容时，在不写 Session 的前提下返回 command conflict。

Assistant 和 tool-result id 必须在 effect 前预分配，logical result id 不因 retry/restore 改变。Tool invocation identity 是 `(assistantEntryId, toolIndex)`；provider `toolCallId` 必须与已持久化 assistant entry 相符，但不能作为唯一 identity。

### 7. Lane coordinator

每个打开的 `(sessionId, lane)` 由一个 process-scoped coordinator 独占。

Coordinator 提供：

- read/decide/write 的 FIFO mutation line；
- sequential debug lane 同一时刻最多一个 external effect；
- 每个 lane 最多一个 open operation；
- 当前 live effect 的 abort controller；
- wait-for-idle settlement；
- parked manual action；
- durable commit 后的 watcher delivery；
- storage corruption 或 writer ownership 丢失后的永久 faulted state。

Mutation job 可以读取 reduced state、选择一个 transition、执行最多一次 durable write，并发布新的 committed snapshot。Provider stream、tool、hook、timer 和 subscriber callback 不能占用 mutation line。

除 Effects 实现外，任何代码都拿不到 writable Pi Session。Procedure 只接收能力受限的 effects，从结构上保证 manual action 停车期间不能写入，也不能调用 provider/tool。

### 8. Recovery reducer

Open 是纯只读操作，不启动 provider、tool、hook 或 timer。每个 lane 按以下顺序恢复：

1. 查询 open operations，limit 为 2。
2. 0 条表示 idle，1 条表示 suspended，2 条表示 corruption。
3. 读取该 open operation 的 records。
4. 从当前 leaf 回溯到记录的 source leaf，读取 operation-owned entries。
5. 校验 record order、ids、attempts、tool ordinals 和 provisioned results。
6. 将合法 prefix reduce 为完整 lane state。
7. 在零写入条件下推导稳定的 next action。

Reducer 必须是 pure function，并对每一个合法 prefix 都有完整定义。未知 record shape、多个 open operation、attempt gap、result-id mismatch、tool identity mismatch、finish 之后仍有 record，或相同 id 的非同内容 materialization 都属于 corruption。Corruption 会 fault Session，不能把 lane 当成 idle。

Reducer 根据 Pi 公开 record contract、第一方设计和测试重新实现，不通过 deep import 复制。行为通过本地 parity fixtures 固定，确保 Pi 升级不会静默改变 recovery。

### 9. 内部 Action 与 Effects

Micro-action 描述复用 Pi 的公开 `ActionInfo` vocabulary：

- durable append/move/fact action；
- `stream_assistant`；
- `execute_tool`；
- hook；
- finish action；
- 后续支持的 queue/deferred/timer action。

`peekAction()` 必须是 pure 且稳定的，直到 lane 发生变化。`executeAction()` 在 mutation line 内重新检查 parked action，拒绝 stale action，然后只释放当前一个 action。`runToCompletion()` 持续释放 action，直到 terminal 或 suspended。

所有 side effect 都经过注入的 `Effects` 对象：

- append record；
- append entry；
- move lane 或 set fact；
- stream 一次 assistant attempt；
- execute 一个 validated tool call；
- invoke 一个 hook；
- timer wait；
- 发布 committed 和 ephemeral events。

Manual drive 使用 `GatedEffects` 包装同一套 Effects；automatic drive 使用不加 gate 的 Effects。Procedure 必须完全相同。对于相同的 deterministic model/tools，manual 与 automatic execution 的 normalized durable logs 必须一致。

### 10. Studio 语义单步

Pi micro-action 对 debugger button 来说过细，因此 Studio facade 负责将它们聚合为 semantic step。

一个 model step：

1. 校验 expected next semantic action。
2. 提交 `step_attempt`，记录 attempt 和 assistant result id。
3. 释放一次 provider effect。
4. 将 delta 作为 ephemeral event streaming。
5. 在 result classification 前提交 usage。
6. 提交 assistant `MessageEntry`。
7. 停在第一个本地 tool effect 前，或者 terminal state。

一个 tool step：

1. 校验 expected assistant entry 和 tool ordinal。
2. 解析工具并 prepare/validate arguments。
3. 运行 before-tool policy phase。
4. 如果 block 或 invalid，在不声称工具副作用已启动的情况下提交相应 error tool result。
5. 如果允许执行，提交包含 effective args、replay policy 和 provisioned result id 的 `tool_started`。
6. 只释放一次 tool effect。
7. 运行 after-tool finalization phase。
8. 如有 tool usage，则提交 usage。
9. 提交一个 tool-result `MessageEntry`。
10. 停在下一个 tool 或 model effect 前。

Debug Session 强制本地工具 sequential execution，确保一次点击对应一个已完成的 tool result。只有在 parallel-batch implementation 证明 ordered result commit 和 recovery 后，Continue 才能恢复配置的 parallel execution。第一版 production 对 Step 和 Continue 都使用 sequential execution，以维持唯一执行协议。

Provider-hosted tool 仍在 provider request 内执行。它们是 assistant response activity，不是本地 `execute_tool` action，不能作为独立本地工具单步。

### 11. Model 执行

Assistant executor 一次只执行一个 provider attempt。它直接使用 Pi Models 和 streaming API，不调用 stock `Agent.prompt()` 或 `agentLoopContinue()`。

Executor 负责：

- 从当前 Pi branch 构建 context；
- 应用已注册的 entry projector；
- 解析被冻结的 model 和 system prompt；
- 使用配置的 Pi converter 转换 provider messages；
- 发送 ephemeral text/thinking/tool-call delta；
- 返回一条完整 assistant message 和 usage；
- 不执行工具，也不开始第二个 assistant turn。

Provider retry 会写一条新的 `step_attempt`，使用 durable incremented attempt number 和相同 logical result id。即使 assistant result 未提交，provider request 仍可能已经产生费用。因此恢复只能承诺 at-least-once provider attempt，不能承诺 exactly-once billing。

### 12. Tool 执行

`ToolContext.execution` 立即做 breaking change，只使用 Pi identity：`sessionId`、`lane`、`runId`、`assistantEntryId`、`toolIndex`、`toolCallId`、`toolName` 和 `idempotencyKey`。旧的 `threadId`、`stepIndex`、`callId` 直接删除，不做双字段兼容。Phase 0–2 期间，待退休 Engine adapter 将 Thread 显式映射成 `sessionId`。Sandbox 和 Skill lifecycle 绑定 `sessionId`。

Tool preparation 和 finalization 必须成为明确 runtime phase，不能隐藏在 stock Agent callback 中：

```text
lookup -> prepare args -> validate -> before policy
       -> tool_started -> execute -> after policy
       -> usage -> tool-result entry
```

Missing tool、argument preparation failure、schema validation failure 和 before-tool policy block 都会生成普通 error tool-result entry。这些路径不能写 `tool_started`，因为没有 external tool effect 被正式接纳。

`tool_started` 保存 hook 调整后的 effective arguments，以及执行开始时生效的 replay policy。Tool execution 会收到由 Session、operation、assistant entry 和 ordinal 派生的稳定 idempotency key。

After-tool policy 可以转换 content、details、error state 和 usage。只有 finalization 结束后才能提交 settled result。Session write failure 是 Harness fault，不是 tool error；一旦失去 durable boundary，loop 不得继续。

### 13. Tool 崩溃恢复

恢复矩阵：

| Durable prefix                                              | 含义                        | 恢复行为                                                  |
| ----------------------------------------------------------- | --------------------------- | --------------------------------------------------------- |
| Assistant tool call 已存在；没有 `tool_started`             | 工具 effect 确定未被接纳    | 暴露相同的 clean tool breakpoint                          |
| `tool_started` 已存在；result entry 已存在                  | 工具已经 settle             | 跳过执行，继续 reduction                                  |
| `tool_started(replay=safe)`；result 缺失；当前声明仍为 safe | 结果未知但允许重放          | 使用持久化 effective args 和稳定 idempotency key 重新执行 |
| `tool_started(replay=safe)`；当前声明变为 never 或缺失      | 安全性降低                  | 提交 synthetic interrupted error result                   |
| `tool_started(replay=never)`；result 缺失                   | unsafe side effect 结果未知 | 提交 synthetic interrupted error result；禁止自动重放     |

Synthetic interruption 不重新运行 before/after hook。用户主动要求 retry unsafe tool 时，必须形成新的显式 operation 或 override action，并由产品进行可见确认，不能伪装成自动恢复。

Pi Session 无法保证 exactly-once external effect。更强保证需要 tool backend 对稳定 idempotency key 去重。

### 14. Run 完成

只有 `operation_finished` 提交后，operation 才进入 terminal。

Outcome 包括：

- completed；
- failed；
- aborted；
- suspended：以 open operation 加可恢复状态表示，不写 terminal finish record。

如果 final assistant entry 已存在但 finish record 缺失，恢复只提交缺失的 finish action，禁止再次发起 provider request。

Completion predicate 必须从 committed entries 和 tool results 计算。Pi message 支持的 runtime-only `terminate` hint 可以保留，但不能成为恢复的唯一证据。

### 15. Cancellation 与 close

Abort 顺序：

1. 幂等提交一条 `abort_requested` record。
2. 向当前本地 provider/tool effect 发送 signal。
3. 由 reducer 补齐必要的 synthetic tool results。
4. 提交 `operation_finished(outcome=aborted)`。

如果进程在第一步之后退出，resume 会读取 abort intent 并完成 abort recovery，而不是继续 run。

关闭 runtime 是 controlled crash，不是 abort。它会停止本地工作并释放 repository resources，但不写 terminal outcome；open operation 保持可恢复。

所有 gate 和 hook 都必须监听当前 abort signal，并在 abort/close 时移除 waiter。

### 16. Event 与 Snapshot 模型

Pi `AgentMessage` 是 canonical transcript message。内核不持久化、也不同步 `@llm-space/core.Message` 或 ACP payload。ACP 是后续 UI/宿主互操作的边缘协议；Pi log → ACP projection 必须位于 Harness 外部。

Pi Session log 是唯一 durable execution log，LLM Space 不新增第二张 runtime-event 表。Runtime 只在进程边缘把 Pi log item 投影为 committed notification，并把 provider/tool progress 转发为 ephemeral delta。这些边缘 event 分为两类：

- ephemeral：provider text/thinking/tool-call delta 和本地进度；
- committed：Session entry/record/fact change 及其派生的 semantic state。

只有相应 Session write resolve 后才能发布 committed event。每个 committed event 携带 Session id、lane、可能存在的 operation id、Session sequence，以及足以重新请求 snapshot 的 identity。

Ephemeral event 不跨重启 replay。Assistant 或 tool result 提交后，UI 必须丢弃 streaming overlay，并从 Pi Session snapshot 重建 message。

RPC disconnect 不取消执行。重新连接后 open Session，并从 durable sequence 继续。只有显式 abort command 可以停止 run。

### 17. 持久化与 Writer Ownership

第一版自研 Bun-native `BunSqliteSessionRepository`，因为官方 Node adapter 依赖 `node:sqlite`，Bun 1.3.14 无法解析。实现必须覆盖 Pi 完整公共 `SessionRepo` contract，并通过 `createSessionBackendConformance`，不得 deep import Pi internal。

Pi Session 与 Studio metadata 使用同一个物理 SQLite 文件，但严格区分表 ownership。Pi 表统一使用 `pi_` 前缀，包括 `pi_sessions`、`pi_entries`、`pi_records`、`pi_lanes`、`pi_writer_leases` 和 `pi_schema_migrations`；LLM Space immutable binding 使用 `llm_space_runtime_bindings`。各 adapter 只拥有自己的 transaction，不假设跨 owner 原子写。

每个 project/application runtime 只打开一次 repository，并由 composition root 关闭。Process-local registry 确保每个 Session 只有一个 open handle。跨进程 writer ownership 由 Pi SQLite fenced writer lease 保证。

Lost lease 会永久 fault 本地 Session handle。旧 writer 不得重试写入；UI 必须在新的 owner 问题解决后重新打开。

Product object 和 Pi Session 的创建不依赖跨 owner transaction，而按以下方式 reconcile：

1. 使用调用方提供的稳定 id 创建 Pi Session。
2. 持久化 Studio/App 对该 id 的引用。
3. 如果第二步失败，使用相同 id 重试时复用已有 Pi Session。无引用的空 Session 可以安全识别并在以后清理。

Run admission 完全发生在 Pi Session 中，不再需要 Studio pending-run record。

### 18. Error 模型

预期内 command rejection 返回 tagged result：

- lane busy；
- stale action；
- nothing to resume；
- no active operation；
- invalid message；
- missing runtime identities；
- unsupported capability；
- command conflict；
- closed runtime。

已接受的 operation resolve 为 completed、failed、aborted 或 suspended outcome。Provider error、普通 tool error、missing tool、invalid arguments 和 policy block 都是 durable operation/transcript outcome。

Storage failure、lost writer lease、invalid record log、provisioned-content mismatch、impossible state transition 或 programmer defect 会抛 Harness fault，并永久 fault Session handle。这些错误不能转换成模型可见的 tool error。

### 19. Studio Domain 变化

Playground 和 Experiment 的 execution identity 从 Engine Thread/Checkpoint ids 改为：

- Pi `sessionId`；
- 默认 lane，第一版固定为 `main`；
- Session 当前 leaf id；
- 从 Session 推导的可选 active/suspended operation id；
- runtime format version。

Studio Draft 继续作为 dirty editable projection。Run 启动时，将 Draft 中的 message/config changes 提交到 Pi Session，然后清除 Draft，不再创建 Engine input checkpoint。

Run history 变成 Studio 维护的 Pi operation id 排序/引用索引。Run detail、messages、usage 和 outcome 从 Pi records/entries 投影。Evaluation target 引用 Pi Session、operation 和 leaf/entry identity。

Studio event 保留面向产品的命名，但必须投影自已提交的 Pi change。`message.completed` 只能在 Pi MessageEntry 提交后发出，`tool.completed` 只能在 Pi tool-result entry 提交后发出。

### 20. App 与 CLI 变化

App package 不再定义 authoritative model Session transcript 和 Session-to-Engine Run link。它的产品 Session facade 由 Pi Session 支撑：

- title 映射到 Pi Session name；
- model message 映射到 Pi MessageEntry；
- system/user-action timeline 映射到 Pi CustomEntry；
- current activity 从 open Pi operation 推导；
- run history 引用 Pi operation id；
- Task 继续作为引用 Pi Session/operation id 的应用元数据。

CLI 与 Studio 使用相同 runtime facade 启动和 watch，不再托管第二套 agent loop。CLI 与 Desktop 使用相同规则消费 ephemeral streaming event 并与 committed snapshot 对账。

### 21. 迁移与发布

迁移采用直接 cutover，禁止双写：

1. 引入 Pi runtime、ACP v2 boundary 和 host lifecycle。
2. 将 Playground、Experiment、App、CLI 与 remote execution 直接切换到 Pi Session。
3. 删除 LLM Space 自定义 model Session/Run projection。
4. 删除 Engine 与 Engine-Pi package 及全部产品执行路径。

Production 代码禁止将同一个 model/tool step 同时写入 Engine 和 Pi Session；cutover 完成后不存在 Engine runtime version。

代码不读取、迁移、导入、检测或删除旧 Engine/App/Studio 数据；部署前由维护者自行清理 data root。本实现只支持全新 Pi-backed schema，不保留 runtime rollback path。

### 22. 交付阶段

#### Phase 0：Contract 与 characterization

- 建立 package boundary 并 exact pin Pi dependency。
- 在 Studio shared database 中实现 Bun SQLite Session backend，并通过 Pi 完整 Session conformance。
- 实现 fenced writer lifecycle 和 immutable runtime-binding storage。
- 固化 public record-validity 和 Session-context fixtures。
- 定义 runtime snapshot、error、effects 和 stable action identity。
- 添加无副作用 open/restore 测试。

退出条件：能够确定性 reduce idle/open operation，且整个过程产生零 external effect。

#### Phase 1：Model-only 垂直切片

- 实现 main-lane admission 和 runtime binding。
- 实现一次 assistant attempt、usage、message commit、finish、abort 和 provider retry。
- 实现 manual/automatic drive。
- 集成一个不接 UI 的 headless Studio facade。

退出条件：no-tool run 可以 step、continue，并能在每个 effect boundary crash/reopen，最终收敛到相同 normalized log。

#### Phase 2：Sequential tools

- 实现 lookup、prepare、validation、before policy、durable tool intent、execution、after policy、usage 和 result commit。
- 实现 safe/never recovery 和 synthetic interruption。
- 提供稳定 tool idempotency key。
- 添加 multi-tool sequential semantic stepping。

退出条件：每个 tool crash prefix 都有已验证的 recovery outcome，并且任何 unsafe tool 都不会被自动重放。

#### Phase 3：Persistence 与 host lifecycle

- 实现 watch/reconnect 和 committed event cursor。
- 验证 close 与 abort 语义。
- 新增独立 `@llm-space/acp`，精确锁定官方 SDK 1.3.0 的 experimental v2 boundary。
- 建立共享 ACP application 与 reconnect contract；生产 host 在 Phase 4、5
  对 authoritative consumer cutover 时再激活。

退出条件：process restart、competing writer、lease takeover 和 RPC disconnect 测试全部通过。

#### Phase 4：Studio cutover

- 将新 Playground/Experiment execution reference 替换为 Pi identity。
- 适配 Draft commit、run history、evaluation target 和 UI event。
- 将 Step/Continue/Abort 切到新 facade。
- 让 Desktop UI execution 通过 Electrobun custom transport envelope 使用 ACP 语义。

退出条件：新 Studio 对象不再写 Engine Thread、Run 或 Checkpoint，并且能够完全从 Pi Session 恢复。

#### Phase 5：App/CLI cutover 与退休旧实现

- 将 App model Session projection 替换为 Pi-backed facade。
- 将 CLI 路由到共享 runtime，提供标准 NDJSON stdio ACP v2 endpoint，并让 SSH
  remote execution 切到该 endpoint。
- 删除过时的 Engine/Engine-Pi package、composition 和 store。

退出条件：所有受支持本地执行界面使用同一个 Pi Session runtime，不再存在重复 authoritative transcript。

### 23. 安全与隐私

Session records 可能包含 prompt、effective tool arguments、model output、tool results 和 runtime binding metadata。它们必须使用现有 local data root 权限，并且在未脱敏前不能写入 analytics 或 diagnostic output。

恢复要求持久化 tool arguments。接收 secret 的工具应传递 reference 或可脱敏 handle，不能将 raw credential 写入参数。Runtime 绝不能在 effective args 中持久化 process environment variable 或已解析的 auth token。

Renderer 不得获得 writable Session storage 或 tool executor。所有执行都留在 trusted Bun process，通过 typed RPC 暴露。

### 24. 可观测性

Runtime diagnostic 使用稳定的 Session、lane、operation、action、attempt、assistant entry 和 tool ordinal identity。日志必须区分 ephemeral effect progress 与 committed Session change。

Metrics 包含：

- operation started/completed/failed/aborted/suspended；
- model attempts 和 retry count；
- tool executions、safe replay 和 synthetic interruption；
- recovery duration 和 corruption count；
- writer lease loss；
- stale Step rejection；
- Session append latency；
- semantic Step latency。

默认不得在 metrics 中包含 message content 或 tool arguments。

### 25. 验收标准

以下条件全部满足后，本方案才算完成：

1. 对已迁移对象，Pi Session 是唯一 durable transcript 和 execution-state authority。
2. Production 代码不继承或 monkey-patch Pi Agent/Harness。
3. 不存在 unsupported Pi deep import。
4. Model Step 只有在一条 assistant entry 提交后才返回。
5. Tool Step 只有在一条 tool-result entry 提交后才返回。
6. Next semantic action 稳定，并可由 action id 防止 stale execution。
7. Open Session 不产生 provider、tool、hook 或 timer effect。
8. Manual 和 automatic drive 产生等价 normalized Session log。
9. 每一个 provider/tool durable prefix 都有已测试的恢复结果。
10. Unsafe unknown tool outcome 永不自动重放。
11. Session write failure 会停止执行，不会伪装成 tool error。
12. 本地 abort signal 发出前，abort intent 已 durable。
13. Lost writer lease 会永久 fence 旧 runtime。
14. Streaming overlay 会在 commit/reconnect 后与 Session entry 对账。
15. Studio run history 和 Evaluation 能通过 Pi identity 解析。
16. 新迁移对象不写 Engine Thread、Run 或 Checkpoint state。
17. 产品代码不包含旧数据 reader、import、migration、schema detection 或 cleanup。
18. Focused/full test、typecheck、zero-warning lint 和 production build 全部通过。

## 测试决策

### 主要行为测试 seam

最高层、最主要的测试 seam 是 `StudioPiSessionRuntime`。测试以 Studio caller 身份操作，断言 snapshot、semantic step、event 和 restart behavior，不断言 coordinator field、Promise gate 或 private procedure structure。

必测行为：

- start、一个 model Step、一个 tool Step、Continue 和 terminal result；
- stale Step action rejection；
- 相同/冲突 payload 的重复 start admission；
- 每个 external effect 前、中、后的 abort；
- ephemeral delta 丢失后的 reconnect；
- missing model/tool identity suspension；
- 在每个 durable prefix close/reopen；
- imported Session rendering 和 Evaluation reference。

### Effects 崩溃测试 seam

`Effects` 是唯一的底层 fault-injection seam。Deterministic test wrapper 会在每个 effect 前停车，分别释放 0 到 N 个 effects，模拟进程退出，在相同 Session 上创建新 runtime，验证 restore 产生零 effect，然后 resume，并比较最终 normalized Session log。

Crash matrix 覆盖：

- operation admission 前后；
- 每一条 initial message append；
- provider stream 前、中、后；
- usage 已写、assistant 尚未 append；
- assistant 已 append、tool planning 尚未开始；
- tool intent 前后；
- tool side effect 已发生、result 尚未提交；
- after-tool policy 前后；
- tool usage 和 result append；
- abort intent 与 terminal finish；
- final assistant append 与 operation finish 之间。

### Session backend 测试 seam

Memory、开发环境保留的 JSONL，以及 production SQLite storage 都运行 Pi 官方 Session conformance。Writer 测试额外覆盖：

- 两个 repository 打开同一个 Session；
- lease expiry 与 fenced takeover；
- old writer 尝试再次写入；
- old close 不释放 new owner lease；
- project/application runtime shutdown。

### Deterministic model/tool fake

Model fake 产生确定性的 text、thinking、tool calls、usage、provider error、retryable error 和 abort behavior。Tool fake 提供确定性结果，并按 idempotency key 计数。测试通过外部调用次数证明 replay 决策。

主要 seam 的测试不能 mock Pi Session reduction，必须使用真实 Session implementation，以持续覆盖 transcript 和 record invariant。

### Parity 与 compatibility

本地 reducer fixtures 来源于 Pi 的 valid-prefix 和 corruption case，但只断言公开行为，不复制 source structure。Pi dependency 升级前必须用相同 fixture corpus 验证。

Manual 和 automatic run 使用完全相同的 fake effects。Normalized log 只移除 storage-assigned sequence、timestamp 和刻意随机的 ids；所有 semantic records、entries、顺序、usage 和 outcome 必须相同。

### Studio 集成

Studio application tests 验证：

- Draft commit 成为 Pi entries/config state；
- Step 和 Continue 只调用一个 runtime seam；
- run history ordering 引用 Pi operation；
- Evaluation target 跨重启保持稳定；
- committed runtime event 投影为现有 UI event 语义；
- Pi-runtime 对象不产生 Engine store write。

Desktop RPC tests 验证 correlation、reconnect、duplicate response handling 和 explicit abort。Renderer tests 只断言 presentation/store reconciliation，不在浏览器中 mock tool execution。

### 质量门禁

每个交付阶段都必须通过 focused runtime tests 和 TypeScript checking。Cutover 阶段还必须通过完整 Bun test suite、zero-warning lint、所有 workspace typecheck 和 production renderer build。

## 不在本方案范围内

- Fork Pi，或在本次工作中向上游贡献实现。
- 继承或 patch stock Pi `Agent`。
- 依赖官方 `node:sqlite` backend 或 deep import Pi `dist/*`。
- 第一版 production 就支持完整 `AgentLane`。
- 第一版 production 就支持 multi-lane/subagent execution。
- 第一版 production 就支持 parallel local tool stepping。
- 在对应 phase 被单独设计前实现 queue steering、follow-up、next-run、compaction、navigation、skill 和 prompt-template execution。
- 通用的 exactly-once provider billing 或 external tool side effect。
- 将 provider-hosted tool 当作可独立执行的本地 tool step。
- 自动破坏性迁移或删除旧 Engine/App/Studio data。
- 为同一个 execution 同时维护 Engine 和 Pi 两套写入。
- 修改 static shared-thread viewer 的展示数据格式；它继续使用 `@llm-space/core.Thread`。
- 除了替换 execution reference 之外，修改 Studio 的 Project、Experiment、Draft、Evaluation 或 Task 产品概念。
- 持久化 ACP payload，或让 Harness 依赖 ACP。ACP 是后续 UI/协议边缘；内核只持久化 Pi `AgentMessage`。

## 补充说明

已有 Pi hook 研究仍可用于理解 live event ordering，但 hook 只是 runtime 内部 phase，不是 source of truth。Session recovery prototype 已证明，丢弃全部 runtime object 后仍能重建 model/tool next action，并能对 unsafe tool 做 interruption recovery。它没有证明真实 provider/tool production behavior；生产证据必须来自 Effects crash matrix。

不 fork 的决策，是用较少的 upstream code reuse 换取稳定的 public dependency boundary。由于 pinned release 中的上游 Harness execution code 本身尚未实现，这个取舍是合理的。代价是 LLM Space 必须自己负责 recovery correctness，并以实现 storage engine 的纪律维护 reducer/effect protocol。

进入实现拆票前，团队需要确认三项约束：`StudioPiSessionRuntime` 是唯一产品 seam；第一版只支持 main lane；第一版所有本地工具都 sequential，且不存在 unsupported fallback。放宽其中任何一项都会实质改变 recovery/test matrix，需要单独的设计决策。
