import { mkdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function loadAuthoredModule({
  sourcePath,
  version,
  authoredSdk = false,
}: {
  sourcePath: string;
  version: string;
  authoredSdk?: boolean;
}): Promise<{ default?: unknown }> {
  const result = await Bun.build({
    entrypoints: [sourcePath],
    bundle: true,
    format: "esm",
    target: "bun",
    write: false,
    sourcemap: "inline",
    plugins: authoredSdk
      ? [
          {
            name: "llm-space-agent-definition",
            setup(build) {
              build.onResolve({ filter: /^@llm-space\/runtime$/ }, () => ({
                path: "agent-definition",
                namespace: "llm-space-runtime",
              }));
              build.onLoad(
                {
                  filter: /^agent-definition$/,
                  namespace: "llm-space-runtime",
                },
                () => ({
                  contents:
                    "export const defineAgent = (definition) => definition;",
                  loader: "js",
                })
              );
            },
          },
        ]
      : [],
  } as Parameters<typeof Bun.build>[0]);
  if (!result.success || !result.outputs[0]) {
    throw new Error(
      result.logs.map((log) => log.message).join("\n") ||
        `Unable to compile ${sourcePath}`
    );
  }
  const source = await result.outputs[0].text();
  const cacheRoot = path.join(
    await realpath(tmpdir()),
    "llm-space-runtime-modules"
  );
  const cachePath = path.join(
    cacheRoot,
    `${authoredSdk ? "definition" : "source"}-${version}.mjs`
  );
  await mkdir(cacheRoot, { recursive: true });
  try {
    await writeFile(cachePath, source, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (!_hasCode(error, "EEXIST")) throw error;
  }
  const module: unknown = await import(
    `${pathToFileURL(cachePath).href}?v=${version}`
  );
  return module && typeof module === "object" && "default" in module
    ? { default: module.default }
    : {};
}

function _hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
