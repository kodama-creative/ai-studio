import {
  defineDynamic,
  SKILL_BRAND,
  type ExactDefinition,
} from "../shared/types";

export type SkillFileContent = string | Uint8Array;

export interface SkillFile {
  readonly path: string;
  readonly content: SkillFileContent;
}

export interface SkillHandle {
  readonly description: string;
  readonly markdown: string;
  readonly name: string;
}

export interface SkillPackageDefinition {
  readonly description: string;
  readonly files?: Readonly<Record<string, SkillFileContent>>;
  readonly license?: string;
  readonly markdown: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface NamedSkillDefinition extends SkillPackageDefinition {
  readonly name: string;
}
export type SkillDefinition = SkillPackageDefinition;

export function defineSkill<const T extends SkillDefinition>(
  definition: ExactDefinition<T, SkillDefinition>
): T {
  Object.defineProperty(definition, SKILL_BRAND, { value: true });
  return definition;
}

export { defineDynamic };
export type { DynamicResolveContext, DynamicSentinel } from "../shared/types";
