import { hydrateShellEnv } from "../env/hydrate";

/** Initialize process state, then start the Desktop composition root. */
export async function bootstrapDesktopApp(): Promise<void> {
  hydrateShellEnv();

  // Capture cold-start links before the longer bootstrap imports evaluate.
  await import("../deep-link/launch");

  const { seedWorkspace } = await import("../workspace/seed");
  seedWorkspace();

  const { seedSkills } = await import("../skills/seed");
  seedSkills();

  const { createDesktopProcessContainer } = await import(
    "../di/process-container"
  );
  const { DesktopLifecycle } = await import("./desktop-lifecycle");
  const { startDesktopApp } = await import("./desktop-app");
  const processContainer = createDesktopProcessContainer();
  try {
    await startDesktopApp(processContainer);
  } catch (error) {
    const startupFailure = new DesktopLifecycle();
    startupFailure.defer("desktop process scope after startup failure", () =>
      processContainer.dispose()
    );
    await startupFailure.stop();
    throw error;
  }
}
