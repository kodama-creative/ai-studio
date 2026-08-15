export type DesktopToken<T> = symbol & { readonly __service?: T };

/** Create a stable DI symbol owned by one explicit business or lifecycle namespace. */
export function desktopToken<T>(
  namespace: string,
  name: string
): DesktopToken<T> {
  if (namespace.length === 0 || name.length === 0) {
    throw new Error("Desktop token namespace and name are required.");
  }
  return Symbol.for(`@llm-space/desktop/${namespace}/${name}`);
}
