export const AGENT_PROJECT_MANIFEST_FILE = "llm-space.json";
export const AGENT_PROJECT_MANIFEST_VERSION = 1;

export interface AgentProjectManifest {
  schemaVersion: 1;
  agent: string;
}

export class AgentProjectManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentProjectManifestError";
  }
}

export function parseAgentProjectManifest(
  input: unknown
): AgentProjectManifest {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AgentProjectManifestError(
      `${AGENT_PROJECT_MANIFEST_FILE} must contain a JSON object.`
    );
  }
  const manifest = input as Record<string, unknown>;
  if (manifest.schemaVersion !== AGENT_PROJECT_MANIFEST_VERSION) {
    throw new AgentProjectManifestError(
      `Unsupported Agent Project schemaVersion: ${String(manifest.schemaVersion)}.`
    );
  }
  if (typeof manifest.agent !== "string" || !manifest.agent.trim()) {
    throw new AgentProjectManifestError(
      `${AGENT_PROJECT_MANIFEST_FILE} must define a non-empty relative agent path.`
    );
  }
  return {
    schemaVersion: AGENT_PROJECT_MANIFEST_VERSION,
    agent: manifest.agent.trim(),
  };
}
