import { describe, expect, test } from "bun:test";

import { COMMAND_META } from "../../shared/commands";

import type { CommandContribution } from "./command-contribution";
import { CommandRegistry } from "./command-registry";
import { SnapshotContributionProvider } from "./contribution-provider";

function _registry(
  contributions: readonly CommandContribution[],
  forwarded: unknown[] = []
): CommandRegistry {
  return new CommandRegistry(
    new SnapshotContributionProvider(() => contributions),
    { sendToWebview: (command) => forwarded.push(command) }
  );
}

describe("CommandRegistry", () => {
  test("all command identities include a business namespace", () => {
    expect(Object.keys(COMMAND_META).every((type) => type.includes("."))).toBe(
      true
    );
  });

  test("forwards unclaimed webview commands after startup", () => {
    const forwarded: unknown[] = [];
    const registry = _registry([], forwarded);
    registry.onStart();
    const command = { type: "app.openSettings", args: {} } as const;

    registry.execute(command);

    expect(forwarded).toEqual([command]);
  });

  test("collects one typed Bun handler from a contribution", () => {
    const executed: unknown[] = [];
    const contribution: CommandContribution = {
      registerCommands(commands) {
        commands.registerCommand("shell.openLink", {
          execute: (command) => executed.push(command),
        });
      },
    };
    const registry = _registry([contribution]);
    registry.onStart();
    const command = {
      type: "shell.openLink",
      args: { url: "https://example.com" },
    } as const;

    registry.execute(command);

    expect(executed).toEqual([command]);
  });

  test("rejects duplicate and late command registration", () => {
    const contribution = (): CommandContribution => ({
      registerCommands(commands) {
        commands.registerCommand("shell.openLink", {
          execute: () => undefined,
        });
      },
    });
    const duplicate = _registry([contribution(), contribution()]);
    expect(() => duplicate.onStart()).toThrow(
      'Command handler for "shell.openLink" is already registered.'
    );

    const started = _registry([]);
    started.onStart();
    expect(() =>
      started.registerCommand("shell.openLink", {
        execute: () => undefined,
      })
    ).toThrow("can only be registered while CommandRegistry is starting");
  });
});
