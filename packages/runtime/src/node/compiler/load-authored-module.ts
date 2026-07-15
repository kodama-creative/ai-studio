import { createHash } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import * as TypeBox from "typebox";

import {
  createAuthoredDefinitionVirtualModule,
  defineMcpClientConnectionRuntime,
  defineToolRuntime,
} from "../../internal/authored-action-definitions";

const TYPEBOX_RUNTIME_KEY = Symbol.for("llm-space.typebox-runtime");

Object.defineProperty(globalThis, TYPEBOX_RUNTIME_KEY, {
  value: TypeBox,
  configurable: false,
  enumerable: false,
  writable: false,
});

export async function loadAuthoredModule({
  sourcePath,
  authoredSdk = false,
}: {
  sourcePath: string;
  authoredSdk?: boolean;
}): Promise<{ default?: unknown; fingerprint: string }> {
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
              build.onResolve(
                { filter: /^@llm-space\/runtime\/tools$/ },
                () => ({
                  path: "tool-definition",
                  namespace: "llm-space-runtime",
                })
              );
              build.onLoad(
                {
                  filter: /^tool-definition$/,
                  namespace: "llm-space-runtime",
                },
                () => ({
                  contents: createAuthoredDefinitionVirtualModule(
                    "defineTool",
                    defineToolRuntime
                  ),
                  loader: "js",
                })
              );
              build.onResolve(
                { filter: /^@llm-space\/runtime\/connections$/ },
                () => ({
                  path: "connection-definition",
                  namespace: "llm-space-runtime",
                })
              );
              build.onLoad(
                {
                  filter: /^connection-definition$/,
                  namespace: "llm-space-runtime",
                },
                () => ({
                  contents: createAuthoredDefinitionVirtualModule(
                    "defineMcpClientConnection",
                    defineMcpClientConnectionRuntime
                  ),
                  loader: "js",
                })
              );
              build.onResolve({ filter: /^typebox$/ }, () => ({
                path: "typebox-runtime",
                namespace: "llm-space-runtime",
              }));
              build.onLoad(
                {
                  filter: /^typebox-runtime$/,
                  namespace: "llm-space-runtime",
                },
                () => ({
                  contents: `
                    const runtime = globalThis[Symbol.for("llm-space.typebox-runtime")];
                    if (!runtime) throw new Error("TypeBox authored runtime is unavailable");
                    export const Type = runtime.Type;
                    export const Format = runtime.Format;
                    export const Schema = runtime.Schema;
                  `,
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
  const fingerprint = createHash("sha256")
    .update(sourcePath)
    .update(source)
    .digest("hex");
  const cacheRoot = path.join(
    await realpath(tmpdir()),
    "llm-space-runtime-modules"
  );
  const cachePath = path.join(
    cacheRoot,
    `${authoredSdk ? "definition" : "source"}-${fingerprint}.mjs`
  );
  await mkdir(cacheRoot, { recursive: true });
  try {
    await writeFile(cachePath, source, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (!_hasCode(error, "EEXIST")) throw error;
  }
  const module: unknown = await import(
    `${pathToFileURL(cachePath).href}?v=${fingerprint}`
  );
  return module && typeof module === "object" && "default" in module
    ? { default: module.default, fingerprint }
    : { fingerprint };
}

function _hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
