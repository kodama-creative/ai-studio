import type {
  BuiltinTool,
  BuiltinToolCallResponse,
  ProviderConnectionRef,
} from "@llm-space/core";
import { SearchSettingsManager } from "@llm-space/runtime/search";
import { SkillsManager } from "@llm-space/runtime/skills";
import {
  normalizeToolCallResult,
  type BuiltInToolEntry,
} from "@llm-space/runtime/tools";
import {
  createFsBuiltInTools,
  createMediaBuiltInTools,
  createWebBuiltInTools,
  miscBuiltInTools,
} from "@llm-space/runtime/tools/built-in";
import { inject, injectable } from "inversify";

import {
  DESKTOP_ENV,
  type DesktopEnvironment,
  WORKSPACE_ROOT,
} from "../app/desktop-paths";
import { ArkImageGenerationService } from "../models/ark-image-generation-service";
import { NativeFilesService } from "../native/native-files-service";

/** Immutable Desktop bundle of the fixed Runtime built-in tools. */
@injectable()
export class BuiltInTools {
  private readonly _entries: readonly Readonly<BuiltInToolEntry>[];
  private readonly _entriesByName: ReadonlyMap<
    string,
    Readonly<BuiltInToolEntry>
  >;

  constructor(
    @inject(SkillsManager) skills: SkillsManager,
    @inject(SearchSettingsManager) searchSettings: SearchSettingsManager,
    @inject(ArkImageGenerationService)
    imageGeneration: ArkImageGenerationService,
    @inject(NativeFilesService) files: NativeFilesService,
    @inject(WORKSPACE_ROOT) workspaceRoot: string,
    @inject(DESKTOP_ENV) env: DesktopEnvironment
  ) {
    const entries = [
      ...createWebBuiltInTools({ env, searchSettings }),
      ...createFsBuiltInTools({ files, skills, workspaceRoot }),
      ...createMediaBuiltInTools({ imageGeneration }),
      ...miscBuiltInTools,
    ].map(_snapshotEntry);
    const entriesByName = new Map<string, Readonly<BuiltInToolEntry>>();
    for (const entry of entries) {
      if (entriesByName.has(entry.tool.name)) {
        throw new Error(`Duplicate built-in tool name "${entry.tool.name}".`);
      }
      entriesByName.set(entry.tool.name, entry);
    }
    this._entries = Object.freeze(entries);
    this._entriesByName = entriesByName;
  }

  /** Return the immutable tool definitions exposed to renderer and Pi bindings. */
  listTools(): BuiltinTool[] {
    return this._entries.map((entry) => entry.tool);
  }

  /** Execute one fixed built-in tool and normalize its model-facing response. */
  async call({
    name,
    arguments: args,
    config,
    connection,
  }: {
    name: string;
    arguments: Record<string, unknown>;
    config?: Record<string, unknown>;
    connection?: ProviderConnectionRef;
  }): Promise<BuiltinToolCallResponse> {
    const entry = this._entriesByName.get(name);
    if (entry === undefined) {
      throw new Error(`Built-in tool not found: ${name}`);
    }
    if (
      connection !== undefined &&
      entry.tool.connection?.providerId !== connection.providerId
    ) {
      throw new Error(
        `Built-in tool ${name} does not use provider: ${connection.providerId}`
      );
    }
    return normalizeToolCallResult(
      await entry.execute(args, config, { connection })
    );
  }
}

function _snapshotEntry(entry: BuiltInToolEntry): Readonly<BuiltInToolEntry> {
  return Object.freeze({
    tool: _deepFreeze(structuredClone(entry.tool)),
    execute: entry.execute,
  });
}

function _deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      _deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
