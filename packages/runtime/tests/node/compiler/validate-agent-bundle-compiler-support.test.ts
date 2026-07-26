import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  AGENT_BUNDLE_COMPILER_SUPPORT_FILENAME,
  AGENT_BUNDLE_COMPILER_SUPPORT_MANIFEST_FILENAME,
  validateAgentBundleCompilerSupport
} from "../../../src/node";
import { getRejection } from "../../test-utils/get-rejection";
import { writeAgentBundleCompilerSupportFixture } from "../../test-utils/write-agent-bundle-compiler-support-fixture";

let root = "";
let supportPath = "";
let manifestPath = "";

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "llm-space-support-validation-"));
  supportPath = path.join(root, AGENT_BUNDLE_COMPILER_SUPPORT_FILENAME);
  manifestPath = path.join(
    root,
    AGENT_BUNDLE_COMPILER_SUPPORT_MANIFEST_FILENAME
  );
  await writeAgentBundleCompilerSupportFixture(
    root,
    "export const valid = true;\n"
  );
});

afterAll(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("validateAgentBundleCompilerSupport", () => {
  test("rejects missing support", async () => {
    const error = await getRejection(validateAgentBundleCompilerSupport(
      path.join(root, "missing", AGENT_BUNDLE_COMPILER_SUPPORT_FILENAME)
    ));
    expect(error.message).toContain("support is unavailable");
  });

  test("rejects an unsupported schema version", async () => {
    await _withManifest(
      manifest => ({ ...manifest, schemaVersion: manifest.schemaVersion + 1 }),
      async () => {
        const error = await getRejection(
          validateAgentBundleCompilerSupport(supportPath)
        );
        expect(error.message).toContain("schema 2 is unsupported");
      }
    );
  });

  test("rejects a byte length mismatch", async () => {
    await _withManifest(
      manifest => ({ ...manifest, byteLength: manifest.byteLength + 1 }),
      async () => {
        const error = await getRejection(
          validateAgentBundleCompilerSupport(supportPath)
        );
        expect(error.message).toContain("byte length mismatch");
      }
    );
  });

  test("rejects a fingerprint mismatch", async () => {
    await _withManifest(
      manifest => ({ ...manifest, sha256: "0".repeat(64) }),
      async () => {
        const error = await getRejection(
          validateAgentBundleCompilerSupport(supportPath)
        );
        expect(error.message).toContain("fingerprint mismatch");
      }
    );
  });
});

async function _withManifest(
  mutate: (manifest: {
    byteLength: number;
    schemaVersion: number;
    sha256: string;
  }) => unknown,
  run: () => Promise<void>
): Promise<void> {
  const original = await readFile(manifestPath, "utf8");
  try {
    await writeFile(
      manifestPath,
      JSON.stringify(mutate(JSON.parse(original))),
      "utf8"
    );
    await run();
  } finally {
    await writeFile(manifestPath, original, "utf8");
  }
}
