import type { SkillHandle } from "../skills";
import type { ToolContext, ToolDefinition } from "../tools";

import {
  createRuntimeToolContext,
  type RuntimeServices,
} from "./runtime-services";
import {
  createLoadSkillToolDefinition,
  LOAD_SKILL_TOOL_IMPLEMENTATION_ID,
} from "./skill-loader";

export interface AgentHostBinding {
  readonly agent: { readonly agentSpecId: string };
  readonly skills?: readonly SkillHandle[];
  readonly tools: readonly {
    readonly name: string;
    readonly description?: string;
    readonly inputSchema?: Readonly<Record<string, unknown>>;
    readonly implementationId: string;
  }[];
}

export interface AgentModelTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface AgentRuntimeHost<TTool> {
  resolveTools(binding: AgentHostBinding): Promise<ReadonlyMap<string, TTool>>;
  modelTools(binding: AgentHostBinding): AgentModelTool[];
  createToolContext(input: {
    readonly binding: AgentHostBinding;
    readonly execution: ToolContext["execution"];
    readonly signal: AbortSignal;
  }): ToolContext;
}

/**
 * Restores Agent-owned framework tools and Skills from an immutable operation
 * binding. Execution runtimes supply only the adapter for their tool wrapper.
 */
export function createAgentRuntimeHost<TTool>(options: {
  readonly services: RuntimeServices;
  readonly loadCurrentTools: () => Promise<ReadonlyMap<string, TTool>>;
  readonly wrapFrameworkTool: (input: {
    readonly definition: ToolDefinition;
    readonly implementationId: string;
  }) => TTool;
}): AgentRuntimeHost<TTool> {
  return {
    async resolveTools(binding) {
      const tools = new Map<string, TTool>();
      for (const frozen of binding.tools) {
        if (frozen.implementationId === LOAD_SKILL_TOOL_IMPLEMENTATION_ID) {
          tools.set(
            frozen.name,
            options.wrapFrameworkTool({
              definition: createLoadSkillToolDefinition(binding.skills ?? []),
              implementationId: LOAD_SKILL_TOOL_IMPLEMENTATION_ID,
            })
          );
        }
      }
      try {
        for (const [name, tool] of await options.loadCurrentTools()) {
          if (!tools.has(name)) tools.set(name, tool);
        }
      } catch (error) {
        if (tools.size === 0) throw error;
      }
      return tools;
    },

    modelTools(binding) {
      return binding.tools.map((tool) => {
        if (tool.description === undefined || tool.inputSchema === undefined) {
          throw new Error(
            `Frozen tool "${tool.name}" is missing its model-visible schema.`
          );
        }
        return {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        };
      });
    },

    createToolContext({ binding, execution, signal }) {
      return createRuntimeToolContext(
        _withMountedSkills(options.services, binding),
        {
          agentId: binding.agent.agentSpecId,
          execution,
          signal,
        }
      );
    },
  };
}

function _withMountedSkills(
  services: RuntimeServices,
  binding: AgentHostBinding
): RuntimeServices {
  const mounted = new Map(
    (binding.skills ?? []).map((skill) => [skill.name, skill])
  );
  return {
    ...services,
    skills: {
      resolve(input) {
        const skill = mounted.get(input.identifier);
        if (skill !== undefined) return skill;
        if (services.skills !== undefined) return services.skills.resolve(input);
        throw new Error(
          `Agent "${input.agentId}" does not mount Skill "${input.identifier}".`
        );
      },
    },
  };
}
