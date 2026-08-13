# Vercel Eve 的 Agent 作者边界、本地开发与线上发布

> 调研日期：2026-08-12
> 调研对象：[Vercel Eve](https://github.com/vercel/eve)，官方定位为 “The Open Framework for Building Agents”
> 基准版本：Eve `0.33.2`，仓库 `main` 提交 [`5cc74a6`](https://github.com/vercel/eve/tree/5cc74a67015fe1a191eb375e2788b0cebb63164e)
> 方法：只使用 Eve 官方文档、官方 GitHub 源码和官方 CI。本文不修改 LLM Space 产品代码。

## 结论

是的，`examples/basic-agent` 里的 `local-host.ts`、`run.ts`、`session-event-renderer.ts` 和 `example-faux-model.ts` 不应该要求 Agent 接入方编写。

Eve 的核心做法不是给每个项目生成一份可修改的 host，而是把 host 做成框架能力：Agent 作者遵循目录约定编写 `agent/` 下的声明和业务实现；统一 CLI 负责发现、编译、启动本地服务、交互调试、持久化、日志、评测、构建与部署。Eve 的教程也明确说，作者只负责 tools、instructions、channels、skills 等能力，model-to-tool loop 由 Eve 驱动，作者不写 loop。[来源：How It Runs](https://github.com/vercel/eve/blob/5cc74a67015fe1a191eb375e2788b0cebb63164e/docs/tutorial/how-it-runs.mdx)

对 LLM Space，合理边界应是：

```text
Agent 项目（用户代码）
  package.json / tsconfig.json       # 脚手架生成，用户通常不需要实现
  agent/
    agent.ts                         # Agent 配置
    instructions.md                  # 指令
    tools/*.ts                       # 业务工具实现
    ...                              # skills / connections / hooks 等
  evals/*.eval.ts                    # 可选，用户编写行为测试

LLM Space（平台代码）
  project discovery / generation loading
  model registry / ToolContext / auth / sandbox
  App + Engine + SQLite composition
  Session / Run lifecycle and cancellation
  streaming projection and dev UI
  file watching / rebuild / diagnostics
  build / start / deploy adapters
```

用户项目里可以保留 `"dev": "llm-space dev"` 之类的脚本，但脚本只是调用平台 CLI，不应对应项目内一份 `local-host.ts`。

## 1. 为什么这里的 Eve 没有同名歧义

本仓库已经给出直接证据：

- [`packages/agent/NOTICE`](../../packages/agent/NOTICE) 标注该包部分代码源自 “Vercel Eve 0.31.3”，并链接 `https://github.com/vercel/eve`。
- [`packages/agent/src/type-contract.test.ts`](../../packages/agent/src/type-contract.test.ts) 将当前声明契约称为 “Eve-compatible agent contract”。
- loader 同时识别扩展包的 `llmSpace.extension.source` 与 `eve.extension.source`。

因此本文研究的是 Vercel 的 filesystem-first Agent framework，不是其他同名产品。需要注意，本仓库派生基准是 Eve 0.31.3，而本次查阅的官方 `main` 已是 0.33.2；CLI 和部署细节可能继续变化。作者边界和目录模型在当前两边仍然一致。

## 2. Eve 让 Agent 作者写什么

### 2.1 最小 Agent

Eve 将文件系统作为 authoring interface。官方文档说明 root Agent 必须有 instructions，`agent.ts` 在使用默认配置时可以省略；tools、skills、channels、connections、sandbox、subagents、schedules 等目录均按需添加。[来源：Project Structure](https://github.com/vercel/eve/blob/5cc74a67015fe1a191eb375e2788b0cebb63164e/docs/project-structure.mdx)、[Project Layout](https://github.com/vercel/eve/blob/5cc74a67015fe1a191eb375e2788b0cebb63164e/docs/reference/project-layout.md)

```text
my-agent/
├── package.json
├── agent/
│   ├── agent.ts          # 可选配置；脚手架默认生成
│   ├── instructions.md   # root Agent 必需
│   └── tools/            # 可选，业务函数
└── evals/                # 可选，行为评测
```

命名来自路径，例如 `agent/tools/get_weather.ts` 自动成为 `get_weather`，作者不再重复填写 `name` 或 `id`。Agent 的名称优先来自 `package.json#name`，否则取项目目录名。[来源：Project Layout](https://github.com/vercel/eve/blob/5cc74a67015fe1a191eb375e2788b0cebb63164e/docs/reference/project-layout.md)

### 2.2 作者必须实现与不必实现的内容

| 类别 | Agent 作者负责 | Eve/平台负责 |
| --- | --- | --- |
| 行为 | instructions、tool 的业务逻辑、需要的 skill | 组装 system prompt、发现并注册能力 |
| 模型 | 在 `defineAgent` 中选择模型及必要选项 | provider/runtime 解析、model-to-tool loop |
| 外部系统 | 声明 connection/channel，补业务 auth 规则 | connection runtime、callback、协议路由 |
| 状态 | 声明业务 state 及其使用方式 | Session/Turn/Step 持久化与恢复 |
| 测试 | 编写输入和业务断言 | 启动测试 host、发送 turn、采集事件和报告 |
| 本地开发 | 执行统一 `dev` 命令 | server、TUI、watch/rebuild、日志、trace |
| 发布 | 选择目标、配置生产凭据/认证 | build host、link、deploy、启动协议 |

框架并没有消灭业务代码。例如 tool 的 `execute()`、生产 channel 的身份认证、不可重复副作用的幂等性仍必须由作者承担。官方关于 durability 的说明是：已完成 Step 不重跑，中断在执行中的 Step 会重跑，因此收费、发邮件等副作用仍要由作者设计幂等或增加 approval。[来源：How It Runs](https://github.com/vercel/eve/blob/5cc74a67015fe1a191eb375e2788b0cebb63164e/docs/tutorial/how-it-runs.mdx)

## 3. Eve 没让作者写 `local-host`

`eve init` 会创建项目、安装依赖和初始化 Git；给已有项目执行 `eve init .` 时，只添加 Agent 目录与缺失依赖。生成的 `package.json` 使用完全通用的命令：

```json
{
  "scripts": {
    "build": "eve build",
    "dev": "eve dev",
    "start": "eve start",
    "typecheck": "tsc"
  }
}
```

脚手架源码中没有为每个项目生成 `local-host.ts`、交互式 CLI、Session repository 或 stream renderer。[来源：官方 scaffold 源码](https://github.com/vercel/eve/blob/5cc74a67015fe1a191eb375e2788b0cebb63164e/packages/eve/src/setup/scaffold/create/project.ts)

脚手架确实会生成少量宿主接入声明，例如默认的 `agent/channels/eve.ts`。但这是 framework channel 的配置和认证策略，不是 Engine/App/Store 的 composition root；而且它由 `eve init` 生成，作者只在生产认证需求变化时修改。[来源：同一 scaffold 源码](https://github.com/vercel/eve/blob/5cc74a67015fe1a191eb375e2788b0cebb63164e/packages/eve/src/setup/scaffold/create/project.ts)

Eve 将以下能力放进 `eve` 包和 CLI：

- Agent 文件发现、diagnostics 与编译；
- durable Session、Turn、Step 执行；
- HTTP host 和本地 workflow store；
- terminal UI、取消、approval/question 交互；
- 开发期 rebuild 和 generation snapshot；
- logs、traces、eval runner；
- production build、start、link 和 deploy。

这正是 `local-host.ts` 应当属于框架而非业务项目的证据。

## 4. Eve 的本地开发

### 4.1 启动和交互

标准入口只有：

```sh
npm run dev
# 实际执行 eve dev
```

`eve dev` 同时启动本地开发 server 和交互式 TUI。TUI 负责消息、tool 展示、approval、question、取消、清空/压缩 Session、模型配置和部署入口；也可以用 `--no-ui` 只启动 server，或者用 `eve dev <url>` 让相同 TUI 连接线上部署。[来源：Dev TUI](https://github.com/vercel/eve/blob/5cc74a67015fe1a191eb375e2788b0cebb63164e/docs/guides/dev-tui.md)、[CLI Reference](https://github.com/vercel/eve/blob/5cc74a67015fe1a191eb375e2788b0cebb63164e/docs/reference/cli.md)

### 4.2 热更新与数据

Eve 的开发 server 管理这些作者不应重复实现的细节：

- `.env` / `.env.local` 由每个 CLI 命令统一加载；
- `.eve/dev-server-state.v1.json` 记录可重连的本地 server；
- `.eve/dev-runtime/snapshots/` 保存不可变 generation，使正在运行的 Turn 继续使用一致代码，新 Turn 使用 rebuild 后的代码；
- rebuild 后 TUI 仍保持逻辑 Session；
- `.eve/.workflow-data` 保存本地 workflow 事件；
- `.eve/logs/` 与 `.eve/traces/` 保存诊断和 trace，并有 retention 规则。

[来源：CLI Reference](https://github.com/vercel/eve/blob/5cc74a67015fe1a191eb375e2788b0cebb63164e/docs/reference/cli.md)

这个设计尤其值得 LLM Space 复用：Studio 与未来 CLI 应当作为同一 Project Runtime 的两个客户端，而不是 Studio 一套 host、每个 Agent example 再手拼一套 host。

## 5. Eve 的本地测试

Eve 区分普通 TypeScript 测试和 Agent 行为 eval。框架提供的是后者：作者在 `evals/**/*.eval.ts` 中写场景，运行：

```sh
eve eval
eve eval --strict --junit .eve/junit.xml
```

没有 `--url` 时，`eve eval` 自动发现 eval、启动本地开发 host、并发执行并收集完整事件；传 `--url` 时，同一批 eval 可直接验证远程部署。报告写入 `.eve/evals/<timestamp>/`，CI 可上传 JUnit 和完整事件 artifact。[来源：Running Evals](https://github.com/vercel/eve/blob/5cc74a67015fe1a191eb375e2788b0cebb63164e/docs/evals/running.mdx)

官方自身的 `agent-basic-runtime` fixture 也只保留 `agent/`、`evals/`、配置文件和通用 scripts，不包含 fixture 自己的 local host。它的 `test:e2e` 只是 `eve eval --strict`。[来源：官方 basic runtime fixture](https://github.com/vercel/eve/tree/5cc74a67015fe1a191eb375e2788b0cebb63164e/e2e/fixtures/agent-basic-runtime)

官方 CI 又把验证拆成两层：

1. local suite 使用真实模型验证模型行为；
2. Vercel world suite 使用确定性 mock model，先 build/deploy，再对 deployment URL 执行同一批 eval，隔离模型波动与部署基础设施问题。

[来源：Eve local E2E workflow](https://github.com/vercel/eve/blob/5cc74a67015fe1a191eb375e2788b0cebb63164e/.github/workflows/e2e-local.yml)、[Vercel E2E workflow](https://github.com/vercel/eve/blob/5cc74a67015fe1a191eb375e2788b0cebb63164e/.github/workflows/e2e-vercel.yml)

这不意味着框架应替代所有 unit test。作者的复杂纯函数、数据库 adapter 或有外部副作用的业务代码仍可用普通 test runner 测试；但 Session/Run、stream、cancel、host boot 等平台行为不应在每个 Agent 项目中重新测试。

## 6. Eve 的构建与线上发布

### 6.1 可运行产物

```sh
eve build
eve start
```

`eve build` 发现并编译 Agent，在 `.eve/builds/` 的 invocation-owned 临时目录完成构建，成功后原子发布 host output；稳定产物是 `.output/`。失败不会覆盖上一次成功的 `.output/`。`eve start` 负责运行这个已构建 host。[来源：CLI Reference](https://github.com/vercel/eve/blob/5cc74a67015fe1a191eb375e2788b0cebb63164e/docs/reference/cli.md)

因此生产 host 仍由框架生成，而不是作者写一个 `server.ts`。

### 6.2 Vercel 的一等发布路径

```sh
eve link
eve deploy
```

- `eve link` 创建或关联 Vercel Project，并拉取 AI Gateway 凭据到 `.env.local`；
- `eve deploy` 执行 production deployment，本质上封装 `vercel deploy --prod`，还负责首次登录/关联、依赖安装和 env pull；
- 本地 TUI 也提供 `/deploy`；
- 发布后可以执行 `eve dev https://deployment-url` 做人工 smoke test，或执行 `eve eval --url https://deployment-url` 做自动验证。

[来源：CLI Reference](https://github.com/vercel/eve/blob/5cc74a67015fe1a191eb375e2788b0cebb63164e/docs/reference/cli.md)、[Ship It tutorial](https://github.com/vercel/eve/blob/5cc74a67015fe1a191eb375e2788b0cebb63164e/docs/tutorial/ship-it.mdx)

Eve package 描述为 “run anywhere”，`build` + `start` 也提供自托管基础面；但本次官方文档里完整的一键 link/deploy 路径只针对 Vercel。不能据此推断任意云的数据库、durability、sandbox、secret 和伸缩都已自动解决。对 LLM Space，应把发布设计成 provider adapter；先定义可移植 build artifact 与 host contract，再为具体平台实现 deploy adapter。

## 7. 与当前 `examples/basic-agent` 的差异

当前 example 的真正业务代码很少：

- `agent/agent.ts`：5 行，选择模型；
- `agent/instructions.md`：业务指令；
- `agent/tools/word-count.ts`：20 行，tool 实现。

但项目同时承担了约 400 行平台代码（不含测试）：

| 当前文件 | 当前职责 | 建议归属 |
| --- | --- | --- |
| `local-host.ts` | loader、generation、Pi provider、Engine、App、SQLite、Session、Run、cancel、ToolContext 的 composition root | LLM Space Project Runtime / host package |
| `run.ts` | 参数解析、interactive REPL、SIGINT、Session attach | 统一 CLI 或 Studio |
| `session-event-renderer.ts` | RunFrame 到终端文本的投影 | 通用 CLI renderer/client |
| `example-faux-model.ts` | 确定性模型与 scripted tool call | 平台测试支持包 |
| `local-host.test.ts` | Session、SQLite、Run 与 cancel 集成验证 | host/CLI integration tests |
| `run.test.ts` | CLI 输出与 SIGINT 验证 | CLI tests |
| `threads/` | 旧的运行数据/fixture | 不进入 Agent 源码模板；测试 fixture 应放测试目录 |

问题不仅是文件多。`local-host.ts` 迫使每个接入方知道并正确组合：

- `@llm-space/app`、`@llm-space/engine`、`@llm-space/engine-pi`；
- SQLite store 的共享路径和关闭顺序；
- generation resolver 的一致性校验；
- provider 注册与环境变量；
- active Run 查找、恢复和取消；
- `ToolContext` 的 sandbox、skills、tokens、auth 行为。

其中当前 example 对 sandbox、skills、tokens、auth 只是直接抛错。若把这当成接入模板，每个作者都会得到一个能力不完整且可能与 Desktop 行为不一致的 host。

另一个边界信号是依赖：当前 Agent example 直接依赖 `agent + app + core + engine + engine-pi + pi-ai`。面向接入方的项目应主要依赖稳定的 Agent authoring API 和一个 CLI/runtime 包；App/Engine/SQLite/Pi adapter 是平台实现细节，不应成为每个项目的直接 composition 依赖。

## 8. 对 LLM Space 的建议目标

### 8.1 公开 Agent 项目

建议脚手架输出：

```text
my-agent/
├── package.json
├── tsconfig.json
├── agent/
│   ├── agent.ts
│   ├── instructions.md
│   └── tools/
└── evals/                 # 可选
```

`package.json` 只暴露稳定命令，例如：

```json
{
  "scripts": {
    "dev": "llm-space dev",
    "build": "llm-space build",
    "start": "llm-space start",
    "eval": "llm-space eval"
  }
}
```

命令名称只是建议，关键是所有命令调用同一个平台实现，不在项目中生成可漂移的 host 源码。

### 8.2 平台内部的一个组合根、多个驱动端

```text
                         ┌─ Studio Project window
Agent project ─ loader ─ Project Runtime
                         ├─ CLI dev / eval
                         └─ production host / deploy adapter
```

`Project Runtime` 应统一负责：

- load/resolve immutable Agent generation；
- 注入 model registry、ToolContext、sandbox、skills、connections、auth；
- 创建 App/Engine/Store 并管理关闭和 recovery；
- 提供 Session/Run command + event stream API；
- 把运行数据写到 LLM Space home 或部署环境的 data plane，而不是项目源码目录。

Studio、CLI、线上 host 只做 transport/UI adapter。这样 Studio 里调试过的语义才和本地 CLI、线上部署一致。

### 8.3 推荐实施顺序

1. **先抽 host**：把 `local-host.ts` 的通用 composition 移到平台包，定义最小 `ProjectRuntime` API；Desktop Project execution 与 example 共用它。
2. **再瘦身 example**：公开 example 只保留 `agent/`、可选 `evals/` 和通用 scripts；把 faux model 与 host tests 移到平台 integration fixture。
3. **补 dev driver**：Studio 已经是主要调试 UI，CLI 可以是薄 driver；两者共享 generation reload、Session/Run 和事件协议。
4. **补 build/start contract**：生成不可变 Agent artifact，明确运行时版本、入口、资源文件和环境需求。
5. **最后做 deploy adapter**：先实现一个目标平台，同时保留 provider-neutral artifact；线上发布后复用同一 eval 协议做 smoke test。

## 9. 目前已经具备与尚缺的能力

| 能力 | 当前状态 |
| --- | --- |
| filesystem-first Agent 定义与 loader | 已有 `@llm-space/agent` |
| durable Thread/Run/Checkpoint 与 SQLite | 已有 `@llm-space/engine` |
| Pi model/tool Step 执行 | 已有 `@llm-space/engine-pi` |
| Session 投影与 SQLite | 已有 `@llm-space/app` |
| Project/Experiment 调试 UI | 正在由 Desktop + Studio 建设 |
| 通用 Project Runtime composition root | 尚未形成；目前散落在 Desktop 与 `basic-agent/local-host.ts` |
| 通用 dev CLI / headless dev server | 尚未形成 |
| Agent eval authoring + runner | 尚未形成完整公开契约 |
| immutable build artifact + `start` | 尚未形成 |
| production deploy adapter | 尚未形成 |

现有 `apps/server` 依赖的是 `@llm-space/runtime`，不是新的 Agent/App/Engine Project Runtime，因此不能直接视为 code-first Agent 的 production host。它可以提供 HTTP server、鉴权和打包经验，但需要先对齐新的执行链路，不能让 example 反向依赖 legacy server 来凑发布路径。

## 10. 一手资料索引

- [Vercel Eve repository](https://github.com/vercel/eve)
- [Eve README / filesystem authoring interface](https://github.com/vercel/eve/blob/5cc74a67015fe1a191eb375e2788b0cebb63164e/README.md)
- [Installation](https://github.com/vercel/eve/blob/5cc74a67015fe1a191eb375e2788b0cebb63164e/docs/installation.mdx)
- [Project Structure](https://github.com/vercel/eve/blob/5cc74a67015fe1a191eb375e2788b0cebb63164e/docs/project-structure.mdx)
- [Project Layout](https://github.com/vercel/eve/blob/5cc74a67015fe1a191eb375e2788b0cebb63164e/docs/reference/project-layout.md)
- [CLI Reference](https://github.com/vercel/eve/blob/5cc74a67015fe1a191eb375e2788b0cebb63164e/docs/reference/cli.md)
- [Dev TUI](https://github.com/vercel/eve/blob/5cc74a67015fe1a191eb375e2788b0cebb63164e/docs/guides/dev-tui.md)
- [Running Evals](https://github.com/vercel/eve/blob/5cc74a67015fe1a191eb375e2788b0cebb63164e/docs/evals/running.mdx)
- [How It Runs](https://github.com/vercel/eve/blob/5cc74a67015fe1a191eb375e2788b0cebb63164e/docs/tutorial/how-it-runs.mdx)
- [Ship It](https://github.com/vercel/eve/blob/5cc74a67015fe1a191eb375e2788b0cebb63164e/docs/tutorial/ship-it.mdx)
- [Scaffold implementation](https://github.com/vercel/eve/blob/5cc74a67015fe1a191eb375e2788b0cebb63164e/packages/eve/src/setup/scaffold/create/project.ts)
- [Official basic runtime fixture](https://github.com/vercel/eve/tree/5cc74a67015fe1a191eb375e2788b0cebb63164e/e2e/fixtures/agent-basic-runtime)
- [Local E2E workflow](https://github.com/vercel/eve/blob/5cc74a67015fe1a191eb375e2788b0cebb63164e/.github/workflows/e2e-local.yml)
- [Vercel E2E workflow](https://github.com/vercel/eve/blob/5cc74a67015fe1a191eb375e2788b0cebb63164e/.github/workflows/e2e-vercel.yml)
