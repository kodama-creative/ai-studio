import type { AgentProjectSnapshot } from "./project";

export function createImmutableAgentProjectSnapshot(
  snapshot: AgentProjectSnapshot
): AgentProjectSnapshot {
  return _immutableDataCopy(snapshot, new WeakMap());
}

function _immutableDataCopy<T>(value: T, copies: WeakMap<object, object>): T {
  if (value === null || typeof value !== "object") return value;
  const existing = copies.get(value);
  if (existing) return existing as T;

  const prototype = Object.getPrototypeOf(value) as object | null;
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  ) {
    return value;
  }

  const copy: object = Array.isArray(value) ? [] : {};
  copies.set(value, copy);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    Object.defineProperty(copy, key, {
      value: _immutableDataCopy(_readProperty(value, key), copies),
      enumerable: Object.prototype.propertyIsEnumerable.call(value, key),
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(copy) as T;
}

function _readProperty(value: object, key: PropertyKey): unknown {
  return (value as Record<PropertyKey, unknown>)[key];
}
