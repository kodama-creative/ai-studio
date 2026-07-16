/** Clone and deeply freeze a value before it crosses the Session Store seam. */
export function immutableSnapshot<T>(value: T): T {
  return _deepFreeze(structuredClone(value));
}

function _deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      _deepFreeze(child);
    }
  }
  return value;
}
