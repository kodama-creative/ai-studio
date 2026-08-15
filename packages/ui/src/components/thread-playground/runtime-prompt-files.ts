import type { FilesHost } from "../../host/types";

export interface PromptFiles {
  loadFile: (path: string) => Promise<string>;
  fileExists: (path: string) => Promise<boolean>;
}

/** Adapt host file access to the prompt renderer contract. */
export function createPromptFiles(files: FilesHost): PromptFiles {
  return {
    loadFile: (path) => files.readText(path),
    fileExists: (path) => files.exists(path),
  };
}
