import {
  RuntimeCapabilityUnavailableError,
  RuntimeNotFoundError,
} from "./errors";
import type { RuntimeClient, RuntimeId } from "./types";
import type { RuntimeCapability } from "./types";


export class RuntimeRouter {
  private readonly _runtimes = new Map<RuntimeId, RuntimeClient>();
  private _defaultRuntimeId: RuntimeId = "local";

  constructor(localRuntime: RuntimeClient) {
    this.register("local", localRuntime);
  }

  register(id: RuntimeId, runtime: RuntimeClient): void {
    this._runtimes.set(id, runtime);
  }

  unregister(id: RuntimeId): void {
    if (id === "local") {
      throw new Error("Cannot unregister the local runtime.");
    }
    if (id === this._defaultRuntimeId) {
      throw new Error("Cannot unregister the default runtime.");
    }
    this._runtimes.delete(id);
  }

  setDefaultRuntime(id: RuntimeId): void {
    this._assertRuntime(id);
    this._defaultRuntimeId = id;
  }

  getDefaultRuntimeId(): RuntimeId {
    return this._defaultRuntimeId;
  }

  get(runtimeId?: RuntimeId): RuntimeClient {
    const id = runtimeId ?? this._defaultRuntimeId;
    const runtime = this._runtimes.get(id);
    if (!runtime) {
      throw new RuntimeNotFoundError(id);
    }
    return runtime;
  }

  /** Resolve a Runtime and authoritatively require one advertised capability. */
  require(
    runtimeId: RuntimeId | undefined,
    capability: RuntimeCapability
  ): RuntimeClient {
    const runtime = this.get(runtimeId);
    const info = runtime.info();
    if (!info.capabilities.includes(capability)) {
      throw new RuntimeCapabilityUnavailableError(info.id, capability);
    }
    return runtime;
  }

  list() {
    return [...this._runtimes.values()].map((runtime) => runtime.info());
  }

  private _assertRuntime(id: RuntimeId): void {
    if (!this._runtimes.has(id)) {
      throw new RuntimeNotFoundError(id);
    }
  }
}
