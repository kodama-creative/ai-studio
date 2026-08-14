# ACP Session 协议、恢复语义与单步调试边界

> 调研日期：2026-08-14
> 调研对象：官方 ACP 规范与 `@agentclientprotocol/sdk@1.3.0`
> 上游对应提交：[`fa32570`（tag `v1.3.0`）](https://github.com/agentclientprotocol/typescript-sdk/tree/fa32570936b42bf4f3aef175c6e926860914b638)
> 方法：只核对 ACP 官方文档、官方 RFD、官方 TypeScript SDK 源码、GitHub release 与 npm metadata。本文不修改产品代码。

## 结论

1. **产品决策是精确锁定 `@agentclientprotocol/sdk@1.3.0` 并使用 `experimental/v2`。** npm `latest` 是 `1.3.0`，发布于 2026-07-21；v2 只能从 `@agentclientprotocol/sdk/experimental/v2` 导入，官方明确标记为 Draft，wire protocol 和 TypeScript API 都可能不兼容地变化。该风险由独立的 `@llm-space/acp` boundary 承担，不要求同时保留 v1。[npm metadata](https://registry.npmjs.org/@agentclientprotocol/sdk/1.3.0) · [v1.3.0 release](https://github.com/agentclientprotocol/typescript-sdk/releases/tag/v1.3.0) · [package exports](https://github.com/agentclientprotocol/typescript-sdk/blob/fa32570936b42bf4f3aef175c6e926860914b638/package.json#L1-L60) · [v2 warning](https://github.com/agentclientprotocol/typescript-sdk/blob/fa32570936b42bf4f3aef175c6e926860914b638/README.md#L17-L32)
2. **ACP v1 没有 durable update cursor、断线补发或 resubscribe。** `session/load` 从头 replay 整段会话，`session/resume` 明确不 replay；官方实验 HTTP/WS client 也明确说明断线期间的 in-flight transport messages 不会补发。[Session Setup](https://agentclientprotocol.com/protocol/v1/session-setup) · [HTTP reconnect contract](https://github.com/agentclientprotocol/typescript-sdk/blob/fa32570936b42bf4f3aef175c6e926860914b638/src/http-stream.ts#L44-L61)
3. **ACP 没有标准单步、暂停或继续方法。** v1 的执行入口 `session/prompt` 代表完整 turn，直到结束才返回 `stopReason`；`session/cancel` 是取消，不是暂停。Session mode/config 只是 Agent 自定义选择器，没有标准 execution-control 语义。[Prompt Turn](https://agentclientprotocol.com/protocol/v1/prompt-turn) · [Session Modes](https://agentclientprotocol.com/protocol/v1/session-modes) · [Session Config Options](https://agentclientprotocol.com/protocol/v1/session-config-options)
4. **Studio 单步必须是协商过的 ACP 扩展，Pi Session 仍是 durability authority。** 建议用 `_llm-space.dev/...` JSON-RPC method，并在 `agentCapabilities._meta["llm-space.dev"]` 广告能力；标准 ACP client 只走自动的完整 `session/prompt`。不能把 permission request、mode 或 `end_turn` 冒充 debugger pause。
5. **ACP adapter 必须从 Pi durable log/snapshot 重建投影。** ACP notification 只用于传输和显示，不应持久化为另一份 transcript，也不能作为 crash recovery 游标。

## 1. 官方 TypeScript SDK

使用：

```text
@agentclientprotocol/sdk@1.3.0
```

SDK 是 ESM，peer dependency 为 `zod ^3.25.0 || ^4.0.0`。稳定 schema 也由包导出为 `@agentclientprotocol/sdk/schema/schema.json`。官方推荐的新 API 是：Agent 用 `agent({ name })` 注册 `initialize`、`newSession`、`prompt` 等 handler 后连接 stream；Client 用 `client({ name })` 注册 `requestPermission`、`sessionUpdate` 等 handler。[package.json](https://github.com/agentclientprotocol/typescript-sdk/blob/fa32570936b42bf4f3aef175c6e926860914b638/package.json#L25-L103) · [official README](https://github.com/agentclientprotocol/typescript-sdk/blob/fa32570936b42bf4f3aef175c6e926860914b638/README.md#L34-L62)

实现含义：

- `@llm-space/acp` 应直接依赖并 re-use SDK schema/types，不复制一套 ACP DTO。
- `zod` 是该 package 的直接 runtime peer，应由 workspace catalog 精确管理，不能依赖偶然的 transitive installation。
- Phase 3–5 只从独立 `@llm-space/acp` package 导入 `experimental/v2`；其他 package 不直接依赖 Draft schema。

## 2. Transport 模型

ACP 使用 JSON-RPC 2.0。稳定的标准 transport 是 stdio：Client 启动 Agent 子进程，双方交换 UTF-8、单行、换行分隔的 JSON-RPC message；Agent 的 stdout 只能写 ACP，日志写 stderr。官方 SDK 的 `Stream` 是一对 `ReadableStream`/`WritableStream`，`ndJsonStream()` 负责 NDJSON 编解码。[Transports](https://agentclientprotocol.com/protocol/v1/transports) · [SDK Stream](https://github.com/agentclientprotocol/typescript-sdk/blob/fa32570936b42bf4f3aef175c6e926860914b638/src/stream.ts#L5-L43)

规范允许 custom transport，只要保留 JSON-RPC message 和 ACP lifecycle；Streamable HTTP 仍在 draft。SDK 1.3.0 虽导出 experimental HTTP、WebSocket 和 server entrypoint，但它们不是稳定 transport contract。[Transports](https://agentclientprotocol.com/protocol/v1/transports) · [experimental exports](https://github.com/agentclientprotocol/typescript-sdk/blob/fa32570936b42bf4f3aef175c6e926860914b638/package.json#L39-L57)

对 LLM Space 的含义：

- `llm-space acp` 应提供标准 stdio endpoint；SSH remote 可直接通过 `ssh <host> llm-space acp` 搬运该字节流。
- Desktop 可把相同 JSON-RPC message 放进 Electrobun 现有 namespaced envelope；这是允许的 custom transport，但不能宣称是 ACP 标准网络 transport。
- 现在不应把实验 HTTP/WS server 作为 remote runtime 的必要条件。

## 3. Session lifecycle

### `session/new`

初始化完成后，Client 发送绝对 `cwd`、`mcpServers`，以及 capability 支持时的 `additionalDirectories`。Agent 创建会话并返回唯一 `sessionId`，还可以返回初始 mode/config options。[Session Setup](https://agentclientprotocol.com/protocol/v1/session-setup) · [SDK request/response types](https://github.com/agentclientprotocol/typescript-sdk/blob/fa32570936b42bf4f3aef175c6e926860914b638/src/schema/types.gen.ts#L2764-L2806)

### `session/load`

只有 Agent 广告 `agentCapabilities.loadSession: true` 时可调用。Agent 恢复 session context，然后在原 request 返回之前，用 `session/update` **从头 replay 整段 conversation**；全部 replay 完才响应。Client 可以继续 prompt。[Session Setup — Loading Sessions](https://agentclientprotocol.com/protocol/v1/session-setup#loading-sessions) · [SDK load type](https://github.com/agentclientprotocol/typescript-sdk/blob/fa32570936b42bf4f3aef175c6e926860914b638/src/schema/types.gen.ts#L5193-L5232)

### `session/resume`

只有 Agent 广告 `sessionCapabilities.resume` 时可调用。它恢复同一 session，但在返回前 **MUST NOT** replay 旧 history；response 只可携带初始 mode/config state。它适合 Client 已保存 UI 状态的 reconnect，不是断线补发 API。[Session Setup — Resuming Sessions](https://agentclientprotocol.com/protocol/v1/session-setup#resuming-sessions) · [SDK resume type](https://github.com/agentclientprotocol/typescript-sdk/blob/fa32570936b42bf4f3aef175c6e926860914b638/src/schema/types.gen.ts#L5329-L5369)

不要混淆 `session/list` 的 `cursor`：它只分页列举 session，与 `session/update` replay 无关。[Session List](https://agentclientprotocol.com/protocol/v1/session-list) · [list cursor type](https://github.com/agentclientprotocol/typescript-sdk/blob/fa32570936b42bf4f3aef175c6e926860914b638/src/schema/types.gen.ts#L5234-L5258)

## 4. v1 `session/update` 与 prompt completion

外层通知是：

```ts
type SessionNotification = {
  sessionId: string;
  update: SessionUpdate;
  _meta?: Record<string, unknown> | null;
};
```

稳定 SDK 1.3.0 的 `SessionUpdate` discriminant 是 `sessionUpdate`，主要变体为：

- `user_message_chunk`、`agent_message_chunk`、`agent_thought_chunk`：单个 `ContentBlock`，可带 `messageId`；同一 message 的 chunk 按到达顺序 append。
- `tool_call`：第一次报告，核心字段是 `toolCallId`、required `title`，可带 `kind`、`status`、content、locations、raw input/output。
- `tool_call_update`：`toolCallId` required，其余字段为 patch；标准 status 是 `pending | in_progress | completed | failed`。
- plan、available commands、current mode、config options、session info、usage 等展示更新。

精确 union 见官方生成类型：[SessionNotification/SessionUpdate](https://github.com/agentclientprotocol/typescript-sdk/blob/fa32570936b42bf4f3aef175c6e926860914b638/src/schema/types.gen.ts#L3680-L3751)；tool shape 见 [ToolCall](https://github.com/agentclientprotocol/typescript-sdk/blob/fa32570936b42bf4f3aef175c6e926860914b638/src/schema/types.gen.ts#L3785-L3850) 与 [Tool Calls docs](https://agentclientprotocol.com/protocol/v1/tool-calls)。

v1 的 `session/prompt` 是完整 turn request。Agent 可在 request pending 时发 updates，但最终必须返回 `PromptResponse { stopReason }`；标准 stop reason 是 `end_turn | max_tokens | max_turn_requests | refusal | cancelled`。v1 没有 `paused`、`suspended`、`state_update` 或 operation/step id。[Prompt Turn](https://agentclientprotocol.com/protocol/v1/prompt-turn) · [PromptResponse](https://github.com/agentclientprotocol/typescript-sdk/blob/fa32570936b42bf4f3aef175c6e926860914b638/src/schema/types.gen.ts#L3232-L3271)

## 5. Tool calls 与 permission request

Tool execution 仍由 Agent 拥有；ACP 只让 Agent 报告状态，并在需要时向 Client 发反向 JSON-RPC request：

```ts
type RequestPermissionRequest = {
  sessionId: string;
  toolCall: ToolCallUpdate;
  options: PermissionOption[];
};

type RequestPermissionOutcome =
  { outcome: "selected"; optionId: string } | { outcome: "cancelled" };
```

Option 的标准 UI hint 是 `allow_once`、`allow_always`、`reject_once`、`reject_always`。Client 可以依据策略自动选择；prompt cancel 时必须用 `cancelled` 回答 pending permission request。[Tool Calls — Requesting Permission](https://agentclientprotocol.com/protocol/v1/tool-calls#requesting-permission) · [SDK permission request](https://github.com/agentclientprotocol/typescript-sdk/blob/fa32570936b42bf4f3aef175c6e926860914b638/src/schema/types.gen.ts#L126-L223) · [permission response](https://github.com/agentclientprotocol/typescript-sdk/blob/fa32570936b42bf4f3aef175c6e926860914b638/src/schema/types.gen.ts#L5974-L6008)

Permission 是 allow/reject 决策，不是 debugger gate，也没有 durable replay。实现时可以在 Pi tool effect 前投影 `pending` + request permission，但 Pi Runtime 必须自己持久化可恢复状态；断线后只能从 Pi state 重新判断是否仍需询问，不能 replay 一个旧 JSON-RPC request。

## 6. 没有 durable cursor，也没有标准单步

### Stable v1

- 无 update sequence/cursor/ack。
- `session/load` 只有全量 replay；`session/resume` 不 replay。
- transport disconnect 会丢失断线期间的 notification。
- 无 `session/step`、`session/continue`、`pause`、`resume operation` 或 debug mode 语义。
- `session/cancel` 终止模型和工具 effect，最终语义是 `cancelled`，不能当 pause。

因此，ACP v1 client 重新 attach 时必须执行以下二选一：

1. 丢弃 UI projection，调用 `session/load` 从 Pi Session 全量重建；或
2. UI 已持久化完整 projection 时调用 `session/resume`，接受 gap 无法自动补齐的限制。

Studio 应选择第一种正确性模型；数据规模优化应在 Pi snapshot/projector 内做，不能发明为 ACP 标准 cursor。

### Draft v2

v2 把 load/resume 合成 `session/resume(replayFrom?)`，但当前唯一标准 cursor 是 inclusive `{ type: "start" }`，仍然只是全量 replay；message/checkpoint/server-provided cursor 仅是 RFD 描述的 future possibility。[v2 Resume Replay RFD](https://agentclientprotocol.com/rfds/v2/session-resume-replay) · [draft generated type](https://github.com/agentclientprotocol/typescript-sdk/blob/fa32570936b42bf4f3aef175c6e926860914b638/src/v2/schema/types.gen.ts#L5480-L5575)

v2 的 prompt 变成“接受即返回”，工作状态通过 `state_update: running | requires_action | idle` 通知，并统一了 message/tool upsert/chunk。这比 v1 更适合长期后台工作，但仍没有标准 `paused` 或 `step`，而且官方要求 Draft 不能默认用于生产。[v2 announcement](https://agentclientprotocol.com/announcements/acp-v2-draft) · [v2 Prompt Lifecycle](https://agentclientprotocol.com/protocol/v2/prompt-lifecycle)

## 7. Extension 规则

ACP 类型都提供 `_meta?: Record<string, unknown>`。实现不得给规范类型随意增加 root field；自定义数据必须进入 `_meta`。`traceparent`、`tracestate`、`baggage` 应保留给 W3C trace context。[Extensibility](https://agentclientprotocol.com/protocol/v1/extensibility) · [Meta Propagation RFD](https://agentclientprotocol.com/rfds/meta-propagation)

自定义 request/notification method 必须以 `_` 开头；不认识的 request 返回 JSON-RPC `-32601`，不认识的 notification 应忽略。扩展能力应在 capability object 的 `_meta` 中广告。[Extensibility — Extension Methods](https://agentclientprotocol.com/protocol/v1/extensibility#extension-methods)

建议 LLM Space 采用一个域名命名空间对象：

```json
{
  "agentCapabilities": {
    "_meta": {
      "llm-space.dev": {
        "durableDebug": {
          "version": 1,
          "methods": [
            "_llm-space.dev/session/step",
            "_llm-space.dev/session/continue"
          ]
        }
      }
    }
  }
}
```

精确 method payload 应引用 Pi 的 `sessionId`、lane、operation/entry identity，并带 caller-generated idempotency command id；它们不应塞进标准 `session/prompt` 或伪装成 mode semantics。

ACP application 只在请求进行期间按 `(sessionId, commandId)` 合并并发重试，settle 后立即释放，不缓存完整 transcript。跨进程的 lost-response retry 由 host backend 负责：Step 使用稳定 `expectedActionId` 与 Pi 已提交的 attempt/result identity 对账并重建当前 snapshot；Continue 的 `commandId` receipt 由 host-owned metadata 与 Pi Session 放在同一物理数据库中。ACP payload 不进入 Pi log，也不形成第二套 runtime event/session 状态。

## 8. 对 Phase 3–5 的实施约束

1. 新建 transport-neutral `@llm-space/acp`，依赖官方 SDK experimental v2；Pi Runtime 不依赖 ACP。
2. projector 只从已 durable commit 的 Pi entries/records 发 ACP updates；流式临时 chunk 可以发，但 reconnect 必须以 Pi snapshot 为准。
3. 标准 v2 session lifecycle 保持官方语义。单步/继续与增量 durable sequence 通过 capability-negotiated `_llm-space.dev/...` 扩展实现。
4. Desktop 使用 Electrobun custom transport；CLI `llm-space acp` 使用官方 stdio NDJSON；SSH 复用 stdio，不引入实验 HTTP/WS。
5. 不存 ACP payload，不维护第二套 Session/Run/Checkpoint；messageId/toolCallId 从稳定 Pi identity 确定性派生，保证全量 replay 可重复折叠。
6. Draft API 变化只修改 `@llm-space/acp` 的官方类型适配和契约测试；单步仍是显式扩展，不能伪装成标准 v2 capability。
