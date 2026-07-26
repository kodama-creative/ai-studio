export const AGENT_BUNDLE_COMPILER_SUPPORT_FILENAME =
  "agent-bundle-compiler-support.mjs";
export const AGENT_BUNDLE_COMPILER_SUPPORT_MANIFEST_FILENAME =
  "agent-bundle-compiler-support.json";
export const AGENT_BUNDLE_COMPILER_SUPPORT_SCHEMA_VERSION = 1;
export const AGENT_BUNDLE_COMPILER_SUPPORT_HELPER_SPECIFIER =
  "llm-space:compiler/create-bundled-agent-project";

export interface AgentBundleCompilerSupportManifest {
  readonly byteLength: number;
  readonly schemaVersion: number;
  readonly sha256: string;
}

export interface AgentBundleCompilerSupport {
  readonly bytes: Uint8Array;
  readonly manifest: AgentBundleCompilerSupportManifest;
}
