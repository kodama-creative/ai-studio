import type { Bind } from "inversify";

import type { CommandSink } from "./command-registry";
import type { DesktopWindowScope } from "./process-container";
import { desktopToken } from "./tokens";

export type DesktopWindowKind = "main" | "project";

export interface DesktopWindowFeatureContext {
  readonly kind: DesktopWindowKind;
  readonly commandSink: CommandSink;
}

/** One bundled feature which installs its window-owned DI bindings. */
export interface DesktopWindowFeature {
  readonly id: string;
  install(
    scope: DesktopWindowScope,
    context: DesktopWindowFeatureContext
  ): void;
}

export const WindowFeature = desktopToken<DesktopWindowFeature>(
  "window",
  "feature"
);

/** Define one immutable bundled feature without exposing the DI container. */
export function windowFeature(
  id: string,
  install: DesktopWindowFeature["install"]
): DesktopWindowFeature {
  if (id.trim().length === 0) {
    throw new Error("Desktop window feature id is required.");
  }
  return Object.freeze({ id, install });
}

/** Add one feature to the process-level multi-binding. */
export function bindWindowFeature(
  bind: Bind,
  feature: DesktopWindowFeature
): void {
  bind<DesktopWindowFeature>(WindowFeature).toConstantValue(feature);
}

/**
 * Installs the frozen feature snapshot before command/RPC contribution
 * registries start. Duplicate ownership and repeated installation fail early.
 */
export class DesktopWindowFeatures {
  private _installed = false;

  constructor(private readonly _features: readonly DesktopWindowFeature[]) {}

  install(
    scope: DesktopWindowScope,
    context: DesktopWindowFeatureContext
  ): void {
    if (this._installed) {
      throw new Error("Desktop window features are already installed.");
    }
    this._installed = true;
    const ids = new Set<string>();
    for (const feature of this._features) {
      if (ids.has(feature.id)) {
        throw new Error(`Duplicate desktop window feature id "${feature.id}".`);
      }
      ids.add(feature.id);
    }
    for (const feature of this._features) {
      try {
        feature.install(scope, context);
      } catch (error) {
        throw new Error(
          `Failed to install desktop window feature "${feature.id}".`,
          { cause: error }
        );
      }
    }
  }
}
