import { describe, expect, test } from "bun:test";

import type { SkillsHost } from "../../../host";

import { listEnabledPromptVariableSkills } from "./prompt-variable-skills";

describe("listEnabledPromptVariableSkills", () => {
  test("includes enabled skills from the host's effective list", async () => {
    const skills: SkillsHost = {
      getSettings: () => Promise.resolve({ discoveryPaths: [] }),
      listSkills: () => Promise.resolve([]),
      listAvailable: () =>
        Promise.resolve([
          {
            name: "code-review",
            description: "Review code",
            path: "/skills/code-review",
            enabled: true,
          },
        ]),
    };

    expect(await listEnabledPromptVariableSkills(skills)).toEqual([
      {
        name: "code-review",
        description: "Review code",
        path: "/skills/code-review",
        enabled: true,
      },
    ]);
  });
});
