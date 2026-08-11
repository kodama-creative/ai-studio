import { AsyncLocalStorage } from "node:async_hooks";

import type { JsonValue } from "../shared/types";

const CONTEXT_STORAGE = Symbol.for("@llm-space/agent/context-storage");

export interface StateContext {
  readonly values: Map<string, JsonValue>;
}

export interface AgentStateContext {
  /** Runs one complete Agent execution with this state bound via AsyncLocalStorage. */
  run<T>(fn: () => T): T;
  /** Returns an isolated JSON snapshot suitable for a Thread Checkpoint. */
  snapshot(): Readonly<Record<string, JsonValue>>;
}

type GlobalWithContext = typeof globalThis & {
  [CONTEXT_STORAGE]?: AsyncLocalStorage<StateContext>;
};

const CONTEXT_GLOBAL = globalThis as GlobalWithContext;
export const AGENT_CONTEXT_STORAGE = (CONTEXT_GLOBAL[CONTEXT_STORAGE] ??=
  new AsyncLocalStorage<StateContext>());

export function createAgentStateContext(
  initial: Readonly<Record<string, JsonValue>>
): AgentStateContext {
  const values = new Map(Object.entries(_cloneJson(initial)));
  return {
    run<T>(fn: () => T): T {
      return AGENT_CONTEXT_STORAGE.run({ values }, fn);
    },
    snapshot(): Readonly<Record<string, JsonValue>> {
      return _cloneJson(Object.fromEntries(values));
    },
  };
}

function _cloneJson<T extends JsonValue | Readonly<Record<string, JsonValue>>>(
  value: T
): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch (cause) {
    throw new Error("Agent state must contain only JSON values.", { cause });
  }
}
