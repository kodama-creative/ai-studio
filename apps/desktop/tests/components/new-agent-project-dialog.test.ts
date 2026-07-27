import path from "node:path";
import { expect, test } from "bun:test";

test("leaves editor handoff explicit after scaffolding", async () => {
  const source = await Bun.file(path.join(
    import.meta.dir,
    "../../src/components/new-agent-project-dialog.tsx"
  )).text();
  expect(source).not.toContain('type: "openExternalAgentProjectInEditor"');
  expect(source).not.toContain("externalAgentProjects.openInEditor(");
});
