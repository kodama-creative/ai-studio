# Eclipse Theia 的 Command 层放置

> 调研日期：2026-08-17
> 调研对象：Eclipse Theia 官方仓库 `master`，固定提交 [`713634f`](https://github.com/eclipse-theia/theia/tree/713634fd5885ff8abde8cfd50bc3493d535772a5)（2026-08-14）
> 资料范围：只使用 Eclipse Theia 官方源码；未修改 LLM Space 产品代码。

## 结论

Theia 的实际分层是：

```text
menu / keybinding / toolbar / command palette
  -> frontend CommandRegistry
      -> frontend CommandHandler
          -> browser-side feature service
              -> backend Server RPC proxy（需要 backend 能力时）
```

具体而言：

1. `CommandRegistry`、`CommandContribution`、`CommandService` 的声明虽然位于 `@theia/core` 的 `common/command.ts`，但真正的 `CommandRegistry` singleton 绑定在 **frontend application container**；`CommandService` 在 frontend 只是同一实例的接口别名。[契约与实现](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/common/command.ts#L143-L224) · [frontend bindings](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/browser/frontend-application-module.ts#L273-L278)
2. Core backend **没有第二个 `CommandRegistry`**。它在每条 frontend connection 的 child container 中，把 `CommandService` 绑定为 `/services/commands` 的 frontend RPC proxy。[backend binding](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/node/backend-application-module.ts#L67-L83) · [`bindFrontendService` 的 proxy 实现](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/node/messaging/connection-container-module.ts#L35-L94)
3. 普通 feature 需要 backend 能力时，典型做法不是注册 backend command handler，而是让 **frontend handler 调 browser-side service / remote server proxy**。Task 和 Workspace 都采用这条链路。
4. Menu、keybinding、toolbar 只持有 command id 与展示/触发信息；实际状态查询和执行仍回到 frontend `CommandRegistry`。
5. Theia 的 `CommandService.executeCommand<T>()` 会返回 `Promise<T | undefined>`，因此 “Command 必须没有业务返回值”不是 Theia 的硬规则。[`CommandService` contract](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/common/command.ts#L163-L186) · [`CommandRegistry.executeCommand`](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/common/command.ts#L335-L350)

## 三个类型分别在哪一层

### `CommandContribution`

`CommandContribution` 是 common 层声明的 extension point：一个同名 symbol/interface，接口只有 `registerCommands(commands: CommandRegistry)`。它描述“如何向 registry 注册”，本身不承担执行或 transport。[源码](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/common/command.ts#L143-L152)

实际业务实现通常位于 feature 的 `browser/` 目录，并由 frontend module 多绑定到 `CommandContribution`。例如 Task 的一个 `TaskFrontendContribution` 同时实现 Command、Menu、Keybinding 和 frontend lifecycle contributions，frontend module 用多个 `toService(...)` 将这些身份指向同一个 singleton。[Task contribution](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/task/src/browser/task-frontend-contribution.ts#L116-L167) · [Task frontend bindings](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/task/src/browser/task-frontend-module.ts#L48-L54)

### `CommandRegistry`

`CommandRegistry` 保存 command definitions 与 handlers，并实现 `CommandService`。它在启动时读取所有 `CommandContribution`，逐个调用 `registerCommands(this)`。[实现与启动](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/common/command.ts#L188-L224)

虽然类文件在 `common/`，实例的 runtime ownership 是 frontend：frontend module 将它 `toSelf().inSingletonScope()`，再将 `CommandService` alias 到它；`FrontendApplication` 直接注入 registry，并按 `commands -> keybindings -> menus` 的顺序启动三个 registry。[frontend bindings](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/browser/frontend-application-module.ts#L273-L288) · [frontend startup](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/browser/frontend-application.ts#L263-L302)

### `CommandService`

`CommandService` 是较窄的执行接口：`executeCommand` 加执行前后事件；它没有 command 注册、可见性、enablement 等 registry API。[接口](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/common/command.ts#L163-L186)

- 在 frontend，它是 `CommandRegistry` 的别名，因此调用落在本 frontend registry。[绑定](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/browser/frontend-application-module.ts#L273-L278)
- 在 backend，它是指向对应 frontend 的 per-connection RPC proxy；`bindFrontendService` 创建 `RpcProxyFactory`，监听指定 path，并把 proxy 绑定到 service identifier。[backend module](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/node/backend-application-module.ts#L67-L83) · [proxy binding](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/node/messaging/connection-container-module.ts#L73-L94)

所以准确表述不是“backend 也有 registry”，而是“backend 可以通过连接作用域的 `CommandService` proxy 请求 frontend 执行命令”。

## UI surface 如何消费 command

三个 surface 都不另建执行路径：

- **Menu**：menu action 保存 `commandId`。`ActionMenuNode` 用 frontend `CommandRegistry` 查询 `isVisible`、`isEnabled`、`isToggled`，点击时调用 `executeCommand(commandId, ...args)`。[`ActionMenuNode`](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/browser/menu/action-menu-node.ts#L37-L103)
- **Keybinding**：keybinding 保存 command id；匹配键盘事件后，`KeybindingRegistry` 检查 command 是否注册/active，然后调用同一个 registry 的 `executeCommand`。[执行路径](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/browser/keybinding.ts#L525-L557)
- **Toolbar**：toolbar item 同样保存 command id；点击处理器检查 enablement 后调用 frontend `CommandRegistry.executeCommand`，并可把当前 widget 作为参数传给 handler。[toolbar item](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/browser/shell/tab-bar-toolbar/tab-toolbar-item.tsx#L165-L210)

这说明 Theia 的 menu/keybinding/toolbar 是 command 的 frontend adapters，而不是各自直连 backend service。

## 官方 feature 例子

### 1. Task：frontend command -> browser TaskService -> backend TaskServer proxy

`TaskFrontendContribution.registerCommands` 在 frontend registry 注册 `task:run` 等 handlers；handler 调用注入的 `TaskService.run(...)`，菜单和快捷键也只引用这些 command ids。[handlers](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/task/src/browser/task-frontend-contribution.ts#L215-L328) · [menus](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/task/src/browser/task-frontend-contribution.ts#L330-L360) · [keybinding](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/task/src/browser/task-frontend-contribution.ts#L395-L401)

`TaskService` 是 browser-side orchestration service，注入 `TaskServer`；frontend module 将 `TaskServer` 绑定成 RPC proxy，真正运行任务时 `TaskService` 调 `taskServer.run(...)`。Backend module 暴露的是 `TaskServerImpl`，不是 command handler。[TaskService dependency](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/task/src/browser/task-service.ts#L99-L137) · [frontend proxy binding](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/task/src/browser/task-frontend-module.ts#L64-L68) · [remote call](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/task/src/browser/task-service.ts#L1006-L1021) · [backend server binding](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/task/src/node/task-backend-module.ts#L31-L47)

### 2. Workspace：frontend command -> browser WorkspaceService/UI services -> WorkspaceServer proxy

`WorkspaceFrontendContribution` 位于 `browser/`，注册 OPEN/CLOSE 等 commands、menus 与 keybindings；handlers 调 `doOpen()`、`closeWorkspace()` 等 frontend methods，这些 methods 协调 file dialog、file service、opener 与 `WorkspaceService`。[bindings and handlers](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/workspace/src/browser/workspace-frontend-contribution.ts#L65-L178) · [menu/keybinding registration](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/workspace/src/browser/workspace-frontend-contribution.ts#L180-L258) · [open orchestration](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/workspace/src/browser/workspace-frontend-contribution.ts#L260-L301)

`WorkspaceService` 在 browser 侧注入 `WorkspaceServer`；frontend module 把它绑定成 `workspacePath` proxy，backend module 暴露 `DefaultWorkspaceServer`。这里也没有 backend workspace command registry。[browser service](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/workspace/src/browser/workspace-service.ts#L50-L70) · [frontend proxy](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/workspace/src/browser/workspace-frontend-module.ts#L71-L81) · [backend server](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/workspace/src/node/workspace-backend-module.ts#L25-L43)

## 对当前 Command/RPC 讨论的含义

若目标是参考 Theia，可采用下面的基线：

```text
renderer menu / shortcut / palette / toolbar
  -> renderer CommandRegistry
      -> feature handler
          -> renderer feature service/client
              -> Bun namespaced RPC service
```

- 把 UI-facing command definitions、handler selection、enablement、visibility 和 dispatch 放在 renderer/window scope，最接近 Theia。
- Bun capability 通过 feature RPC service 暴露；正常链路由 renderer handler 调它，而不是在 Bun 再注册一套同 id command handler。
- 只有 Bun 确实需要主动要求某个 renderer 执行 UI command 时，才需要类似 Theia backend `CommandService` 的反向 per-window proxy/transport；这不等于创建 Bun `CommandRegistry`。
- “Command 只表达 UI intent”与 Theia 的典型 feature 链路相符；但“Command 必须无返回值”是 LLM Space 自己可选的约束，不是 Theia 事实。Theia 明确允许 handler 返回结果。
- 原生窗口生命周期操作若必须在 renderer 不可用时完成，可以保留为 shell/Bun capability；但这属于 Electrobun 的平台边界，不能用 Theia 的 backend command registry 作为依据，因为 Theia core 没有那套 registry。

## 核查边界

以上结论针对 Theia core command infrastructure 与固定提交中的官方 Task、Workspace 实现。
