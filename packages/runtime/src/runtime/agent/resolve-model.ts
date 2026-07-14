import type { Api, Model, Models } from "@earendil-works/pi-ai";

import type { AgentModelSelector } from "../../shared/agent-definition";

import { AgentRuntimeModelUnavailableError } from "./agent-runtime-model-unavailable-error";

export function resolveAgentRuntimeModel(
  models: Models,
  selector: AgentModelSelector
): Model<Api> {
  const model = models.getModel(selector.provider, selector.id);
  if (!model) throw new AgentRuntimeModelUnavailableError(selector);
  return model;
}
