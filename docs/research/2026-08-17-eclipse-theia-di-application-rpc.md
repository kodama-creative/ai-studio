# Eclipse Theia 的 DI、应用入口与双向 RPC：对 Desktop 重构的约束

> 调研日期：2026-08-17
>
> 调研对象：Eclipse Theia 官方仓库 `master`，提交 [`713634f`](https://github.com/eclipse-theia/theia/tree/713634fd5885ff8abde8cfd50bc3493d535772a5)（2026-08-14）
>
> 资料范围：只使用 Eclipse Theia 官方文档与官方 GitHub 源码；对 LLM Space 的判断只依据本仓库现状。未修改产品代码。
>
> 相关已有笔记：[`eclipse-theia-command-registry.md`](./eclipse-theia-command-registry.md)

> 历史状态：本文记录的是重构前的代码与第一轮判断。最终落地已将 composition root 合并到 `app/bootstrap.ts`，删除 `DesktopLifecycle`、`DesktopHost` 和 `ToolContribution`；关于“严格逆序是业务不变量”的判断也被后续源码研究与代码验证推翻。当前结论见 [`2026-08-18-eclipse-theia-lifecycle-di.md`](./2026-08-18-eclipse-theia-lifecycle-di.md) 与 [`../desktop-architecture-redesign.md`](../desktop-architecture-redesign.md)。下文保留作为决策演进记录。

## 结论先行

Theia 值得借鉴的不是“所有类都加 Inversify decorator”，而是下面四条控制反转规则：

1. **生成的入口是 composition root**：创建容器、加载 core/feature modules、最后只解析一个 `FrontendApplication` 或 `BackendApplication` 并启动。应用类不加载 module，也不从容器里找业务服务。[frontend generator](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/dev-packages/application-manager/src/generator/frontend-generator.ts#L113-L166) · [backend generator](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/dev-packages/application-manager/src/generator/backend-generator.ts#L116-L184)
2. **稳定依赖用 service injection，开放集合用 contribution provider**：业务类由 `@injectable()` 标记，依赖通过 `@inject(Token)` 注入；同一个 contribution token 可以有多个绑定，registry/application 在明确的启动阶段一次性收集和调用。[官方 Services and Contributions](https://theia-ide.org/docs/services_and_contributions/) · [ContributionProvider 源码](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/common/contribution-provider.ts#L20-L65)
3. **RPC contract、远端 proxy、服务实现、反向 callback 是四个对象**：browser 注入的是远端 server proxy；backend 暴露 server implementation；需要推送时，browser 另提供一个 client callback object，backend 通过同一双向 channel 调用它。[官方 Communication via RPC](https://theia-ide.org/docs/json_rpc/) · [Task 完整绑定](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/task/src/browser/task-frontend-module.ts#L64-L68) · [backend handler](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/task/src/node/task-backend-module.ts#L36-L47)
4. **Contribution 是注册适配器，不是业务层**：它把 feature 接入应用/registry 生命周期；真正状态和行为仍在 service、manager、server 或局部 controller 中。Theia 的代码没有把 `Controller → Application → Client` 当成每个功能都必须经过的固定三层。[FrontendApplicationContribution contract](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/browser/frontend-application-contribution.ts#L22-L70) · [Task feature module](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/task/src/browser/task-frontend-module.ts#L48-L88)

对 LLM Space 的直接判断：当前 Bun process root + 每窗口 child scope + 显式 namespaced RPC 的总体方向已经比“照搬 Theia 全局容器和反射 proxy”更适合 Electrobun。应重做的是**构造和命名一致性**，不是推翻现有 namespace manifest、每窗口 registry 和显式生命周期边界。

## 1. `@injectable`、`@inject`、Symbol 与多实现

### 1.1 Theia 的准确写法

Theia/Inversify 源码中的 decorator 名是小写 `@injectable()` 与 `@inject(...)`，不是 `@Injectable` / `@Inject`。官方文档说明：只有由 DI 容器创建的对象才会完成注入，因此实现类要标记 `@injectable()` 并在 `ContainerModule` 中绑定；依赖可通过 constructor、field 或初始化方法注入。[官方文档](https://theia-ide.org/docs/services_and_contributions/#dependency-injection-di)

Theia 对 public service/contribution 常用“同名 value + type”写法：

```ts
export const CommandContribution = Symbol("CommandContribution");
export interface CommandContribution {
  registerCommands(commands: CommandRegistry): void;
}
```

value 位置的 symbol 是运行期 DI identity，type 位置的 interface 是编译期契约。Theia 当前使用 `Symbol(...)`，不是 `Symbol.for(...)`。[CommandContribution](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/common/command.ts#L143-L152) · [官方 service identifier 说明](https://theia-ide.org/docs/services_and_contributions/#services)

Theia 官方文档也明确区分：真正对外、允许替换的 service 适合 symbol + interface；extension 内部且不作为扩展点的实现可以直接以 class 同时作为 token/type。[官方 Services](https://theia-ide.org/docs/services_and_contributions/#services)

因此 Desktop 的 token policy 建议是：

- 内部唯一实现：直接用 concrete class 作 identity，例如 `DesktopApp`、`RpcRegistry`、`DesktopWindowFactory`。
- 外部值或真实 interface seam：使用 feature 自己导出的 typed symbol，例如 `MODEL_MANAGER`、`WINDOW_APPLICATION`。
- 开放多实现：使用同名 symbol + interface，例如 `RpcContribution`、`CommandContribution`。
- 不建立一个中央 `TOKENS` 大字典；token 应由拥有契约的 feature/module 导出。

### 1.2 单 symbol 多实现与 provider

Theia 的多实现不是“注入一个随机实现”，而是对同一 symbol 重复 binding，再注入一个**带 name qualifier 的 provider**：

```ts
constructor(
  @inject(ContributionProvider)
  @named(CommandContribution)
  contributions: ContributionProvider<CommandContribution>,
) {}
```

`ContainerBasedContributionProvider` 首次 `getContributions()` 时调用 `container.getAll(serviceIdentifier)`，缓存结果并释放 container 引用；`bindRootContributionProvider` 默认把查找锚定到 root container，以免长寿命 provider 留住短命 child container。[provider implementation](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/common/contribution-provider.ts#L30-L65) · [root provider rationale](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/common/contribution-provider.ts#L78-L130)

同一个 class 实现多个 contribution 时，Theia 先把 concrete class 绑定成 singleton，再用多个 `toService(...)` alias 到同一个实例；Task frontend 就把一个 `TaskFrontendContribution` 同时绑定为 application、command、keybinding、menu 和 quick access contribution。[Task binding](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/task/src/browser/task-frontend-module.ts#L48-L54) · [`bindContribution` helper](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/common/contribution-provider.ts#L132-L143)

对 Desktop，最终采用更直接的 Inversify 机制：每个原生窗口都是 Desktop
root 的 raw child `Container`，窗口模块对同一 `RpcContribution` symbol
重复绑定，`RpcRegistry` 在 child 内通过原生 `@multiInject()` 一次取得固定
集合并在 `onStart()` 冻结。这样既保留首次启动后拒绝 late registration 的
语义，也不需要自定义 `SnapshotContributionProvider`，且 Main-only/Project-only
contribution 不会跨兄弟窗口泄漏。Theia 的 provider 设计仍说明了“collection
owner 必须匹配实例生命周期”这一原则，但不需要机械移植其 root-provider
helper。[Theia provider docs](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/common/contribution-provider.ts#L78-L112)

### 1.3 什么时候不该用多绑定

Contribution 适合“未知数量、同一协议、由一个 registry/lifecycle owner 统一消费”的开放集合。固定依赖、只有一个实现的 application/service 不应为了“架构统一”做成 contribution。Theia 的 `FrontendApplication` 直接注入固定的 `CommandRegistry`、`MenuModelRegistry`、`KeybindingRegistry`、shell 和 state service，只有 frontend lifecycle hooks 才通过 provider 注入。[FrontendApplication constructor](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/browser/frontend-application.ts#L57-L66)

## 2. 从入口到 `FrontendApplication` / `BackendApplication`

### 2.1 Frontend

生成的 frontend 入口顺序是：创建 `Container` → 加载 messaging/preload/core/feature modules → `container.get(FrontendApplication)` → `application.start()`。入口拥有 module 顺序和 composition failure handling；`FrontendApplication` 只接收 ordinary dependencies。[frontend generator](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/dev-packages/application-manager/src/generator/frontend-generator.ts#L113-L166)

`FrontendApplication.start()` 的稳定职责是协调 workbench 生命周期：启动 contributions、挂载 shell、恢复/创建布局、reveal UI、安装全局 listeners、推进 application state。[FrontendApplication.start](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/browser/frontend-application.ts#L72-L104)

其贡献启动顺序是：

```text
FrontendApplicationContribution.initialize
→ configure
→ CommandRegistry.onStart
→ KeybindingRegistry.onStart
→ MenuModelRegistry.onStart
→ FrontendApplicationContribution.onStart
```

窗口卸载时同步调用 `onStop`；layout 另有 `initializeLayout` / `onDidInitializeLayout` 阶段。[startContributions](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/browser/frontend-application.ts#L263-L329) · [lifecycle contract](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/browser/frontend-application-contribution.ts#L22-L70)

### 2.2 Backend

生成的 backend 入口同样创建独立 container，加载 backend/messaging/logger 和 feature modules，通过 CLI initialization 触发 `BackendApplication.configured`，最后调用 `BackendApplication.start(port, host)`。[backend generator](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/dev-packages/application-manager/src/generator/backend-generator.ts#L116-L184)

`BackendApplication` 是 Express/HTTP 生命周期根，贡献协议为 `initialize → configure(expressApp) → onStart(server) → onStop`。[BackendApplicationContribution](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/node/backend-application.ts#L67-L141) · [官方 Backend Contributions](https://theia-ide.org/docs/backend_application_contribution/)

它的 `@postConstruct init()` 先建立 configure promise；configure 阶段调用贡献的 `initialize` 和 `configure`，start 阶段创建/listen HTTP server 后调用 `onStart`。优雅退出先等待 contributions 的 `onStop`，再 unbind root container 触发 `@preDestroy`。[configure/start](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/node/backend-application.ts#L234-L368) · [shutdown](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/node/backend-application.ts#L378-L417)

### 2.3 映射到 Desktop

Desktop 应维持三层生命周期根，而不是把它们揉成一个 `DesktopApp`：

```text
src/bun/index.ts
  → bootstrapDesktopProcess()           import-order barrier
      → composeAndStartDesktopApp()     composition root
          → resolve DesktopApp once     process lifecycle root
              → DesktopWindowFactory
                  → DesktopWindowRuntime per native window
                      → CommandRegistry + RpcRegistry
```

- `bootstrap.ts`：只保证 shell env → deep-link listener → composition graph 的求值顺序。
- `desktop-composition.ts`：唯一知道 module 集合、外部 Electrobun/runtime adapter、process/window containers 和失败回滚的地方。文件大不是首要问题；把装配责任分散到业务 class 才是问题。
- `DesktopApp`：只协调进程启动/退出、launch、后台服务和窗口管理；不 `container.get()`、不 load module。
- `DesktopWindowFactory`：唯一创建 native window + child scope + immutable window identity。
- `DesktopWindowRuntime`：每窗口 lifecycle root，启动/释放 registries 和 transport，再关闭 native window。

这与 Theia 的“入口装配、Application 运行生命周期”的方向一致；不同点是 Desktop 还需要 Bun process root 下的**每原生窗口 child container**，不能照搬 Theia 单 frontend-container 的作用域。当前依据：[`bootstrap.ts`](../../apps/desktop/src/bun/app/bootstrap.ts) · [`desktop-composition.ts`](../../apps/desktop/src/bun/app/desktop-composition.ts) · [`desktop-app.ts`](../../apps/desktop/src/bun/app/desktop-app.ts) · [`desktop-window-runtime.ts`](../../apps/desktop/src/bun/app/desktop-window-runtime.ts)。

不建议新增一个无差别 `DesktopApplicationContribution` 并把所有 manager 都塞进去。Theia backend 的 contribution hooks 有并行阶段，且 stop 贡献需要彼此独立；Desktop 目前 launch → windows → process scope 的严格逆序和 Electrobun 两阶段 quit 是业务不变量，显式 `DesktopLifecycle` 更清楚。[Theia backend parallel initialize/stop contract](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/node/backend-application.ts#L84-L140) · [implementation](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/node/backend-application.ts#L234-L245)

## 3. Browser ↔ Backend RPC、proxy 与 callback

### 3.1 Theia 的完整消费链

Theia 当前核心类名已从 `JsonRpc*` 改为 `Rpc*`；`JsonRpcConnectionHandler`、`JsonRpcProxyFactory` 只是自 1.39.0 起保留的 deprecated aliases。[aliases](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/common/messaging/proxy-factory.ts#L307-L339)

一条普通 browser → backend 调用：

```text
shared TaskServer interface + taskPath
browser ServiceConnectionProvider.createProxy<TaskServer>(taskPath, localTaskClient)
  → RpcProxyFactory creates callable proxy and opens named channel
backend ConnectionHandler(path)
  → RpcConnectionHandler creates reverse proxy
  → targetFactory(reverseProxy) returns TaskServer implementation
  → RpcProxyFactory listens on channel
renderer consumer injects TaskServer proxy and calls run()/kill()/getTasks()
```

`ServiceConnectionProvider` 负责 path → channel、重连和 proxy factory；`RpcConnectionHandler` 负责在新 channel 上构造 proxy/target 并开始 listen。[frontend provider](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/browser/messaging/service-connection-provider.ts#L47-L86) · [handler](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/common/messaging/proxy-factory.ts#L45-L58)

### 3.2 反向 callback 不是另一个业务 client aggregation

Theia 的 `TaskServer extends RpcServer<TaskClient>`；browser 把 `TaskWatcher.getTaskClient()` 作为本地 target 传给 `createProxy`。backend 的 connection handler 收到 reverse `TaskClient` proxy，调用 `taskServer.setClient(client)`；server 后续通过 `TaskClient.onTaskCreated/onTaskExit/...` 向该连接推送通知，断线时移除 client。[Task protocol](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/task/src/common/task-protocol.ts#L220-L240) · [TaskClient callbacks](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/task/src/common/task-protocol.ts#L290-L297) · [browser watcher](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/task/src/common/task-watcher.ts#L21-L77) · [backend connection](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/task/src/node/task-backend-module.ts#L36-L47)

Theia backend 还为每个 frontend connection 创建 child container，加载 `ConnectionContainerModule`，把该连接的 frontend service proxy 绑定进 child scope；所以 backend service 可以注入“同一连接对应的 frontend service”。[ConnectionContainerModule contract](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/node/messaging/connection-container-module.ts#L35-L95) · [per-connection container](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/node/messaging/default-messaging-service.ts#L64-L93)

### 3.3 不应照搬到 Electrobun 的部分

Theia 的 `RpcProxyFactory` 是 JavaScript `Proxy`：读取任意属性都会生成远端调用；方法名以 `notify` 或 `on` 开头时自动变成 notification。它还必须特殊排除 `then` 与 `toJSON`，防止被当成 Promise 或序列化协议。[proxy dispatch](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/common/messaging/proxy-factory.ts#L187-L279)

这部分不适合 Desktop。当前显式 `RpcNamespace` manifest 只生成声明过的 request/stream/event，能在注册时拒绝重复 namespace，并处理 cancellation、stream terminal state 和每窗口事件订阅；这些约束比反射 proxy 更适合 Electrobun envelope。应保留：[`namespaced-rpc.ts`](../../apps/desktop/src/shared/namespaced-rpc.ts) · [`rpc-registry.ts`](../../apps/desktop/src/bun/di/rpc-registry.ts)。

建议关系是：

```text
renderer Controller / store
  → feature RpcClient（薄、无状态、一个 namespace）
      → Electrobun RpcClientTransport（唯一 envelope adapter）
          ⇄ window RpcRegistry
              → feature RpcServer（薄 transport adapter）
                  → Application / Manager / native capability

Bun push
  → feature-owned EventSource / AsyncIterable
      → RpcRegistry
          → namespace event / stream
              → feature RpcClient
                  → Controller / store
```

因此不要把 Theia 的 `setClient()` 模式机械移植成 Bun manager 持有 renderer callback proxy。Desktop 有多个 native window，window `RpcRegistry` 已经天然知道事件该发往哪个 renderer；进程 service 只暴露 event source，window adapter 负责订阅和投影，生命周期更清楚。

## 4. `Controller`、`Client`、`Application`、`Contribution` 的命名边界

Theia 源码显示的是职责命名，而不是固定层级：

| 名称                     | 应承担的职责                                                               | 不应承担的职责                                                 | Theia / 当前证据                                                                                                                                                                                                                                                                                                                                            |
| ------------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `*Client`                | 远端反向 callback contract，或 renderer 侧远端 facade；协议边界对象        | 持有大块 UI 状态、业务编排、聚合所有 feature                   | [TaskClient](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/task/src/common/task-protocol.ts#L290-L297)                                                                                                                                                                                                      |
| `*Server` / `*RpcServer` | 实现 shared remote request contract；transport adapter 应薄                | 创建 DI container、拥有 UI state                               | [TaskServer binding](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/task/src/node/task-backend-module.ts#L36-L47)                                                                                                                                                                                            |
| `*Contribution`          | 把一个现有 feature 接入 registry/application lifecycle；实现一个窄注册协议 | 充当 application/service locator，承载核心业务状态             | [Frontend contribution contract](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/browser/frontend-application-contribution.ts#L22-L70)                                                                                                                                                               |
| `*Application`           | 一个进程/窗口或 feature use-case 的生命周期/编排 facade                    | 知道 transport envelope，调用 container，只有一行 pass-through | [FrontendApplication](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/browser/frontend-application.ts#L34-L104)                                                                                                                                                                                      |
| `*Controller`            | 局部交互或状态机 owner，协调若干 services 并向 UI 暴露状态/actions         | 作为每个 feature 必经的后端层，或只是改名的 RPC client         | [ToolbarController](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/toolbar/src/browser/toolbar-controller.ts#L35-L119) · [HostedPluginController](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/plugin-dev/src/browser/hosted-plugin-controller.ts#L31-L126) |
| `*Registry`              | 消费一类 contributions，校验/冻结注册集合，并拥有其注册生命周期            | 做 feature 业务逻辑                                            | [CommandRegistry onStart](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/common/command.ts#L191-L224)                                                                                                                                                                                               |
| `*Module`                | 声明 bindings/aliases/scope；没有运行期业务状态                            | 偷跑 manager singleton、打开窗口、执行网络请求                 | [frontend application module](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/browser/frontend-application-module.ts#L155-L175)                                                                                                                                                                      |

套到 Desktop：

- renderer 中的 `ProjectSourceController`、`MainTabsController` 等如果确实拥有 snapshot、并发/epoch、watch 生命周期和 React external-store seam，命名合理；它们消费 feature client，不消费 Electrobun envelope。
- `createThreadClient()` 这类 factory 只投影一个 shared namespace，命名合理；不要再造 `DesktopClient`、`NativeClient`、`ApplicationClients` 聚合层。
- Bun 的 `DesktopPlaygroundApplication`、`ModelsApplication` 只有在它们编排多项 capability/use case 时才保留；纯 transport-only feature 可由 RPC server/contribution 直接适配现有 manager/state owner。
- `RpcContribution` 只负责 `registerRpc(registry)`；`RpcServer` 只做 transport projection；二者都不应成为第二套 application。

## 5. 适用性清单

### 直接采用

- `@injectable()` + constructor `@inject(...)` 用于容器创建的长期对象；constructor injection 优先于 Theia 源码常见的 field injection，依赖更可见。
- concrete class identity 用于内部唯一实现；typed feature symbol 用于 interface/value seam；同名 symbol + interface 用于 contribution。
- concrete singleton + 多个 `toService(...)`，保证一个对象实现多个 contribution 时仍只有一个实例。[Theia 示例](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/task/src/browser/task-frontend-module.ts#L48-L54)
- 入口加载全部 bindings，最后解析一次 `DesktopApp`；application class 不感知 container。[Theia frontend entry](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/dev-packages/application-manager/src/generator/frontend-generator.ts#L131-L166)
- registry 在 `onStart()` 统一消费 contributions；贡献 class 不在 constructor 中自注册。[CommandRegistry](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/common/command.ts#L191-L224)

### 调整后采用

- Theia root contribution provider → Desktop 在每窗口 child container 内原生
  `@multiInject()`，由 Registry 启动时冻结 contribution 集合。
- Theia `FrontendApplicationContribution` / `BackendApplicationContribution` → 只用于真正独立的开放 lifecycle hooks；严格有序的 process shutdown 保持显式 lifecycle stack。
- Theia server/client callback protocol → Desktop 用 namespace event/stream 表达 push；只有存在真正 renderer request handler 时才需要反向 request contract。

### 不采用

- JavaScript `Proxy` 的任意方法反射和 `on*`/`notify*` 命名启发式。[Theia proxy behavior](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/packages/core/src/common/messaging/proxy-factory.ts#L221-L279)
- 一个跨 Bun 和 renderer 的共享 DI container；Theia 的 frontend/backend 本身也是分别创建容器，再通过 RPC 连接。[frontend container](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/dev-packages/application-manager/src/generator/frontend-generator.ts#L113-L139) · [backend container](https://github.com/eclipse-theia/theia/blob/713634fd5885ff8abde8cfd50bc3493d535772a5/dev-packages/application-manager/src/generator/backend-generator.ts#L135-L145)
- catch-all `Controller → Application → Client` 三层模板。没有编排、状态或边界价值时，不新增 pass-through class。
- application/contribution 内 `container.get()` service locator；resolve 只发生在 composition root / scope lifecycle owner。

## 6. 第一轮设计访谈必须回答的问题

1. `DesktopApp` 的成功启动定义是什么：launch 已连接、Main 已打开、Project 已恢复，还是后台 update 已启动？哪些必须阻塞 `start()`？
2. process scope、Main window scope、Project window scope 的 singleton 清单分别是什么？有没有对象现在被第一个窗口意外实例化并“认领”？
3. 哪些集合真的是开放多实现：`RpcContribution`、`CommandContribution`、`ToolContribution` 之外还有什么？如果当前只有一个实现，为什么需要 contribution？
4. 一个 feature 的 shared RPC namespace 是否只属于一个 application/manager？如果同一个 contribution 注册两个 namespace，它们是否属于同一业务生命周期，还是被错误聚合？
5. renderer `Controller` 的判定标准是什么：必须拥有 snapshot + lifecycle + concurrency policy，还是只要调用 client 就叫 controller？
6. Bun `*Application` 的判定标准是什么：必须封装一个完整 use case 和不变量，还是所有 RPC namespace 都机械配一个 application？
7. push 数据应建模为 event 还是 stream？event 是长期状态变化广播；stream 是一次调用拥有的有序序列和 cancellation。现有 namespace 是否混用了两者？
8. contribution snapshot 何时冻结？任何窗口创建后是否还允许 late binding？若不允许，失败应发生在 module load、registry start 还是首个 RPC call？
9. decorator 迁移是否包含 renderer？如果 renderer 没有明确 composition root 和生命周期收益，应先只改 Bun，对 React controller 继续显式构造。
10. 当前 composition root 的痛点究竟是“行数多”，还是“资源构造、注册、启动、回滚之间缺少可证明的顺序”？只有后者才需要架构调整；import-order barrier 与 composition ownership 可以分文件表达，但不能把装配责任分散到业务类。

## 建议的决策基线

第一版重构可以用一句话约束：

> **Bun 入口显式组装 process/window object graph；容器创建的 class 使用 `@injectable()` + constructor `@inject()`；固定依赖直接注入，开放集合在 raw window child container 内通过原生 `@multiInject()` 注入；`DesktopApp`/窗口 Application 只协调生命周期；RPC 保留显式 namespace manifest，Service/Contribution/Application 各自只跨一条边界。**

这保留了 Theia 最有价值的控制反转和生命周期分工，同时避免把它的 WebSocket、connection child container、反射 proxy 与 legacy callback 命名约定无条件搬进 Electrobun。
