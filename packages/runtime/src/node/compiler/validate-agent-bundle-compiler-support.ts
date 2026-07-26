import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  AGENT_BUNDLE_COMPILER_SUPPORT_MANIFEST_FILENAME,
  AGENT_BUNDLE_COMPILER_SUPPORT_SCHEMA_VERSION
} from "./agent-bundle-compiler-support";

import type {
  AgentBundleCompilerSupport,
  AgentBundleCompilerSupportManifest
} from "./agent-bundle-compiler-support";

export async function validateAgentBundleCompilerSupport(
  supportPath: string
): Promise<AgentBundleCompilerSupport> {
  const manifestPath = path.join(
    path.dirname(supportPath),
    AGENT_BUNDLE_COMPILER_SUPPORT_MANIFEST_FILENAME
  );
  let bytes: Uint8Array;
  let manifestBytes: string;
  try {
    [bytes, manifestBytes] = await Promise.all([
      readFile(supportPath),
      readFile(manifestPath, "utf8")
    ]);
  } catch (error) {
    throw new Error(
      `Agent bundle compiler support is unavailable: ${supportPath}`,
      { cause: error }
    );
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(manifestBytes);
  } catch (error) {
    throw new Error("Agent bundle compiler support manifest is invalid", {
      cause: error
    });
  }
  if (!_isManifest(candidate)) {
    throw new Error("Agent bundle compiler support manifest is invalid");
  }
  if (candidate.schemaVersion !== AGENT_BUNDLE_COMPILER_SUPPORT_SCHEMA_VERSION) {
    throw new Error(
      `Agent bundle compiler support schema ${candidate.schemaVersion} is unsupported`
    );
  }
  if (candidate.byteLength !== bytes.byteLength) {
    throw new Error("Agent bundle compiler support byte length mismatch");
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (candidate.sha256 !== sha256) {
    throw new Error("Agent bundle compiler support fingerprint mismatch");
  }
  return Object.freeze({
    bytes,
    manifest: Object.freeze({ ...candidate })
  });
}

function _isManifest(
  value: unknown
): value is AgentBundleCompilerSupportManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).length === 3
    && Number.isSafeInteger(candidate.byteLength)
    && (candidate.byteLength as number) >= 0
    && Number.isSafeInteger(candidate.schemaVersion)
    && typeof candidate.sha256 === "string"
    && /^[a-f0-9]{64}$/.test(candidate.sha256);
}
