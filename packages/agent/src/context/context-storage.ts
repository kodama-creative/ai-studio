import { AsyncLocalStorage } from "node:async_hooks";

const CONTEXT_STORAGE = Symbol.for("@llm-space/agent/context-storage");

export interface StateContext {
  readonly values: Map<string, unknown>;
}

type GlobalWithContext = typeof globalThis & {
  [CONTEXT_STORAGE]?: AsyncLocalStorage<StateContext>;
};

const CONTEXT_GLOBAL = globalThis as GlobalWithContext;
export const AGENT_CONTEXT_STORAGE = (CONTEXT_GLOBAL[CONTEXT_STORAGE] ??=
  new AsyncLocalStorage<StateContext>());

export function runInAgentContext<T>(
  values: Readonly<Record<string, unknown>>,
  fn: () => T
): T {
  return AGENT_CONTEXT_STORAGE.run(
    { values: new Map(Object.entries(values)) },
    fn
  );
}
