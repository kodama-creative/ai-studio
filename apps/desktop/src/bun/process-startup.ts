import { hydrateShellEnv } from "./env/hydrate";

/** Establish import-time prerequisites before loading the composition graph. */
export async function startDesktopProcess(): Promise<void> {
  hydrateShellEnv();

  const { desktopDeepLinks } = await import("./deep-link/launch");
  const { bootstrapDesktopApp } = await import("./app/bootstrap");

  await bootstrapDesktopApp(desktopDeepLinks);
}
