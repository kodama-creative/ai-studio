# WorkBuddy AI 的 Agent Loop 与本地文件沙箱

> 调研日期：2026-08-10  
> 本机版本：WorkBuddy AI 5.1.0（macOS arm64）  
> 方法：只读检查本机安装包、代码签名/entitlements、内置 CLI 与原生 sandbox binary，并与 WorkBuddy/CodeBuddy 官方文档及隐私政策交叉验证。未启动应用、未修改应用或配置、未读取用户会话正文或凭据。

## 结论

WorkBuddy AI 是一个**本地编排、模型可远程也可本地**的混合架构。

- 对当前桌面版的常规交互式任务，外层 agent loop（维护会话、限制 turn 数、接收模型 tool call、调度工具、把 tool result 送入下一轮）在本机内置的 CodeBuddy CLI/Runner 进程中运行，置信度高。
- 默认内置模型的推理在云端：官方隐私政策明确说输入会发给第三方大模型处理。自定义 API 则直连用户配置的模型端点；配置本机 Ollama 时，模型推理也可以留在本机。
- 文件、命令、浏览器等动作由本机工具执行。官方隐私政策明确区分“模型输出”和“用户设备本地的工具执行”。
- “沙箱”主要约束 **Bash/PowerShell 命令及其子进程**，不是把整个 Electron App 放进 macOS App Sandbox。macOS 上命令沙箱使用 Seatbelt；文件和网络规则由本地 `sandbox-cli` 管理。
- `Read`/`Write`/`Edit` 等 direct filesystem tools 由本地 CLI 直接实现，不是把每次文件 API 调用都包进 Seatbelt。它们受工具权限流以及 sandbox 的 `denyRead`/`denyWrite` 规则约束；`allowWrite` 的 OS 级 allow-only 边界主要属于 Bash sandbox。不要把“Bash 被 Seatbelt 沙箱化”误解成“整个桌面进程及所有文件 API 都被同一个 OS 沙箱包住”。

简化的数据流如下：

```text
用户任务
  -> 本机 Electron UI
  -> 本机 sidecar
  -> 本机 CodeBuddy CLI / Runner（outer agent loop）
  -> 模型调用
       - 默认内置模型：第三方云端 LLM
       - 自定义 API：用户指定端点
       - Ollama：本机 127.0.0.1:11434
  <- assistant 内容 / tool call
  -> 本机权限判断
  -> 本机工具执行
       - Bash/PowerShell：sandbox-cli -> macOS Seatbelt -> 子进程
       - Read/Write/Edit：本地文件工具 + 权限/deny 规则
       - 浏览器/第三方软件：本机对应软件
  <- tool result
  -> 下一轮模型调用，直到完成或达到 turn 上限
```

## 证据分级

以下内容刻意分成三类：

1. **官方披露**：能说明产品承诺、数据流和用户可见行为，但通常不披露进程级实现。
2. **本机安装包静态分析**：能说明 5.1.0 这一构建包含和调用了什么代码，但不是运行时网络抓包。
3. **综合判断**：由多条证据拼接得出，并明确保留不确定性。

## 1. Agent loop 在哪里

### 1.1 本机静态证据：桌面端拉起本地 sidecar 和 per-session CLI

安装包是 Electron 应用：

- `/Applications/WorkBuddy AI.app/Contents/Info.plist`
  - `CFBundleIdentifier = com.workbuddy.workbuddy-ai`
  - `CFBundleShortVersionString = 5.1.0`
  - `CFBundleExecutable = Electron`
- `/Applications/WorkBuddy AI.app/Contents/Resources/app.asar`
  - 内含 `main/index.js`、`main/sidecar-entry.js`。
- `/Applications/WorkBuddy AI.app/Contents/Resources/app.asar.unpacked/cli/`
  - 内含完整 `@genie/agent-cli`、`dist/codebuddy.js`、`bin/codebuddy`、产品配置和原生 `vendor/sandbox/sandbox-cli`。

`app.asar!/main/index.js` 的 `SidecarManager.spawnSidecar()` 明确：

- 以 Electron executable 启动 `sidecar-entry.js`；
- 注入 `ELECTRON_RUN_AS_NODE=1`，使其作为普通 Node.js 本地进程运行；
- sidecar 通过本机 Unix socket/pipe 与主进程通信。

