import path from "node:path";
import { expect, test } from "bun:test";

test("dispatches inspector editor actions through the command layer", async () => {
  const source = await Bun.file(path.join(
    import.meta.dir,
    "../../../src/components/thread-tabs/external-project-tab-pane.tsx"
  )).text();
  expect(source).toContain('type: "openExternalAgentProjectInEditor"');
  expect(source).not.toContain("externalAgentProjects.openInEditor(");
});
