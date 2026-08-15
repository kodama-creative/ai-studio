import { expect, test } from "bun:test";

import type { ModelManager } from "@llm-space/runtime/models";

import { ProjectGeneratorApplication } from "./project-generator-application";

test("Generator resolves model and requested environment secrets inside its own slice", async () => {
  const key = "LLM_SPACE_GENERATOR_APPLICATION_TEST_KEY";
  const previous = process.env[key];
  process.env[key] = "environment-secret";
  const connections: unknown[] = [];
  const models = {
    resolveConnection(input: unknown) {
      connections.push(input);
      return Promise.resolve({ apiKey: "model-secret" });
    },
  } as Pick<ModelManager, "resolveConnection">;
  const application = new ProjectGeneratorApplication(
    { pickDirectory: () => Promise.resolve(null) },
    models
  );

  try {
    expect(
      await application.resolveEnv({
        providerId: "provider-1",
        profileId: "profile-1",
        envNames: [key, "LLM_SPACE_GENERATOR_APPLICATION_MISSING_KEY"],
      })
    ).toEqual({
      modelApiKey: "model-secret",
      envValues: {
        [key]: "environment-secret",
        LLM_SPACE_GENERATOR_APPLICATION_MISSING_KEY: "",
      },
    });
    expect(connections).toEqual([
      { providerId: "provider-1", profileId: "profile-1" },
    ]);
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});
