export const AGENT_PROJECT_ARTIFACT_SCHEMA_VERSION = 1;

export interface AgentProjectArtifactFingerprintEntry {
  readonly id: string;
  readonly fingerprint: string;
}

export interface AgentProjectArtifactFingerprintSection {
  readonly fingerprint: string;
  readonly entries: readonly AgentProjectArtifactFingerprintEntry[];
}

export interface AgentProjectArtifactFingerprints {
  readonly sources: AgentProjectArtifactFingerprintSection;
  readonly dependencies: AgentProjectArtifactFingerprintSection;
  readonly capabilities: AgentProjectArtifactFingerprintSection;
  readonly schemas: AgentProjectArtifactFingerprintSection;
  readonly runtime: AgentProjectArtifactFingerprintSection;
  readonly environmentRequirements: AgentProjectArtifactFingerprintSection;
}

export interface AgentProjectArtifact {
  readonly schemaVersion: typeof AGENT_PROJECT_ARTIFACT_SCHEMA_VERSION;
  readonly fingerprint: string;
  readonly fingerprints: AgentProjectArtifactFingerprints;
}
