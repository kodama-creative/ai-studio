import { mock } from "bun:test";

const events: string[] = [];
await mock.module("../env/hydrate", () => ({
  hydrateShellEnv: () => events.push("hydrate"),
}));
await mock.module("../deep-link/launch", () => {
  events.push("deep-link:import");
  return {};
});
await mock.module("../workspace/seed", () => {
  events.push("workspace:import");
  return { seedWorkspace: () => events.push("workspace:seed") };
});
await mock.module("../skills/seed", () => {
  events.push("skills:import");
  return { seedSkills: () => events.push("skills:seed") };
});
await mock.module("./desktop-lifecycle", () => {
  events.push("lifecycle:import");
  return {
    DesktopLifecycle: class {
      private _cleanup: (() => void | Promise<void>) | undefined;

      constructor() {
        events.push("lifecycle:create");
      }

      defer(_label: string, cleanup: () => void | Promise<void>): void {
        events.push("lifecycle:defer");
        this._cleanup = cleanup;
      }

      async stop(): Promise<void> {
        events.push("lifecycle:stop");
        await this._cleanup?.();
      }
    },
  };
});
await mock.module("inversify", () => {
  events.push("composition:import");
  return {
    Container: class {
      constructor() {
        events.push("container:create");
      }

      unbindAllAsync(): Promise<void> {
        events.push("container:unbind");
        return Promise.resolve();
      }
    },
    ContainerModule: class {},
  };
});
await mock.module("@llm-space/core/server", () => {
  events.push("core:import");
  throw new Error("startup failed");
});

const { bootstrapDesktopApp } = await import("./bootstrap");

try {
  await bootstrapDesktopApp();
  throw new Error("Desktop bootstrap unexpectedly succeeded.");
} catch (error) {
  if (!(error instanceof Error) || error.message !== "startup failed") {
    throw error;
  }
}

const expected = [
  "hydrate",
  "deep-link:import",
  "workspace:import",
  "workspace:seed",
  "skills:import",
  "skills:seed",
  "lifecycle:import",
  "composition:import",
  "container:create",
  "core:import",
  "container:unbind",
];
if (JSON.stringify(events) !== JSON.stringify(expected)) {
  throw new Error(`Unexpected Desktop bootstrap order: ${events.join(", ")}`);
}
