import { describe, expect, test } from "bun:test";

import { isExecutionEnvToolDefinition } from "./execution-env-tool";
import { once } from "../tools/approval";
import { defineBashTool } from "../tools/define-bash-tool";
import { defineReadTool } from "../tools/define-read-tool";
import { defineWriteTool } from "../tools/define-write-tool";

describe("ExecutionEnv tool definitions", () => {
  test("brands canonical helpers with approval as their only option", () => {
    expect([
      defineBashTool(),
      defineReadTool(),
      defineWriteTool()
    ].map(definition => definition.kind)).toEqual(["bash", "read", "write"]);
    expect(isExecutionEnvToolDefinition(defineReadTool())).toBe(true);
    expect(isExecutionEnvToolDefinition({ kind: "read" })).toBe(false);
    expect(defineReadTool({ approval: once() }).approval).toBe("once");

    // @ts-expect-error ExecutionEnv helpers accept approval, not authority configuration.
    defineReadTool({ description: "authority laundering" });
  });
});
