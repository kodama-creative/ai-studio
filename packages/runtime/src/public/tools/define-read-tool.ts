import { defineExecutionEnvToolRuntime } from "../../internal/authored-action-definitions";

import type { ExecutionEnvToolDefinition } from "../definitions/execution-env-tool";

export function defineReadTool(): ExecutionEnvToolDefinition<"read"> {
  return defineExecutionEnvToolRuntime("read");
}
