# Eclipse Theia 的 CommandRegistry 与 CommandContribution

> 调研日期：2026-08-14  
> 调研对象：Eclipse Theia 官方仓库 `main`，提交 [`30844b5`](https://github.com/eclipse-theia/theia/tree/30844b5882ba6902a8b3fd96991780b5c6ef12cc)（2026-08-12）  
> 方法：只使用 Theia 官方 GitHub 源码和 Theia 官方文档；未修改 LLM Space 业务代码。

## 结论

Theia 的准确模式是：

1. `CommandRegistry` 在**一个 frontend Inversify 容器内**以 singleton scope 绑定；它不是跨 frontend、backend 和所有 OS 窗口的进程级静态全局对象。
2. `CommandContribution` 确实采用“同名 value symbol + interface”的 TypeScript 声明合并写法，但官方源码是 `Symbol('CommandContribution')`，**不是** `Symbol.for(...)`。
3. 业务贡献 class 实现 `CommandContribution.registerCommands(registry)`；Theia 在 frontend 启动阶段统一调用它。业务 class 的 constructor 通常注入 handler 依赖，不在 constructor 中执行注册副作用。
4. `CommandRegistry` 自己在 constructor 中注入 `ContributionProvider<CommandContribution>`。启动时它取出全部贡献，逐个调用 `registerCommands(this)`。
5. handler 和 command definition 都保存在同一个 frontend `CommandRegistry` 中。执行时从高优先级到低优先级寻找第一个 enabled handler，再执行它。

因此，如果目标是“仿 Theia”，合适的结构不是让每个业务 class 在 constructor 中调用 registry，而是：**业务 class 在 constructor 注入自身依赖；统一 registry 在自身启动方法中发现贡献并回调注册**。

## 1. `CommandContribution` 的 Symbol + interface

官方源码 [`packages/core/src/common/command.ts`](https://github.com/eclipse-theia/theia/blob/30844b5882ba6902a8b3fd96991780b5c6ef12cc/packages/core/src/common/command.ts#L143-L152)：

```ts
export const CommandContribution = Symbol('CommandContribution');

export interface CommandContribution {
    registerCommands(commands: CommandRegistry): void;
}
```

这是同名 value/type：

- value 位置的 `CommandContribution` 是 Inversify service identifier；
- type 位置的 `CommandContribution` 是贡献接口。

Theia 官方“Services and Contributions”文档也明确推荐 public service 使用同名 symbol + interface，并说明 symbol 是注入标识、interface 是类型契约：[官方文档](https://theia-ide.org/docs/services_and_contributions/)。

需要注意：Theia 使用 `Symbol(...)`，依赖模块导入同一个导出值来保证 token identity。`Symbol.for('a.b.c')` 是 LLM Space 可采用的额外约束，但不能表述成 Theia 原样实现；`Symbol.for` 会进入当前 JS realm 的 global symbol registry。

## 2. `CommandRegistry` 的 constructor 与 `onStart`

核心实现同样在 [`packages/core/src/common/command.ts`](https://github.com/eclipse-theia/theia/blob/30844b5882ba6902a8b3fd96991780b5c6ef12cc/packages/core/src/common/command.ts#L191-L224)：

```ts
@injectable()
export class CommandRegistry implements CommandService {
    constructor(
        @inject(ContributionProvider) @named(CommandContribution)
        protected readonly contributionProvider: ContributionProvider<CommandContribution>
    ) { }

    onStart(): void {
        const contributions = this.contributionProvider.getContributions();
        for (const contrib of contributions) {
            contrib.registerCommands(this);
        }
    }
}
```

这里的控制反转关系非常明确：

```text
CommandRegistry constructor
  <- 注入 ContributionProvider<CommandContribution>

FrontendApplication 启动
  -> CommandRegistry.onStart()
  -> provider.getContributions()
  -> contribution.registerCommands(registry)
  -> registry.registerCommand(...)
```

也就是说，“registry 在 constructor 里面使用”的 Theia 对应物，是 **registry 的 constructor 使用 contribution provider**，不是 contribution 的 constructor 使用 registry 并立即注册。

## 3. singleton 的准确作用域

frontend core module 的绑定见 [`packages/core/src/browser/frontend-application-module.ts`](https://github.com/eclipse-theia/theia/blob/30844b5882ba6902a8b3fd96991780b5c6ef12cc/packages/core/src/browser/frontend-application-module.ts#L272-L278)：

```ts
bind(CommandRegistry).toSelf().inSingletonScope().onActivation(({ container }, registry) => {
    WebSocketConnectionProvider.createHandler(container, commandServicePath, registry);
    return registry;
});
bind(CommandService).toService(CommandRegistry);
bindRootContributionProvider(bind, CommandContribution);
```

所以它是：

- 同一 frontend DI container 内只有一个 `CommandRegistry`；
- `CommandService` 是同一实例的接口别名；
- singleton 是 Inversify binding scope，不是 module-level `new CommandRegistry()`，也不是跨进程 static singleton。

Theia 应用生成器为 frontend 启动创建一个 `new Container()`，加载 frontend modules 后解析并启动 `FrontendApplication`，见 [`dev-packages/application-manager/src/generator/frontend-generator.ts`](https://github.com/eclipse-theia/theia/blob/30844b5882ba6902a8b3fd96991780b5c6ef12cc/dev-packages/application-manager/src/generator/frontend-generator.ts#L112-L165)。官方“Authoring Theia Extensions”文档将其描述为 frontend 和 backend **各有一个** global DI container，而不是两端共享一个容器：[官方文档](https://theia-ide.org/docs/authoring_extensions/)。

### frontend、backend、window

- **Frontend**：`CommandRegistry` 属于 frontend application container。每个独立启动的 workbench frontend 都会创建自己的 container，因此 registry 是 per-frontend-application singleton。
- **Backend**：core backend 不绑定另一个 `CommandRegistry`。它在 connection-scoped container 中把 `CommandService` 绑定为 frontend service proxy，见 [`packages/core/src/node/backend-application-module.ts`](https://github.com/eclipse-theia/theia/blob/30844b5882ba6902a8b3fd96991780b5c6ef12cc/packages/core/src/node/backend-application-module.ts#L64-L69)。因此 backend 可通过连接调用对应 frontend 的 command service，但不与 frontend 共享同一个 JS 对象。
- **独立 workbench 窗口**：如果窗口独立加载完整 frontend bootstrap，它有自己的 container 和 registry。
- **Theia extracted secondary window**：这是主 frontend 用 `window.open` 创建并把已有 widget 移进去；handler 和 widget 仍由主 frontend 的服务对象管理，不是另起一套完整 command registry。相关实现见 [`default-secondary-window-service.ts`](https://github.com/eclipse-theia/theia/blob/30844b5882ba6902a8b3fd96991780b5c6ef12cc/packages/core/src/browser/window/default-secondary-window-service.ts#L104-L145) 和 [`secondary-window-handler.ts`](https://github.com/eclipse-theia/theia/blob/30844b5882ba6902a8b3fd96991780b5c6ef12cc/packages/core/src/browser/secondary-window-handler.ts#L162-L225)。

因此不能只说“全局单例”；准确名称应是“frontend application/container scoped singleton”。

## 4. `registerCommands` 的调用时机

`FrontendApplication` constructor 注入 singleton registry；启动顺序见 [`packages/core/src/browser/frontend-application.ts`](https://github.com/eclipse-theia/theia/blob/30844b5882ba6902a8b3fd96991780b5c6ef12cc/packages/core/src/browser/frontend-application.ts#L57-L66) 和同文件的 [`startContributions`](https://github.com/eclipse-theia/theia/blob/30844b5882ba6902a8b3fd96991780b5c6ef12cc/packages/core/src/browser/frontend-application.ts#L266-L312)：

```text
FrontendApplicationContribution.initialize()
FrontendApplicationContribution.configure(app)
CommandRegistry.onStart()       // 此处统一调用全部 registerCommands
KeybindingRegistry.onStart()
MenuModelRegistry.onStart()
FrontendApplicationContribution.onStart(app)
```

这保证了 command 先于 keybindings 和 menus 完成注册，并且 registration side effect 有一个明确、可测试的生命周期入口。

## 5. `ContributionProvider` 如何收集实现

provider 实现在 [`packages/core/src/common/contribution-provider.ts`](https://github.com/eclipse-theia/theia/blob/30844b5882ba6902a8b3fd96991780b5c6ef12cc/packages/core/src/common/contribution-provider.ts#L20-L65)：

```ts
export const ContributionProvider = Symbol('ContributionProvider');

export interface ContributionProvider<T extends object> {
    getContributions(recursive?: boolean): T[];
}

// 首次调用时：
currentServices.push(...currentContainer.getAll(this.serviceIdentifier));
// 之后缓存 services，并释放 container 引用。
```

`bindRootContributionProvider(bind, CommandContribution)` 会绑定一个 named singleton provider，并将查找锚定到 root container，见[同文件](https://github.com/eclipse-theia/theia/blob/30844b5882ba6902a8b3fd96991780b5c6ef12cc/packages/core/src/common/contribution-provider.ts#L100-L130)。业务模块只需创建多重绑定：

```ts
bind(MyCommandContribution).toSelf().inSingletonScope();
bind(CommandContribution).toService(MyCommandContribution);
```

如果该 class 只作为一次性 command contribution 使用，也可按官方 hello-world 示例直接绑定：

```ts
bind(CommandContribution).to(HelloworldCommandContribution);
```

当同一个业务对象还实现 `MenuContribution`、`FrontendApplicationContribution` 等多个贡献接口时，优先 `toSelf().inSingletonScope()` + 多个 `toService(...)`，保证各 contribution token 解析到同一个对象，而不是产生多个 class 实例。

官方文档对 provider 的描述与源码一致：provider 是绑定类型的 contributions 容器，通过 `@inject(ContributionProvider) @named(ContributionToken)` 注入；任何模块绑定该 token 后都会被收集：[Services and Contributions](https://theia-ide.org/docs/services_and_contributions/#contribution-providers)。

## 6. 业务 class 如何注入依赖

官方推荐写法是：constructor 注入 handler 需要的 service，registry 由生命周期方法参数传入。官方 commands 文档示例为：[Commands, Menus and Keybindings](https://theia-ide.org/docs/commands_keybindings/#contributing-commands)

```ts
@injectable()
export class HelloworldCommandContribution implements CommandContribution {
    constructor(
        @inject(MessageService)
        private readonly messageService: MessageService,
    ) { }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(HelloworldCommand, {
            execute: () => this.messageService.info('Hello World!')
        });
    }
}
```

Theia 文档也说明：在 contribution 之外需要访问 registry 时，可以通过 DI 注入 `CommandRegistry`。这适合“执行/查询已有 command”的 consumer；不代表推荐在 constructor 内执行命令注册。

## 7. handler 的注册与执行

注册支持两种形式：

```ts
registry.registerCommand(command, handler);

registry.registerCommand(command);
registry.registerHandler(command.id, handler);
```

源码行为：

- `registerCommand` 保存 command definition；如果带 handler，会继续调用 `registerHandler`；重复 command id 只 warning 并返回空 disposable。见 [`command.ts`](https://github.com/eclipse-theia/theia/blob/30844b5882ba6902a8b3fd96991780b5c6ef12cc/packages/core/src/common/command.ts#L232-L249)。
- 一个 command 可有多个 handler；新 handler 用 `unshift` 放到数组头，因此后注册者优先。见 [`command.ts`](https://github.com/eclipse-theia/theia/blob/30844b5882ba6902a8b3fd96991780b5c6ef12cc/packages/core/src/common/command.ts#L280-L303)。
- `executeCommand` 从头查找第一个没有 `isEnabled` 或 `isEnabled(...args) === true` 的 handler；先等待 `onWillExecuteCommand`，再调用 `handler.execute(...args)`，最后触发 `onDidExecuteCommand`。无 active handler 时抛 `NO_ACTIVE_HANDLER`。见 [`command.ts`](https://github.com/eclipse-theia/theia/blob/30844b5882ba6902a8b3fd96991780b5c6ef12cc/packages/core/src/common/command.ts#L335-L355) 和 [`getActiveHandler`](https://github.com/eclipse-theia/theia/blob/30844b5882ba6902a8b3fd96991780b5c6ef12cc/packages/core/src/common/command.ts#L378-L393)。
- `isVisible`、`isToggled` 分别服务菜单/工具栏展示与 toggle 状态；执行选择只看 `isEnabled`。

## 8. 对 LLM Space 设计讨论的直接含义

如果要沿用 Theia 语义，建议把术语分清：

```ts
export const CommandContribution = Symbol.for('desktop.command.CommandContribution');
export interface CommandContribution {
    registerCommands(registry: CommandRegistry): void;
}
```

```ts
export class CommandRegistry {
    constructor(
        private readonly contributions: ContributionProvider<CommandContribution>,
    ) {}

    start(): void {
        for (const contribution of this.contributions.getContributions()) {
            contribution.registerCommands(this);
        }
    }
}
```

这里 `Symbol.for` 是项目自己的 token policy；其余控制流与 Theia 对齐。若改成业务 class constructor 直接调用 registry，则是另一种 eager self-registration 模式，需要另行解决构造顺序、重复实例化、卸载/dispose 和测试隔离问题，不能再称为 Theia 的 contribution 模式。

