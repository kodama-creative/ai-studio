# Codex 与 Claude Cowork：Task、Session、Thread、Transcript 顶层概念研究

> 调研日期：2026-08-10  
> 范围：只研究 OpenAI Codex 与 Anthropic Claude Cowork 的官方产品文档、官方帮助中心、官方公开协议/源码；不检查当前项目代码。  
> 目的：厘清 `Task`、`Session`、`Thread / Conversation`、`Turn / Run`、`Message / Item`、`Transcript`、`Workspace / Sandbox`、`Subagent` 之间的关系，为顶层领域设计提供事实依据。

## 结论先行

两个产品共同说明：**Task、Session、Thread/Conversation、Transcript 不是一组同义词，也不应该固定为一一对应。**

- Codex 的本地/桌面运行协议把核心交互明确建模为 `Thread -> Turn -> Item`。`Session` 在最新协议中是一次 live session tree 的根身份，可包含 root thread 与 subagent child threads；它不是消息容器的另一个名字。
- Codex Cloud 另有独立的 `Cloud Task` 资源。官方开源客户端类型显示一个 Task 可有多个 best-of-N `TurnAttempt`，并拥有环境、状态、diff 与 apply 生命周期；它不能与本地协议的 Thread 或 Turn 直接画等号。
- 普通 Cowork 的产品流程常近似“描述一个 task，启动一个 Cowork session”，所以文案里 task/session 看起来接近；但这只是该入口的产品选择。
- Cowork Dispatch 明确拆成 `Persistent Thread / Conversation -> Task -> Session -> Transcript`：一个永不重置的 thread 接受多个 task，每个 task 再调度合适的 Claude Code 或 Cowork session。
- Cowork Scheduled Task 又显示出 `TaskDefinition -> repeated Session`：每次定时执行都是自己的 Cowork session，历史 run 与任务定义分开。
- 两边都提供了强证据，说明 **可显示/审计的 transcript、模型实际可见的 context、完整 runtime trace 是三种不同投影**。上下文压缩不应删除审计历史，也不应让 Transcript 等同 Model Context。

建议把顶层关系理解为：

```text
Task / Goal / Schedule             端应用的委托与编排语义
          |
          v
Session / Invocation               一次有边界的执行与资源生命周期
          |
          +---- Thread(s)           Agent 连续交互/分支的持久语义
          |         |
          |         +---- Turn(s) / Run(s)
          |                   |
          |                   +---- Message / Item / Tool Event
          |
          +---- Sandbox / Workspace Binding / Capability Snapshot

Transcript                         可审计、可回放的事实投影
Model Context                      某次模型调用的受预算投影
Runtime Trace                      比 Transcript 更完整的执行证据
```

上图是跨产品的**设计归纳**，不是任何一家公开的内部实现图。

## 证据标记

- **明确事实**：官方文档、帮助中心或官方公开协议/类型直接表述。
- **类型事实**：官方开源仓库的公开类型或协议字段；说明当前实现形状，但不自动等于长期产品承诺。
- **设计推断**：由多个官方事实归纳出的架构建议；不声称是产品内部实现。

## 一、OpenAI Codex

### 1. 核心交互：Thread -> Turn -> Item

**明确事实。** Codex app-server 将用户与 Agent 的交互定义为三个顶层 primitive：

- `Thread`：用户与 Codex Agent 的一次 conversation，包含多个 Turn。
- `Turn`：一次对话轮次，通常从 user message 开始、以 agent message 结束，包含多个 Item。
- `Item`：Turn 中的用户输入与 Agent 输出；会持久化并用于后续对话上下文，包括 user message、reasoning、agent message、shell command、file edit 等。

