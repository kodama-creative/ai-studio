import {
  normalizeMcpName,
  type McpServerDraft,
  type McpServerView,
  type McpToolView,
  type McpTransportType,
} from "@llm-space/core";
import { inject, injectable, optional } from "inversify";

import { MCP_SERVICE, type McpRequests } from "@/shared/mcp-rpc";

import { RendererNotificationService } from "../notifications/renderer-notification-service";

export interface McpKeyValueRow {
  readonly id: string;
  readonly key: string;
  readonly value: string;
}

export interface McpServerForm {
  readonly name: string;
  readonly useOriginalToolNames: boolean;
  readonly transport: McpTransportType;
  readonly command: string;
  readonly argsText: string;
  readonly cwd: string;
  readonly env: readonly McpKeyValueRow[];
  readonly url: string;
  readonly headers: readonly McpKeyValueRow[];
}

export interface McpSettingsSnapshot {
  readonly servers: readonly McpServerView[];
  readonly selectedId: string | null;
  readonly creating: boolean;
  readonly form: McpServerForm;
  readonly formError: string | null;
  readonly tools: readonly McpToolView[];
  readonly loading: boolean;
  readonly saving: boolean;
  readonly testingServerId: string | null;
  readonly cancellingTest: boolean;
  readonly disconnecting: boolean;
  readonly dirty: boolean;
}

export type McpSettingsClient = Pick<
  McpRequests,
  | "listServers"
  | "addServer"
  | "updateServer"
  | "removeServer"
  | "disconnectServer"
  | "cancelTest"
  | "listTools"
>;

export const MCP_SETTINGS_SAVE_DELAY = Symbol("McpSettingsSaveDelay");

type Listener = () => void;

/**
 * Owns the MCP settings editor state machine and its RPC lifecycle.
 *
 * The interface accepts user intent. Debounced persistence, selection safety,
 * test cancellation, and stale async result suppression stay internal.
 */
@injectable()
export class McpSettingsController {
  private readonly _listeners = new Set<Listener>();
  private _cancelRequested = false;
  private _cancelScheduledSave?: () => void;
  private _lifecycle = 0;
  private _refreshRequest = 0;
  private _selectedIdBeforeCreate: string | null = null;
  private _started = false;
  private _snapshot: McpSettingsSnapshot;

  constructor(
    @inject(MCP_SERVICE)
    private readonly _client: McpSettingsClient,
    @inject(RendererNotificationService)
    private readonly _notifications: Pick<
      RendererNotificationService,
      "success" | "error"
    >,
    @inject(MCP_SETTINGS_SAVE_DELAY) @optional()
    private readonly _saveDelayMs = 600
  ) {
    this._snapshot = {
      servers: [],
      selectedId: null,
      creating: false,
      form: this._emptyForm(),
      formError: null,
      tools: [],
      loading: true,
      saving: false,
      testingServerId: null,
      cancellingTest: false,
      disconnecting: false,
      dirty: false,
    };
  }

  readonly getSnapshot = (): McpSettingsSnapshot => this._snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  start(): void {
    this.stop();
    this._started = true;
    this._lifecycle += 1;
    this._cancelRequested = false;
    this._set({
      ...this._snapshot,
      loading: true,
      saving: false,
      testingServerId: null,
      cancellingTest: false,
      disconnecting: false,
    });
    void this.refresh();
  }

  stop(): void {
    this._started = false;
    this._lifecycle += 1;
    this._refreshRequest += 1;
    this._clearScheduledSave();
  }

