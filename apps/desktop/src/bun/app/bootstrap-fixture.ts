import { mock } from "bun:test";

const events: string[] = [];
const deepLinks = { source: "test" };

await mock.module("../env/hydrate", () => ({
  hydrateShellEnv: () => events.push("hydrate"),
}));
await mock.module("../deep-link/launch", () => {
  events.push("deep-link:import");
  return { desktopDeepLinks: deepLinks };
});
await mock.module("./desktop-composition", () => {
  events.push("composition:import");
  return {
    composeAndStartDesktopApp: (source: unknown) => {
      if (source !== deepLinks) {
        throw new Error("Bootstrap did not forward the deep-link source.");
      }
      events.push("composition:start");
    },
  };
});

const { bootstrapDesktopProcess } = await import("./bootstrap");

await bootstrapDesktopProcess();

const expected = [
  "hydrate",
  "deep-link:import",
  "composition:import",
  "composition:start",
];
if (JSON.stringify(events) !== JSON.stringify(expected)) {
  throw new Error(`Unexpected Desktop bootstrap order: ${events.join(", ")}`);
}
