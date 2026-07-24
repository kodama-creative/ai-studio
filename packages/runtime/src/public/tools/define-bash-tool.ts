import { defineExecutionEnvToolRuntime } from "../../internal/authored-action-definitions";

import type {
  ExecutionEnvToolDefinition,
  ExecutionEnvToolOptions
} from "../definitions/execution-env-tool";

export function defineBashTool(
  options: ExecutionEnvToolOptions = {}
): ExecutionEnvToolDefinition<"bash"> {
  return defineExecutionEnvToolRuntime("bash", options);
}
