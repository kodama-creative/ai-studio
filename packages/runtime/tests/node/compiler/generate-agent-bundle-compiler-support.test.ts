import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  AGENT_BUNDLE_COMPILER_SUPPORT_FILENAME,
  AGENT_BUNDLE_COMPILER_SUPPORT_MANIFEST_FILENAME,
  generateAgentBundleCompilerSupport
} from "../../../src/node";

const REPOSITORY_ROOT = path.resolve(import.meta.dir, "../../../../..");

let root = "";
let supportPath = "";

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "llm-space-support-generation-"));
  await generateAgentBundleCompilerSupport(root);
  supportPath = path.join(root, AGENT_BUNDLE_COMPILER_SUPPORT_FILENAME);
});

afterAll(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("generateAgentBundleCompilerSupport", () => {
  test("generates checkout-independent closed bytes with a valid sidecar", async () => {
    const copiedCheckoutRoot = path.join(root, "copied-checkout");
    const secondRoot = path.join(root, "copied-output");
    await _copyCompilerCheckout(copiedCheckoutRoot);
    const copiedGeneratorPath = path.join(
      copiedCheckoutRoot,
      "packages/runtime/src/node/compiler/generate-agent-bundle-compiler-support.ts"
    );
    const copiedGenerator = await import(
      `${pathToFileURL(copiedGeneratorPath).href}?copied-checkout`
    ) as {
      generateAgentBundleCompilerSupport(
        outputDirectory: string
      ): Promise<{
        byteLength: number;
        schemaVersion: number;
        sha256: string;
      }>;
    };
    const firstManifest = JSON.parse(await readFile(path.join(
      root,
      AGENT_BUNDLE_COMPILER_SUPPORT_MANIFEST_FILENAME
    ), "utf8"));
    const secondManifest =
      await copiedGenerator.generateAgentBundleCompilerSupport(secondRoot);
    const supportSource = await readFile(supportPath, "utf8");

    expect(secondManifest).toEqual(firstManifest);
    expect(await readFile(path.join(
      secondRoot,
      AGENT_BUNDLE_COMPILER_SUPPORT_FILENAME
    ))).toEqual(await readFile(supportPath));
    expect(supportSource).not.toContain(REPOSITORY_ROOT);
    expect(supportSource).not.toContain(copiedCheckoutRoot);
    expect(supportSource
      .split(/\r?\n/)
      .some(line => /^\s*\/\/[#@]\s*sourceMappingURL=/.test(line)))
      .toBe(false);
  });
});

async function _copyCompilerCheckout(checkoutRoot: string): Promise<void> {
  await cp(
    path.join(REPOSITORY_ROOT, "packages/runtime/src"),
    path.join(checkoutRoot, "packages/runtime/src"),
    { recursive: true }
  );
  const nodeModulesRoot = path.join(
    checkoutRoot,
    "packages/runtime/node_modules"
  );
  await mkdir(nodeModulesRoot, { recursive: true });
  await cp(
    await realpath(path.join(
      REPOSITORY_ROOT,
      "packages/runtime/node_modules/typescript"
    )),
    path.join(nodeModulesRoot, "typescript"),
    { dereference: true, recursive: true }
  );
  for (const dependency of [
    ["typebox"],
    ["@earendil-works", "pi-agent-core"],
    ["@earendil-works", "pi-ai"],
    ["@modelcontextprotocol", "sdk"]
  ]) {
    const source = await realpath(path.join(
      REPOSITORY_ROOT,
      "packages/runtime/node_modules",
      ...dependency
    ));
    const destination = path.join(nodeModulesRoot, ...dependency);
    await mkdir(path.dirname(destination), { recursive: true });
    await symlink(source, destination, "dir");
  }
}
