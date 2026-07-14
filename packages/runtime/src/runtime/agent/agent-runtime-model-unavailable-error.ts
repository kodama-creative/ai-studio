import type { AgentModelSelector } from "../../shared/agent-definition";

export class AgentRuntimeModelUnavailableError extends Error {
  readonly selector: AgentModelSelector;

  constructor(selector: AgentModelSelector) {
    super(`Agent model is unavailable: ${selector.provider}/${selector.id}`);
    this.name = "AgentRuntimeModelUnavailableError";
    this.selector = selector;
  }
}
