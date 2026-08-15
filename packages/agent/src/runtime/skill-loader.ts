import type { SkillHandle } from "../skills";
import type { ToolDefinition } from "../tools";

export const LOAD_SKILL_TOOL_NAME = "load_skill";
export const LOAD_SKILL_TOOL_IMPLEMENTATION_ID =
  "llm-space:agent:load-skill:v1";
export const LOAD_SKILL_TOOL_DESCRIPTION =
  "Load the full instructions for one available Skill by name. Use this when the request clearly matches a listed Skill description or the user explicitly names that Skill.";

/** Creates the framework-owned, agent-scoped Skill loader. */
export function createLoadSkillToolDefinition(
  skills: readonly SkillHandle[] = []
): ToolDefinition {
  const mounted = new Map(skills.map((skill) => [skill.name, skill]));
  return {
    description: LOAD_SKILL_TOOL_DESCRIPTION,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["skill"],
      properties: {
        skill: {
          type: "string",
          description: "The name of the available Skill to load.",
        },
      },
    },
    replay: "safe",
    execute(input) {
      const identifier = (input as Record<string, unknown>).skill;
      if (typeof identifier !== "string" || identifier.length === 0) {
        throw new Error('load_skill requires a non-empty "skill" name.');
      }
      const skill = mounted.get(identifier);
      if (skill !== undefined) return skill.markdown;
      const available = [...mounted.keys()].sort();
      const hint =
        available.length === 0
          ? ""
          : ` Available skills: ${available.join(", ")}.`;
      throw new Error(`No skill named "${identifier}".${hint}`);
    },
  };
}
