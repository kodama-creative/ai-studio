import { defineExecutionEnvToolRuntime } from "../../internal/authored-action-definitions";

import type {
  ExecutionEnvToolDefinition,
  ExecutionEnvToolOptions
} from "../definitions/execution-env-tool";

export function defineWriteTool(
  options: ExecutionEnvToolOptions = {}
): ExecutionEnvToolDefinition<"write"> {
  return defineExecutionEnvToolRuntime("write", options);
}
