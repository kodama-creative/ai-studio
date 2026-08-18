import { McpManager } from "@llm-space/runtime/mcp";
import { ContainerModule } from "inversify";

/** Bind the process-owned MCP manager and its external-resource cleanup. */
export function mcpModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(McpManager)
      .toSelf()
      .inSingletonScope()
      .onDeactivation((manager) => manager.shutdown());
  });
}
