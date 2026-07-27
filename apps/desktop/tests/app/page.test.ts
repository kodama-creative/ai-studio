import path from "node:path";
import { expect, test } from "bun:test";

import { COMMAND_META } from "../../src/shared/commands";

test("handles external editor actions through the webview command", async () => {
  expect(COMMAND_META.openExternalAgentProjectInEditor).toEqual({
    label: "Open Agent Project in Editor",
    target: "webview"
  });
  const source = await Bun.file(path.join(
    import.meta.dir,
    "../../src/app/page.tsx"
  )).text();
  expect(source).toContain("openExternalAgentProjectInEditor:");
  expect(source).toContain("externalAgentProjects.openInEditor(projectId");
  expect(source).not.toContain("project.threads[0]");
});
