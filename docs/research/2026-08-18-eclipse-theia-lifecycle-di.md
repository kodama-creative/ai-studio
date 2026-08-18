# Eclipse Theia 如何把 DI Service 接入 Application 生命周期

> 调研日期：2026-08-18
>
> 调研对象：Eclipse Theia 官方仓库 `master`，固定提交 [`fa058c3`](https://github.com/eclipse-theia/theia/tree/fa058c354e5bfa630cb6766d042131cc8de8a7ff)（2026-08-17）
>
> 资料范围：只使用 Eclipse Theia 官方文档与官方 GitHub 源码；源码链接全部固定到上述提交。未修改产品代码。
>
> 相关笔记：[`2026-08-17-eclipse-theia-di-application-rpc.md`](./2026-08-17-eclipse-theia-di-application-rpc.md)

> 落地状态：后续代码验证确认 Desktop 没有跨所有 process service 的严格逆序释放需求。本文关于 Theia 机制的研究结论仍有效；“保留通用 lifecycle root/stack”的早期建议已被更小的方案取代：只在 `DesktopApp` 与窗口 Application 中表达真实业务顺序，其余由 container ownership、`@preDestroy()` 或 binding `onDeactivation` 释放。

## 结论先行

Theia 的 lifecycle contribution **不是自动绑定，而是模块显式装配**：

1. `@injectable()` 只让 class 可由 Inversify 构造；`implements FrontendApplicationContribution` / `BackendApplicationContribution` 只是 TypeScript 类型关系。两者都不会让 class 自动进入 application 的 contribution 集合。
2. feature module 必须把实现类绑定为 service，再显式 `toService(...)` alias 到 lifecycle contribution symbol。`bindContribution(...)` 只是批量生成这些 alias；它既不绑定实现类，也不扫描 interface。
3. `bindContributionProvider(...)` / `bindRootContributionProvider(...)` 只绑定一个 named `ContributionProvider`。Provider 首次消费时用 `container.getAll(contributionSymbol)` 收集并缓存显式注册的贡献；它同样不负责发现实现类。
4. Frontend/Backend Application 是集合的唯一 lifecycle consumer，但二者调度语义不同：frontend hooks 基本都按集合顺序串行，frontend stop 同步；backend 的 `initialize`、`configure`、`onStop` 并行，`onStart` 串行。
5. `@postConstruct` / `@preDestroy` 是**容器实例的构造/释放 hooks**，不是 application contribution hooks。当前 backend 退出明确分两阶段：先等待所有 contribution `onStop`，再 `rootContainer.unbindAllAsync()` 触发 singleton 的 `@preDestroy`；frontend 入口没有对应的 root-container unbind。
6. Theia 能降低“class 已绑定但忘记加入 lifecycle”的概率，却没有从机制上消灭它：module 仍必须写显式 alias，或显式调用 `bindContribution`。如果漏掉这一步，Application 不会调用该 class。

对当前 Desktop 设计最直接的启示是：**模块中的 lifecycle alias 仍应被视为显式、可审查的 composition 事实**。不要期待 decorator 或 interface 自动完成注册；也不要让同一资源在 `onStop` 和 `@preDestroy` 中重复释放。

## 1. Contribution 注册是显式的，不是自动发现

### 1.1 Application 注入的是 provider，不是“所有实现了接口的 class”

`FrontendApplicationContribution` 是一个运行期 `Symbol` 加一个编译期 interface；`FrontendApplication` 注入的是 `@inject(ContributionProvider) @named(FrontendApplicationContribution)`。[contract](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/packages/core/src/browser/frontend-application-contribution.ts#L22-L70) · [consumer injection](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/packages/core/src/browser/frontend-application.ts#L57-L66)

Backend 完全相同：`BackendApplicationContribution` 是 symbol/interface，`BackendApplication` 注入对应的 named provider。[contract](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/packages/core/src/node/backend-application.ts#L75-L140) · [consumer injection](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/packages/core/src/node/backend-application.ts#L200-L213)

这意味着 collection membership 由 **binding key** 决定，而不是由 class 的 `implements` 决定。`@injectable()` 也只提供容器构造所需 metadata；Theia 官方文档明确说，注入只对由 DI container 创建、标记为 `@injectable()` 且在 DI context 注册的对象生效。[官方 Services and Contributions](https://theia-ide.org/docs/services_and_contributions/#dependency-injection-di)

### 1.2 生产 module 的实际写法

Frontend core module 明确分三步：

```ts
bind(IconThemeApplicationContribution).toSelf().inSingletonScope();
bind(FrontendApplicationContribution).toService(IconThemeApplicationContribution);

bind(FrontendApplication).toSelf().inSingletonScope();
bindRootContributionProvider(bind, FrontendApplicationContribution);
```

第一行定义实例 identity/lifetime，第二行把**同一实例**接到 lifecycle collection，第三组 binding 让 Application 能消费 collection。[frontend bindings](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/packages/core/src/browser/frontend-application-module.ts#L155-L175)

Backend messaging module 也先绑定 `DefaultMessagingService` 与 `WebsocketEndpoint`，再分别 alias 到 `BackendApplicationContribution`。[backend bindings](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/packages/core/src/node/messaging/messaging-backend-module.ts#L31-L44)

因此，下面的 class 即使类型正确，也不会自动收到 lifecycle callback：

```ts
@injectable()
class FeatureService implements FrontendApplicationContribution {
  onStart(): void { /* ... */ }
}

bind(FeatureService).toSelf().inSingletonScope();
// 缺少：bind(FrontendApplicationContribution).toService(FeatureService)
```

### 1.3 `bindContribution` 做了什么、没做什么

`bindContribution(bindable, service, contributions)` 的实现只是循环：

```ts
for (const contribution of contributions) {
  bind(contribution).toService(service);
}
```

它的注释明确把 `service` 定义为 **already bound service**。[implementation](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/packages/core/src/common/contribution-provider.ts#L132-L144)

所以它解决的是“一项 service 同时承担多个 contribution identity”时的重复 alias，例如概念上可写成：

```ts
bind(FeatureService).toSelf().inSingletonScope();
bindContribution(bind, FeatureService, [
  FrontendApplicationContribution,
  CommandContribution,
]);
```

它**不会**：

- 自动 `bind(FeatureService).toSelf()`；
- 决定 singleton/transient lifetime；
- 读取 `implements`；
- 自动绑定 `ContributionProvider`；
- 自动启动或停止 service。

使用 `toService` 很重要：多个 contribution identity 会解析到 service binding 的同一实例。若对每个 contribution token 分别 `to(FeatureService)`，就可能构造多个实例，生命周期和状态不再共享。

### 1.4 `bindViewContribution` 展示了更安全的“原子 helper”

Theia 的 `bindViewContribution(bind, identifier)` 把一组必须同时发生的装配动作收进一个 helper：先把 view contribution class 绑定为 singleton，再立即 alias 为 `CommandContribution`、`KeybindingContribution` 和 `MenuContribution`。[implementation](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/packages/core/src/browser/shell/view-contribution.ts#L44-L50)

它仍不是自动发现；调用 module 必须显式选择这个 helper。价值在于把“class binding + 固定 aliases”做成一个原子操作，避免只写 `toSelf()` 却漏掉某个约定内 contribution。相比之下，通用 `bindContribution` 不知道 class lifetime，也不绑定 class 本身。

## 2. `bindContributionProvider` 的准确机制

### 2.1 Provider 是带 qualifier 的 singleton

`bindContributionProvider(bindable, id)` 在通用 `ContributionProvider` symbol 下注册一个 `whenTargetNamed(id)` 的 singleton dynamic value；解析时把当前 container 与 contribution id 交给 `ContainerBasedContributionProvider`。[binding](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/packages/core/src/common/contribution-provider.ts#L78-L98)

Application 因而可以用同一个 provider type、不同 `@named(...)` qualifier 消费不同开放集合。它并不是 `@multiInject(id)` 的语法包装，而是一个具备 lazy snapshot/filter/parent traversal 语义的 collection owner。

### 2.2 首次读取时收集、过滤、缓存

`getContributions()` 首次调用时：

1. 检查当前 container 是否绑定 contribution id；
2. 调 `container.getAll(id)` 解析所有显式绑定；
3. 可选取得 `ContributionFilterRegistry` 并过滤结果；
4. 若 `recursive === true`，继续向 parent container 收集；默认不递归；
5. 缓存最终数组，并把内部 container 引用置为 `undefined`。

后续调用返回同一个缓存数组，不再观察 late bindings。[provider implementation](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/packages/core/src/common/contribution-provider.ts#L20-L65)

`getAll` 抛错时 provider 会记录错误并继续，不会让整个 `getContributions()` 直接抛出；但 catch 包围的是该 container 的整次 `getAll`，并不是逐个 binding 隔离。[error boundary](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/packages/core/src/common/contribution-provider.ts#L42-L61)

### 2.3 Root provider 与 child provider

Theia 当前推荐 application-level contribution 使用 `bindRootContributionProvider`。它在 provider 第一次解析时沿 `container.parent` 找到 root，再创建 provider，避免长寿命 provider 意外持有短命 widget child container。[rationale and implementation](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/packages/core/src/common/contribution-provider.ts#L100-L130)

普通 `bindContributionProvider` 则保留解析它的 container，适合 connection-scoped 等确实要读取 child bindings 的场景。[child-scope guidance](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/packages/core/src/common/contribution-provider.ts#L78-L98)

这两种 helper 都只建立**集合读取器**。它们不会把 service alias 到 contribution id；provider binding 与每项 contribution binding 是两个独立、都必须存在的装配动作。

## 3. Frontend Application 如何启动和停止 contributions

### 3.1 启动阶段与顺序

生成的 frontend 入口创建 container、加载 core/feature modules，最后只解析一个 `FrontendApplication` 并调用 `start()`。[generated entry](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/dev-packages/application-manager/src/generator/frontend-generator.ts#L113-L166)

`FrontendApplication.start()` 先启动 contributions，随后 attach shell、初始化/恢复 layout、reveal UI 并注册全局 listeners。[application start](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/packages/core/src/browser/frontend-application.ts#L72-L104)

Contribution 的主要启动顺序是：

```text
每项 initialize（串行，逐项 await）
→ 每项 configure（串行，逐项 await）
→ CommandRegistry.onStart
→ KeybindingRegistry.onStart
→ MenuModelRegistry.onStart
→ 每项 contribution.onStart（串行，逐项 await）
```

每个 contribution hook 都有独立 `try/catch`：某一项抛错会被记录，下一项仍继续；同一阶段完成后才进入下一阶段。[startContributions](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/packages/core/src/browser/frontend-application.ts#L263-L313)

`initializeLayout` 与 `onDidInitializeLayout` 也按 provider 数组顺序串行、逐项隔离错误。[layout hooks](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/packages/core/src/browser/frontend-application.ts#L233-L260)

### 3.2 Frontend stop 是同步、正序、best effort

unload 时，Application 保存 layout 后调用 `stopContributions()`。[unload wiring](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/packages/core/src/browser/frontend-application.ts#L126-L135)

`stopContributions()` 按 provider 返回顺序遍历，直接同步调用 `onStop(this)`；每一项单独 `try/catch`，因此一项同步异常不阻止后续项。它**不是逆启动顺序，也不并行，更不等待 Promise**。[stop implementation](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/packages/core/src/browser/frontend-application.ts#L315-L330)

契约明确说明 frontend `onStop` 由 `window.pagehide` 驱动，已是最后一个 tick，不允许异步代码。[frontend lifecycle contract](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/packages/core/src/browser/frontend-application-contribution.ts#L45-L58)

当前 generated frontend entry 没有在 unload 时调用 root `container.unbindAllAsync()`；所以不能从 Theia frontend 推导出“窗口关闭必然触发所有 service 的 `@preDestroy`”。[generated entry](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/dev-packages/application-manager/src/generator/frontend-generator.ts#L113-L167)

## 4. Backend Application 如何启动和停止 contributions

### 4.1 构造、配置与启动

生成的 backend 入口创建 root container、加载 core/messaging/logger 与 feature modules；解析 `BackendApplication` 后先等待其 `configured`，再调用 `start(port, host)`。[generated entry](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/dev-packages/application-manager/src/generator/backend-generator.ts#L132-L193)

`BackendApplication` 的 `@postConstruct init()` 会立即把 `_configured` 设为 `this.configure()`；也就是说，**解析 Application 实例**触发配置流程，而不是 contribution provider 自动启动它。[postConstruct](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/packages/core/src/node/backend-application.ts#L247-L258)

Backend 各阶段的并发语义不同：

| 阶段 | 调度 | 错误隔离 |
| --- | --- | --- |
| `initialize` | `Promise.all` 并行 | 每项内部 `try/catch`，记录后继续 |
| `configure` | 等全部 initialize 完成，再 `Promise.all` 并行 | 每项内部 `try/catch` |
| `onStart` | HTTP server 创建后，按 provider 顺序串行 `await` | 每项内部 `try/catch` |

证据：[initialize/configure](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/packages/core/src/node/backend-application.ts#L234-L288) · [onStart](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/packages/core/src/node/backend-application.ts#L337-L368)

所以 backend contribution 不能假设同阶段中另一项先完成；只有阶段之间存在 barrier。

### 4.2 Graceful shutdown 是明确的两阶段事务

当前提交的 `SIGINT` / `SIGTERM` 路径调用幂等的 `gracefulShutdown()`：

```text
所有 BackendApplicationContribution.onStop
  ├─ Promise.all 并行
  ├─ 每项 try/catch，单项失败不阻断其他项
  └─ 整个阶段最多等待 5 秒
→ rootContainer.unbindAllAsync()
  ├─ 触发已激活 singleton 的 @preDestroy
  └─ 整个阶段另有 5 秒预算
→ process.exit(1)
```

每个 cleanup phase 的错误或超时都只记录 warning，后续 phase 与最终 exit 仍执行。源码还明确接受超时 Promise 在后台晚到、可能接触已部分 unbind container 的风险。[gracefulShutdown](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/packages/core/src/node/backend-application.ts#L378-L424)

Contribution stop 本身使用 `Promise.all`，并用 async wrapper 将同步 throw 转为 rejection，再在每项内部捕获。因此 stop contributions **并行、无相互顺序依赖、逐项错误隔离**；它不是 LIFO。[stopContributions](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/packages/core/src/node/backend-application.ts#L426-L445)

Theia 特意先 stop contributions、后 unbind container，使 `onStop` 执行时注入服务仍可解析；官方测试锁定了这个顺序，并证明一项 reject 不会阻止另一项 stop。[shutdown tests](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/packages/core/src/node/backend-application.spec.ts#L174-L254)

### 4.3 同步退出 fallback 不保证异步清理完成

`process.on('exit')` 是 fallback：它 fire-and-forget `stopContributions()`，只能保证各 `onStop` 被同步调用到第一个 `await`；随后立即终止 process tree。`stoppedContributions` 标志避免 graceful path 与 exit handler 重复 dispatch。[fallback](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/packages/core/src/node/backend-application.ts#L426-L455) · [idempotency tests](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/packages/core/src/node/backend-application.spec.ts#L275-L308)

因此，只有 signal-driven graceful path 能等待 async `onStop` 和 `@preDestroy`。崩溃、bind failure 或普通同步 exit 不能承诺这一点。

## 5. `@postConstruct`、`@preDestroy` 与 `unbindAllAsync`

### 5.1 它们与 contribution lifecycle 是正交的

可以把两套机制分开看：

| 机制 | 触发者 | 面向对象 | 典型用途 |
| --- | --- | --- | --- |
| `@postConstruct` | Inversify 完成实例构造与注入 | 单个 container-created instance | 建立实例内部不变量、订阅依赖、启动局部初始化 |
| `initialize/configure/onStart/onStop` | Frontend/Backend Application 遍历 provider | 显式绑定到 contribution symbol 的集合 | application 阶段扩展点 |
| `@preDestroy` | container binding 被 async unbind | 已由 container 激活、具备 deactivation hook 的实例 | 释放实例自己拥有的资源 |

例如 `BackendApplication.@postConstruct init()` 启动自身 configure promise；普通 `LocalStorageService.@postConstruct init()` 初始化本地状态。二者都不因此成为 application contributions。[backend activation](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/packages/core/src/node/backend-application.ts#L247-L258) · [ordinary service activation](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/packages/core/src/browser/storage-service.ts#L46-L63)

反过来，一个 contribution 是否有 `@preDestroy`，不影响它能否收到 `onStop`；决定因素仍是 contribution alias。

### 5.2 `unbindAllAsync` 是显式 ownership disposal

当前 Theia 在两个明确 ownership boundary 使用它：

- backend root shutdown：贡献停止后 unbind root，触发 root-scoped singleton `@preDestroy`；测试用 canary 证明 hook 在 exit 前执行。[root disposal test](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/packages/core/src/node/backend-application.spec.ts#L100-L139)
- frontend connection 关闭：unbind 对应 connection child container，触发 connection-scoped singleton `@preDestroy`。[child disposal](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/packages/core/src/node/messaging/default-messaging-service.ts#L75-L89) · [child disposal test](https://github.com/eclipse-theia/theia/blob/fa058c354e5bfa630cb6766d042131cc8de8a7ff/packages/core/src/node/messaging/test/default-messaging-service.spec.ts#L28-L83)

Theia 源码为 contribution stop 明确规定了并发和逐项错误隔离；但它没有在自己的代码里规定 `unbindAllAsync()` 内部各 `@preDestroy` 的执行顺序，也只在 phase 外围统一 catch `unbindAllAsync` 的 reject。因此不要把 `@preDestroy` 当成可表达跨 service 顺序依赖的 LIFO lifecycle stack。

### 5.3 同一 class 同时使用两套 stop hook 的风险

一个 class 可以既 alias 为 `BackendApplicationContribution`，又声明 `@preDestroy`。那它在 graceful path 会先收到 `onStop`，随后在 container unbind 时再收到 `@preDestroy`。这不是自动去重。

合理分工应是：

- `onStop`：必须在 application 仍完整、其他注入服务仍可用时发生的协作式停止；
- `@preDestroy`：实例自身最终、幂等的资源释放；
- 若两者触及同一资源，共用一个幂等内部 disposer，而不是维护两套 cleanup。

## 6. Theia 是否解决了“绑定 class 后忘记注册 lifecycle”

**没有彻底解决。** Theia 的防线是约定与 helper，不是自动化：

1. lifecycle extension point 有独立 symbol/interface，registration 在 feature module 中可见；
2. `toService` 明确复用已经绑定的 singleton；
3. `bindContribution` 可一次为同一 service 建多个 contribution aliases，减少重复样板；
4. `ContributionProvider` 集中 collection discovery，Application 不需要知道每个 feature class。

但 module author 仍必须显式写：

```ts
bind(FeatureService).toSelf().inSingletonScope();
bind(FrontendApplicationContribution).toService(FeatureService);
```

或：

```ts
bind(FeatureService).toSelf().inSingletonScope();
bindContribution(bind, FeatureService, [FrontendApplicationContribution]);
```

只写第一行，service 可以被普通依赖注入，却不会进入 lifecycle collection。只实现 interface 或只加 decorator 也无效。**所以 module-level explicit alias 仍然必需。**

Theia 当前没有靠 `@postConstruct` 补救这个遗漏，因为 activation hook 只有在 service 被解析时才运行，并且不提供 Application 的阶段参数、集合顺序或错误隔离语义。把所有长期 service 都改成 constructor/postConstruct 自启动，只会隐藏 startup ownership。

## 7. 对 Desktop 架构的具体判断

Theia 的实现支持以下约束：

- feature module 先 `toSelf().inSingletonScope()`，再对每个开放集合 `toService(...)`；不要依赖 `implements` 自动注册。
- 对稳定、成组出现的 lifecycle aliases，可借鉴 `bindViewContribution` 建 feature-owned 原子 binding helper，让 class binding、lifetime 与 aliases 一次完成；helper 仍由 module 显式调用，不做反射扫描。
- lifecycle/registry collection 的 provider 或 `@multiInject` 只能收集显式 aliases；这正是 composition root 可审计性的来源。
- 若 Main/Project window 使用 sibling child containers，窗口关闭时显式 `application.stop()` 后再 `container.unbindAllAsync()`，其 ownership 语义与 Theia connection child container 一致。
- 只有存在真实跨资源 teardown 不变量时，才在对应 Application root 中显式编码该局部顺序。当前 Desktop 不需要通用 lifecycle stack；Theia backend contribution stop 是并行而非 LIFO，也不能作为有序资源释放机制。
- `@preDestroy` 适合每实例最终释放，不替代业务层 `Application.stop()`；二者并存必须幂等且职责不重叠。
- registry/application 应在明确 start 阶段消费固定 contribution 集合；不让 contribution 在 constructor 中主动向全局 registry 自注册。

不应从 Theia 推导出以下结论：

- `@injectable` class 会自动加入生命周期；
- `bindContributionProvider` 会扫描实现类；
- `container.unbindAllAsync()` 等价于 application `stop()`；
- contribution stop 按创建顺序逆序执行；
- frontend window 关闭会自动释放整个 DI container。

## 最终回答

> Theia 把“service 的实例 identity/lifetime”和“service 参与哪个 application lifecycle”分成两个显式 binding。`bindContribution` 只生成 `toService` aliases，`bind[Root]ContributionProvider` 只生成 named collection provider；二者都不自动发现 `implements`。Frontend/Backend Application 再按各自定义的顺序、并发和错误隔离策略消费集合。`@postConstruct/@preDestroy` 属于 container activation/deactivation，只有显式 unbind 才构成释放边界。因而，Theia 仍要求 module 显式 alias；它让遗漏容易审查，但没有让遗漏在类型或运行期自动报错。
