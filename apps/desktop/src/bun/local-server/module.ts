import type { EmbeddedLocalServerManager } from "./embedded-local-server-manager";
import type { DesktopModule } from "../host/desktop-host";

export function createEmbeddedLocalServerModule(
  manager: EmbeddedLocalServerManager
): DesktopModule {
  return {
    id: "embedded-local-server",
    register() {},
    start: () => async () => manager.shutdown()
  };
}
