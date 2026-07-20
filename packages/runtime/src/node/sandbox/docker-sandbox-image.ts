export const DOCKER_SANDBOX_HELPER_PATH =
  "/opt/llm-space/sandbox-helper.mjs";

export const DOCKER_SANDBOX_FILE = `FROM oven/bun:1.3.14-debian@sha256:9dba1a1b43ce28c9d7931bfc4eb00feb63b0114720a0277a8f939ae4dfc9db6f
USER root
RUN mkdir -p /opt/llm-space /workspace && chown 1000:1000 /workspace
COPY --chown=1000:1000 sandbox-helper.mjs /opt/llm-space/sandbox-helper.mjs
RUN chmod 0555 /opt/llm-space/sandbox-helper.mjs
VOLUME ["/workspace"]
USER 1000:1000
WORKDIR /workspace
CMD ["sh", "-c", "trap 'exit 0' TERM INT; while :; do sleep 3600 & wait $!; done"]
`;

export const DOCKER_SANDBOX_HELPER_SOURCE = String.raw`
import { createHash, randomUUID } from "node:crypto";
import { appendFile, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const WORKSPACE = "/workspace";
const INTERNAL = path.join(WORKSPACE, ".llm-space");

function result(value) {
  process.stdout.write(JSON.stringify({ type: "result", ok: true, value }) + "\n");
}

function failure(error) {
  process.stdout.write(JSON.stringify({
    type: "result",
    ok: false,
    error: { message: error instanceof Error ? error.message : String(error) }
  }) + "\n");
}

function fileFailure(error, target) {
  const code = error instanceof Error && "code" in error ? error.code : "";
  const stable = code === "ENOENT" ? "not_found"
    : code === "EACCES" || code === "EPERM" || code === "EROFS"
      ? "permission_denied"
      : code === "ENOTDIR" ? "not_directory"
        : code === "EISDIR" ? "is_directory"
          : code === "EINVAL" ? "invalid" : "unknown";
  process.stdout.write(JSON.stringify({
    type: "result",
    ok: false,
    error: {
      kind: "file",
      code: stable,
      message: error instanceof Error ? error.message : String(error),
      ...(target ? { path: target } : {})
    }
  }) + "\n");
}

function executionFailure(code, error) {
  process.stdout.write(JSON.stringify({
    type: "result",
    ok: false,
    error: {
      kind: "execution",
      code,
      message: error instanceof Error ? error.message : String(error)
    }
  }) + "\n");
}

function addressed(value) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw Object.assign(new Error("Sandbox path must be a string"), {
      code: "EINVAL"
    });
  }
  const absolute = path.posix.isAbsolute(value)
    ? path.posix.normalize(value)
    : path.posix.resolve(WORKSPACE, value);
  const allowed = absolute === WORKSPACE
    || absolute.startsWith(WORKSPACE + "/")
    || absolute === "/tmp"
    || absolute.startsWith("/tmp/");
  if (!allowed) {
    throw Object.assign(new Error("Sandbox path is outside /workspace and /tmp"), {
      code: "EACCES"
    });
  }
  return absolute;
}

function fileInfoValue(target, info) {
  return {
    name: path.posix.basename(target),
    path: target,
    kind: info.isSymbolicLink() ? "symlink"
      : info.isDirectory() ? "directory" : "file",
    size: info.size,
    mtimeMs: info.mtimeMs
  };
}

function safeName(value) {
  return typeof value === "string"
    && value.length > 0
    && value === path.posix.basename(value)
    && !value.includes("\\")
    && !/[\0-\x1f\x7f]/.test(value)
    && Buffer.byteLength(value, "utf8") <= 240;
}

async function seed(input) {
  await mkdir(INTERNAL, { recursive: true });
  for (const file of input.files ?? []) {
    if (typeof file.path !== "string" || file.path.startsWith("/")
      || file.path.includes("\\") || file.path.split("/").some(
        segment => !segment || segment === "." || segment === ".."
      )) {
      throw new Error("Invalid Sandbox seed path");
    }
    const target = path.join(WORKSPACE, ...file.path.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(file.contentBase64, "base64"), {
      flag: "wx"
    });
  }
  await writeFile(
    path.join(INTERNAL, "seed.json"),
    JSON.stringify({ fingerprint: input.fingerprint ?? null }),
    { flag: "wx" }
  );
  result();
}

async function stageTurn(input) {
  const attachments = input.attachments ?? [];
  const turnKey = createHash("sha256").update(String(input.turnId)).digest("hex").slice(0, 24);
  const attachmentRoot = path.join(WORKSPACE, "attachments");
  const destination = path.join(attachmentRoot, turnKey);
  const marker = path.join(destination, ".attachments.json");
  try {
    const existing = JSON.parse(await readFile(marker, "utf8"));
    if (JSON.stringify(existing.input) !== JSON.stringify(attachments.map(
      ({ id, name, fingerprint }) => ({ id, name, fingerprint })
    ))) {
      throw new Error("Turn attachments already exist with different identity");
    }
    result(existing.staged);
    return;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
  const stagingRoot = path.join(INTERNAL, "staging");
  const temporary = path.join(stagingRoot, randomUUID());
  await mkdir(temporary, { recursive: true });
  const staged = [];
  try {
    for (const attachment of attachments) {
      if (!safeName(attachment.name)) {
        throw new Error("Invalid Sandbox attachment name");
      }
      const content = Buffer.from(attachment.contentBase64, "base64");
      const target = path.join(temporary, attachment.name);
      await writeFile(target, content, { flag: "wx" });
      staged.push({
        id: attachment.id,
        name: attachment.name,
        fingerprint: attachment.fingerprint,
        ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
        path: path.posix.join("/workspace/attachments", turnKey, attachment.name),
        size: content.byteLength
      });
    }
    await writeFile(
      path.join(temporary, ".attachments.json"),
      JSON.stringify({
        input: attachments.map(({ id, name, fingerprint }) => ({
          id,
          name,
          fingerprint
        })),
        staged
      }),
      { flag: "wx" }
    );
    await mkdir(attachmentRoot, { recursive: true });
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  result(staged);
}

async function manifest() {
  const entries = await readdir(WORKSPACE, { withFileTypes: true });
  result(entries
    .filter(entry => entry.name !== ".llm-space")
    .map(entry => entry.isDirectory() ? entry.name + "/" : entry.name)
    .sort()
    .slice(0, 1000));
}

async function fileOperation(input) {
  let target;
  try {
    if (input.operation === "absolutePath") {
      result(addressed(input.path));
      return;
    }
    if (input.operation === "joinPath") {
      if (!Array.isArray(input.parts)) {
        throw Object.assign(new Error("Path parts must be an array"), {
          code: "EINVAL"
        });
      }
      result(addressed(path.posix.join(...input.parts)));
      return;
    }
    if (input.operation === "createTempDir") {
      const prefix = safeName(input.prefix || "tmp-") ? input.prefix || "tmp-" : "tmp-";
      result(await mkdtemp(path.posix.join("/tmp", prefix)));
      return;
    }
    if (input.operation === "createTempFile") {
      const prefix = safeName(input.prefix || "file") ? input.prefix || "file" : "file";
      const suffix = typeof input.suffix === "string" && !input.suffix.includes("/")
        ? input.suffix : "";
      const targetFile = path.posix.join("/tmp", prefix + randomUUID() + suffix);
      const handle = await open(targetFile, "wx");
      await handle.close();
      result(targetFile);
      return;
    }
    target = addressed(input.path);
    if (input.operation === "readTextFile") {
      result(await readFile(target, "utf8"));
    } else if (input.operation === "readTextLines") {
      const text = await readFile(target, "utf8");
      const lines = text.split(/\r?\n/);
      if (lines.at(-1) === "") lines.pop();
      result(input.maxLines === undefined ? lines : lines.slice(0, input.maxLines));
    } else if (input.operation === "readBinaryFile") {
      result({ contentBase64: (await readFile(target)).toString("base64") });
    } else if (input.operation === "writeFile") {
      await mkdir(path.posix.dirname(target), { recursive: true });
      await writeFile(
        target,
        input.contentBase64 === undefined
          ? String(input.contentText ?? "")
          : Buffer.from(input.contentBase64, "base64")
      );
      result();
    } else if (input.operation === "appendFile") {
      await mkdir(path.posix.dirname(target), { recursive: true });
      await appendFile(
        target,
        input.contentBase64 === undefined
          ? String(input.contentText ?? "")
          : Buffer.from(input.contentBase64, "base64")
      );
      result();
    } else if (input.operation === "fileInfo") {
      result(fileInfoValue(target, await lstat(target)));
    } else if (input.operation === "listDir") {
      const entries = await readdir(target, { withFileTypes: true });
      const infos = [];
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        const child = path.posix.join(target, entry.name);
        infos.push(fileInfoValue(child, await lstat(child)));
      }
      result(infos);
    } else if (input.operation === "canonicalPath") {
      result(await realpath(target));
    } else if (input.operation === "exists") {
      try {
        await lstat(target);
        result(true);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          result(false);
        } else {
          throw error;
        }
      }
    } else if (input.operation === "createDir") {
      await mkdir(target, { recursive: input.recursive !== false });
      result();
    } else if (input.operation === "remove") {
      await rm(target, {
        recursive: input.recursive === true,
        force: input.force === true
      });
      result();
    } else {
      throw Object.assign(new Error("Unsupported file operation"), {
        code: "ENOTSUP"
      });
    }
  } catch (error) {
    fileFailure(error, target);
  }
}

async function streamText(stream, type) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let collected = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    collected += chunk;
    process.stdout.write(JSON.stringify({ type, chunk }) + "\n");
  }
  const tail = decoder.decode();
  if (tail) {
    collected += tail;
    process.stdout.write(JSON.stringify({ type, chunk: tail }) + "\n");
  }
  return collected;
}

function killGroup(pid, signal) {
  try { process.kill(-pid, signal); } catch {}
}

async function execute(input) {
  if (input.env && Object.keys(input.env).length > 0) {
    executionFailure("shell_unavailable", "Sandbox shell environment overrides are disabled");
    return;
  }
  const cwd = addressed(input.cwd || WORKSPACE);
  const commandId = String(input.commandId || "");
  const marker = path.posix.join("/tmp", "llm-space-process-" + commandId + ".json");
  let child;
  let timer;
  try {
    child = Bun.spawn(["setsid", "/bin/sh", "-lc", String(input.command)], {
      cwd,
      env: {
        PATH: "/usr/local/bin:/usr/bin:/bin",
        HOME: "/tmp",
        TMPDIR: "/tmp"
      },
      stdout: "pipe",
      stderr: "pipe"
    });
    await writeFile(marker, JSON.stringify({ pid: child.pid }), { flag: "wx" });
    let timedOut = false;
    if (typeof input.timeout === "number") {
      timer = setTimeout(() => {
        timedOut = true;
        killGroup(child.pid, "SIGTERM");
        setTimeout(() => killGroup(child.pid, "SIGKILL"), 250);
      }, Math.max(0, input.timeout * 1000));
    }
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      streamText(child.stdout, "stdout"),
      streamText(child.stderr, "stderr")
    ]);
    if (timedOut) {
      executionFailure("timeout", "Sandbox command timed out");
    } else {
      result({ stdout, stderr, exitCode });
    }
  } catch (error) {
    executionFailure("spawn_error", error);
  } finally {
    if (timer) clearTimeout(timer);
    await rm(marker, { force: true });
  }
}

async function abortCommand(input) {
  const marker = path.posix.join(
    "/tmp",
    "llm-space-process-" + String(input.commandId || "") + ".json"
  );
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const { pid } = JSON.parse(await readFile(marker, "utf8"));
      killGroup(pid, "SIGTERM");
      await Bun.sleep(100);
      killGroup(pid, "SIGKILL");
      result();
      return;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
      await Bun.sleep(10);
    }
  }
  result();
}

try {
  const input = JSON.parse(await Bun.stdin.text());
  if (input.operation === "seed") await seed(input);
  else if (input.operation === "stageTurn") await stageTurn(input);
  else if (input.operation === "manifest") await manifest();
  else if (input.operation === "exec") await execute(input);
  else if (input.operation === "abort") await abortCommand(input);
  else await fileOperation(input);
} catch (error) {
  failure(error);
}
`;
