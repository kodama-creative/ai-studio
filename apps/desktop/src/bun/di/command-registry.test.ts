import { describe, expect, test } from "bun:test";

import { COMMAND_META } from "../../shared/commands";

import type { CommandContribution } from "./command-contribution";
import { CommandRegistry } from "./command-registry";
import { SnapshotContributionProvider } from "./contribution-provider";

function _registry(
  contributions: readonly CommandContribution[],
  forwarded: unknown[] = [],
  reportError?: (type: keyof typeof COMMAND_META, error: unknown) => void
): CommandRegistry {
  return new CommandRegistry(
    new SnapshotContributionProvider(() => contributions),
    { sendToWebview: (command) => forwarded.push(command) },
    reportError
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

  test("contains synchronous and asynchronous handler failures", async () => {
    const failures: { type: string; error: unknown }[] = [];
    const contribution: CommandContribution = {
      registerCommands(commands) {
        commands.registerCommand("updates.check", {
          execute: () => Promise.reject(new Error("async failure")),
        });
        commands.registerCommand("shell.reportBugs", {
          execute: () => {
            throw new Error("sync failure");
          },
        });
      },
    };
    const registry = _registry([contribution], [], (type, error) => {
      failures.push({ type, error });
    });
    registry.onStart();

    registry.execute({ type: "updates.check", args: {} });
    registry.execute({ type: "shell.reportBugs", args: {} });
    await Promise.resolve();

    expect(failures.map(({ type }) => type)).toEqual([
      "shell.reportBugs",
      "updates.check",
    ]);
    expect(failures.map(({ error }) => (error as Error).message)).toEqual([
      "sync failure",
      "async failure",
    ]);
  });

  test("best-effort disposal releases every command registration", async () => {
    const disposed: string[] = [];
    const contribution: CommandContribution = {
      registerCommands(commands) {
        const first = {
          execute: () => undefined,
          dispose() {
            disposed.push("first");
          },
        };
        const second = {
          execute: () => undefined,
          dispose() {
            disposed.push("second");
            throw new Error("second cleanup failed");
          },
        };
        commands.registerCommand("updates.check", first);
        commands.registerCommand("shell.reportBugs", second);
      },
    };
    const registry = _registry([contribution]);
    registry.onStart();

    const failure = await registry.dispose().then(
      () => undefined,
      (error: unknown) => error
    );
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as Error).message).toBe(
      "Failed to dispose Command Registry."
    );
    expect(disposed).toEqual(["second", "first"]);
  });
});
