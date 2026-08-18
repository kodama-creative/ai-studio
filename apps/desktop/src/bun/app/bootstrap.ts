import { hydrateShellEnv } from "../env/hydrate";

/**
 * Establish process-wide prerequisites before loading the composition root.
 *
 * The imports are deliberately sequential: user shell variables must exist
 * before env-sensitive modules evaluate, and the native URL listener must be
 * installed before the larger composition graph can delay cold-start routing.
 */
export async function bootstrapDesktopProcess(): Promise<void> {
  hydrateShellEnv();

  const { desktopDeepLinks } = await import("../deep-link/launch");
  const { composeAndStartDesktopApp } = await import("./desktop-composition");

  await composeAndStartDesktopApp(desktopDeepLinks);
}
