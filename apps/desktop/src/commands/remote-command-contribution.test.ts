import { expect, mock, test } from "bun:test";

await mock.module("@/lib/electrobun", () => ({ electrobun: {} }));

const { RendererCommandRegistry } = await import(
  "./renderer-command-registry"
);
const { RemoteCommandContribution } = await import(
  "./remote-command-contribution"
);

test("native Commands execute through typed remote Services", async () => {
  const calls: string[] = [];
  const imported: unknown[] = [];
  const registry = new RendererCommandRegistry();
  registry.registerCommandHandlers({
    "playground.importFiles": ({ files }) => {
      imported.push(files);
    },
  });
  const contribution = new RemoteCommandContribution(
    registry,
    {
      toggleMaximized: () => Promise.resolve(),
      zoomIn: () => Promise.resolve(),
      zoomOut: () => Promise.resolve(),
      resetZoom: () => Promise.resolve(),
      reload: () => {
        calls.push("reload");
        return Promise.resolve();
      },
    } as never,
    {
      openLink: (url: string) => {
        calls.push(`link:${url}`);
        return Promise.resolve();
      },
      openDocument: () => Promise.resolve(),
      reportBugs: () => Promise.resolve(),
    },
    {
      pickImportFiles: () => Promise.resolve([]),
      readClipboardImport: () =>
        Promise.resolve([{ name: "thread.json", text: "{}" }]),
    } as never,
    { open: () => Promise.resolve() } as never,
    { signIn: () => Promise.resolve(), signOut: () => Promise.resolve() } as never,
    { check: () => Promise.resolve(), applyAndRestart: () => Promise.resolve() } as never
  );
  contribution.start();

  registry.executeCommand({ type: "window.reload", args: {} });
  registry.executeCommand({
    type: "shell.openLink",
    args: { url: "https://example.com" },
  });
  registry.executeCommand({ type: "playground.importFromClipboard", args: {} });
  await Promise.resolve();
  await Promise.resolve();

  expect(calls).toEqual(["reload", "link:https://example.com"]);
  expect(imported).toEqual([[{ name: "thread.json", text: "{}" }]]);

  contribution.stop();
});
