# Vercel Eve HTTP Channel、业务身份与 Session 集成研究

日期：2026-08-09  
上游快照：[`vercel/eve@f835ad57409ddf33cd21c52947ec27e8c7024bb7`](https://github.com/vercel/eve/tree/f835ad57409ddf33cd21c52947ec27e8c7024bb7)（Eve 0.31.3）

## 结论

Eve 没有把 HTTP Channel 做成一个独立 package。作者 API、Channel 执行语义、Nitro HTTP Host 和 Workflow Runtime 都在同一个 `packages/eve` 内，但分成了四层目录：

1. `src/public/definitions` 与 `src/channel`：`defineChannel`、HTTP route descriptor、`from`、`resolveSession`、`attachSession` 等公共契约和实现；
2. `src/compiler` / `src/runtime`：将作者定义编译成 manifest，再恢复为可执行 handler；
3. `src/internal/nitro/host` / `src/internal/nitro/routes`：注册 Nitro route、构造每请求上下文并调用 handler；
4. `src/execution`：Workflow-backed Runtime，真正创建、恢复和驱动 durable session。

它不是强制绑定 Vercel 平台：官方支持 `eve build && eve start` 自托管 Node/Nitro 服务，也允许自选 Workflow world 和 sandbox backend。Vercel Workflow、Sandbox、Cron、OIDC 和 Connect 是官方深度集成的部署与身份能力，但不是 `defineChannel` 的必需条件。[自托管文档](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/docs/guides/deployment/self-hosting.md#L6-L53)明确给出了非 Vercel Host、存储和 sandbox 的替代方案；[Vercel 部署文档](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/docs/guides/deployment/vercel.mdx#L50-L65)则描述了托管时才启用的 Vercel 服务组合。

业务身份与 Session identity 是三件不同的事：

- `SessionAuthContext`：经过验证的业务调用者身份，包含 `principalId`、`principalType`、`issuer`、`subject` 和字符串 attributes；
- channel address / continuation token：业务或平台会话地址，例如 thread id；它被 `from(address)` 和 `resolveSession(address)` 使用；
- runtime session id：Harness/Runtime 生成的 opaque durable id，由 `attachSession(sessionId)` 固定寻址。

Eve 不会把 `resolveSession` 或 `attachSession` 当作鉴权。官方文档明确说明 route auth 不负责 session ownership，也没有第二层 per-session ACL；多用户、多租户业务必须自己在 HTTP 边界实现 ownership authorization。[来源](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/docs/guides/auth-and-route-protection.md#L244-L255)

因此，对 LLM Space 最值得复用的不是 Eve 当前的 package 边界，而是它对三类 identity 的区分；同时应补上 Eve 留给应用层的 session ownership seam。

## 本地与上游版本确认

本仓库没有安装或 vendored Eve 源码；搜索只发现兼容实现和 NOTICE。`packages/agent/NOTICE` 标明实现派生自 Eve 0.31.3、commit `f835ad5…`，并已修改 package layout、Bun loader 和 manifest 格式。[本地来源](../../packages/agent/NOTICE)

研究时通过官方仓库确认：远端 HEAD 仍为同一个 `f835ad5…` commit。因此下面的文件路径和行号同时对应本项目复刻所依据的版本与当前官方源码。

## HTTP Channel 在 Eve 中放在哪里

### 1. 作者定义层

`defineChannel()` 在 `packages/eve/src/public/definitions/channel.ts`。它只把作者提供的 `routes`、adapter state/context/events、CORS 和 `receive` 组合成 opaque `CompiledChannel`，不监听端口，也不自动鉴权。[源码](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/public/definitions/channel.ts#L213-L284)

`GET` / `POST` / `PUT` / `PATCH` / `DELETE` 只是 `{ transport, method, path, handler }` descriptor factory；route handler 的第二个参数包含 `from`、`resolveSession`、`attachSession`、`to`、`params`、`waitUntil` 和 `requestIp`。[源码](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/channel/routes.ts#L12-L59) [route factories](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/channel/routes.ts#L145-L230)

### 2. 编译与加载层

Compiler 从 `agent/channels/<name>.ts` 的路径推导 channel name，并把定义里的每个 route 展开成 manifest 中独立的 `{ name, method, urlPath, sourceId, exportName, cors }` entry。[源码](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/compiler/normalize-channel.ts#L11-L62)

Runtime 随后重新加载 authored module，用 `(method, urlPath)` 找到 live handler，并生成 `ResolvedChannelDefinition`。[源码](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/runtime/resolve-channel.ts#L19-L88)

### 3. HTTP Host 层

Nitro Host 合并 framework routes 与 authored routes，以 `(method, route)` 去重，并为每个 route 注册一个 virtual Nitro handler；CORS preflight 也在这里处理。[源码](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/internal/nitro/host/channel-routes.ts#L32-L105) [handler registration](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/internal/nitro/host/channel-routes.ts#L109-L176)

请求到达后，`dispatchChannelRequest()`：

1. 加载 resolved channels 和 Workflow Runtime；
2. 根据 route key 找到 channel；
3. 构造 `RouteHandlerArgs`；
4. 调用 authored handler；
5. 将 handler 注册的 background promises 交给 Nitro `event.waitUntil()`。

对应实现见 [`channel-dispatch.ts`](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/internal/nitro/routes/channel-dispatch.ts#L28-L113)。`buildRouteArgs()` 注入 channel operations、fixed-session factory、cross-channel sender、decoded params、IP 和 waitUntil；其 `createSession` 闭包会把 adapter、channel name、Vercel request id 一并交给 Runtime。[源码](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/internal/nitro/routes/channel-dispatch.ts#L181-L232)

每个请求都会创建一个轻量 `WorkflowRuntime` facade；durable state 在 workflow execution 中，不在 HTTP dispatcher singleton 中。[源码](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/internal/nitro/routes/runtime-stack.ts#L10-L44)

## Eve 是否与 Vercel 平台绑定

结论是“部署能力深度集成，但 Channel 语义不要求 Vercel”。证据如下：

- 自托管路径运行 Eve 自己生成的 Nitro Node 服务，可以使用本地或自定义 Workflow world、Docker/microsandbox/custom sandbox backend。[官方自托管指南](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/docs/guides/deployment/self-hosting.md#L6-L53)
- Vercel 托管路径额外自动配置 Web Runtime、Vercel Workflow、Cron 和 Sandbox。[官方部署指南](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/docs/guides/deployment/vercel.mdx#L50-L65)
- `vercelOidc()` 只是一个可选 `AuthFn`。官方明确说已有用户/session/API key/IdP 的应用可以完全替换它；非 Vercel host 甚至建议省略它。[官方 auth 指南](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/docs/guides/auth-and-route-protection.md#L26-L70)
- Nitro dispatcher 唯一隐式 Vercel 逻辑是 development 模式下补充当前项目 OIDC resolver；production 分支直接调用 handler。[源码](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/internal/nitro/routes/channel-dispatch.ts#L158-L179)

不过，它并不是一个通用的嵌入式 `fetch()` library：官方标准执行面是由 Eve 编译器生成并由 Nitro host 启动的独立服务。Next/SvelteKit/Nuxt 集成主要通过 proxy/rewrite 或 Vercel sibling service 把 `/eve/v1/*` 接进现有 Web app，而不是把业务服务器对象直接传给 Harness。这一点与 LLM Space 目前希望保留 Host 可替换性的目标不同。

## 业务身份和 user id 如何进入 Agent

### 1. HTTP 边界把业务 session 转成 `SessionAuthContext`

公共身份结构定义为：

```ts
interface SessionAuthContext {
  attributes: Record<string, string | readonly string[]>;
  authenticator: string;
  issuer?: string;
  principalId: string;
  principalType: string;
  subject?: string;
}
```

[源码](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/channel/types.ts#L92-L106)

`AuthFn<Request>` 直接接收标准 `Request`。`routeAuth()` 顺序执行 auth functions：首个返回 principal 的函数成功，`null`/`undefined` 继续，全部跳过则返回 401。[源码](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/public/channels/auth.ts#L485-L498) [`routeAuth`](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/public/channels/auth.ts#L572-L614)

官方的业务集成示例是在 `AuthFn` 内调用应用自己的 `getSession(request)`，然后映射：

- `principalId = session.userId`；
- `principalType = "user"`；
- `attributes` 放 team/tenant/role 等经过服务端验证的业务 claims；
- 多 IdP 时设置稳定 `issuer`。

[官方示例](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/docs/guides/auth-and-route-protection.md#L47-L70) [多租户示例](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/docs/patterns/multi-tenant-auth.md#L38-L81)

官方强调 tenant membership 和 credential storage 仍由业务应用负责；tenant/user 必须来自已验证 route auth，不能来自 prompt、tool arguments 或未验证 request body。[来源](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/docs/patterns/multi-tenant-auth.md#L6-L36)

内置平台 channel 也做同样的映射。例如 Slack 将 workspace/user 组合成稳定 `principalId`，原始 Slack user id、team id、channel/thread 放 attributes，并按 human/bot 设置 `principalType`。[源码](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/public/channels/slack/auth.ts#L20-L50)

### 2. 默认 `eveChannel` 把 route auth 结果显式传给 Runtime

`eveChannel()` 本身也是 `defineChannel()` 的高层 wrapper，为 `/eve/v1/session`、follow-up、control 和 stream routes 逐个调用 `routeAuth()`。[源码](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/public/channels/eve.ts#L193-L225)

新建 session 的调用链是：

```text
Request
  -> routeAuth(request, authoredPolicy)
  -> optional trusted forwarded principal
  -> onMessage({ eve: { caller, request } }, message)
  -> createSession({ auth, initiatorAuth, input, mode })
  -> Runtime.createSession(RunInput)
```

关键实现是 [`eve.ts` L223-L292](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/public/channels/eve.ts#L223-L292)。默认 `onMessage` 原样返回 route-auth caller；应用可在这个 hook 添加 context 或改写 dispatch auth。[源码](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/public/channels/eve.ts#L566-L604)

已有 session 的 follow-up 调用链是：

```text
Request /session/:sessionId
  -> routeAuth(request, authoredPolicy)
  -> attachSession(sessionId)       // 仅创建 fixed-id handle
  -> session.send(message, { auth: currentCaller })
  -> Runtime.dispatchSession({ sessionId, command: { auth, ... } })
```

对应实现见 [`eve.ts` L295-L365](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/public/channels/eve.ts#L295-L365) 和 [`session.ts` L77-L125](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/channel/session.ts#L77-L125)。

### 3. Runtime 内区分 current caller 与 initiator

Session 创建时，`buildRunContext()` 把 `run.auth` 写入 `AuthKey`，把 `run.initiatorAuth ?? run.auth` 写入 `InitiatorAuthKey`。[源码](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/execution/runtime-context.ts#L21-L50)

Follow-up delivery 可以携带不同 caller；Workflow step 会更新 `AuthKey`，但不改 `InitiatorAuthKey`。[类型契约](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/channel/types.ts#L433-L446) [更新实现](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/execution/workflow-steps.ts#L226-L230)

因此 authored tools/hooks/channel events 看到：

- `ctx.session.auth.current`：当前 turn 的调用者；
- `ctx.session.auth.initiator`：创建 durable session 的调用者。

这两个 seed keys 是可序列化的 durable context，而 `ctx.session` 是每 step 派生的 authored projection。[源码](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/context/keys.ts#L35-L68) [公开 callback context](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/public/definitions/callback-context.ts#L7-L24)

## `from`、`resolveSession`、`attachSession` 的真实语义

### Channel address 不是 user id

`from(address)` 返回一个动态 handle：每次操作寻找“当前拥有该 address 的 session”。`resolveSession(address)` 只是把这个动态 ownership 快照成一个 fixed session handle。[接口](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/channel/channel-operations.ts#L47-L75)

内部会将 address 变成 `${channelName}:${address}`，先尝试 `dispatchContinuation`；无 owner 时只有 `send` 可以创建新 session，并把调用者显式提供的 `options.auth` 放进 `RunInput.auth`。[实现](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/channel/channel-address.ts#L62-L137)

因此业务 channel 应从已验证的平台 conversation identity 生成 address。它可以包含 tenant/workspace/thread 维度，但不应该把未经验证的 user id 当 ownership proof。

### `attachSession` 既不查询也不授权

`attachSession(sessionId)` 只是 `createSession(sessionId, runtime)`；源码明确称它为 I/O-free factory。真正 I/O 在随后 `send`、`getEventStream`、`reset` 等操作发生。[实现](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/channel/session.ts#L22-L45) [`createAttachSessionFn`](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/channel/session.ts#L154-L160)

这解释了 Eve 默认 route 的安全责任：它只确认“请求者通过 route auth”，不会确认“请求者拥有 URL 中的 session id”。官方明确要求应用自行实现 per-user/per-tenant/per-session authorization。[官方安全说明](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/docs/guides/auth-and-route-protection.md#L244-L255)

## 与已有业务服务不在同一进程时

Eve 提供 forwarded principal 机制用于 agent-to-agent/服务间身份转发，但它不是无条件信任 body：

1. 接收方先通过 route auth 验证 transport caller/forwarder；
2. `trustedForwarders` 只判断“谁有权断言”；
3. 通过后才接受 body 中的 `current`/`initiator` principal metadata；
4. 接收方覆盖 `eve:forwarded-by` audit attribute；
5. 不转发 token 或 credential。

该机制默认拒绝，没有 `trustedForwarders` 或 predicate 拒绝时返回 403。[源码](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/channel/forwarded-principal.ts#L8-L32) [gate implementation](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/channel/forwarded-principal.ts#L87-L140)

对普通业务 Web app，更直接的官方模式仍是在同源 HTTP route 中验证 cookie/session/JWT 后生成 principal；只有跨受信服务边界时才转发 principal metadata。

## 对 LLM Space 设计的启示

以下是基于上游事实的设计建议，不是 Eve 现有 API 描述。

### 1. 保持三类 identity 独立

建议明确建模：

```ts
interface Principal {
  id: string;
  type: "user" | "service" | "anonymous" | string;
  issuer?: string;
  subject?: string;
  attributes: Readonly<Record<string, string | readonly string[]>>;
}

interface ChannelAddress {
  channelId: string;
  address: string;
}

type SessionId = string;
```

不要让 `userId` 同时承担 channel thread key、session id 和 authorization proof。

### 2. 业务鉴权 seam 应由 Host 注入，verified principal 由 Harness 承载

- Cookie、JWT、业务 session SDK、API gateway headers 属于业务 Host/composition root；
- HTTP Channel executor 只消费 Host 验证后的 `Principal`；
- Harness 要把 `current` / `initiator` principal 放入 session context，使 tool、dynamic capability、storage policy 能读取；
- `packages/harness-pi` 不应知道 HTTP、cookie、tenant 或 user id。

这比把 `getCurrentUser()` 或 Vercel OIDC 写进 `packages/harness` 更容易接入 desktop playground、独立 server 和现有业务后端。

### 3. 不应直接复制 Eve 的 session ownership 缺口

建议在 HTTP Channel Host 与 Harness 之间提供显式 authorizer，例如：

```ts
interface SessionAccessPolicy {
  authorize(input: {
    action: "read" | "send" | "cancel" | "reset";
    principal: Principal;
    sessionId: string;
  }): Promise<boolean>;
}
```

Session repository 需要保存可查询的 owner/tenant scope，或者由业务系统维护 `(businessConversation, principal/tenant) -> sessionId` 映射。`attachSession()` 仍可保持底层 I/O-free，但不能直接作为公开 HTTP authorization API。

### 4. 本地 tracer bullet 可以分两步

第一步可以用 `anonymous/local-dev` principal 跑通 HTTP 与 event stream，但 API 仍应要求显式 principal resolver，避免以后改变 Harness 方法签名。第二步再用 example Host 的 header/cookie mock 验证：

- 同一 tenant/user 可继续 session；
- follow-up 更新 `current`，不更新 `initiator`；
- 不同 tenant 无法 attach/stream/send；
- channel address 在 tenant 维度隔离；
- 跨服务 forwarded principal 必须经过 trusted-forwarder 校验。

## 一句话回答原问题

Eve 把 HTTP Channel 执行放在 `packages/eve` 内部的 compiler + Nitro host + channel dispatcher，而不是 Vercel 平台专属包；Vercel 是可选的部署/auth/credential backend。业务 user id 由业务自己的 `AuthFn(Request)` 验证后写入 `SessionAuthContext.principalId`，tenant/role 写入 attributes，再由 Channel 显式传给 Runtime。`resolveSession` 解析的是 channel address，`attachSession` 绑定的是 runtime session id，两者都不是鉴权；已有业务集成必须在 HTTP 边界增加 session ownership/tenant authorization。
