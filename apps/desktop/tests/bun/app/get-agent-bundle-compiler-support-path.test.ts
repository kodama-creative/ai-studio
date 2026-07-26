import { expect, test } from "bun:test";

import config from "../../../electrobun.config";
import { getAgentBundleCompilerSupportPath } from "../../../src/bun/app/get-agent-bundle-compiler-support-path";

test("copies compiler support beside the packaged Bun entry", () => {
  expect(getAgentBundleCompilerSupportPath("/Resources/app/bun")).toBe(
    "/Resources/app/bun/support/agent-bundle-compiler-support.mjs"
  );
  expect(config.build.copy[".generated/agent-bundle-compiler"]).toBe(
    "bun/support"
  );
});
