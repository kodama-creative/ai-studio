import { AsyncLocalStorage } from "node:async_hooks";
import { Compile } from "typebox/compile";

import type { ToolResultMessage } from "@earendil-works/pi-ai";

import {
  AgentStateCommitUnknownError
} from "./agent-state-errors";
import { installStateScopeAccessor } from "../../internal/authored-state-definitions";
import { assertRuntimeSessionStateValues } from "../harness/in-memory-session-store";

import type { AgentSessionContext } from "../../shared/agent-session-context";
import type { CompiledAgentStateDefinition } from "../agent/agent-project-snapshot";
import type {
  RuntimeSessionStateEntry,
  RuntimeSessionStateValue,
  SessionStore,
  StoredRuntimeSession
} from "../harness/session-store";

interface ActiveAgentStateScope {
  get(name: string): unknown;
  readonly session: AgentSessionContext;
  update(name: string, updater: (current: unknown) => unknown): void;
}

interface StateRuntimeDefinition {
  readonly definition: CompiledAgentStateDefinition;
  readonly validator: { Check(value: unknown): boolean; };
}

interface StateStepTransaction {
  failed: boolean;
  readonly expectedVersion: number | null;
  readonly values: Map<string, RuntimeSessionStateValue>;
}

const ACTIVE_SCOPE = new AsyncLocalStorage<ActiveAgentStateScope>();

function _activeScope(): ActiveAgentStateScope | undefined {
  return ACTIVE_SCOPE.getStore();
}

installStateScopeAccessor(_activeScope);

export { AgentStateCommitUnknownError };

export function getActiveAgentSessionContext(): AgentSessionContext {
  const scope = ACTIVE_SCOPE.getStore();
  if (!scope) {
    throw new Error("Agent Session context is unavailable outside authored Runtime execution");
  }
  return scope.session;
}

export class AgentSessionState {
  private readonly _context: AgentSessionContext;
  private readonly _definitions: ReadonlyMap<string, StateRuntimeDefinition>;
  private readonly _sessionStore?: SessionStore;
  private readonly _onCommitted?: (session: StoredRuntimeSession) => Promise<void> | void;
  private _transaction: Promise<StateStepTransaction> | null = null;

  constructor({
    context,
    definitions,
    sessionStore,
    onCommitted
  }: {
    context: AgentSessionContext;
    definitions: readonly CompiledAgentStateDefinition[];
    onCommitted?: (session: StoredRuntimeSession) => Promise<void> | void;
    sessionStore?: SessionStore;
  }) {
    this._context = _validateContext(context);
    this._definitions = new Map(definitions.map(definition => [
      definition.name,
      { definition, validator: Compile(definition.schema) }
    ]));
    if (this._definitions.size !== definitions.length) {
      throw new Error("Agent Session state definitions must have unique names");
    }
    this._sessionStore = sessionStore;
    this._onCommitted = onCommitted;
    if (definitions.length > 0 && !sessionStore) {
      throw new Error("Agent Projects with Session state require a Session Store");
    }
  }

  get context(): AgentSessionContext {
    return this._context;
  }

  async executeTool<TResult>(run: () => Promise<TResult>): Promise<TResult> {
    const transaction = await this._ensureTransaction();
    const scope: ActiveAgentStateScope = {
      session: this._context,
      get: name => this._get(transaction, name),
      update: (name, updater) => { this._update(transaction, name, updater); }
    };
    try {
      return await ACTIVE_SCOPE.run(scope, run);
    } catch (error) {
      transaction.failed = true;
      throw error;
    }
  }

  async executeReadOnly<TResult>(run: () => Promise<TResult>): Promise<TResult> {
    const transaction = await this._loadTransaction();
    const scope: ActiveAgentStateScope = {
      session: this._context,
      get: name => this._get(transaction, name),
      update() {
        throw new Error("Session state is read-only while resolving instructions");
      }
    };
    return ACTIVE_SCOPE.run(scope, run);
  }

  async validateSession(): Promise<void> {
    await this._loadTransaction();
  }

  async completeStep(
    toolResults: readonly ToolResultMessage[],
    options: { deferred?: boolean; } = {}
  ): Promise<void> {
    const transactionPromise = this._transaction;
    this._transaction = null;
    if (!transactionPromise) { return; }
    const transaction = await transactionPromise;
    if (
      transaction.failed
      || options.deferred
      || toolResults.some(result => result.isError)
    ) {
      return;
    }
    if (this._definitions.size === 0) { return; }
    const values = this._stateEntries(transaction.values);
    assertRuntimeSessionStateValues(values);
    const store = this._sessionStore;
    if (!store) {
      throw new Error("Session State Store is unavailable");
    }
    try {
      const session = await store.commit({
        sessionId: this._context.id,
        expectedVersion: transaction.expectedVersion,
        mutations: [{ type: "replaceState", values }]
      });
      await this._onCommitted?.(session);
    } catch (error) {
      throw new AgentStateCommitUnknownError(error);
    }
  }

  discardStep(): void {
    this._transaction = null;
  }

  private async _ensureTransaction(): Promise<StateStepTransaction> {
    this._transaction = this._transaction ?? this._loadTransaction();
    return this._transaction;
  }

