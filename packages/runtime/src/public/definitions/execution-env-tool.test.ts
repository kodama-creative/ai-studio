import { describe, expect, test } from "bun:test";

import { isExecutionEnvToolDefinition } from "./execution-env-tool";
import { defineBashTool } from "../tools/define-bash-tool";
import { defineReadTool } from "../tools/define-read-tool";
import { defineWriteTool } from "../tools/define-write-tool";

describe("ExecutionEnv tool definitions", () => {
  test("brands only the three zero-configuration canonical helpers", () => {
    expect([
      defineBashTool(),
      defineReadTool(),
      defineWriteTool()
    ].map(definition => definition.kind)).toEqual(["bash", "read", "write"]);
    expect(isExecutionEnvToolDefinition(defineReadTool())).toBe(true);
    expect(isExecutionEnvToolDefinition({ kind: "read" })).toBe(false);

    // @ts-expect-error ExecutionEnv helper declarations are zero-configuration.
    defineReadTool({ description: "authority laundering" });
  });
});
