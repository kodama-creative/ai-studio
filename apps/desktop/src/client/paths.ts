import type { RuntimeId } from "@/shared/runtime";

import { appDirectoriesClient, nativeFilesClient, nativeDialogsClient } from "./native-files";
import { promptFilesClient } from "./runtime-rpc-clients";

/**
 * Resolve a directory under the llm-space root, creating it (recursively) if
 * missing, and return its absolute path. The renderer can't touch the
 * filesystem or read the root, so it asks the bun main process.
 */
export async function ensureRootDir(relativePath: string): Promise<string> {
  return appDirectoriesClient.ensure(relativePath);
}

/** Absolute path to `LLM_SPACE_HOME/workspace`, creating it if missing. */
export async function getWorkspacePath(): Promise<string> {
  return ensureRootDir("workspace");
}

/**
 * Read an arbitrary text file (any path, `~` expands to home) for the prompt
 * `@include` macro. Resolves to `""` for a missing/unreadable path.
 */
export async function readTextFile(
  path: string,
  runtimeId: RuntimeId
): Promise<string> {
  if (!runtimeId) {
    throw new Error("Prompt file runtimeId is required.");
  }
  return promptFilesClient.readText(runtimeId, path);
}

/** Whether a path points to a readable regular file (`~` expands to home). */
export async function textFileExists(
  path: string,
  runtimeId: RuntimeId
): Promise<boolean> {
  if (!runtimeId) {
    throw new Error("Prompt file runtimeId is required.");
  }
  return promptFilesClient.exists(runtimeId, path);
}

/** Whether a path points to an existing directory (`~` expands to home). */
export async function directoryExists(path: string): Promise<boolean> {
  return nativeFilesClient.directoryExists(path);
}

/** Open the native file picker; resolves to the chosen path or `null`. */
export async function pickFile(): Promise<string | null> {
  return nativeDialogsClient.pickFile();
}

/** Open the native directory picker; resolves to the chosen path or `null`. */
export async function pickDirectory(): Promise<string | null> {
  return nativeDialogsClient.pickDirectory();
}
