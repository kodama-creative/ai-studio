import {
  loadAgentProject,
  loadAgentProjectManifest
} from "@llm-space/runtime/node";
import { describe, expect, test } from "bun:test";

describe("example Agent Project", () => {
  test("loads its portable source and executes the deterministic tool", async () => {
    const resolved = await loadAgentProjectManifest(import.meta.dir);
    const snapshot = await loadAgentProject(resolved.agentRoot);

    expect(resolved.manifest).toEqual({
      schemaVersion: 1,
      agent: "./agent"
    });
    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.definition).toEqual({
      limits: { maxModelCallsPerRun: 25 },
      model: { provider: "openai", id: "gpt-5.3-codex" },
      reasoning: "high",
      environment: {
        OPENAI_API_KEY: { kind: "secret", required: true }
      }
    });
    expect(snapshot.instructions).toContain("concise weather assistant");
    expect(snapshot.tools.map(tool => tool.name)).toEqual([
      "get-weather",
      "remember-city"
    ]);
    expect(snapshot.stateDefinitions).toEqual([
      expect.objectContaining({
        name: "example.weather-session",
        version: 1,
        initial: { requestedCities: [] },
        sourcePath: "state/weather-session.ts"
      })
    ]);
    expect(
      snapshot.connections.map(connection => ({
        name: connection.name,
        allow: connection.definition.tools.allow
      }))
    ).toEqual([{ name: "fixture", allow: ["remote_echo"] }]);
    expect(snapshot.resources.skills?.map(skill => skill.name)).toEqual([
      "weather-brief"
    ]);
    expect(snapshot.artifact.fingerprint).toBe(snapshot.fingerprint);
    expect(snapshot.artifact.fingerprints.sources.entries).toHaveLength(7);
    expect(snapshot.artifact.fingerprints.capabilities.entries.map(entry =>
      entry.id)).toEqual([
      "agent",
      "connection:fixture",
      "instruction:instructions.md",
      "instructions",
      "skill:weather-brief",
      "state:example.weather-session",
      "tool:get-weather",
      "tool:remember-city"
    ]);
    expect(snapshot.artifact.fingerprints.schemas.entries.map(entry =>
      entry.id)).toEqual([
      "state:example.weather-session",
      "tool:get-weather:input",
      "tool:get-weather:output",
      "tool:remember-city:input",
      "tool:remember-city:output"
    ]);
    expect(snapshot.artifact.fingerprints.runtime.entries.length).toBeGreaterThan(0);
    expect(
      snapshot.artifact.fingerprints.environmentRequirements.entries.map(
        entry => entry.id
      )
    ).toEqual(["agent-env:OPENAI_API_KEY", "bun@>=1.3.14"]);

    const result = await snapshot.tools[0]!.execute("example-test", {
      city: "Shanghai"
    });
    expect(result.content).toEqual([
      {
        type: "text",
        text: '{"city":"Shanghai","mocked":true,"weather":"Shanghai: Sunny, 22°C"}'
      }
    ]);
    expect(result.details).toEqual({
      city: "Shanghai",
      mocked: true,
      weather: "Shanghai: Sunny, 22°C"
    });
  });
});