同一文件的 `CodeBuddyCodeSessionBackend.initializeInternal()` 又为每个会话构造本地 runtime：

- `command` 是本机 Electron executable；
- 第一个参数是内置 `cli/bin/codebuddy`；
- 参数含 `--serve`、`--session-id`、会话工作目录和权限模式；
- sidecar 返回 `http://127.0.0.1:<port>/api/v1/acp`；
- Electron 主进程用 ACP client 连接这个 loopback endpoint。

`app.asar!/main/sidecar-entry.js` 的注释和实现也直接说明：

> `SessionProcess ... host a CLI (agent-cli --serve) instance per session.`

macOS/Linux 使用 `@lydell/node-pty` 启动进程；Windows 使用 `child_process.spawn`。文件还写明桌面端真正的 transport 是绑定 `127.0.0.1` 的 CLI ACP HTTP server。

### 1.2 本机静态证据：loop 与工具调度代码在内置 CLI

`app.asar.unpacked/cli/dist/codebuddy.js` 中可复核到：

- `Runner`、`RunnerProvider`、`AgentService`、`SessionManager`；
- `DEFAULT_MAX_TURNS = 500`，以及 `CODEBUDDY_CODE_MAX_TURNS`；
- `runner.run(..., { maxTurns, stream: true })`；
- assistant function call、`function_call_result`/`tool_result`、继续下一轮的本地历史处理；
- `Read`、`Write`、`Edit`、`Bash`、`PowerShell`、`Glob`、`Grep`、MCP、subagent 等工具注册。

这比“工具在本地”更进一步：会话状态、turn 上限、模型响应解析、tool result 回填和继续运行的代码都在本机 CLI bundle 中。因此，对该版本桌面会话可把 **outer agent loop 位于本机** 视为高置信结论。

### 1.3 官方交叉验证

官方 Overview 说 agents 会在 `their local computer` 上自主规划和执行多步任务；Assistant 文档说手机发来的任务由 `Tencent WorkBuddy on your computer automatically executes the task`；FAQ 明确桌面客户端必须保持运行，才能接收和执行远程任务。

来源：

