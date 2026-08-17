import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const LEGACY_PARAMETER_DECORATOR_HELPER = "__legacyDecorateParamTS";
const CONSTRUCTOR_INJECTION_PROBE =
  "inject(DesktopPlaygroundApplication)";

/**
 * Assert that the bundled Bun process retained legacy parameter decorators.
 *
 * Inversify reads the metadata written by `@inject()` at class-definition
 * time. A bundle can therefore typecheck and build successfully yet fail at
 * startup if its TypeScript transform silently switches to stage-3 class
 * decorators, which do not support parameter decorators.
 */
export function verifyBunDiBundle(source: string): void {
  if (
    !source.includes(LEGACY_PARAMETER_DECORATOR_HELPER) ||
    !source.includes(CONSTRUCTOR_INJECTION_PROBE)
  ) {
    throw new Error(
      "Bun bundle dropped Inversify parameter decorators; run the verified Desktop pre-build before Electrobun packaging"
    );
  }
}

/** Resolve the Bun entry bundle produced before Electrobun packs the ASAR. */
function resolveBunBundle(buildDir: string): string {
  const candidates: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (
        entry.isFile() &&
        entry.name === "index.js" &&
        basename(directory) === "bun" &&
        basename(dirname(directory)) === "app"
      ) {
        candidates.push(path);
      }
    }
  };
  visit(buildDir);
  if (candidates.length !== 1) {
    throw new Error(
      `Expected one Electrobun app/bun/index.js in ${buildDir}, found ${candidates.length}`
    );
  }
  return candidates[0];
}

/** Verify the current Electrobun build when invoked as a lifecycle hook. */
export function verifyCurrentBunDiBundle(): void {
  const buildDir = process.env.ELECTROBUN_BUILD_DIR;
  if (!buildDir) {
    throw new Error("ELECTROBUN_BUILD_DIR is required");
  }
  const bundlePath = resolveBunBundle(buildDir);
  verifyBunDiBundle(readFileSync(bundlePath, "utf8"));
  console.info("verify-bun-di-bundle: constructor injection metadata retained");
}
