import { isDynamicModelDefinition } from "../../internal/authored-dynamic-model-definition";

import type { AgentDefinition } from "../../public/definitions/agent";
import type { CompiledAgentDefinition } from "../../shared/agent-definition";

export function compileAgentDefinition(
  definition: AgentDefinition
): CompiledAgentDefinition {
  const model = isDynamicModelDefinition(definition.model)
    ? definition.model.fallback
    : definition.model;
  const separator = model.indexOf("/");
  let reasoning: "off" | AgentDefinition["reasoning"] | undefined =
    definition.reasoning;
  if (reasoning === "none") {
    reasoning = "off";
  } else if (reasoning === "provider-default") {
    reasoning = undefined;
  }
  return {
    ...(definition.description
      ? { description: definition.description }
      : {}),
    model: {
      provider: model.slice(0, separator),
      id: model.slice(separator + 1)
    },
    ...(isDynamicModelDefinition(definition.model)
      ? { dynamicModel: definition.model }
      : {}),
    ...(definition.modelOptions ? { modelOptions: definition.modelOptions } : {}),
    ...(definition.limits ? { limits: definition.limits } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(definition.environment ? { environment: definition.environment } : {})
  };
}
