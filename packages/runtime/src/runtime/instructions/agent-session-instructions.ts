import { isInstructionsDefinition } from "../../internal/authored-instruction-definitions";
import { deriveInstructionSnapshotContent } from "../harness/derive-instruction-snapshot-content";

import type { AgentSessionContext } from "../../shared/agent-session-context";
import type { AgentProjectSnapshot } from "../agent/agent-project-snapshot";
import type {
  RuntimeTurnInstructionSnapshot,
  SessionStore,
  StoredRuntimeSession
} from "../harness/session-store";
import type { AgentSessionState } from "../state/agent-session-state";

export class AgentSessionInstructions {
  private readonly _context: AgentSessionContext;
  private readonly _entries: NonNullable<AgentProjectSnapshot["instructionEntries"]>;
  private readonly _projectFingerprint: string;
  private readonly _sessionStore?: SessionStore;
  private readonly _sessionState: AgentSessionState;
  private readonly _onCommitted?: (session: StoredRuntimeSession) => Promise<void> | void;
  private readonly _hostEntries: RuntimeTurnInstructionSnapshot["entries"];

  constructor({
    context,
    instructionsPrefix,
    onCommitted,
    project,
    sandboxInstruction,
    sessionState,
    sessionStore,
    systemPrompt
  }: {
    context: AgentSessionContext;
    instructionsPrefix: string;
    onCommitted?: (session: StoredRuntimeSession) => Promise<void> | void;
    project: AgentProjectSnapshot;
    sandboxInstruction?: string;
    sessionState: AgentSessionState;
    sessionStore?: SessionStore;
    systemPrompt?: string;
  }) {
    this._context = context;
    this._projectFingerprint = project.fingerprint;
    this._sessionState = sessionState;
    this._sessionStore = sessionStore;
    this._onCommitted = onCommitted;
    const projectEntries = project.instructionEntries ?? [{
      kind: "static" as const,
      markdown: project.instructions,
      sourcePath: "instructions.md"
    }];
    if (projectEntries.some(entry => entry.kind === "dynamic") && !sessionStore) {
      throw new Error(
        "Agent Projects with dynamic instructions require a Session Store"
      );
    }
    const hasSystemPromptOverride = systemPrompt !== undefined
      && systemPrompt !== project.instructions;
    this._entries = hasSystemPromptOverride
      ? projectEntries.filter(entry => entry.kind === "dynamic")
      : projectEntries;
    this._hostEntries = [
      ...(sandboxInstruction?.trim() ? [{
        kind: "static" as const,
        markdown: sandboxInstruction.trim(),
        sourcePath: "host:sandbox-workspace"
      }] : []),
      ...(systemPrompt === undefined && instructionsPrefix.trim() ? [{
        kind: "static" as const,
        markdown: instructionsPrefix.trim(),
        sourcePath: "host:instructions-prefix"
      }] : []),
      ...(hasSystemPromptOverride ? [{
        kind: "static" as const,
        markdown: systemPrompt,
        sourcePath: "host:system-prompt"
      }] : [])
    ];
  }

  async resolve(
    stateScopeEnabled: boolean
  ): Promise<RuntimeTurnInstructionSnapshot> {
    const stored = this._sessionStore
      ? await this._sessionStore.load(this._context.id)
      : null;
    const snapshot = await this.prepare(stateScopeEnabled, stored);
    if (!this._sessionStore || stored?.snapshot.instructionSnapshots?.[
      this._context.turn.id
    ]) {
      return snapshot;
    }
    const committed = await this._sessionStore.commit({
      sessionId: this._context.id,
      expectedVersion: stored?.version ?? null,
      mutations: [{ type: "recordTurnInstructions", snapshot }]
    });
    await this._onCommitted?.(committed);
    const recorded = committed.snapshot.instructionSnapshots?.[
      this._context.turn.id
    ];
    if (!recorded) {
      throw new Error(
        `Turn ${this._context.turn.id} instruction snapshot was not persisted`
      );
    }
    return recorded;
  }

  async prepare(
    stateScopeEnabled: boolean,
    stored: StoredRuntimeSession | null
  ): Promise<RuntimeTurnInstructionSnapshot> {
    const existing = stored?.snapshot.instructionSnapshots?.[
      this._context.turn.id
    ];
    if (existing) {
      if (existing.agentSnapshotFingerprint !== this._projectFingerprint) {
        throw new Error(
          `Turn ${this._context.turn.id} instruction snapshot belongs to a different Agent artifact`
        );
      }
      return existing;
    }

    const entries: Array<RuntimeTurnInstructionSnapshot["entries"][number]> = [
      ...this._hostEntries
    ];
    for (const entry of this._entries) {
      if (entry.kind === "static") {
        entries.push({
          kind: "static",
          markdown: entry.markdown.trim(),
          sourcePath: entry.sourcePath
        });
        continue;
      }
      const resolve = async () => entry.definition.events["turn.started"](
        { type: "turn.started" },
        { session: this._context }
      );
      const result = stateScopeEnabled
        ? await this._sessionState.executeReadOnly(resolve)
        : await resolve();
      if (result === null) { continue; }
      if (!isInstructionsDefinition(result)) {
        throw new TypeError(
          `Dynamic instructions "${entry.sourcePath}" must return defineInstructions(...) or null`
        );
      }
      entries.push({
        kind: "dynamic",
        markdown: result.markdown.trim(),
        sourcePath: entry.sourcePath
      });
    }
    const { fingerprint, markdown } = await deriveInstructionSnapshotContent(
      entries
    );
    const snapshot: RuntimeTurnInstructionSnapshot = {
      agentSnapshotFingerprint: this._projectFingerprint,
      entries,
      fingerprint,
      markdown,
      turnId: this._context.turn.id
    };
    return snapshot;
  }
}
