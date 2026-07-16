import type { AgentProjectSnapshot } from "./agent-project-snapshot";

export function createImmutableAgentProjectSnapshot<
  TSnapshot extends AgentProjectSnapshot
>(snapshot: TSnapshot): TSnapshot {
  return _immutablePlainDataCopy(
    snapshot,
    "AgentProjectSnapshot",
    new WeakSet()
  );
}

function _immutablePlainDataCopy<T>(
  value: T,
  path: string,
  ancestors: WeakSet<object>
): T {
  if (value === null || typeof value !== "object") { return value; }
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (
    !Array.isArray(value)
    && prototype !== Object.prototype
    && prototype !== null
  ) {
    throw new TypeError(
      `${path} must contain only plain data objects, arrays, primitives, and functions`
    );
  }
  if (ancestors.has(value)) {
    throw new TypeError(`${path} must not contain circular data`);
  }
  ancestors.add(value);

  const copy: object = Array.isArray(value) ? [] : {};
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") { continue; }
    const childPath = `${path}.${typeof key === "symbol" ? (key.description ?? key.toString()) : key}`;
    Object.defineProperty(copy, key, {
      value: _immutablePlainDataCopy(
        (value as Record<PropertyKey, unknown>)[key],
        childPath,
        ancestors
      ),
      enumerable: Object.prototype.propertyIsEnumerable.call(value, key),
      configurable: false,
      writable: false
    });
  }
  ancestors.delete(value);
  return Object.freeze(copy) as T;
}
