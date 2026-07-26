import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AGENT_BUNDLE_COMPILER_SUPPORT_FILENAME,
  AGENT_BUNDLE_COMPILER_SUPPORT_MANIFEST_FILENAME,
  AGENT_BUNDLE_COMPILER_SUPPORT_SCHEMA_VERSION,
  type AgentBundleCompilerSupportManifest
} from "./agent-bundle-compiler-support";

export async function generateAgentBundleCompilerSupport(
  outputDirectory: string
): Promise<AgentBundleCompilerSupportManifest> {
  const temporaryRoot = await mkdtemp(path.join(
    tmpdir(),
    "llm-space-compiler-support-"
  ));
  try {
    const supportBytes = await _buildInFreshBunProcess(temporaryRoot);
    const manifest = Object.freeze({
      byteLength: supportBytes.byteLength,
      schemaVersion: AGENT_BUNDLE_COMPILER_SUPPORT_SCHEMA_VERSION,
      sha256: createHash("sha256").update(supportBytes).digest("hex")
    });
    await mkdir(outputDirectory, { recursive: true });
    const supportPath = path.join(
      outputDirectory,
      AGENT_BUNDLE_COMPILER_SUPPORT_FILENAME
    );
    const manifestPath = path.join(
      outputDirectory,
      AGENT_BUNDLE_COMPILER_SUPPORT_MANIFEST_FILENAME
    );
    const supportTemporaryPath = `${supportPath}.${process.pid}.tmp`;
    const manifestTemporaryPath = `${manifestPath}.${process.pid}.tmp`;
    await writeFile(supportTemporaryPath, supportBytes);
    await writeFile(
      manifestTemporaryPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8"
    );
    await rename(supportTemporaryPath, supportPath);
    await rename(manifestTemporaryPath, manifestPath);
    return manifest;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function _buildInFreshBunProcess(
  temporaryRoot: string
): Promise<Uint8Array> {
  const outputPath = path.join(temporaryRoot, "support.mjs");
  const scriptPath = path.join(temporaryRoot, "build-support.mjs");
  const builderPath = fileURLToPath(
    new URL("./build-agent-bundle-compiler-support.ts", import.meta.url)
  );
  await writeFile(scriptPath, `
    import { buildAgentBundleCompilerSupport } from ${JSON.stringify(builderPath)};
    await Bun.write(
      ${JSON.stringify(outputPath)},
      await buildAgentBundleCompilerSupport()
    );
  `, "utf8");
  const child = Bun.spawn([process.execPath, scriptPath], {
    stdout: "pipe",
    stderr: "pipe"
  });
  const [exitCode, standardError] = await Promise.all([
    child.exited,
    new Response(child.stderr).text()
  ]);
  if (exitCode !== 0) {
    throw new Error(
      standardError.trim()
      || "Unable to generate Agent bundle compiler support"
    );
  }
  return readFile(outputPath);
}
