import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  AGENT_BUNDLE_COMPILER_SUPPORT_FILENAME,
  AGENT_BUNDLE_COMPILER_SUPPORT_MANIFEST_FILENAME,
  AGENT_BUNDLE_COMPILER_SUPPORT_SCHEMA_VERSION
} from "../../src/node";

export async function writeAgentBundleCompilerSupportFixture(
  outputRoot: string,
  source: string
): Promise<void> {
  const bytes = new TextEncoder().encode(source);
  const manifest = {
    byteLength: bytes.byteLength,
    schemaVersion: AGENT_BUNDLE_COMPILER_SUPPORT_SCHEMA_VERSION,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
  await mkdir(outputRoot, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(outputRoot, AGENT_BUNDLE_COMPILER_SUPPORT_FILENAME),
      bytes
    ),
    writeFile(
      path.join(
        outputRoot,
        AGENT_BUNDLE_COMPILER_SUPPORT_MANIFEST_FILENAME
      ),
      JSON.stringify(manifest),
      "utf8"
    )
  ]);
}