  private async _loadTransaction(): Promise<StateStepTransaction> {
    const stored = this._sessionStore
      ? await this._sessionStore.load(this._context.id)
      : null;
    const storedValues = stored?.snapshot.state?.values ?? {};
    for (const name of Object.keys(storedValues)) {
      if (!this._definitions.has(name)) {
        throw new Error(
          `Stored Session state "${name}" has no authored definition`
        );
      }
    }
    const values = new Map<string, RuntimeSessionStateValue>();
    for (const [name, runtime] of this._definitions) {
      const storedEntry = storedValues[name];
      const value = storedEntry
        ? this._validateStoredEntry(runtime, storedEntry)
        : runtime.definition.initial;
      if (!runtime.validator.Check(value)) {
        throw new Error(
          `Session state "${name}" initial value does not match the authored schema`
        );
      }
      values.set(name, _immutableJson(value));
    }
    assertRuntimeSessionStateValues(Object.fromEntries(
      [...this._definitions].map(([name, runtime]) => [name, {
        definitionVersion: runtime.definition.version,
        schemaFingerprint: runtime.definition.schemaFingerprint,
        value: _requiredStateValue(values, name)
      }])
    ));
    return {
      failed: false,
      expectedVersion: stored?.version ?? null,
      values
    };
  }

  private _validateStoredEntry(
    runtime: StateRuntimeDefinition,
    entry: RuntimeSessionStateEntry
  ): RuntimeSessionStateValue {
    const definition = runtime.definition;
    if (entry.definitionVersion !== definition.version) {
      throw new Error(
        `Session state "${definition.name}" version ${entry.definitionVersion} does not match authored version ${definition.version}`
      );
    }
    if (entry.schemaFingerprint !== definition.schemaFingerprint) {
      throw new Error(
        `Session state "${definition.name}" schema does not match the authored definition`
      );
    }
    if (!runtime.validator.Check(entry.value)) {
      throw new Error(
        `Session state "${definition.name}" value does not match the authored schema`
      );
    }
    return entry.value;
  }

  private _get(
    transaction: StateStepTransaction,
    name: string
  ): RuntimeSessionStateValue {
    const value = transaction.values.get(name);
    if (value === undefined || !this._definitions.has(name)) {
      throw new Error(`Session state "${name}" is not declared by this Agent`);
    }
    return value;
  }

  private _update(
    transaction: StateStepTransaction,
    name: string,
    updater: (current: unknown) => unknown
  ): void {
    const runtime = this._definitions.get(name);
    const current = transaction.values.get(name);
    if (!runtime || current === undefined) {
      throw new Error(`Session state "${name}" is not declared by this Agent`);
    }
    const next = updater(current);
    if (!runtime.validator.Check(next)) {
      throw new TypeError(
        `Session state "${name}" update does not match the authored schema`
      );
    }
    const immutable = _immutableJson(next) as RuntimeSessionStateValue;
    const candidate = new Map(transaction.values);
    candidate.set(name, immutable);
    assertRuntimeSessionStateValues(this._stateEntries(candidate));
    transaction.values.set(name, immutable);
  }

  private _stateEntries(
    values: ReadonlyMap<string, RuntimeSessionStateValue>
  ): Record<string, RuntimeSessionStateEntry> {
    return Object.fromEntries(
      [...this._definitions].map(([name, runtime]) => [name, {
        definitionVersion: runtime.definition.version,
        schemaFingerprint: runtime.definition.schemaFingerprint,
        value: _requiredStateValue(values, name)
      }])
    );
  }
}

function _requiredStateValue(
  values: ReadonlyMap<string, RuntimeSessionStateValue>,
  name: string
): RuntimeSessionStateValue {
  const value = values.get(name);
  if (value === undefined) {
    throw new Error(`Session state "${name}" is unavailable`);
  }
  return value;
}

function _validateContext(context: AgentSessionContext): AgentSessionContext {
  _assertText("Session id", context.id);
  _assertPrincipal("initiator", context.auth.initiator);
  _assertPrincipal("current principal", context.auth.current);
  _assertText("Channel kind", context.channel.kind);
  if (context.channel.id !== undefined) {
    _assertText("Channel id", context.channel.id);
  }
  _assertText("Turn id", context.turn.id);
  if (!Number.isSafeInteger(context.turn.sequence) || context.turn.sequence < 0) {
    throw new TypeError("Turn sequence must be a non-negative safe integer");
  }
  if (context.tenant) {
    _assertText("Tenant issuer", context.tenant.issuer);
    _assertText("Tenant id", context.tenant.tenantId);
  }
  return _immutableJson(context);
}

function _assertPrincipal(
  label: string,
  principal: AgentSessionContext["auth"]["current"]
): void {
  _assertText(`${label} issuer`, principal.issuer);
  _assertText(`${label} id`, principal.principalId);
  if (
    principal.principalType !== "runtime"
    && principal.principalType !== "service"
    && principal.principalType !== "user"
  ) {
    throw new TypeError(`${label} type is invalid`);
  }
}

function _assertText(label: string, value: string): void {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 256) {
    throw new TypeError(`${label} must contain 1 through 256 characters`);
  }
}

function _immutableJson<T>(value: T): T {
  const copy = structuredClone(value);
  return _freeze(copy, new WeakSet());
}

function _freeze<T>(value: T, ancestors: WeakSet<object>): T {
  if (!value || typeof value !== "object") { return value; }
  if (ancestors.has(value)) {
    throw new TypeError("Session state must not contain circular data");
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Session state must contain only plain JSON objects");
  }
  ancestors.add(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    _freeze(child, ancestors);
  }
  ancestors.delete(value);
  return Object.freeze(value);
}
