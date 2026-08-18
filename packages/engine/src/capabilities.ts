import type { AgentManifest, AgentManifestSource } from "@llm-space/agent/loader";

export type UnsupportedAgentCapabilityKind =
  | "channel"
  | "connection"
  | "hook"
  | "instrumentation"
  | "sandbox"
  | "sandbox-workspace"
  | "schedule"
  | "subagent";

export interface UnsupportedAgentCapability {
  readonly kind: UnsupportedAgentCapabilityKind;
  readonly path: string;
  readonly sourcePath?: string;
  readonly message: string;
}

/** Structured admission failure for capabilities the current Pi host cannot run. */
export class UnsupportedAgentCapabilitiesError extends Error {
  readonly code = "unsupported_agent_capabilities";

  constructor(readonly capabilities: readonly UnsupportedAgentCapability[]) {
    super(capabilities.map((capability) => capability.message).join("\n"));
    this.name = "UnsupportedAgentCapabilitiesError";
  }
}

/**
 * Validates the complete loaded manifest at the execution boundary.
 * Discovery remains lossless; unsupported declarations are never discarded.
 */
export function validateAgentCapabilities(manifest: AgentManifest): void {
  const capabilities = _unsupported(manifest, `agent:${manifest.agentId}`);
  if (capabilities.length > 0) {
    throw new UnsupportedAgentCapabilitiesError(capabilities);
  }
}

function _unsupported(
  manifest: AgentManifest,
  prefix: string
): UnsupportedAgentCapability[] {
  const capabilities: UnsupportedAgentCapability[] = [];
  _appendSources(capabilities, "channel", `${prefix}.channels`, manifest.channels);
  _appendSources(
    capabilities,
    "connection",
    `${prefix}.connections`,
    manifest.connections
  );
  _appendSources(capabilities, "hook", `${prefix}.hooks`, manifest.hooks);
  _appendSources(
    capabilities,
    "sandbox-workspace",
    `${prefix}.sandboxWorkspace`,
    manifest.sandboxWorkspace
  );
  _appendSources(capabilities, "schedule", `${prefix}.schedules`, manifest.schedules);
  if (manifest.instrumentation !== undefined) {
    capabilities.push(
      _capability(
        "instrumentation",
        `${prefix}.instrumentation`,
        manifest.instrumentation
      )
    );
  }
  if (manifest.sandbox !== undefined) {
    capabilities.push(_capability("sandbox", `${prefix}.sandbox`, manifest.sandbox));
  }
  manifest.subagents.forEach((subagent, index) => {
    const path = `${prefix}.subagents[${index}]`;
    capabilities.push({
      kind: "subagent",
      path,
      message: `Pi host does not yet support Agent capability "${path}".`,
    });
    capabilities.push(..._unsupported(subagent, path));
  });
  return capabilities;
}

function _appendSources(
  target: UnsupportedAgentCapability[],
  kind: UnsupportedAgentCapabilityKind,
  path: string,
  sources: readonly AgentManifestSource[]
): void {
  sources.forEach((source, index) => {
    target.push(_capability(kind, `${path}[${index}]`, source));
  });
}

function _capability(
  kind: UnsupportedAgentCapabilityKind,
  path: string,
  source: AgentManifestSource
): UnsupportedAgentCapability {
  return {
    kind,
    path,
    sourcePath: source.logicalPath,
    message: `Pi host does not yet support Agent capability "${path}" from "${source.logicalPath}".`,
  };
}
