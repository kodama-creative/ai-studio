import {
  Container,
  type ContainerModule,
  type ServiceIdentifier,
} from "inversify";

import { rendererToken, type RendererToken } from "./tokens";

export interface RendererLifecycleContribution {
  start(): void;
  stop(): void;
}

export const RENDERER_LIFECYCLE_CONTRIBUTION =
  rendererToken<RendererLifecycleContribution>("di", "lifecycle-contribution");

/** One restartable renderer scope with deterministic contribution lifecycle. */
export class RendererScope {
  private readonly _container: Container;
  private _activeContributions: RendererLifecycleContribution[] = [];
  private _started = false;

  constructor(options: {
    readonly modules: readonly ContainerModule[];
    readonly parent?: RendererScope;
  }) {
    this._container = new Container({
      parent: options.parent?._container,
    });
    for (const module of options.modules) this._container.load(module);
  }

  get<T>(token: RendererToken<T>): T;
  get<T>(token: ServiceIdentifier<T>): T;
  get<T>(token: ServiceIdentifier<T>): T {
    return this._container.get(token);
  }

  start(): void {
    if (this._started) return;
    this._started = true;
    let contributions: RendererLifecycleContribution[] = [];
    let startedCount = 0;
    try {
      contributions = this._container.isCurrentBound(
        RENDERER_LIFECYCLE_CONTRIBUTION
      )
        ? this._container.getAll<RendererLifecycleContribution>(
            RENDERER_LIFECYCLE_CONTRIBUTION
          )
        : [];
      this._activeContributions = contributions;
      for (const contribution of contributions) {
        startedCount += 1;
        contribution.start();
      }
    } catch (error) {
      for (let index = startedCount - 1; index >= 0; index -= 1) {
        _stopBestEffort(contributions[index]);
      }
      this._activeContributions = [];
      this._started = false;
      throw error;
    }
  }

  stop(): void {
    if (!this._started) return;
    this._started = false;
    const contributions = this._activeContributions;
    this._activeContributions = [];
    for (let index = contributions.length - 1; index >= 0; index -= 1) {
      _stopBestEffort(contributions[index]);
    }
  }
}

function _stopBestEffort(
  contribution: RendererLifecycleContribution | undefined
): void {
  if (!contribution) return;
  try {
    contribution.stop();
  } catch (error) {
    console.error("Failed to stop renderer lifecycle contribution", error);
  }
}
