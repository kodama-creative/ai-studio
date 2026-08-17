import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { verifyBunDiBundle } from "./verify-bun-di-bundle";

const projectRoot = join(import.meta.dir, "..");
const outputDir = join(
  projectRoot,
  "node_modules",
  ".cache",
  "llm-space-electrobun",
  "bun"
);
const outputPath = join(outputDir, "index.js");

mkdirSync(outputDir, { recursive: true });

// Electrobun's compiled CLI currently loses legacy parameter decorators when
// its internal Bun.build() reads TypeScript. Running the same build in this
// external hook honors Desktop's tsconfig and preserves Inversify metadata.
const result = await Bun.build({
  entrypoints: [join(projectRoot, "src", "bun", "index.ts")],
  outdir: outputDir,
  target: "bun",
  tsconfig: join(projectRoot, "tsconfig.json"),
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error("Failed to prebuild the Desktop Bun process");
}

verifyBunDiBundle(readFileSync(outputPath, "utf8"));
console.info("pre-build: Bun process emitted with constructor injection metadata");
