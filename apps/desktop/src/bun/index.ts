import { hydrateShellEnv } from "./env/hydrate";

/**
 * Hydrate and seed state before loading the composition root.
 * Dynamic imports prevent runtime modules from evaluating too early.
 */
async function _bootstrapDesktopApp(): Promise<void> {
  hydrateShellEnv();

  const { seedWorkspace } = await import("./workspace/seed");
  seedWorkspace();

  const { seedSkills } = await import("./skills/seed");
  seedSkills();

  const { startDesktopApp } = await import("./app");
  await startDesktopApp();
}

await _bootstrapDesktopApp();
