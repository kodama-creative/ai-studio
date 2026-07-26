import path from "node:path";
import { AGENT_BUNDLE_COMPILER_SUPPORT_FILENAME } from "@llm-space/runtime/node";

export function getAgentBundleCompilerSupportPath(
  bunDirectory = import.meta.dir
): string {
  return path.join(
    bunDirectory,
    "support",
    AGENT_BUNDLE_COMPILER_SUPPORT_FILENAME
  );
}