- [WorkBuddy Overview](https://www.workbuddy.ai/docs/workbuddy/Overview)
- [Assistant](https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Assistant)
- [FAQ](https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/FAQ)

官方没有公开 outer loop 的进程图；“loop 位于本机”的最终判断因此主要来自本机 5.1.0 安装包，官方文档只做交叉验证。

## 2. 模型推理在哪里

### 2.1 默认模型：云端第三方 LLM

中国区 PC 隐私政策 3.6.3 明确披露：

> 用户通过对话框主动发送或授权我们获取的输入内容，将由我们收集并向第三方大模型发送、第三方大模型将自行处理并直接向用户返回输出内容。

这说明“loop 本地”不等于“内容不出机”。发送给模型的上下文可能包含用户输入、上传文件或授权获取的内容；工作区边界是本地操作边界，不是自动的数据防外传边界。

来源：

- [《WorkBuddy 隐私保护指引（PC 端）》](https://privacy.qq.com/document/preview/771d9a58551449e9a7e7445ebfe04966)
- [同一政策的腾讯官方 JSON](https://privacy.qq.com/document_ext_api/product-doc/detail?id=771d9a58551449e9a7e7445ebfe04966)

### 2.2 自定义 API 与 Ollama

同一隐私政策说，自定义模型的 API Key 仅保存在本地设备，输入直接发往相应模型。官方模型文档进一步说明：

- 自定义 API：WorkBuddy 直连用户填写的 URL；数据落点取决于该 provider。
- Ollama：连接本机默认 `11434` 的 OpenAI-compatible interface，官方描述为代码和对话内容不离开本机，并可离线使用。

来源：[Model](https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model)

安装包的 `cli/product.json` 也把当前产品标为 `deploymentType: "SaaS"`，并列有远程 WorkBuddy endpoint；CLI bundle 同时包含多种云模型 provider adapter。这与官方披露一致。

## 3. 本地文件沙箱如何协作

### 3.1 两层控制，不是一个“大容器”

WorkBuddy 的本地安全至少分为两层：

1. **工具权限层**：根据 permission mode、allow/ask/deny rule、命令风险分类决定允许、拒绝或向用户确认。
2. **命令 OS 沙箱层**：允许执行 Bash/PowerShell 后，再让命令进入 `sandbox-cli` 创建的 filesystem/network 边界。

官方 Permission Modes 文档的表述是：

> Commands run under sandbox constraints first. If they are blocked, WorkBuddy then decides whether confirmation is needed based on risk.

来源：[Permission Modes](https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Permission-Modes)

因此“用户点了允许”和“进程能访问任意路径”不是同一个概念；sandbox 拦截后还可能触发 allow once、永久加规则或拒绝。

### 3.2 Bash/PowerShell 的路径

内置 CLI 的 `BashSandboxManager` 读取 `~/.workbuddy/settings.json` 中的 `sandbox` 配置，并将规则下发给本地原生 binary：

- `OpenSession` / `CloseSession`
- `RunExecutable`
- `AddFileRule` / `RemoveFileRule`
- `AddNetworkRule` / `RemoveNetworkRule`
- `GetRules`、统计和 sandbox intercept choice

默认配置的关键语义是：

- `filesystem.allowWrite` 包含当前工作目录 `.` 及必要的缓存/工具目录；
- `denyRead`、`denyWrite` 可额外配置；
- network 有 allowed/denied domains、local binding、Unix socket 规则；
- 设置可允许或禁止 `dangerouslyDisableSandbox` 逃生路径；逃生仍走普通权限确认。

官方 Bash Sandbox 文档给出的用户级语义：

- 当前工作目录及子目录默认可读写；
- 整机默认可读，但显式 deny 的目录除外；
- 不可直接修改工作目录外文件，除非获得明确授权/更新规则；
- 网络通过 sandbox 外的 proxy 按 domain 控制；
- sandbox 内启动的子进程继承相同边界。

来源：[Bash Sandbox](https://www.codebuddy.ai/docs/cli/bash-sandboxing)

### 3.3 direct Read/Write/Edit 的边界

这是最容易混淆的一点。

`Read`/`Write`/`Edit` 是本机 CLI 的 direct tools，不需要通过 Bash 启动 shell，因此没有证据表明每次 direct file operation 都进入 Seatbelt 子进程。安装包代码展示的协作方式是：

- `BashSandboxManager.loadConfig()` 得到 `denyRead` / `allowWrite` / `denyWrite`；
- `ToolPermissionService.syncSandboxDenyRules()` 把 `denyWrite` 映射成 `Write`、`Edit`、`MultiEdit`、`NotebookEdit` 的 deny rules；
- 把 `denyRead` 映射成 `Read`、`Glob`、`Grep`、`NotebookRead` 的 deny rules；
- `allowWrite` 则由 sandbox shell service 下发给 `sandbox-cli`，形成 Bash 子进程的 OS 级写入 allowlist。

官方 Bash Sandbox 文档也只承诺：配置文件的 `denyWrite` 同时适用于 Bash 和 file editing tools。它没有声称 direct tools 全部运行在同一个 Seatbelt profile 内。

因此可安全下结论：

- Bash/PowerShell：权限判断 + OS 级 sandbox。
- Direct file tools：本地权限判断 + sandbox deny rule 同步；不能仅凭 Bash sandbox 推断其拥有完全相同的 OS 级 allowWrite 包络。

### 3.4 macOS 特例

应用本体的签名 entitlements 包含 JIT、网络 client/server、user-selected read-write 等能力，但**没有** `com.apple.security.app-sandbox`。因此 Electron 主进程和本地 CLI 不是 Apple App Sandbox 容器里的受限应用；它们原则上继承当前用户权限。

可复核命令：

```bash
codesign -d --entitlements :- '/Applications/WorkBuddy AI.app'
```

原生 `/Applications/WorkBuddy AI.app/Contents/Resources/app.asar.unpacked/cli/vendor/sandbox/sandbox-cli` 的静态字符串和 Rust 模块路径显示：

- macOS profile 使用 Seatbelt，调用 `/usr/bin/sandbox-exec -p`；
- profile 从 deny-default/限制写入开始，根据 file rules 加 allow/deny；
- 网络通过本地 HTTP/SOCKS proxy 和可选 NetworkExtension bridge 管理；
- `sandbox-config.json` 给出了 app group、NetworkExtension/FileProvider bundle id 等本地协作标识。

官方文档也明确写明 macOS 使用 Seatbelt。也就是说，被 OS sandbox 限制的是 `sandbox-cli` 启动的命令树，而不是整个 WorkBuddy Electron 进程。

## 4. 本机实际状态与限制

检查时 WorkBuddy 没有在运行，也没有在预期的 `~/.workbuddy` / `~/.workbuddy-ai` 路径发现已生成的用户配置。因此本次没有动态抓取进程树、loopback ACP 流量或模型请求，也无法判断这台机器当前 UI 中 sandbox toggle 的最终值。

静态代码里通用 CLI 的 `DEFAULT_SANDBOX_CONFIG.enabled` 是 `false`；桌面端又维护独立的 `sandboxSafetyEnabled`，按会话通过 `session/set_config_option` 将 sandbox 开关推给 CLI。官方 WorkBuddy 文档描述常规命令先进入 sandbox。三者共同说明“是否启用”是产品/会话配置结果，不能仅看 CLI 通用默认值。

如果以后需要做动态确认，最小只读验证是：启动一个无敏感内容的空白任务，观察本机进程树、`127.0.0.1` 监听端口和出站域名；不需要读取请求正文即可确认进程和网络边界。

## 5. 数据与遥测提醒

- `cli/product.json` 静态配置中 standard/model telemetry 和 tracing 均为 enabled；这说明构建具备并默认配置了上报能力，但不等价于每种正文都会被上传。
- 中国区隐私政策披露会收集操作记录、设备/浏览器信息、时间信息及对话记录；用于模型优化的开关可在“设置 → 系统设置 → 体验优化计划”关闭。
- 自定义模型 API Key 按官方披露仅保存在本地；不要把这理解成输入也必然留在本地——输入仍会发到用户选择的模型 endpoint。
- 海外版政策与中国区政策在存储地区、保留期和部分默认设置上不同，本文以本机中国区 PC 政策作为主要法律文本。海外政策仅作交叉验证：[WorkBuddy Privacy Policy](https://www.workbuddy.ai/document/privacy-policy)。

## 6. 尚不能证明的事项

- 无官方公开架构图说明每一个 agent state machine 对象的进程边界；本地 loop 的高置信判断来自安装包 5.1.0。
- 未做运行时 TLS 解密，不能列出一次真实任务具体发送了哪些 prompt、文件片段或 tool result。
- `Full Access` 官方只明确关闭逐步确认；是否在所有场景都关闭命令 sandbox 本身，官方文档没有充分说明。
- 安装包包含 cloud-agent、remote sandbox/E2B 等可选路径，但这不代表常规桌面会话使用它们。特定“云端 Agent”功能可能有不同执行边界，需要按功能另测。
- NetworkExtension/FileProvider 相关标识和代码存在于构建中，但未动态验证本机当前是否加载这些扩展；macOS command sandbox 的 Seatbelt 路径已有官方文档和 binary 双重证据。

## 7. 复核入口

安装包内最有价值的路径：

```text
/Applications/WorkBuddy AI.app/Contents/Info.plist
/Applications/WorkBuddy AI.app/Contents/Resources/app.asar
/Applications/WorkBuddy AI.app/Contents/Resources/app.asar.unpacked/cli/package.json
/Applications/WorkBuddy AI.app/Contents/Resources/app.asar.unpacked/cli/product.json
/Applications/WorkBuddy AI.app/Contents/Resources/app.asar.unpacked/cli/sandbox-config.json
/Applications/WorkBuddy AI.app/Contents/Resources/app.asar.unpacked/cli/dist/codebuddy.js
/Applications/WorkBuddy AI.app/Contents/Resources/app.asar.unpacked/cli/vendor/sandbox/sandbox-cli
```

建议在解包后的 `main/index.js` / `main/sidecar-entry.js` 搜索：

```text
SidecarManager
spawnSidecar
resolveCLIPath
CodeBuddyCodeSessionBackend
initializeInternal
127.0.0.1
/api/v1/acp
setSandboxMode
session/set_config_option
```

在 `cli/dist/codebuddy.js` 搜索：

```text
DEFAULT_MAX_TURNS
RunnerProvider
AgentService
BashSandboxManager
DEFAULT_SANDBOX_CONFIG
syncSandboxDenyRules
ADD_FILE_RULE
RUN_EXECUTABLE
```