  async refresh(): Promise<void> {
    this._requireStarted();
    const lifecycle = this._lifecycle;
    const request = ++this._refreshRequest;
    this._set({ ...this._snapshot, loading: true });
    try {
      const servers = await this._client.listServers();
      if (!this._isCurrent(lifecycle) || request !== this._refreshRequest)
        return;
      if (this._snapshot.creating) {
        this._set({ ...this._snapshot, servers });
        return;
      }
      const currentId = this._snapshot.selectedId;
      const selectedId =
        currentId !== null && servers.some((server) => server.id === currentId)
          ? currentId
          : (servers[0]?.id ?? null);
      const selectionChanged = selectedId !== currentId;
      this._set({
        ...this._snapshot,
        servers,
        selectedId,
        ...(selectionChanged
          ? {
              form: this._formFromServer(
                servers.find((server) => server.id === selectedId) ?? null
              ),
              formError: null,
              tools: [],
              dirty: false,
            }
          : {}),
      });
    } catch (error) {
      if (this._isCurrent(lifecycle) && request === this._refreshRequest) {
        this._notifications.error("Failed to load MCP servers", error);
      }
    } finally {
      if (this._isCurrent(lifecycle) && request === this._refreshRequest) {
        this._set({ ...this._snapshot, loading: false });
      }
    }
  }

  select(serverId: string): void {
    this._requireStarted();
    if (this._selectionLocked()) return;
    const server = this._snapshot.servers.find((item) => item.id === serverId);
    if (server === undefined) return;
    this._clearScheduledSave();
    this._set({
      ...this._snapshot,
      selectedId: server.id,
      creating: false,
      form: this._formFromServer(server),
      formError: null,
      tools: [],
      dirty: false,
    });
  }

  beginCreate(): void {
    this._requireStarted();
    if (this._selectionLocked()) return;
    this._selectedIdBeforeCreate = this._snapshot.selectedId;
    this._clearScheduledSave();
    this._set({
      ...this._snapshot,
      selectedId: null,
      creating: true,
      form: this._emptyForm(),
      formError: null,
      tools: [],
      dirty: false,
    });
  }

  cancelCreate(): void {
    this._requireStarted();
    if (!this._snapshot.creating || this._snapshot.saving) return;
    this._clearScheduledSave();
    const selectedId =
      this._selectedIdBeforeCreate !== null &&
      this._snapshot.servers.some(
        (server) => server.id === this._selectedIdBeforeCreate
      )
        ? this._selectedIdBeforeCreate
        : (this._snapshot.servers[0]?.id ?? null);
    this._selectedIdBeforeCreate = null;
    this._set({
      ...this._snapshot,
      selectedId,
      creating: false,
      form: this._formFromServer(this._serverById(selectedId)),
      formError: null,
      tools: [],
      dirty: false,
    });
  }

  updateForm(form: McpServerForm): void {
    this._requireStarted();
    this._set({
      ...this._snapshot,
      form,
      formError: null,
      dirty: true,
    });
    this._scheduleSave();
  }

  async testSelected(): Promise<void> {
    this._requireStarted();
    const server = this._selectedServer();
    if (server === null || this._selectionLocked()) return;
    const lifecycle = this._lifecycle;
    this._cancelRequested = false;
    this._set({
      ...this._snapshot,
      formError: null,
      testingServerId: server.id,
    });
    try {
      const response = await this._client.listTools(server.id);
      if (!this._isCurrent(lifecycle)) return;
      if (this._cancelRequested) return;
      this._set({
        ...this._snapshot,
        tools: response.tools,
        servers: this._snapshot.servers.map((item) =>
          item.id === response.server.id ? response.server : item
        ),
      });
      this._notifications.success(
        `MCP server connected: ${response.tools.length} tool${response.tools.length === 1 ? "" : "s"} discovered`
      );
    } catch (error) {
      if (!this._isCurrent(lifecycle)) return;
      this._set({ ...this._snapshot, tools: [] });
      if (this._cancelRequested || _isCancellation(error)) return;
      await this.refresh();
      if (this._isCurrent(lifecycle)) {
        this._notifications.error("Failed to connect MCP server", error);
      }
    } finally {
      if (this._isCurrent(lifecycle)) {
        this._cancelRequested = false;
        this._set({
          ...this._snapshot,
          testingServerId:
            this._snapshot.testingServerId === server.id
              ? null
              : this._snapshot.testingServerId,
        });
      }
    }
  }

