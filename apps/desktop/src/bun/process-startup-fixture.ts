import { mock } from "bun:test";

const events: string[] = [];
const deepLinks = { source: "test" };

await mock.module("./env/hydrate", () => ({
  hydrateShellEnv: () => events.push("hydrate"),
}));
await mock.module("./deep-link/launch", () => {
  events.push("deep-link:import");
  return { desktopDeepLinks: deepLinks };
});
await mock.module("./app/bootstrap", () => {
  events.push("bootstrap:import");
  return {
    bootstrapDesktopApp: (source: unknown) => {
      if (source !== deepLinks) {
        throw new Error("Startup did not forward the deep-link source.");
      }
      events.push("bootstrap:start");
    },
  };
});

const { startDesktopProcess } = await import("./process-startup");

await startDesktopProcess();

const expected = [
  "hydrate",
  "deep-link:import",
  "bootstrap:import",
  "bootstrap:start",
];
if (JSON.stringify(events) !== JSON.stringify(expected)) {
  throw new Error(`Unexpected Desktop startup order: ${events.join(", ")}`);
}
