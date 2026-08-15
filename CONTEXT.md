# LLM Space domain model

LLM Space is a local Agent workbench. Desktop exposes two product surfaces over one durable Pi execution kernel: ordinary Playgrounds and code-first Agent Studio Experiments.

## Execution

**Agent**: an Eve-compatible code definition loaded by `@llm-space/agent`. It declares model, instructions, tools, dynamic configuration, and optional hooks. The public definition surface is stable; supported details resolve into Pi operation bindings.

**Pi Session**: durable execution authority. Pi entries own the committed model transcript, operation status, tool results, lane, leaf, outcome, and usage.

**Lane / leaf**: the selected resumable branch and its current committed tip inside a Pi Session.

**Operation**: one admitted user input plus its model/tool actions. The operation binding is resolved once and frozen so restart/retry cannot silently change model, instructions, or tools.

**Step / Continue**: debugger commands that execute one next action or continue automatically. Command receipts are durable and idempotent.

**Tool approval**: a durable Pi suspension. The UI only records Approve/Deny through `thread.resolveToolApproval`; tool effects remain Runtime-owned.

## Products

**Playground**: the main-window editable AgentSpec plus product metadata and a reference to one Pi Session lane/leaf. It is not a JSON file.

**AgentSpec**: Playground-owned editable model, instructions, tools, and prompt variables. It does not own committed Pi messages.

**Agent Project**: a source directory containing one or more `@llm-space/agent` definitions.

**Studio Experiment**: a code-first Agent debugging workspace with product metadata, an editable Draft, evaluation data, and a reference to one Pi Session lane/leaf.

**Draft**: uncommitted product edits. Admission commits the next Pi operation and clears the consumed Draft.

**Thread (UI)**: the editor/read-only projection of one selected Pi lane/leaf. This name is intentionally UI-facing; Thread is not a storage or execution authority.

**Portable Thread Snapshot**: versioned sharing/import envelope containing one selected lane/leaf projection plus source product/session/lane/leaf identity. Import creates a new Playground and Pi Session; it never reopens the source identity.

## Boundaries

Desktop renderer → namespaced Electrobun RPC → Playground/Studio application → `DurablePiRuntime` → Pi Session.

ACP exists only at the CLI/external protocol edge. Desktop has no ACP, SSH, Remote Runtime, headless server, or Plugin compatibility layer. Stateless UI helper generation uses `auxiliaryGeneration.*` and creates no Pi Session. Skills are loaded by host capabilities as variables/tools and are independent of Pi.
