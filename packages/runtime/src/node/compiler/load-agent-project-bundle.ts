import { realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { assertValidAgentProject } from "../../runtime/agent/assert-valid-agent-project";

import type { AgentProjectArtifact } from "../../runtime/agent/agent-project-artifact";
import type { CompiledAgentProjectSnapshot } from "../../runtime/agent/agent-project-snapshot";

interface AgentProjectBundleModule {
  createAgentProject(
    artifact: AgentProjectArtifact
  ): CompiledAgentProjectSnapshot;
}

export async function loadAgentProjectBundle(
  bundlePath: string,
  artifact: AgentProjectArtifact
): Promise<CompiledAgentProjectSnapshot> {
  const loaded = await import(pathToFileURL(await realpath(bundlePath)).href) as
    Partial<AgentProjectBundleModule>;
  if (typeof loaded.createAgentProject !== "function") {
    throw new Error("Agent deployment bundle has no createAgentProject export");
  }
  const project = loaded.createAgentProject(artifact);
  assertValidAgentProject(project);
  if (
    project.fingerprint !== artifact.fingerprint
    || project.artifact.fingerprint !== artifact.fingerprint
  ) {
    throw new Error("Bundled Agent fingerprint does not match its artifact");
  }
  return project;
}
