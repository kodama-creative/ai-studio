# Vercel Eve Agent Skills 的声明、加载与运行时装配

> 调研基线：Vercel Eve `0.31.3`，提交 [`f835ad5`](https://github.com/vercel/eve/tree/f835ad57409ddf33cd21c52947ec27e8c7024bb7)。
> 范围：只使用 Eve 官方仓库的文档与源码，重点回答 Skill 如何进入 Agent、模型如何发现和加载 Skill，以及如何映射到 LLM Space 的 Pi operation binding。

## 结论

Eve 的 Skill 语义是 **Agent-scoped、framework-advertised、model-loaded-on-demand**：

1. 作者只在 `agent/skills/` 下声明 Skill。Skill 可以是平铺 Markdown、`defineSkill()` 模块，或带 `SKILL.md` 与 sibling files 的目录包；Skill identity 来自路径，不由定义里的 `name` 字段决定。[官方 Skills 文档](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/docs/skills.mdx#L22-L60) [发现实现](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/discover/skills.ts#L53-L140) [`defineSkill` 定义](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/public/definitions/skill.ts#L11-L34)
2. Skill **不是 prompt variable**。Eve 框架直接把每个 Skill 的 `name + description + SKILL.md path` 组成 `Available skills` system-prompt section，并明确要求模型在命中 description 或用户点名时调用 `load_skill`。完整 Markdown 不会预先注入 system prompt。[prompt formatter](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/execution/skills/instructions.ts#L12-L45) [Session prompt composition](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/execution/session.ts#L148-L155)
3. `load_skill` 是 **Eve framework-owned built-in tool**，不是作者在 `agent/tools/` 中声明的工具。它接收 `{ skill: string }`。静态 Skill 直接从已解析 Agent 中返回 Markdown；动态 Skill 优先，并从当前 sandbox 中读取。结果作为普通 tool result 进入当前模型上下文。[工具实现与 schema](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/runtime/framework-tools/skill.ts#L14-L63) [framework tool definition](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/runtime/framework-tools/skill.ts#L78-L116) [官方加载说明](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/docs/skills.mdx#L6-L20)
4. `ctx.getSkill()` 是另一个面向 authored tool/hook 的运行时 API，用于按相对路径读取 Skill package 的 sibling files；它不负责把完整 Skill instructions 暴露给模型，也不能替代 `load_skill`。[官方说明](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/docs/skills.mdx#L66-L75) [callback context 实现](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/context/build-callback-context.ts#L8-L52)
5. Eve 在解析每个 Agent node 时，自动创建一个绑定该 node 已解析静态 Skills 的 `load_skill` definition，并把它与 authored tools 一起注册到 runtime tool registry；作者不需要、也不应该在公共 Agent 定义里重复声明这个工具。[framework registry](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/runtime/framework-tools/index.ts#L47-L83) [Agent graph assembly](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/runtime/resolve-agent-graph.ts#L134-L184)

## 1. Skill 如何声明和发现

Eve 以文件系统作为 authoring interface。`agent/skills/` 支持三种静态形式：

- `skills/<name>.md`
- `skills/<name>.ts|js|...`，默认导出 `defineSkill({...})`
- `skills/<name>/SKILL.md`，并可携带 `references/`、`assets/`、`scripts/` 等 sibling files

发现器对这些形式统一产出 Skill source refs，并检测同名冲突。`defineSkill()` 的 public shape 只描述 `description`、`markdown` 与 files 等内容；identity 仍由 `agent/skills/` 下的路径产生。[发现语法与冲突处理](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/discover/skills.ts#L53-L140) [public definition](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/public/definitions/skill.ts#L11-L34)

Skill 是 per-agent 隔离的：root Agent 与 subagent 不会互相继承 Skill。[官方作用域说明](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/docs/skills.mdx#L62-L64)

## 2. 模型看见什么

在 Skill 尚未加载时，模型只看见框架生成的 `Available skills` section，其中包括：

- Skill name
- routing description
- `SKILL.md` 路径
- 何时调用 `load_skill` 的框架指令

这是 Eve 直接拼进 system prompt 的 framework-owned block，不是 `{{available_skills}}` 一类由作者决定是否引用的模板变量。formatter 的注释还明确说明：active Skill instructions **不会**注入 system prompt，因为模型会从 `load_skill` tool result 获得它们。[formatter contract](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/execution/skills/instructions.ts#L12-L24) [formatter output](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/execution/skills/instructions.ts#L26-L45)

因此 Eve 的 progressive disclosure 分两层：

1. system prompt 常驻 `name + description`，让模型完成 routing；
2. 只有模型调用 `load_skill` 后，完整 Markdown 才作为 tool result 进入上下文。

加载 Skill 只增加 instructions，不会动态增加一组新工具；工具面与 Skill activation 是正交的。[官方语义](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/docs/skills.mdx#L14-L20)

## 3. 谁提供并执行 `load_skill`

`load_skill` 的 name、description、input/output schema 和 executor 全部定义在 Eve runtime 的 framework-tools 中。`createSkillToolDefinition(authoredSkills)` 用闭包把一个 Agent node 的静态 Skills 绑定进 executor：

- 动态 Skill 名称命中时，从 sandbox 读取；
- 否则从闭包捕获的静态 `authoredSkills` 返回 Markdown；
- 动态 Skill 与静态 Skill 同名时，动态 Skill 优先；
- 未找到时返回当前可用 Skill 名称提示。

[executor](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/runtime/framework-tools/skill.ts#L14-L76) [definition factory](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/runtime/framework-tools/skill.ts#L78-L116)

Eve 的 framework registry 将它与其他 built-in tools 放在同一个集合中；Agent graph 解析时用当前 node 的 `agent.skills` 生成 node-specific definition，然后与 authored tools 一起构建 tool registry。[registry](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/runtime/framework-tools/index.ts#L47-L83) [graph assembly](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/runtime/resolve-agent-graph.ts#L134-L184)

技术细节：该版本源码中的 framework list 总是包含 `load_skill`，所以实现上会为 Agent node 注册它，即使静态 Skill 列表为空；官方文档描述的是有 Skill 时向模型暴露它。对 LLM Space 而言，无需复制这个边缘行为，按“resolved Skills 非空时自动加入”更符合公开语义，也避免提供一个只能报 `not found` 的工具。

## 4. 是否按 operation 自动包含和冻结

Eve **自动包含** framework tool，但没有 LLM Space 的“immutable Pi operation binding”这一抽象。Eve 的时点是 Agent graph resolution：

- 编译/解析 Agent node；
- 用该 node 的静态 Skills 创建闭包绑定的 `load_skill`；
- 构建 runtime tool registry 与 turn agent；
- Session 创建或刷新时，从当前 turn agent 重新组装 system prompt 与 model-visible tool metadata。

[graph resolution](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/runtime/resolve-agent-graph.ts#L134-L184) [Session refresh](https://github.com/vercel/eve/blob/f835ad57409ddf33cd21c52947ec27e8c7024bb7/packages/eve/src/execution/session.ts#L119-L169)

所以不能把 Eve 描述成“每个 operation 冻结 Skill tool”。准确说法是：**框架在 Agent runtime graph 上自动装配 agent-scoped `load_skill`，其静态 Skill 集合绑定于该已解析 Agent node；动态 Skills 另由运行时 lifecycle 解析。**

LLM Space 已经选择了 operation-scoped immutable binding，因此应把 Eve 的语义映射到更严格的本地边界：operation start 时解析一次 Skills，同时冻结 Skill advertisement、model-visible loader tool schema 和 loader 的 agent-scoped lookup；Step/Continue 必须继续使用同一 binding。

## 5. 对 LLM Space 当前设计的含义

> 设计决定（2026-08-15）：LLM Space 保留 Eve 的 Skill discovery、agent-scoped loader 与 `ctx.getSkill()` 语义，但有意不自动把 Skill advertisement 追加到 system prompt。Agent instructions 通过变量显式选择插入位置；`agent/skills/index.ts` 可以替换默认变量实现。

在不改变 `@llm-space/agent` 现有 Eve-compatible definitions、仅增补 LLM Space `defineVariable()` 的前提下，职责如下：

| 层 | 应负责的能力 |
| --- | --- |
| `@llm-space/agent` | 保留现有路径发现、`defineSkill`、静态/动态 Skill resolution 和 `SkillHandle`；不要求作者声明 loader tool。 |
| Studio/App host composition | 在 operation resolution 后提供默认 `available_skills` 变量（或执行 `agent/skills/index.ts` 的单一自定义变量），只替换 instructions 中显式出现的占位符；同时自动贡献一个 agent-scoped Skill loader tool。 |
| `@llm-space/pi-runtime` binding | 持久化最终 system prompt、loader tool schema 和能够稳定定位此次 operation Skill 集合的 host binding；Step/Continue 复用，不重新选择。 |
| Desktop built-in tool implementation | 可复用现有 `skill` 的底层读取/格式化能力，但 lookup 必须先进入当前 Agent operation 的 mounted Skills；不能只查全局 `SkillsManager`。 |
| authored tool/hook context | `ctx.getSkill()` 继续用于程序化访问，不承担模型 progressive disclosure。 |

### 工具命名

Eve `0.31.3` 的框架工具叫 `load_skill`，输入为 `{ skill }`；LLM Space 当前 built-in 叫 `skill`，输入为 `{ name }`。这不是 `defineAgent` / `defineSkill` 的 public-definition compatibility 问题，而是 host/model-facing tool contract 的选择：

- 若追求 Eve runtime 行为一致，Agent host 对 code-first Agent 暴露 `load_skill`；
- 若希望复用 LLM Space Playground 已有 prompt 与 UI 语义，可继续暴露 `skill`，但应复用同一个 agent-scoped resolver；
- 不应同时无条件暴露两个同义工具，否则会增加模型选择歧义。

### 必须避免的实现

1. **不要只把 Skill 放进 `ToolContext.getSkill()`。** 这样 authored tool 能读，模型却没有 advertisement 和 loader，和 Eve 行为不一致。
2. **不要把 LLM Space 的变量选择描述成 Eve 原生行为。** Eve 自动注入 advertisement；LLM Space 是有意允许作者决定 Skill 摘要是否进入 prompt。即使作者不引用变量，agent-scoped loader 仍属于已解析 Agent 的工具能力。
3. **不要让 loader 读取一个进程级可变 `currentSkills`。** operation A/B 并发或 source reload 后，Step/Continue 可能读取到别的 operation 的 Skill。lookup 应由当前 operation 的 frozen binding/host binding 定位。
4. **不要把完整 Skill Markdown预先拼进 system prompt。** 变量最多提供 name/description 等摘要，完整内容按需通过 tool result 加载。

## 最终判断

如果问题是“已有 built-in Skill tool 是否应该内置到 Agent”，按 Eve 的实现答案是：**应该由 Studio/App host 自动装配进 Agent 的运行时能力，但不应该把它当成 Pi 自身能力。** LLM Space 只在 prompt advertisement 上做一处明确差异：默认提供 `available_skills` 变量，并允许 `agent/skills/index.ts` 通过新增的 `defineVariable()` 作者 API替换变量名和渲染逻辑；变量未被 instructions 引用时，不自动注入任何 Skill 摘要。

更准确的目标结构是：

```text
agent/skills/*
  -> @llm-space/agent discovery + operation resolution
  -> 默认 available_skills / skills/index.ts 自定义变量
  -> 只在 instructions 显式引用的位置渲染
  -> Studio/App host 自动装配 agent-scoped loader tool
  -> Pi immutable operation binding
  -> 模型按需调用 loader
  -> 完整 Skill Markdown 作为 tool result 进入当前 lane
```

这既保留 Eve-compatible definitions，也满足 LLM Space 的 Pi Session / Step / Continue 可重放要求。