  async cancelTest(): Promise<void> {
    this._requireStarted();
    const serverId = this._snapshot.testingServerId;
    if (serverId === null || this._snapshot.cancellingTest) return;
    const lifecycle = this._lifecycle;
    this._cancelRequested = true;
    this._set({ ...this._snapshot, cancellingTest: true });
    try {
      const servers = await this._client.cancelTest(serverId);
      if (!this._isCurrent(lifecycle)) return;
      this._set({ ...this._snapshot, servers, tools: [] });
    } catch (error) {
      if (!this._isCurrent(lifecycle)) return;
      this._cancelRequested = false;
      this._notifications.error("Failed to cancel MCP test", error);
    } finally {
      if (this._isCurrent(lifecycle)) {
        this._set({ ...this._snapshot, cancellingTest: false });
      }
    }
  }

  async disconnectSelected(): Promise<void> {
    this._requireStarted();
    const server = this._selectedServer();
    if (
      server === null ||
      this._snapshot.testingServerId !== null ||
      this._snapshot.disconnecting
    ) {
      return;
    }
    const lifecycle = this._lifecycle;
    this._set({ ...this._snapshot, disconnecting: true });
    try {
      const servers = await this._client.disconnectServer(server.id);
      if (!this._isCurrent(lifecycle)) return;
      this._set({ ...this._snapshot, servers, tools: [] });
      this._notifications.success("MCP server disconnected");
    } catch (error) {
      if (this._isCurrent(lifecycle)) {
        this._notifications.error("Failed to disconnect MCP server", error);
      }
    } finally {
      if (this._isCurrent(lifecycle)) {
        this._set({ ...this._snapshot, disconnecting: false });
      }
    }
  }

  async removeSelected(): Promise<void> {
    this._requireStarted();
    const server = this._selectedServer();
    if (server === null || this._selectionLocked()) return;
    const lifecycle = this._lifecycle;
    try {
      const servers = await this._client.removeServer(server.id);
      if (!this._isCurrent(lifecycle)) return;
      const selectedId = servers[0]?.id ?? null;
      this._set({
        ...this._snapshot,
        servers,
        selectedId,
        form: this._formFromServer(
          servers.find((item) => item.id === selectedId) ?? null
        ),
        formError: null,
        tools: [],
        dirty: false,
      });
      this._notifications.success("MCP server removed");
    } catch (error) {
      if (this._isCurrent(lifecycle)) {
        this._notifications.error("Failed to remove MCP server", error);
      }
    }
  }

  private async _save(
    form: McpServerForm,
    targetId: string | null,
    creating: boolean,
    lifecycle: number
  ): Promise<void> {
    this._clearScheduledSave();
    this._set({ ...this._snapshot, formError: null, saving: true });
    try {
      const draft = this._draftFromForm(form);
      const servers =
        creating || targetId === null
          ? await this._client.addServer(draft)
          : await this._client.updateServer(targetId, draft);
      if (!this._isCurrent(lifecycle)) return;
      const saved =
        creating || targetId === null
          ? [...servers]
              .reverse()
              .find(
                (server) => server.serverName === normalizeMcpName(form.name)
              )
          : servers.find((server) => server.id === targetId);
      const selectedId = saved?.id ?? servers[0]?.id ?? null;
      const hasNewerChanges = this._snapshot.form !== form;
      this._selectedIdBeforeCreate = null;
      this._set({
        ...this._snapshot,
        servers,
        selectedId,
        creating: false,
        ...(hasNewerChanges
          ? {}
          : {
              form: this._formFromServer(
                saved ?? this._serverFrom(servers, selectedId)
              ),
              dirty: false,
            }),
      });
    } catch (error) {
      if (this._isCurrent(lifecycle)) {
        this._set({
          ...this._snapshot,
          formError: _errorMessage(error),
        });
      }
    } finally {
      if (this._isCurrent(lifecycle)) {
        this._set({ ...this._snapshot, saving: false });
        this._scheduleSave();
      }
    }
  }

