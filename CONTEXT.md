# LLM Space Agent Workbench

LLM Space 同时支持面向用户的 Agent 应用和面向开发者的 Studio。两者共享 Agent 执行语义，但拥有不同的产品数据与展示模型。

## Product application

**Project**:
可选的 Session 组织与资源配置范围。Session 可以不属于任何 Project。

**Studio Project**:
Studio 中承载 Agent 源码、工作目录和运行配置的开发项目，是打开 Studio Experiment 的必要范围。
_Avoid_: Application Project

**Session**:
用户可以打开、继续和归档的稳定工作入口，拥有完整的产品时间线；`threadId` 指向下一次输入默认继续执行的 Agent Thread。
_Avoid_: Conversation、Chat、Execution Session

**Session Message**:
Session 中面向用户、分享和审计的完整时间线记录，不受模型上下文压缩影响。
_Avoid_: Transcript Item、Thread Message

**Task**:
Session 中可选的工作目标，聚合为了同一目标产生的一次或多次 Run。
_Avoid_: Turn、Attempt

## Agent execution

**Agent**:
描述模型、指令、工具和执行策略的可加载程序定义。
_Avoid_: Harness

**Thread**:
Agent 可以持续执行、恢复或分叉的状态身份；它的当前状态由最新 Checkpoint 决定。
_Avoid_: Session、Conversation、Transcript

**Thread State**:
Thread 在某一时刻可继续执行的模型消息与 Agent 自定义状态，其中模型消息允许被压缩或裁剪。
_Avoid_: Transcript、Message History

**Model Message**:
Thread State 中实际供模型交互使用的消息；实现直接复用 `@llm-space/core` 的 `Message`，不再定义 `ConversationMessage` 或 `ModelMessage` 类型。它不是独立的产品时间线记录。
_Avoid_: Session Message

**Checkpoint**:
Thread State 的不可变版本快照，是恢复、分叉和 Run 结果定位的依据。

**Run**:
推动一个 Thread 从某个 Checkpoint 向后执行的一次尝试；一次 Run 可以包含多个模型步骤和工具步骤。
_Avoid_: Turn、Task Attempt、Execution Session

**Resume**:
从同一个 Thread 的最新 Checkpoint 继续执行，不创建新的 Thread。

**Retry**:
从原 Run 开始前的 Checkpoint 分叉出 Child Thread，并以相同输入创建新的 Run；原 Run 保持不变。

**Handoff**:
创建新的 Session 与新的 Root Thread，并复制来源状态；来源 Session 和 Thread 保持不变。

## Studio

**Playground**:
主窗口中可编辑 AgentSpec 并调试执行的稳定工作入口；引用一个 Engine Thread。它不再以本地 JSON 文件作为持久身份。
_Avoid_: Virtual Agent、Notebook、Thread file

**AgentSpec**:
Playground 拥有的可编辑 Agent 声明，包括 model、instructions、tools 和 prompt variables；不包含 Engine Messages/State。

**Project Experiment**:
Agent Project 中调试代码声明 Agent 的稳定入口；引用 Engine Thread，并可在 clean worktree 时绑定 commit。
_Avoid_: Project Thread

**Studio Experiment**:
Studio 中用于编辑 Agent 配置、运行候选结果和进行评测的稳定工作入口；它引用 Engine Thread，但不是 Thread 本身。
_Avoid for new persisted entities_: Studio Thread、Session

兼容说明：现有 Playground/RPC 暂时保留 `StudioThread` 作为由 Experiment + Engine Thread/Checkpoint 组合出的 outward read model；它不是持久化实体。完成 Engine 层迁移后再单独收敛这套 UI 协议命名，当前改造不连带修改旧 `core.Thread`/Playground。

**Studio Draft**:
Studio Experiment 中尚未提交给 Engine 的可编辑工作副本。Run 创建后 Draft 被消费并清除，Engine Checkpoint 重新成为执行状态的事实来源。
_Avoid_: Thread State、Current Checkpoint
