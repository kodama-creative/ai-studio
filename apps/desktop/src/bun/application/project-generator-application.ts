import { checkUv, GeneratorProjectWorkspace } from "../fs";

import type { ModelsApplication } from "./models-application";
import type { NativeDialogApplication } from "./native-applications";

export interface ProjectGeneratorApplicationApi {
  pickDirectory(): ReturnType<NativeDialogApplication["pickDirectory"]>;
  prepareDirectory(parentDir: string, projectName: string): ReturnType<GeneratorProjectWorkspace["prepare"]>;
  checkUv(): ReturnType<typeof checkUv>;
  runUv(rootDir: string, args: string[], options?: { timeoutMs?: number }): ReturnType<GeneratorProjectWorkspace["runUv"]>;
  writeFile(rootDir: string, relativePath: string, contents: string): ReturnType<GeneratorProjectWorkspace["writeFile"]>;
  removeFile(rootDir: string, relativePath: string): ReturnType<GeneratorProjectWorkspace["removeFile"]>;
  openDevTerminal(rootDir: string): ReturnType<GeneratorProjectWorkspace["openDevTerminal"]>;
  resolveEnv(input: Parameters<ModelsApplication["resolveGeneratorEnv"]>[0]): ReturnType<ModelsApplication["resolveGeneratorEnv"]>;
}

/** Coordinates native selection, guarded project writes, and model secrets. */
export class ProjectGeneratorApplication implements ProjectGeneratorApplicationApi {
  constructor(
    private readonly _dialogs: Pick<NativeDialogApplication, "pickDirectory">,
    private readonly _models: Pick<ModelsApplication, "resolveGeneratorEnv">,
    private readonly _workspace = new GeneratorProjectWorkspace()
  ) {}

  /** Let the user choose a parent directory without authorizing writes yet. */
  pickDirectory(): Promise<string | null> {
    return this._dialogs.pickDirectory();
  }

  /** Validate, create, and authorize one generated project directory. */
  prepareDirectory(parentDir: string, projectName: string) {
    return this._workspace.prepare(parentDir, projectName);
  }

  /** Detect the fixed `uv` executable used by generated projects. */
  checkUv() {
    return checkUv();
  }

  /** Run `uv` only within a directory authorized by this process instance. */
  runUv(rootDir: string, args: string[], options?: { timeoutMs?: number }) {
    return this._workspace.runUv(rootDir, args, options);
  }

  /** Write one generated file below an authorized project root. */
  writeFile(rootDir: string, relativePath: string, contents: string) {
    return this._workspace.writeFile(rootDir, relativePath, contents);
  }

  /** Remove one generated file below an authorized project root. */
  removeFile(rootDir: string, relativePath: string) {
    return this._workspace.removeFile(rootDir, relativePath);
  }

  /** Open the generated project's development target in the native terminal. */
  openDevTerminal(rootDir: string) {
    return this._workspace.openDevTerminal(rootDir);
  }

  /** Resolve explicitly requested secrets through the local model service. */
  resolveEnv(input: Parameters<ModelsApplication["resolveGeneratorEnv"]>[0]) {
    return this._models.resolveGeneratorEnv(input);
  }
}
