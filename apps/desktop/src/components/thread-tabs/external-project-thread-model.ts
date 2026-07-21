import type { Thread } from "@llm-space/core";

export function reconcileExternalProjectThreadModel(input: {
  readonly current: Thread;
  readonly definitionFingerprint: string;
  readonly modelMatchesDefinition: boolean;
  readonly next: Thread;
  readonly projectId: string;
  readonly snapshot: string;
}): Thread {
  const modelChanged = !_sameRuntimeModel(
    input.current.model,
    input.next.model
  );
  const modelSource = modelChanged
    || input.current.agentRuntime?.modelSource === "threadOverride"
    || !input.modelMatchesDefinition
    ? "threadOverride" as const
    : "agent" as const;
  return {
    ...input.next,
    agentRuntime: {
      projectId: input.projectId,
      snapshot:
        input.next.agentRuntime?.snapshot ?? input.snapshot,
      definitionFingerprint:
        input.next.agentRuntime?.definitionFingerprint
        ?? input.definitionFingerprint,
      modelSource
    }
  };
}

function _sameRuntimeModel(
  left: Thread["model"],
  right: Thread["model"]
): boolean {
  return (
    left?.provider === right?.provider
    && left?.id === right?.id
    && JSON.stringify(left?.params ?? null) === JSON.stringify(right?.params ?? null)
  );
}
