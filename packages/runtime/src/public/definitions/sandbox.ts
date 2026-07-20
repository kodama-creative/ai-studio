import {
  defineSandboxRuntime,
  hasSandboxDefinitionBrand
} from "../../internal/authored-sandbox-definition";

export type SandboxDefinition = Readonly<Record<string, never>>;

export function defineSandbox(
  definition: SandboxDefinition
): SandboxDefinition {
  return defineSandboxRuntime(definition);
}

export function isSandboxDefinition(
  value: unknown
): value is SandboxDefinition {
  return hasSandboxDefinitionBrand(value);
}
