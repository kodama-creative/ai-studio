import { describe, expect, test } from "bun:test";

import { COMMAND_META } from "../../shared/commands";

import {
  WindowCommandBus,
  type CommandHandlerContribution,
} from "./command-contribution";

const SCOPE = {} as never;

describe("WindowCommandBus", () => {
  test("all command identities include a business namespace", () => {
    expect(Object.keys(COMMAND_META).every((type) => type.includes("."))).toBe(
      true
    );
  });

  test("forwards unclaimed webview commands", () => {
    const forwarded: unknown[] = [];
    const bus = new WindowCommandBus(SCOPE, [], "main", {
      window: () => ({}) as never,
      sendToWebview: (command) => forwarded.push(command),
    });
    const command = { type: "app.openSettings", args: {} } as const;
    bus.execute(command);
    expect(forwarded).toEqual([command]);
  });

  test("dispatches one Bun command to its contribution", () => {
    const executed: unknown[] = [];
    const contribution: CommandHandlerContribution = {
      id: "shell.links",
      windows: ["main"],
      create: () => ({
        commands: ["shell.openLink"],
        execute: (command) => executed.push(command),
      }),
    };
    const bus = new WindowCommandBus(SCOPE, [contribution], "main", {
      window: () => ({}) as never,
      sendToWebview: () => undefined,
    });
    const command = {
      type: "shell.openLink",
      args: { url: "https://example.com" },
    } as const;
    bus.execute(command);
    expect(executed).toEqual([command]);
  });

  test("rejects duplicate command ownership", () => {
    const contribution = (
      id: CommandHandlerContribution["id"]
    ): CommandHandlerContribution => ({
      id,
      windows: ["main"],
      create: () => ({ commands: ["shell.openLink"], execute: () => undefined }),
    });
    expect(
      () =>
        new WindowCommandBus(
          SCOPE,
          [contribution("test.one"), contribution("test.two")],
          "main",
          { window: () => ({}) as never, sendToWebview: () => undefined }
        )
    ).toThrow('Command handler for "shell.openLink" is duplicated.');
  });
});
