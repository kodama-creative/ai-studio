import type { ModelManager } from "@llm-space/runtime/models";

import type { GeneratorRequests } from "../../shared/generator-rpc";
import type { NativeDialogsApplication } from "../native/native-dialogs-module";

import {
  checkUv,
  GeneratorProjectWorkspace,
} from "./generator-project-workspace";

/** Coordinates native selection, guarded project writes, and model secrets. */
export class ProjectGeneratorApplication implements GeneratorRequests {
  constructor(
    private readonly _dialogs: Pick<NativeDialogsApplication, "pickDirectory">,
    private readonly _models: Pick<ModelManager, "resolveConnection">,
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

  /** Resolve explicitly requested secrets inside the Generator slice. */
  async resolveEnv(input: Parameters<GeneratorRequests["resolveEnv"]>[0]) {
    const modelApiKey =
      (
        await this._models.resolveConnection({
          providerId: input.providerId,
          profileId: input.profileId,
        })
      ).apiKey ?? "";
    const envValues: Record<string, string> = {};
    for (const name of input.envNames) {
      envValues[name] = process.env[name] ?? "";
    }
    return { modelApiKey, envValues };
  }
}
