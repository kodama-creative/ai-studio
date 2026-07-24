import { defineExecutionEnvToolRuntime } from "../../internal/authored-action-definitions";

import type {
  ExecutionEnvToolDefinition,
  ExecutionEnvToolOptions
} from "../definitions/execution-env-tool";

export function defineReadTool(
  options: ExecutionEnvToolOptions = {}
): ExecutionEnvToolDefinition<"read"> {
  return defineExecutionEnvToolRuntime("read", options);
}
