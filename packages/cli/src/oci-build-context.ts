import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { createAgentProjectBundle } from "@llm-space/runtime/node";

import {
  OCI_BUN_BASE_IMAGE,
  OCI_BUN_BASE_REFERENCE
} from "./oci/base-image-lock";
import { createOciEnvironmentManifest } from "./oci/environment-manifest";

export interface CreateOciBuildContextOptions {
  readonly agentRoot: string;
  readonly output: string;
}

export interface CreatedOciBuildContext {
  readonly artifactFingerprint: string;
  readonly output: string;
}

export async function createOciBuildContext(
  options: CreateOciBuildContextOptions
): Promise<CreatedOciBuildContext> {
  _assertLockedBunVersion();
  const output = path.resolve(options.output);
  await _assertMissing(output);
  const parent = path.dirname(output);
  await mkdir(parent, { recursive: true });
  const stage = path.join(parent, `.llm-space-oci-${randomUUID()}`);
  try {
    await mkdir(stage, { mode: 0o700 });
    const bundled = await createAgentProjectBundle(path.resolve(options.agentRoot));
    const sourceRevision = await _sourceRevision(options.agentRoot);
    const environment = createOciEnvironmentManifest(
      bundled.artifact.fingerprint,
      bundled.environment
    );
    await _bundleEntriesInFreshBunProcess(stage);
    await Promise.all([
      writeFile(path.join(stage, "agent.bundle.mjs"), bundled.bundle, "utf8"),
      writeFile(
        path.join(stage, "artifact.json"),
        `${JSON.stringify(bundled.artifact, null, 2)}\n`,
        "utf8"
      ),
      writeFile(
        path.join(stage, "environment.json"),
        `${JSON.stringify(environment, null, 2)}\n`,
        "utf8"
      ),
      writeFile(
        path.join(stage, "Containerfile"),
        _containerfile(bundled.artifact.fingerprint, sourceRevision),
        "utf8"
      )
    ]);
    await _assertNoRuntimeSecretValues(stage, environment.agent);
    await rename(stage, output);
    return Object.freeze({
      artifactFingerprint: bundled.artifact.fingerprint,
      output
    });
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

async function _assertNoRuntimeSecretValues(
  stage: string,
  agent: ReturnType<typeof createOciEnvironmentManifest>["agent"]
): Promise<void> {
  const names = [
    "LLM_SPACE_SERVER_AUTH_KEYS",
    ...Object.entries(agent)
      .filter(([, requirement]) => requirement.kind === "secret")
      .map(([name]) => name)
  ];
  const files = await readdir(stage);
  const context = (await Promise.all(
    files.map(async file => readFile(path.join(stage, file), "utf8"))
  )).join("\n");
  for (const name of names) {
    const value = process.env[name];
    if (value && context.includes(value)) {
      throw new Error(
        `Generated OCI context contains runtime secret value for ${name}`
      );
    }
  }
}

function _assertLockedBunVersion(): void {
  if (Bun.version !== OCI_BUN_BASE_IMAGE.version) {
    throw new Error(
      `OCI builds require Bun ${OCI_BUN_BASE_IMAGE.version}; current compiler is ${Bun.version}`
    );
  }
}

async function _bundleEntriesInFreshBunProcess(stage: string): Promise<void> {
  const scriptPath = path.join(stage, ".build-oci-entries.mjs");
  const bootstrapEntry = path.join(import.meta.dir, "oci/bootstrap.ts");
  const healthcheckEntry = path.join(import.meta.dir, "oci/healthcheck.ts");
  await writeFile(scriptPath, `
    const [RESOLVE_ROOT, ...ENTRIES] = process.argv.slice(2);
    const PLUGIN = {
      name: "llm-space-oci-workspaces",
      setup(build) {
        build.onResolve({ filter: /^@llm-space\\// }, args => ({
          path: Bun.resolveSync(args.path, RESOLVE_ROOT)
        }));
      }
    };
    for (let index = 0; index < ENTRIES.length; index += 2) {
      const entryPath = ENTRIES[index];
      const outputPath = ENTRIES[index + 1];
      const result = await Bun.build({
        entrypoints: [entryPath],
        format: "esm",
        minify: {
          identifiers: false,
          syntax: true,
          whitespace: true
        },
        sourcemap: "none",
        target: "bun",
        write: false,
        plugins: [PLUGIN]
      });
      if (!result.success || !result.outputs[0]) {
        throw new Error(
          result.logs.map(log => log.message).join("\\n")
          || \`Unable to bundle \${entryPath}\`
        );
      }
      await Bun.write(outputPath, result.outputs[0]);
    }
  `, "utf8");
  const child = Bun.spawn([
    process.execPath,
    scriptPath,
    import.meta.dir,
    bootstrapEntry,
    path.join(stage, "bootstrap.mjs"),
    healthcheckEntry,
    path.join(stage, "healthcheck.mjs")
  ], {
    stdout: "pipe",
    stderr: "pipe"
  });
  const [exitCode, standardError] = await Promise.all([
    child.exited,
    new Response(child.stderr).text()
  ]);
  await rm(scriptPath, { force: true });
  if (exitCode !== 0) {
    throw new Error(
      standardError.trim() || "Unable to build OCI entry bundles"
    );
  }
}

function _containerfile(
  artifactFingerprint: string,
  sourceRevision?: string
): string {
  return `FROM ${OCI_BUN_BASE_REFERENCE}

USER root
WORKDIR /opt/llm-space
COPY --chown=1000:1000 agent.bundle.mjs artifact.json bootstrap.mjs environment.json healthcheck.mjs ./
RUN mkdir -p /var/lib/llm-space && chown 1000:1000 /var/lib/llm-space

LABEL io.llm-space.agent-artifact.fingerprint=${artifactFingerprint}
LABEL io.llm-space.agent-artifact.schema-version=1
LABEL org.opencontainers.image.base.name=${OCI_BUN_BASE_IMAGE.image}:${OCI_BUN_BASE_IMAGE.version}-${OCI_BUN_BASE_IMAGE.variant}
LABEL org.opencontainers.image.base.digest=${OCI_BUN_BASE_IMAGE.digest}
${sourceRevision ? `LABEL org.opencontainers.image.revision=${sourceRevision}\n` : ""}

EXPOSE 7331
VOLUME ["/var/lib/llm-space"]
USER 1000:1000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 CMD ["bun", "/opt/llm-space/healthcheck.mjs"]
ENTRYPOINT ["bun", "/opt/llm-space/bootstrap.mjs"]
`;
}

async function _sourceRevision(agentRoot: string): Promise<string | undefined> {
  const child = Bun.spawn([
    "git",
    "-C",
    path.resolve(agentRoot),
    "rev-parse",
    "--verify",
    "HEAD"
  ], {
    stdout: "pipe",
    stderr: "ignore"
  });
  const [exitCode, standardOutput] = await Promise.all([
    child.exited,
    new Response(child.stdout).text()
  ]);
  const revision = standardOutput.trim();
  return exitCode === 0 && /^[0-9a-f]{40,64}$/.test(revision)
    ? revision
    : undefined;
}

async function _assertMissing(target: string): Promise<void> {
  try {
    await lstat(target);
  } catch (error) {
    if (_hasCode(error, "ENOENT")) { return; }
    throw error;
  }
  throw new Error(`Refusing to overwrite existing path: ${target}`);
}

function _hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
