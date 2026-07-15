import { describe, expect, test } from "bun:test";
import { Value } from "typebox/value";

import { type ProjectTool, Tool } from "./index";

describe("ProjectTool", () => {
  test("accepts safe local and MCP source provenance", () => {
    const tool = {
      type: "project",
      projectId: "project-one",
      snapshot: "snapshot-one",
      name: "weather__forecast",
      description: "Read a forecast",
      parameters: { type: "object" },
      sourcePath: "connections/weather.ts",
      connectionName: "weather",
      remoteToolName: "forecast",
      schemaFingerprint: "sha256:forecast-v1"
    } satisfies ProjectTool;
    expect(Value.Check(Tool, tool)).toBe(true);
  });
});
