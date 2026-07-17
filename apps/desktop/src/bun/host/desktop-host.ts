import { ToolRegistry } from "../tools/tool-registry";

export type DesktopModuleCleanup = () => Promise<void> | void;

export interface DesktopModule {
  id: string;
  register(tools: ToolRegistry): void;
  start?(): DesktopModuleCleanup | Promise<DesktopModuleCleanup | undefined> | undefined;
}

export class DesktopHost {
  readonly tools: ToolRegistry;
  private readonly _modules: DesktopModule[];
  private readonly _onShutdownError: (moduleId: string, error: Error) => void;
  private readonly _cleanups: Array<{
    cleanup: DesktopModuleCleanup;
    moduleId: string;
  }> = [];

  private _registered = false;

  constructor({
    modules,
    tools = new ToolRegistry(),
    onShutdownError = (moduleId, error) => { console.error(`Failed to stop desktop module "${moduleId}":`, error); }
  }: {
    modules: DesktopModule[];
    onShutdownError?: (moduleId: string, error: Error) => void;
    tools?: ToolRegistry;
  }) {
    this._modules = modules;
    this.tools = tools;
    this._onShutdownError = onShutdownError;
  }

  async start(): Promise<void> {
    if (!this._registered) {
      this._assertUniqueModuleIds();
      for (const module of this._modules) {
        try {
          module.register(this.tools);
        } catch (error) {
          throw new Error(
            `Failed to register desktop module "${module.id}": ${_errorMessage(error)}`,
            { cause: error }
          );
        }
      }
      this.tools.freeze();
      this._registered = true;
    }

    for (const module of this._modules) {
      try {
        const cleanup = await module.start?.();
        if (typeof cleanup === "function") {
          this._cleanups.push({ moduleId: module.id, cleanup });
        }
      } catch (error) {
        await this.stop();
        throw new Error(
          `Failed to start desktop module "${module.id}": ${_errorMessage(error)}`,
          { cause: error }
        );
      }
    }
  }

  async stop(): Promise<void> {
    for (const { moduleId, cleanup } of this._cleanups.toReversed()) {
      try {
        // The cleanup union is callable; typed lint cannot resolve void | Promise<void> here.

        await cleanup();
      } catch (error) {
        this._onShutdownError(moduleId, _asError(error));
      }
    }
    this._cleanups.length = 0;
  }

  private _assertUniqueModuleIds(): void {
    const ids = new Set<string>();
    for (const module of this._modules) {
      if (ids.has(module.id)) {
        throw new Error(`Duplicate desktop module id "${module.id}".`);
      }
      ids.add(module.id);
    }
  }
}

function _errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function _asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