来源：[OpenAI Codex app-server — Core Primitives](https://github.com/openai/codex/blob/1c042dd4d823b451ae44029abaf0e13b7cef8904/codex-rs/app-server/README.md#core-primitives)（访问：2026-08-10）。

**明确事实。** 生命周期是：

1. `thread/start` 创建新 conversation；`thread/resume` 继续已存储 conversation；`thread/fork` 复制历史并产生新 thread id。
2. `turn/start` 在目标 Thread 上提交用户输入并立即返回 Turn。
3. 执行过程产生 `item/started`、delta、`item/completed` 等通知。
4. 正常完成或 `turn/interrupt` 后产生 `turn/completed`；Turn 状态包括 `inProgress / completed / interrupted / failed`。

来源：[app-server Lifecycle Overview](https://github.com/openai/codex/blob/1c042dd4d823b451ae44029abaf0e13b7cef8904/codex-rs/app-server/README.md#lifecycle-overview)、[TurnStatus 类型](https://github.com/openai/codex/blob/1c042dd4d823b451ae44029abaf0e13b7cef8904/codex-rs/app-server-protocol/src/protocol/v2/turn.rs#L26-L35)（访问：2026-08-10）。

**类型事实。** 一个 Turn 的 Item 不只等于聊天 Message。当前公开类型包括：

- `UserMessage`、`AgentMessage`、`Reasoning`、`Plan`
- `CommandExecution`、`FileChange`
- `McpToolCall`、`DynamicToolCall`
- `CollabAgentToolCall`、`SubAgentActivity`
- `WebSearch`、`ImageView`、`ImageGeneration`
- `ContextCompaction`

来源：[ThreadItem 类型](https://github.com/openai/codex/blob/1c042dd4d823b451ae44029abaf0e13b7cef8904/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L226-L398)（访问：2026-08-10）。

因此在 Codex 语义中，`Message` 只是 Item 的一部分；Turn 更接近一次用户输入触发的完整 Agent execution episode，而不只是 assistant 文本回复。

**类型事实。** Codex TypeScript SDK 没有再建立一个与 Turn 平行的持久 `Run` 实体：`Thread.run()` 返回 `Promise<Turn>`，流式版本返回 `StreamedTurn`。因此在这一 API 中，run 是“执行一个 Turn”的操作名，Run Result 就是 Turn。

来源：[Codex TypeScript SDK `thread.ts`](https://github.com/openai/codex/blob/1c042dd4d823b451ae44029abaf0e13b7cef8904/sdk/typescript/src/thread.ts#L9-L117)（访问：2026-08-10）。

### 2. Session：live thread tree，而不是 Conversation 的别名

**类型事实。** 最新公开的 `Thread` 类型同时包含：

- 自身 `id`
- `sessionId`：属于同一 session tree 的 threads 共享
- `forkedFromId`：由 fork 创建时指向来源 Thread
- `parentThreadId`：仅 subagent Thread 设置
- `turns`、`status`、`cwd`、`source`、`ephemeral` 等

来源：[Thread 类型](https://github.com/openai/codex/blob/1c042dd4d823b451ae44029abaf0e13b7cef8904/codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs#L184-L253)（访问：2026-08-10）。

**明确事实。** app-server 对 `sessionId` 的说明更精确：它标识当前 live session tree 的 root；root Thread 使用自己的 `thread.id` 作为 `sessionId`。存储但未加载的 Thread 也报告自己的 id，因为 resume 后它会成为一个新的 live session tree root。Spawned child threads 属于同一个 session tree。

来源：[app-server — Branch a conversation](https://github.com/openai/codex/blob/1c042dd4d823b451ae44029abaf0e13b7cef8904/codex-rs/app-server/README.md#L397-L410)、[Thread.sessionId 字段注释](https://github.com/openai/codex/blob/1c042dd4d823b451ae44029abaf0e13b7cef8904/codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs#L184-L199)（访问：2026-08-10）。

可以画成：

```text
Live Session Tree (sessionId = root thread id)
  root Thread
    ├─ Turn 1
    ├─ Turn 2
    ├─ spawned child Thread A
    │    └─ Turns...
    └─ spawned child Thread B
         └─ Turns...

unload / resume persisted root Thread
  -> 新的 live Session Tree
  -> Conversation/Thread identity 仍可延续
```

这揭示了一个重要分离：

- Thread 是可持久化、可 resume/fork 的 conversation identity。
- Session 是当前被加载和执行的 thread tree 生命周期/关联身份。
- root Thread 与 Session 在简单场景中 id 相同，但概念职责不同。

最后一点是**设计推断**；官方类型明确分开了字段，但没有发布完整的领域说明书。

### 3. Transcript、persisted history、model-visible context、runtime trace

Codex 没有在 app-server 顶层 primitive 中定义名为 `Transcript` 的独立资源；公开协议主要使用 Thread/Turn/Item 与 persisted history。

**类型事实。** Codex 当前实现中的 local transcript path 指向 Thread 的 rollout JSONL；rollout 的记录类型不只包含模型消息，还包括 `SessionMeta`、`ResponseItem`、inter-agent communication、`Compacted`、`TurnContext`、`WorldState` 与 lifecycle event。因此 transcript/rollout 是可恢复、可审计的追加式运行记录，比 model message history 更宽。

来源：[transcript path 实现](https://github.com/openai/codex/blob/1c042dd4d823b451ae44029abaf0e13b7cef8904/codex-rs/core/src/session/mod.rs#L4138-L4155)、[RolloutItem 类型](https://github.com/openai/codex/blob/1c042dd4d823b451ae44029abaf0e13b7cef8904/codex-rs/protocol/src/protocol.rs#L3211-L3263)（访问：2026-08-10）。

**明确事实。** `thread/read(includeTurns=true)` 可从 rollout history 读取 Turns 与 Items；`thread/turns/list` 和 `thread/items/list` 可分页读取持久历史。Turn 的 `itemsView` 还能区分 `notLoaded / summary / full`，说明“返回给客户端的历史详情”本身是一种 projection。

来源：[app-server thread read/list APIs](https://github.com/openai/codex/blob/1c042dd4d823b451ae44029abaf0e13b7cef8904/codex-rs/app-server/README.md#example-read-a-thread)、[TurnItemsView 类型](https://github.com/openai/codex/blob/1c042dd4d823b451ae44029abaf0e13b7cef8904/codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs#L256-L291)（访问：2026-08-10）。

**类型事实。** 协议显式存在 `ContextCompaction` Item，也存在向 Thread 的 `model-visible history` 注入 raw Responses API items 的接口。这说明“Thread 的完整可显示/持久 Item 历史”与“当前模型可见历史”至少在实现上可被分别操作。

来源：[ContextCompaction Item](https://github.com/openai/codex/blob/1c042dd4d823b451ae44029abaf0e13b7cef8904/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L386-L398)、[`thread/injectItems` 的 model-visible history 注释](https://github.com/openai/codex/blob/1c042dd4d823b451ae44029abaf0e13b7cef8904/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L1487-L1499)（访问：2026-08-10）。

**类型事实。** Compaction 时，运行态 effective history 被 `replace_history`；同一 replacement history 作为 `CompactedItem` 追加写入 rollout。Resume/replay 遇到该记录时重建并替换 effective history，再继续追加后续 ResponseItem。也就是说，compaction 改的是重放得到的 model-visible history，不是抹掉此前 rollout。

来源：[replace compacted history](https://github.com/openai/codex/blob/1c042dd4d823b451ae44029abaf0e13b7cef8904/codex-rs/core/src/session/mod.rs#L3312-L3344)、[rollout reconstruction](https://github.com/openai/codex/blob/1c042dd4d823b451ae44029abaf0e13b7cef8904/codex-rs/core/src/session/rollout_reconstruction.rs#L317-L362)（访问：2026-08-10）。

**明确事实。** Codex 的 Rollout Trace 文档进一步把三层证据明确区分：

- normal transcript 不足以解释全部执行行为；
- `ConversationItem` 表示出现在模型 request/response 中的 model-visible conversation；
- `ToolCall / CodeCell / TerminalOperation / InferenceCall / Compaction` 表示 runtime/debug boundary；
- runtime payload 不是模型看到了相同 bytes 的证明。

来源：[OpenAI Codex Rollout Trace](https://github.com/openai/codex/blob/1c042dd4d823b451ae44029abaf0e13b7cef8904/codex-rs/rollout-trace/README.md#what-this-gives-us)、[Raw Evidence vs Reduced Graph](https://github.com/openai/codex/blob/1c042dd4d823b451ae44029abaf0e13b7cef8904/codex-rs/rollout-trace/README.md#raw-evidence-vs-reduced-graph)（访问：2026-08-10）。

**设计推断。** 对顶层设计最安全的映射是：

```text
Persisted Thread History / Transcript
  = 用户可见、可审计、可恢复的 Turn + Item 事实

Model-visible Context
  = 某次 inference request 实际选择的 ConversationItems
  = 可经过 compaction / modality filtering / budget projection

Runtime Trace
  = inference、工具、terminal、subagent、compaction 等完整执行证据图
```

这三者可以互相引用，但不应共用一个可变 `messages[]` 作为唯一表示。

### 4. Codex 的 Task：本地产品称呼与 Cloud Task 资源要分开

**明确事实。** app-server 明确列出的顶层交互 primitive 只有 Thread、Turn、Item，没有 Task。因而在本地 CLI/App Engine API 中，将 UI 中的“task”直接建成 Agent 核心实体没有官方协议依据。

来源：[app-server Core Primitives](https://github.com/openai/codex/blob/1c042dd4d823b451ae44029abaf0e13b7cef8904/codex-rs/app-server/README.md#core-primitives)（访问：2026-08-10）。

**类型事实。** Codex Cloud 则确实有单独的 `TaskId` 与 `TaskStatus(pending / ready / applied / error)`。`TaskSummary` 关联 cloud environment、diff summary、review flag 和 attempt count；一个 Task 可列出多个 best-of-N `TurnAttempt`，每个 attempt 有自己的 `turnId`、状态、diff、messages。Task 还拥有把结果 patch preflight/apply 到本地 working tree 的生命周期。

来源：[Codex Cloud Task client types](https://github.com/openai/codex/blob/1c042dd4d823b451ae44029abaf0e13b7cef8904/codex-rs/cloud-tasks-client/src/api.rs#L20-L135)、[CloudBackend 接口](https://github.com/openai/codex/blob/1c042dd4d823b451ae44029abaf0e13b7cef8904/codex-rs/cloud-tasks-client/src/api.rs#L137-L189)（访问：2026-08-10）。

当前公开类型支持以下关系：

```text
Cloud Task
  ├─ prompt / environment / git ref
  ├─ TaskStatus
  ├─ TurnAttempt 1
  ├─ TurnAttempt 2          best-of-N siblings
  ├─ selected diff/messages
  └─ apply / preflight lifecycle
```

**设计推断。** Cloud Task 更像远程工作订单/结果集合；TurnAttempt 是它的一次候选执行。它和本地 `Thread -> Turn -> Item` 可以适配，但不应在通用 Engine 中被强制合并为同一种实体。

### 5. Workspace、Worktree 与 Subagent

**明确事实。** Thread 保存 `cwd`，Turn 可覆盖后续 Turn 使用的 cwd、runtime workspace roots、environment、sandbox/permission policy；这些是执行配置，不是 Message 或 Conversation 本身。

来源：[TurnStartParams](https://github.com/openai/codex/blob/1c042dd4d823b451ae44029abaf0e13b7cef8904/codex-rs/app-server-protocol/src/protocol/v2/turn.rs#L71-L160)、[Thread 类型](https://github.com/openai/codex/blob/1c042dd4d823b451ae44029abaf0e13b7cef8904/codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs#L184-L253)（访问：2026-08-10）。

**明确事实。** Codex App 的 managed worktree 通常专用于一个 chat；permanent worktree 则可承载多个 chats；Handoff 可以在 Local 与 Worktree 间移动 chat 和 code，同时保持 chat identity。这说明 Worktree 是可重绑定的 execution workspace，而不是 Thread/Conversation identity。

来源：[OpenAI Codex Worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees)（旧入口：[developers.openai.com/codex/app/worktrees](https://developers.openai.com/codex/app/worktrees/)；访问：2026-08-10）。

**明确事实。** Subagent 是 child Thread：`parentThreadId` 标出父 Thread；rollout trace 将 parent/child Thread、task delivery、result delivery、close 表示为图中的独立对象和 interaction edges。Top-level independent Threads 有独立 trace bundle，spawned child Threads 则属于同一 rollout/session tree。

来源：[Rollout Trace — Multi-Agent v2](https://github.com/openai/codex/blob/1c042dd4d823b451ae44029abaf0e13b7cef8904/codex-rs/rollout-trace/README.md#multi-agent-v2)、[Thread.parentThreadId](https://github.com/openai/codex/blob/1c042dd4d823b451ae44029abaf0e13b7cef8904/codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs#L184-L205)（访问：2026-08-10）。

## 二、Anthropic Claude Cowork

### 1. 普通 Cowork：Task 通常由一个 Session 承载

**明确事实。** 普通 Cowork 的入口叫“Start a Cowork session”，用户在输入框中 describe the task。Claude 为复杂、多步骤 task 制定计划、按需拆 subtask、执行，并允许用户在运行中 steer、回答问题或重定向。

来源：[Get started with Claude Cowork](https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork)（访问：2026-08-10）。

**明确事实。** Cloud session 的 agent loop 与 code execution 在 Anthropic 基础设施运行；每个 session 有独立、临时 sandbox，在 session start 创建、session end 销毁，session 间不共享 sandbox state。Local session 的 agent loop 在设备上运行，代码/命令在独立 VM 执行。

来源：[Claude Cowork architecture overview](https://support.claude.com/en/articles/14479288-claude-cowork-architecture-overview)（访问：2026-08-10）。

**明确事实。** Cloud session 与 session files 保存到 Claude account，可在 web、desktop、mobile 之间继续；关闭设备后仍可运行。Local files 是另一类资源，仍在用户设备，需要在线 Desktop 与 folder binding 才能访问。

来源：[Use Claude Cowork on web, desktop, and mobile](https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile)（访问：2026-08-10）。

**设计推断。** 普通 Cowork UI 很容易让人得到 `Task ≈ Session ≈ Conversation` 的印象，但官方实际只说明“描述 task 来启动 session”。这是一种常见入口关系，不足以成为核心域的一对一不变量。

### 2. Dispatch：Persistent Thread -> Task -> Session

这是 Cowork 对顶层设计最有价值的反例。

**明确事实。** Dispatch 不为每个 task 新建入口 conversation，而是提供一个“single persistent thread with Claude”；该 thread 不重置，同一个 conversation/context 可跨 phone 与 desktop 使用。目前限制也是 one continuous thread，所有 messages 位于一个 conversation。

来源：[Assign tasks from anywhere in Claude Cowork](https://support.claude.com/en/articles/13947068-assign-tasks-from-anywhere-in-claude-cowork)（访问：2026-08-10）。

**明确事实。** Dispatch 收到 task 后判断工作类型并“spins up the right session”：开发工作进入 Claude Code session，知识工作进入 Cowork session。这些 session 出现在各自 sidebar；用户可以进入执行 session 看详情，也可以只在 persistent thread 等待 outcome 回写。

来源：[Assign tasks from anywhere in Claude Cowork](https://support.claude.com/en/articles/13947068-assign-tasks-from-anywhere-in-claude-cowork)（访问：2026-08-10）。

官方行为可以画成：

```text
Dispatch Persistent Thread / Conversation
  ├─ Message: task request A
  │       └─ dispatch -> Claude Code Session A
  │                         └─ transcript / result
  ├─ Message: task request B
  │       └─ dispatch -> Cowork Session B
  │                         └─ transcript / result
  └─ outcomes 汇聚回同一 persistent conversation
```

因此 Cowork 自己已经证明：`Thread 1 -> N Task -> N Session` 是合理产品模型；Session 不必承载用户全部长期 conversation。

### 3. Scheduled Task：TaskDefinition -> repeated Session

**明确事实。** Scheduled Task 保存 prompt instructions、cadence、approval mode，以及可选 model/folder；可 pause、resume、delete、on-demand run。产品分别展示 upcoming 与 past runs。

来源：[Schedule recurring tasks in Claude Cowork](https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork)（访问：2026-08-10）。

**明确事实。** 官方明确写道：“Each scheduled task runs as its own Cowork session.” 因而任务定义、一次触发、执行 Session 至少是可区分的生命周期。

来源：[Schedule recurring tasks in Claude Cowork](https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork)（访问：2026-08-10）。

**设计推断。** 更稳定的抽象是：

```text
Scheduled TaskDefinition
  ├─ schedule / prompt / permissions / resource bindings
  ├─ Invocation 1 -> Cowork Session 1
  ├─ Invocation 2 -> Cowork Session 2
  └─ Invocation 3 -> Cowork Session 3
```

Anthropic 没有公开通用 `TaskRun` schema；上面的 `Invocation` 是为避免混淆而引入的设计词。

### 4. Session 生命周期与 Owner

**明确事实。** Compliance API 为 remote session 提供状态 `pending / active / paused / archived / failed`；pending 表示正在 provisioning，尚无 transcript；被删除的 session 不再返回。

来源：[Claude Compliance API — Retrieve remote sessions](https://platform.claude.com/docs/en/manage-claude/compliance-content-data#retrieve-remote-sessions)（访问：2026-08-10）。

**明确事实。** Session 要么 user-owned，要么 agent-owned，不会同时属于两者。Scheduled task session 是 agent-owned 的官方例子；`started_by_user` 仍可记录是谁触发这次执行。

来源：[Claude Compliance API — Retrieve remote sessions](https://platform.claude.com/docs/en/manage-claude/compliance-content-data#retrieve-remote-sessions)（访问：2026-08-10）。

这表明 Session 的职责至少包括 execution ownership、provisioning/runtime/archive 生命周期，而不只是 Conversation 消息集合。

### 5. Transcript：Session 的审计记录，不等于 Session 或 Model Context

**明确事实。** Cowork Compliance API 将 Transcript 定义为某个 Session 的记录，包含 user prompts、assistant responses、tool calls、tool results；不含 thinking blocks 与 images。

来源：[Claude Compliance API — Retrieve a session transcript](https://platform.claude.com/docs/en/manage-claude/compliance-content-data#retrieve-a-session-transcript)（访问：2026-08-10）。

**明确事实。** Transcript endpoint 返回 session envelope 与分页 message data；pending session 没有 transcript。Message role 是 `user / assistant`，content block 包括 `text / tool_use / tool_result`。默认 oldest-first；官方要求保持 API 返回顺序，不要按可能相同或轻微倒序的 commit timestamp 重新排序。

来源：[Claude Compliance API — Retrieve a session transcript](https://platform.claude.com/docs/en/manage-claude/compliance-content-data#retrieve-a-session-transcript)（访问：2026-08-10）。

**明确事实。** Cowork OTel 还提供更细的关联：所有事件带 `session.id` 与 session 内单调递增的 `event.sequence`；一个用户 prompt 触发的所有模型 API calls 与 tools 共享 `prompt.id`。一个 prompt 可以产生多次 model API call 和多个 tool action。

来源：[Claude Cowork monitoring — Event correlation](https://claude.com/docs/cowork/monitoring#event-correlation)、[Standard attributes](https://claude.com/docs/cowork/monitoring#standard-attributes)（访问：2026-08-10）。

因此公开可见的执行层级是：

```text
Session
  └─ prompt.id episode
       ├─ model API call(s)
       ├─ tool call(s) / result(s)
       └─ ordered OTel events

Session
  └─ Transcript
       └─ ordered user/assistant messages + tool blocks
```

**设计推断。** `prompt.id episode` 是最接近通用 `Run/Turn` 的 Cowork 单元，但 Anthropic 没有把它公开命名为 Run。Transcript 是合规/审计投影；由于它明确排除 thinking/images，且官方没有公开 context compaction schema，不能声称它等于模型实际看到的 context。

### 6. Project、Workspace、Files 与 Artifact

**明确事实。** Cowork Project 是组织 related tasks 的 dedicated workspace，具有自己的 files/context/instructions/memory；instructions 作用于项目内所有 tasks，memory 从同 Project 的历史 task 学习且不跨 Project。

来源：[Organize your tasks with Projects in Claude Cowork](https://support.claude.com/en/articles/14116274-organize-your-tasks-with-projects-in-claude-cowork)（访问：2026-08-10）。

**明确事实。** `Workspace` 在官方资料中是重载词，而不是单一产品实体：Project 被称为 workspace；cloud session 有 temporary isolated sandbox；monitoring 中 `workspace.host_paths` 指 Desktop 选择的 host directories。

来源：[Cowork Projects](https://support.claude.com/en/articles/14116274-organize-your-tasks-with-projects-in-claude-cowork)、[Architecture overview](https://support.claude.com/en/articles/14479288-claude-cowork-architecture-overview)、[Monitoring attributes](https://claude.com/docs/cowork/monitoring#standard-attributes)（访问：2026-08-10）。

**明确事实。** Cowork 的输出也不是都属于 Transcript 附件：live artifact 是持久 interactive HTML resource，有自己的 Artifacts view、version history，可从未来 thread 更新；从 Artifacts view 新建时会开启 new session。

来源：[Use live artifacts in Claude Cowork](https://support.claude.com/en/articles/14729249-use-live-artifacts-in-claude-cowork)（访问：2026-08-10）。

**设计推断。** `Project`、`ExecutionSandbox`、`HostFolderBinding`、`AccountFileStore`、`Artifact` 应拆开；不要建立一个含义模糊的 Workspace 聚合所有这些职责。

### 7. Subagent

**明确事实。** Cowork 可把复杂工作拆成更小 task 并协调 parallel workstreams；Plugin 中的 Agent 被官方定义为 Claude 可委托的 specialized subagent。

来源：[Get started with Claude Cowork](https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork)、[Cowork plugins](https://claude.com/docs/cowork/guide/plugins)、[Plugins overview](https://claude.com/docs/plugins/overview#how-plugins-compose-capabilities)（访问：2026-08-10）。

**边界事实。** 公开 Cowork 文档没有说明 subagent 是否各自拥有顶层 Session、独立 Transcript、独立持久 ID；Compliance transcript schema 也没有暴露 subagent resource。

**设计推断。** 在接口真正公开或产品需要独立操控前，Cowork-style subagent 更适合被视为 parent Session/prompt episode 内的 child execution/workstream，而不是先验顶层实体。这与 Codex 将 subagent 明确实现为 child Thread 的选择不同，说明 subagent 归属也应是 Engine 的可替换策略。

## 三、横向比较

| 概念 | Codex | 普通 Cowork | Cowork Dispatch | 稳定设计含义 |
|---|---|---|---|---|
| Task | 本地核心协议无 Task；Cloud Task 是独立远程工作订单 | 描述 task 来启动 session，常近似 1:1 | persistent thread 中的一个委托，调度新 session | 端应用的 goal/order/definition |
| Session | 当前 live thread tree；root + child threads 共用 sessionId | 一次 cloud/local execution 与 sandbox 生命周期 | 每个 task 启动合适的 Code/Cowork session | 有边界的 invocation/runtime scope |
| Thread / Conversation | 持久 conversation；包含 turns，可 resume/fork | 普通文档多用 session 指可继续对象，未公开独立 Conversation schema | 明确是永不重置、跨多个 task 的 persistent thread | 用户交互与连续语义 |
| Turn / Run | Turn 是 user input 到完成/中断的完整 episode，含多个 Items | 未公开通用 Run；`prompt.id` 关联一次输入触发的 calls/tools | task 对应 session，但 session 内仍可有多个 prompt episode | Engine 的执行 episode |
| Message / Item | Message 是 Item 子集；tool、command、file、compaction 都是 Item | Transcript message 含 text/tool blocks | persistent thread message 与 worker session transcript 可分开 | 内容/事实原子，不等于完整 execution |
| Transcript | 无独立顶层资源；persisted Turn/Item history + rollout | Session 的合规审计记录 | worker Session transcript 与 dispatch conversation 分离 | 不可丢失的审计/回放投影 |
| Model Context | model-visible conversation，可 compaction；与 runtime trace 分离 | 未公开 compaction schema；不能由 transcript 反推 | 同左 | 每次 inference 的受预算 projection |
| Workspace | Thread/Turn 的 cwd、roots、environment、permissions | Project、sandbox、host paths 等多种含义 | worker session 的执行资源 | 拆成 Project/Binding/Sandbox/Capability |
| Subagent | child Thread，属于同一 session tree | delegated parallel workstream，公开持久模型不明 | worker session 可能继续委托 | 可选 child execution，不要绑死外部产品模型 |

## 四、对顶层领域设计的直接启示（设计推断）

### 1. 不要把 Task、Session、Thread 合并成同一个实体

至少需要允许以下三种端应用组合：

```text
A. Chat / 普通 Cowork
   Task 1 -> Session 1 -> Thread 1

B. Dispatch
   Persistent Thread 1
      -> Task A -> Session A
      -> Task B -> Session B

C. Scheduler / Codex Cloud best-of-N
   TaskDefinition / CloudTask
      -> Invocation / Attempt 1 -> Session/Execution 1
      -> Invocation / Attempt 2 -> Session/Execution 2
```

核心 Engine 若只支持 A，会很快被 Dispatch、schedule、best-of-N、subagent tree 打破。

### 2. Agent Engine 最稳定的内部轴是 Thread / Turn(Run) / Item(Message)

来自 Codex 的证据最完整：

```text
Thread
  └─ Turn / Run
       └─ Item
            ├─ Message
            ├─ ToolCall / ToolResult
            ├─ FileChange / Command
            ├─ Reasoning / Plan
            └─ ContextCompaction marker
```

但不必照抄 Codex 的 Session tree 语义。Engine 可以只要求一个执行作用域引用 Thread；端应用/Host 决定这个作用域是 Cowork Session、Codex live session tree、Cloud Task Attempt，还是本地一次 run。

### 3. 历史消息、当前模型上下文、Transcript 应分别命名

建议使用三个明确概念：

```text
Thread History
  无损持久事实：用户消息、Agent 消息、工具与关键执行 Item

Transcript
  面向 UI / compliance / export 的有序审计投影
  可以脱敏、分页、选择展示层级，但不能悄悄成为模型上下文

Context Snapshot / Context Frame
  某次 Run 实际送给模型的输入
  来自 History + summary/compaction + retained items + current inputs
```

`ContextFrame` 必须引用生成它的 Thread revision/history position 与 compaction provenance；压缩只替换后续模型使用的 projection，不删除 Transcript/History。

### 4. Session 应是 Host/端应用的 invocation scope

Session 适合拥有：

- owner / initiator
- start、pause、resume、archive、fail 生命周期
- environment / sandbox
- capability/permission snapshot
- resource leases、subscriber、transport connection
- root execution 与 child executions 的关联

Session 不应拥有唯一的业务消息事实源；它应引用 Thread/Run，Transcript 则由执行事件投影得到。

### 5. Task 应位于 Orchestration 层

Task 适合表达：

- 用户目标、schedule 或 dispatch order
- completion policy、retry、deadline、budget、best-of-N
- 选择 Agent/Engine/Session 类型
- 多次 invocation/attempt 与最终结果选择
- 将结果回写哪个 conversation/thread 或发布成哪个 artifact

Engine 只需要执行一个明确的 Run；不需要理解“这次执行是 Dispatch task、scheduled task，还是普通聊天”。

## 五、建议的中性概念关系

以下是研究归纳出的建议，不是对 Codex/Cowork 内部模型的宣称：

```text
ProjectScope?                         长期知识/配置/组织边界
   |
   +-- ConversationThread*            面向用户的连续交互
   |      |
   |      +-- Message / PresentedItem*
   |
   +-- TaskDefinition*                可选：目标、schedule、policy
          |
          +-- TaskInvocation*         一次触发/attempt
                 |
                 +-- ExecutionSession 资源与运行生命周期
                        |
                        +-- AgentThread 1..N
                        |      |
                        |      +-- Run/Turn*
                        |             |
                        |             +-- ExecutionItem*
                        |
                        +-- ExecutionSandbox
                        +-- CapabilitySnapshot
                        +-- RuntimeTrace
                        +-- TranscriptProjection

AgentThread History + Context Policy
   -> ContextFrame
   -> Model Call(s)

Output
   -> Conversation Message
   -> File
   -> Durable Artifact
   -> Task Result
```

其中：

- `ConversationThread` 与 `AgentThread` 可以在简单 Chat 产品中是同一对象，在 Dispatch 中则明确不是。
- `ExecutionSession` 与 `AgentThread` 可以在普通单 Agent 产品中是 1:1，在 Codex multi-agent 中是 1:N。
- `TaskInvocation` 与 `ExecutionSession` 常为 1:1，但 retry、resume、best-of-N 时必须允许 1:N 或 M:N 的显式关联。
- `TranscriptProjection` 属于 Session/Run 的审计视图；`ContextFrame` 属于某次模型调用的输入视图。

## 六、仍未由官方资料回答的问题

这些不能当作事实写进架构不变量：

- Cowork 普通 session 内部是否有稳定、独立的 conversation/thread id。
- Cowork subagent 是否拥有独立 session/transcript/id。
- Cowork 模型上下文压缩如何表示、是否持久保存每个 context snapshot。
- Codex App UI 中所有“task”是否总能一一映射到 app-server Thread；Cloud Task 已明确是另一套资源。
- Codex live Session tree 在进程重启、resume、fork、跨设备场景下的全部 identity 保证。
- 两个产品的 UI Transcript 是否完整等于其 compliance/export/protocol history。

顶层设计应让这些成为 adapter policy 或可演进字段，而不是核心对象的不变量。

## 主要官方来源

以下均访问于 2026-08-10：

### OpenAI

- [Codex app-server README](https://github.com/openai/codex/blob/1c042dd4d823b451ae44029abaf0e13b7cef8904/codex-rs/app-server/README.md)
- [Codex app-server protocol: Thread / Turn](https://github.com/openai/codex/blob/1c042dd4d823b451ae44029abaf0e13b7cef8904/codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs)
- [Codex app-server protocol: Item](https://github.com/openai/codex/blob/1c042dd4d823b451ae44029abaf0e13b7cef8904/codex-rs/app-server-protocol/src/protocol/v2/item.rs)
- [Codex Rollout Trace](https://github.com/openai/codex/blob/1c042dd4d823b451ae44029abaf0e13b7cef8904/codex-rs/rollout-trace/README.md)
- [Codex Cloud Tasks client types](https://github.com/openai/codex/blob/1c042dd4d823b451ae44029abaf0e13b7cef8904/codex-rs/cloud-tasks-client/src/api.rs)
- [Codex TypeScript SDK](https://github.com/openai/codex/blob/1c042dd4d823b451ae44029abaf0e13b7cef8904/sdk/typescript/README.md)

### Anthropic

- [Get started with Claude Cowork](https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork)
- [Assign tasks from anywhere in Claude Cowork / Dispatch](https://support.claude.com/en/articles/13947068-assign-tasks-from-anywhere-in-claude-cowork)
- [Schedule recurring tasks](https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork)
- [Claude Cowork architecture overview](https://support.claude.com/en/articles/14479288-claude-cowork-architecture-overview)
- [Use Cowork on web, desktop, and mobile](https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile)
- [Organize tasks with Projects](https://support.claude.com/en/articles/14116274-organize-your-tasks-with-projects-in-claude-cowork)
- [Use live artifacts](https://support.claude.com/en/articles/14729249-use-live-artifacts-in-claude-cowork)
- [Claude Compliance content data](https://platform.claude.com/docs/en/manage-claude/compliance-content-data)
- [Cowork monitoring](https://claude.com/docs/cowork/monitoring)
- [Cowork overview](https://claude.com/docs/cowork/overview)
- [Cowork plugins](https://claude.com/docs/cowork/guide/plugins)
