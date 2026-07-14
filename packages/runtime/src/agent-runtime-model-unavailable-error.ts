import type { AgentModelSelector } from "./agent-definition";

export class AgentRuntimeModelUnavailableError extends Error {
  readonly selector: AgentModelSelector;

  constructor(selector: AgentModelSelector) {
    super(`Model "${selector.provider}/${selector.id}" is not available`);
    this.name = "AgentRuntimeModelUnavailableError";
    this.selector = selector;
  }
}
