import { expect, mock, test } from "bun:test";

import { CommandContribution } from "../di/command-contribution";
import { CommandRegistry } from "../di/command-registry";
import { SnapshotContributionProvider } from "../di/contribution-provider";
import { createDesktopProcessContainer } from "../di/process-container";

const openFileDialog = mock<() => Promise<string[]>>(() => Promise.resolve([]));
await mock.module("electrobun/bun", () => ({
  Utils: { openFileDialog, paths: { documents: "/documents" } },
}));
const {
  nativeDialogsApplicationModule,
  nativeDialogsContributionsModule,
} = await import("./native-dialogs-module");

test("native import failures are contained by the window CommandRegistry", async () => {
  const failure = new Error("picker failed");
  openFileDialog.mockRejectedValue(failure);
  const process = createDesktopProcessContainer();
  process.load(nativeDialogsApplicationModule());
  const scope = process.createWindowScope("native-dialogs-test");
  scope.load(
    nativeDialogsContributionsModule({ sendToWebview: mock(() => undefined) })
  );
  const failures: unknown[] = [];
  const registry = new CommandRegistry(
    new SnapshotContributionProvider(() =>
      scope.getAll(CommandContribution)
    ),
    { sendToWebview: mock(() => undefined) },
    (_type, error) => failures.push(error)
  );
  registry.onStart();

  registry.execute({ type: "playground.importFiles", args: {} });
  await Promise.resolve();
  await Promise.resolve();

  expect(failures).toEqual([failure]);
  openFileDialog.mockReset();
  await registry.dispose();
  await process.dispose();
});
