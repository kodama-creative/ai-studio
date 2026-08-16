import type { ResolutionContext, ServiceIdentifier } from "inversify";

export type RendererToken<T> = symbol & { readonly __service: T };

/** Create a stable token owned exclusively by the desktop renderer. */
export function rendererToken<T>(
  namespace: string,
  name: string
): RendererToken<T> {
  if (namespace.length === 0 || name.length === 0) {
    throw new Error("Renderer token namespace and name are required.");
  }
  return Symbol.for(
    `@llm-space/desktop/renderer/${namespace}/${name}`
  ) as RendererToken<T>;
}

export type RendererServiceIdentifier<T> = ServiceIdentifier<T>;

export function resolveRenderer<T>(
  context: ResolutionContext,
  token: RendererToken<T>
): T {
  return context.get<T>(token);
}
