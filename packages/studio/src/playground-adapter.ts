import type { Thread } from "@llm-space/core";

import type { AgentSpec, Playground } from "./playground";

/** Present a Playground through the existing editor-only core Thread shape. */
export function playgroundToThread(playground: Playground): Thread {
  return {
    title: playground.title,
    ...(playground.agentSpec.model === undefined
      ? {}
      : { model: structuredClone(playground.agentSpec.model) }),
    context: {
      systemPrompt: playground.agentSpec.instructions.join("\n\n"),
      tools: [...structuredClone(playground.agentSpec.tools)],
      messages: [...structuredClone(playground.conversation.messages)],
      ...(playground.agentSpec.variables === undefined
        ? {}
        : { variables: structuredClone(playground.agentSpec.variables) }),
      ...(playground.agentSpec.variableVariants === undefined
        ? {}
        : {
            variableVariants: structuredClone(
              playground.agentSpec.variableVariants
            ),
          }),
    },
  };
}

/** Split an editor document back into declaration metadata and model state. */
export function threadToPlaygroundDocument(
  thread: Thread,
  state: Playground["conversation"]["state"] = {}
): {
  readonly title: string;
  readonly agentSpec: AgentSpec;
  readonly conversation: Playground["conversation"];
} {
  return {
    title: thread.title?.trim() || "New Playground",
    agentSpec: {
      schemaVersion: 1,
      ...(thread.model === undefined
        ? {}
        : { model: structuredClone(thread.model) }),
      instructions:
        thread.context?.systemPrompt === undefined
          ? []
          : [thread.context.systemPrompt],
      tools: [...structuredClone(thread.context?.tools ?? [])],
      ...(thread.context?.variables === undefined
        ? {}
        : { variables: structuredClone(thread.context.variables) }),
      ...(thread.context?.variableVariants === undefined
        ? {}
        : {
            variableVariants: structuredClone(
              thread.context.variableVariants
            ),
          }),
    },
    conversation: {
      messages: [...structuredClone(thread.context?.messages ?? [])],
      state: structuredClone(state),
    },
  };
}