  private _scheduleSave(): void {
    this._clearScheduledSave();
    const state = this._snapshot;
    if (
      !this._started ||
      !state.dirty ||
      state.saving ||
      state.formError !== null ||
      (state.creating && !this._canCreateServer(state.form)) ||
      (!state.creating && state.selectedId === null)
    ) {
      return;
    }
    const form = state.form;
    const targetId = state.selectedId;
    const creating = state.creating;
    const lifecycle = this._lifecycle;
    const timeout = setTimeout(
      () => void this._save(form, targetId, creating, lifecycle),
      this._saveDelayMs
    );
    this._cancelScheduledSave = () => clearTimeout(timeout);
  }

  private _clearScheduledSave(): void {
    this._cancelScheduledSave?.();
    this._cancelScheduledSave = undefined;
  }

  private _selectionLocked(): boolean {
    return (
      this._snapshot.saving ||
      this._snapshot.dirty ||
      this._snapshot.testingServerId !== null
    );
  }

  private _selectedServer(): McpServerView | null {
    return this._serverById(this._snapshot.selectedId);
  }

  private _serverById(id: string | null): McpServerView | null {
    return this._serverFrom(this._snapshot.servers, id);
  }

  private _serverFrom(
    servers: readonly McpServerView[],
    id: string | null
  ): McpServerView | null {
    return servers.find((server) => server.id === id) ?? null;
  }

  private _emptyForm(): McpServerForm {
    return {
      name: "",
      useOriginalToolNames: false,
      transport: "stdio",
      command: "",
      argsText: "",
      cwd: "",
      env: [],
      url: "",
      headers: [],
    };
  }

  private _formFromServer(server: McpServerView | null): McpServerForm {
    if (server === null) return this._emptyForm();
    return {
      name: server.name,
      useOriginalToolNames: server.useOriginalToolNames ?? false,
      transport: server.transport,
      command: server.command ?? "",
      argsText: (server.args ?? []).join("\n"),
      cwd: server.cwd ?? "",
      env: this._rowsFromRecord(server.env),
      url: server.url ?? "",
      headers: this._rowsFromRecord(server.headers),
    };
  }

  private _draftFromForm(form: McpServerForm): McpServerDraft {
    if (form.transport === "stdio") {
      return {
        name: form.name,
        useOriginalToolNames: form.useOriginalToolNames,
        transport: "stdio",
        command: form.command,
        args: form.argsText
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
        cwd: form.cwd.trim() || null,
        env: this._recordFromRows(form.env),
      };
    }
    return {
      name: form.name,
      useOriginalToolNames: form.useOriginalToolNames,
      transport: form.transport,
      url: form.url,
      headers: this._recordFromRows(form.headers),
    };
  }

  private _rowsFromRecord(
    record: Record<string, string> | undefined
  ): readonly McpKeyValueRow[] {
    return Object.entries(record ?? {}).map(([key, value]) =>
      this._createKeyValueRow(key, value)
    );
  }

  private _createKeyValueRow(key = "", value = ""): McpKeyValueRow {
    return { id: crypto.randomUUID(), key, value };
  }

  private _recordFromRows(
    rows: readonly McpKeyValueRow[]
  ): Record<string, string> | undefined {
    const result: Record<string, string> = {};
    for (const row of rows) {
      const key = row.key.trim();
      if (key) result[key] = row.value;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }

  private _canCreateServer(form: McpServerForm): boolean {
    if (!normalizeMcpName(form.name)) return false;
    if (form.transport === "stdio") return form.command.trim().length > 0;
    try {
      new URL(form.url);
      return true;
    } catch {
      return false;
    }
  }

  private _set(snapshot: McpSettingsSnapshot): void {
    this._snapshot = snapshot;
    for (const listener of this._listeners) listener();
  }

  private _isCurrent(lifecycle: number): boolean {
    return this._started && this._lifecycle === lifecycle;
  }

  private _requireStarted(): void {
    if (!this._started) {
      throw new Error("McpSettingsController must be started first.");
    }
  }
}

function _isCancellation(error: unknown): boolean {
  return error instanceof Error && error.message === "MCP test cancelled.";
}

function _errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Please try again.";
}
