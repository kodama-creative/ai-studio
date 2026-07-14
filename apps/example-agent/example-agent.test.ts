import {
  loadAgentProject,
  loadAgentProjectManifest,
} from "@llm-space/runtime/node";
import { describe, expect, test } from "bun:test";

describe("example Agent Project", () => {
  test("loads its portable source and executes the deterministic tool", async () => {
    const resolved = await loadAgentProjectManifest(import.meta.dir);
    const snapshot = await loadAgentProject(resolved.agentRoot);

    expect(resolved.manifest).toEqual({
      schemaVersion: 1,
      agent: "./agent",
    });
    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.instructions).toContain("concise weather assistant");
    expect(snapshot.tools.map((tool) => tool.name)).toEqual(["get_weather"]);
    expect(snapshot.resources.skills?.map((skill) => skill.name)).toEqual([
      "weather-brief",
    ]);

    const result = await snapshot.tools[0]!.execute("example-test", {
      city: "Shanghai",
    });
    expect(result.content).toEqual([
      { type: "text", text: "Shanghai: Sunny, 22°C" },
    ]);
    expect(result.details).toEqual({ city: "Shanghai", mocked: true });
  });
});
