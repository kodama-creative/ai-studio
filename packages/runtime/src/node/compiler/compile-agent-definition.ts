import type { AgentDefinition } from "../../public/definitions/agent";
import type { CompiledAgentDefinition } from "../../shared/agent-definition";

export function compileAgentDefinition(
  definition: AgentDefinition
): CompiledAgentDefinition {
  const separator = definition.model.indexOf("/");
  let reasoning: "off" | AgentDefinition["reasoning"] | undefined =
    definition.reasoning;
  if (reasoning === "none") {
    reasoning = "off";
  } else if (reasoning === "provider-default") {
    reasoning = undefined;
  }
  return {
    model: {
      provider: definition.model.slice(0, separator),
      id: definition.model.slice(separator + 1)
    },
    ...(reasoning ? { reasoning } : {}),
    ...(definition.environment ? { environment: definition.environment } : {})
  };
}
