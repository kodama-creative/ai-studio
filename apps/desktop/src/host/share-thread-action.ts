import type { Command } from "@/shared/commands";
import { buildShareThreadCommand } from "@/shared/share";

interface HostShareThreadInput {
  path: string;
}

function _isHostShareThreadInput(
  input: unknown
): input is HostShareThreadInput {
  if (typeof input !== "object" || input === null) return false;
  const candidate = input as { path?: unknown };
  return typeof candidate.path === "string";
}

/** Adapt the shared UI HostAction into the desktop command boundary. */
export function createDesktopShareThreadAction(
  executeCommand: (command: Command) => void
): (input: unknown) => void {
  return (input) => {
    if (!_isHostShareThreadInput(input)) {
      throw new Error("Invalid Share thread host action");
    }
    executeCommand(buildShareThreadCommand(input.path));
  };
}
