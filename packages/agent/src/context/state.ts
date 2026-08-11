import type { JsonValue } from "../shared/types";

import { AGENT_CONTEXT_STORAGE } from "./context-storage";

const RESERVED_STATE_NAME_PREFIX = "llm-space.";

export interface StateHandle<T extends JsonValue> {
  get(): T;
  update(fn: (current: T) => T): void;
}

function _loadContext() {
  const context = AGENT_CONTEXT_STORAGE.getStore();
  if (context === undefined) {
    throw new Error("State operations require an active agent context.");
  }
  return context;
}

export function defineState<T extends JsonValue>(
  name: string,
  initial: () => T
): StateHandle<T> {
  if (name.startsWith(RESERVED_STATE_NAME_PREFIX)) {
    throw new Error(
      `defineState() name "${name}" uses the reserved prefix "${RESERVED_STATE_NAME_PREFIX}".`
    );
  }
  return {
    get() {
      const context = _loadContext();
      if (!context.values.has(name)) context.values.set(name, initial());
      return context.values.get(name) as T;
    },
    update(fn) {
      const context = _loadContext();
      if (!context.values.has(name)) context.values.set(name, initial());
      context.values.set(name, fn(context.values.get(name) as T));
    },
  };
}
