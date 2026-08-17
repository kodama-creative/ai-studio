import { expect, mock, test } from "bun:test";

import { Container } from "inversify";

const openFileDialog = mock<() => Promise<string[]>>(() => Promise.resolve([]));
await mock.module("electrobun/bun", () => ({
  Utils: { openFileDialog, paths: { documents: "/documents" } },
}));
const {
  NativeDialogsApplication,
  nativeDialogsApplicationModule,
} = await import("./native-dialogs-module");

test("native import picker failures propagate through the Service", async () => {
  const failure = new Error("picker failed");
  openFileDialog.mockRejectedValue(failure);
  const desktop = new Container();
  desktop.load(nativeDialogsApplicationModule());
  const application = desktop.get(NativeDialogsApplication);

  expect(application.pickImportFiles()).rejects.toBe(failure);
  await application.pickImportFiles().catch(() => undefined);

  openFileDialog.mockReset();
  await desktop.unbindAllAsync();
});
