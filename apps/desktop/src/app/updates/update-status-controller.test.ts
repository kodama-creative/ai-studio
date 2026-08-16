import { describe, expect, test } from "bun:test";

import type { RendererCommandRegistry } from "../../commands/renderer-command-registry";
import type { Command } from "../../shared/commands";
import type { UpdateStatusChangedPayload } from "../../shared/updates";
import { createRendererEventEmitter } from "../events/renderer-events";

import { UpdateStatusController } from "./update-status-controller";

describe("UpdateStatusController", () => {
  test("projects manual checks and update readiness without duplicate background announcements", () => {
    const fixture = _fixture();
    const snapshots: unknown[] = [];
    fixture.controller.subscribe(() =>
      snapshots.push(fixture.controller.getSnapshot())
    );
    fixture.controller.start();

    fixture.publish({ manual: true, status: { state: "checking" } });
    expect(fixture.controller.getSnapshot()).toEqual({
      readyVersion: null,
      manualStatus: { state: "checking" },
      dialogOpen: true,
    });

    fixture.publish({
      manual: true,
      status: { state: "downloading", version: "5.0.0" },
    });
    fixture.publish({
      manual: false,
      status: { state: "ready", version: "5.0.0" },
    });
    fixture.publish({
      manual: false,
      status: { state: "ready", version: "5.0.0" },
    });

    expect(fixture.events).toEqual(["downloading:5.0.0", "ready:5.0.0"]);
    expect(fixture.controller.getSnapshot()).toEqual({
      readyVersion: "5.0.0",
      manualStatus: { state: "checking" },
      dialogOpen: false,
    });
    expect(snapshots.length).toBeGreaterThan(0);
  });

  test("owns dismissal, commands, and restartable subscriptions", () => {
    const fixture = _fixture();
    fixture.controller.start();
    fixture.publish({ manual: true, status: { state: "checking" } });
    fixture.controller.setDialogOpen(false);
    fixture.publish({
      manual: true,
      status: { state: "error", message: "offline" },
    });
    expect(fixture.controller.getSnapshot().dialogOpen).toBe(false);

    fixture.controller.recheck();
    fixture.controller.restart();
    fixture.controller.openReleaseNotes("5.0.0");
    expect(fixture.commands).toEqual([
      { type: "updates.check", args: {} },
      { type: "updates.applyAndRestart", args: {} },
      {
        type: "shell.openLink",
        args: {
          url: "https://github.com/deer-flow/llm-space/releases/tag/v5.0.0",
        },
      },
    ]);

    fixture.controller.stop();
    fixture.publish({
      manual: false,
      status: { state: "ready", version: "6.0.0" },
    });
    expect(fixture.controller.getSnapshot().readyVersion).toBeNull();
    fixture.controller.start();
    expect(fixture.subscriptions).toBe(2);
  });
});

function _fixture() {
  let listener: (payload: UpdateStatusChangedPayload) => void = () => undefined;
  let subscriptions = 0;
  const commands: Command[] = [];
  const emitted: string[] = [];
  const events = createRendererEventEmitter();
  events.on("updates:downloading", (version) =>
    emitted.push(`downloading:${version}`)
  );
  events.on("updates:ready", (version) => emitted.push(`ready:${version}`));
  events.on("updates:installed", (version) =>
    emitted.push(`installed:${version}`)
  );
  const controller = new UpdateStatusController(
    {
      on: (_event, next) => {
        subscriptions += 1;
        listener = next;
        return { dispose: () => undefined };
      },
      takeInstalledVersion: () => Promise.resolve(null),
    },
    {
      executeCommand: (command: Command) => {
        commands.push(command);
      },
    } as unknown as RendererCommandRegistry,
    events
  );
  return {
    commands,
    controller,
    events: emitted,
    publish: (payload: UpdateStatusChangedPayload) => listener(payload),
    get subscriptions() {
      return subscriptions;
    },
  };
}
