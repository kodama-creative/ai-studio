import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import {
  EXTERNAL_EDITORS,
  type ExternalEditorId,
  type ExternalEditorStatus
} from "../../shared/external-editor";

type EditorDefinition = (typeof EXTERNAL_EDITORS)[number];

interface ExternalEditorConfig {
  preferredEditorId?: ExternalEditorId;
}

interface EditorLaunch {
  readonly argsPrefix: readonly string[];
  readonly command: string;
}

export interface ExternalEditorSystem {
  readonly platform: NodeJS.Platform;
  readonly homeDirectory: string;
  exists(target: string): Promise<boolean>;
  launch(command: string, args: readonly string[]): void;
  which(command: string): string | null;
}

const DEFAULT_SYSTEM: ExternalEditorSystem = {
  platform: process.platform,
  homeDirectory: homedir(),
  async exists(target) {
    try {
      await access(target);
      return true;
    } catch {
      return false;
    }
  },
  launch(command, args) {
    const child = spawn(command, [...args], {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
  },
  which(command) {
    return Bun.which(command);
  }
};

/** Owns the fixed external-editor allowlist and its persisted preference. */
export class ExternalEditorManager {
  private readonly _configPath: string;
  private readonly _system: ExternalEditorSystem;
  private _config: ExternalEditorConfig | null = null;

  constructor(options: {
    homePath: string;
    system?: ExternalEditorSystem;
  }) {
    this._configPath = path.join(
      options.homePath,
      "settings",
      "external-editor.json"
    );
    this._system = options.system ?? DEFAULT_SYSTEM;
  }

  async status(): Promise<ExternalEditorStatus> {
    const config = await this._loadConfig();
    const editors = await Promise.all(
      EXTERNAL_EDITORS.map(async editor => ({
        id: editor.id,
        label: editor.label,
        available: Boolean(await this._resolveLaunch(editor))
      }))
    );
    const preferredEditorId = editors.some(
      editor => editor.available && editor.id === config.preferredEditorId
    )
      ? (config.preferredEditorId ?? null)
      : (editors.find(editor => editor.available)?.id ?? null);
    return {
      editors,
      preferredEditorId
    };
  }

  async open(
    target: string,
    requestedEditorId?: ExternalEditorId
  ): Promise<ExternalEditorStatus> {
    const status = await this.status();
    const editorId = requestedEditorId ?? status.preferredEditorId;
    if (!editorId) {
      throw new Error(
        "No supported editor was found. Install VS Code, Zed, or Cursor."
      );
    }
    const option = status.editors.find(editor => editor.id === editorId);
    if (!option?.available) {
      throw new Error(`${option?.label ?? editorId} is not available.`);
    }
    const definition = EXTERNAL_EDITORS.find(editor => editor.id === editorId);
    if (!definition) {
      throw new Error("Unsupported external editor.");
    }
    const launch = await this._resolveLaunch(definition);
    if (!launch) {
      throw new Error(`${definition.label} is not available.`);
    }
    this._system.launch(launch.command, [...launch.argsPrefix, target]);
    this._config = { preferredEditorId: editorId };
    await this._saveConfig(this._config);
    return this.status();
  }

  private async _loadConfig(): Promise<ExternalEditorConfig> {
    if (this._config) { return this._config; }
    try {
      const parsed = JSON.parse(
        await readFile(this._configPath, "utf8")
      ) as ExternalEditorConfig;
      this._config = {
        ...(parsed.preferredEditorId
          && EXTERNAL_EDITORS.some(
            editor => editor.id === parsed.preferredEditorId
          )
          ? { preferredEditorId: parsed.preferredEditorId }
          : {})
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") { throw error; }
      this._config = {};
    }
    return this._config;
  }

  private async _resolveLaunch(
    editor: EditorDefinition
  ): Promise<EditorLaunch | null> {
    const command = this._system.which(editor.command);
    if (command) { return { command, argsPrefix: [] }; }
    if (this._system.platform !== "darwin") { return null; }
    const app = `${editor.appName}.app`;
    const appPaths = [
      path.join("/Applications", app),
      path.join(this._system.homeDirectory, "Applications", app)
    ];
    for (const appPath of appPaths) {
      if (await this._system.exists(appPath)) {
        return {
          command: "/usr/bin/open",
          argsPrefix: ["-a", editor.appName]
        };
      }
    }
    return null;
  }

  private async _saveConfig(config: ExternalEditorConfig): Promise<void> {
    await mkdir(path.dirname(this._configPath), { recursive: true });
    const temporary = `${this._configPath}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    await rename(temporary, this._configPath);
  }
}
