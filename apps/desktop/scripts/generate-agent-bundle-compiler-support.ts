import path from "node:path";
import { generateAgentBundleCompilerSupport } from "@llm-space/runtime/node";

const OUTPUT_DIRECTORY = path.resolve(
  import.meta.dir,
  "../.generated/agent-bundle-compiler"
);
const MANIFEST = await generateAgentBundleCompilerSupport(OUTPUT_DIRECTORY);

console.log(
  `Generated Agent bundle compiler support (${MANIFEST.byteLength} bytes, ${MANIFEST.sha256}).`
);
