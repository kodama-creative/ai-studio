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

function _result(value) {
  process.stdout.write(JSON.stringify({ type: "result", ok: true, value }) + "\n");
}

function _failure(error) {
  process.stdout.write(JSON.stringify({
    type: "result",
    ok: false,
    error: { message: error instanceof Error ? error.message : String(error) }
  }) + "\n");
}

function _fileFailure(error, target) {
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

function _executionFailure(code, error) {
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

function _addressed(value) {
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

function _fileInfoValue(target, info) {
  return {
    name: path.posix.basename(target),
    path: target,
    kind: info.isSymbolicLink() ? "symlink"
      : info.isDirectory() ? "directory" : "file",
    size: info.size,
    mtimeMs: info.mtimeMs
  };
}

function _safeName(value) {
  return typeof value === "string"
    && value.length > 0
    && value === path.posix.basename(value)
    && !value.includes("\\")
    && !/[\0-\x1f\x7f]/.test(value)
    && Buffer.byteLength(value, "utf8") <= 240;
}

async function _seed(input) {
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
  _result();
}

async function _stageTurn(input) {
  const attachments = input.attachments ?? [];
  const turnKey = createHash("sha256").update(String(input.turnId)).digest("hex").slice(0, 24);
  const destinationName = ".llm-space-attachments-" + turnKey;
  const destination = path.join(WORKSPACE, destinationName);
  const temporary = path.join(WORKSPACE, destinationName + ".tmp");
  await mkdir(temporary, { recursive: true });
  const staged = [];
  try {
    for (const attachment of attachments) {
      if (!_safeName(attachment.name)) {
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
        path: path.posix.join("/workspace", destinationName, attachment.name),
        size: content.byteLength
      });
    }
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  _result(staged);
}

async function _discardTurn(input) {
  const turnKey = createHash("sha256").update(String(input.turnId)).digest("hex").slice(0, 24);
  const destinationName = ".llm-space-attachments-" + turnKey;
  await Promise.all([
    rm(path.join(WORKSPACE, destinationName), {
      recursive: true,
      force: true
    }),
    rm(path.join(WORKSPACE, destinationName + ".tmp"), {
      recursive: true,
      force: true
    })
  ]);
  _result();
}

async function _manifest() {
  const entries = await readdir(WORKSPACE, { withFileTypes: true });
  _result(entries
    .map(entry => entry.isDirectory() ? entry.name + "/" : entry.name)
    .sort()
    .slice(0, 1000));
}

async function _fileOperation(input) {
  let target;
  try {
    if (input.operation === "absolutePath") {
      _result(_addressed(input.path));
      return;
    }
    if (input.operation === "joinPath") {
      if (!Array.isArray(input.parts)) {
        throw Object.assign(new Error("Path parts must be an array"), {
          code: "EINVAL"
        });
      }
      _result(_addressed(path.posix.join(...input.parts)));
      return;
    }
    if (input.operation === "createTempDir") {
      const prefix = _safeName(input.prefix || "tmp-") ? input.prefix || "tmp-" : "tmp-";
      _result(await mkdtemp(path.posix.join("/tmp", prefix)));
      return;
    }
    if (input.operation === "createTempFile") {
      const prefix = _safeName(input.prefix || "file") ? input.prefix || "file" : "file";
      const suffix = typeof input.suffix === "string" && !input.suffix.includes("/")
        ? input.suffix : "";
      const targetFile = path.posix.join("/tmp", prefix + randomUUID() + suffix);
      const handle = await open(targetFile, "wx");
      await handle.close();
      _result(targetFile);
      return;
    }
    target = _addressed(input.path);
    if (input.operation === "readTextFile") {
      _result(await readFile(target, "utf8"));
    } else if (input.operation === "readTextLines") {
      const text = await readFile(target, "utf8");
      const lines = text.split(/\r?\n/);
      if (lines.at(-1) === "") lines.pop();
      _result(input.maxLines === undefined ? lines : lines.slice(0, input.maxLines));
    } else if (input.operation === "readBinaryFile") {
      _result({ contentBase64: (await readFile(target)).toString("base64") });
    } else if (input.operation === "writeFile") {
      await mkdir(path.posix.dirname(target), { recursive: true });
      await writeFile(
        target,
        input.contentBase64 === undefined
          ? String(input.contentText ?? "")
          : Buffer.from(input.contentBase64, "base64")
      );
      _result();
    } else if (input.operation === "appendFile") {
      await mkdir(path.posix.dirname(target), { recursive: true });
      await appendFile(
        target,
        input.contentBase64 === undefined
          ? String(input.contentText ?? "")
          : Buffer.from(input.contentBase64, "base64")
      );
      _result();
    } else if (input.operation === "fileInfo") {
      _result(_fileInfoValue(target, await lstat(target)));
    } else if (input.operation === "listDir") {
      const entries = await readdir(target, { withFileTypes: true });
      const infos = [];
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        const child = path.posix.join(target, entry.name);
        infos.push(_fileInfoValue(child, await lstat(child)));
      }
      _result(infos);
    } else if (input.operation === "canonicalPath") {
      _result(await realpath(target));
    } else if (input.operation === "exists") {
      try {
        await lstat(target);
        _result(true);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          _result(false);
        } else {
          throw error;
        }
      }
    } else if (input.operation === "createDir") {
      await mkdir(target, { recursive: input.recursive !== false });
      _result();
    } else if (input.operation === "remove") {
      await rm(target, {
        recursive: input.recursive === true,
        force: input.force === true
      });
      _result();
    } else {
      throw Object.assign(new Error("Unsupported file operation"), {
        code: "ENOTSUP"
      });
    }
  } catch (error) {
    _fileFailure(error, target);
  }
}

async function _streamText(stream, type) {
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

function _killGroup(pid, signal) {
  try { process.kill(-pid, signal); } catch {}
}

async function _execute(input) {
  if (input.env && Object.keys(input.env).length > 0) {
    _executionFailure("shell_unavailable", "Sandbox shell environment overrides are disabled");
    return;
  }
  const cwd = _addressed(input.cwd || WORKSPACE);
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
        _killGroup(child.pid, "SIGTERM");
        setTimeout(() => _killGroup(child.pid, "SIGKILL"), 250);
      }, Math.max(0, input.timeout * 1000));
    }
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      _streamText(child.stdout, "stdout"),
      _streamText(child.stderr, "stderr")
    ]);
    if (timedOut) {
      _executionFailure("timeout", "Sandbox command timed out");
    } else {
      _result({ stdout, stderr, exitCode });
    }
  } catch (error) {
    _executionFailure("spawn_error", error);
  } finally {
    if (timer) clearTimeout(timer);
    await rm(marker, { force: true });
  }
}

async function _abortCommand(input) {
  const marker = path.posix.join(
    "/tmp",
    "llm-space-process-" + String(input.commandId || "") + ".json"
  );
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const { pid } = JSON.parse(await readFile(marker, "utf8"));
      _killGroup(pid, "SIGTERM");
      await Bun.sleep(100);
      _killGroup(pid, "SIGKILL");
      _result();
      return;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
      await Bun.sleep(10);
    }
  }
  _result();
}

try {
  const input = JSON.parse(await Bun.stdin.text());
  if (input.operation === "seed") await _seed(input);
  else if (input.operation === "stageTurn") await _stageTurn(input);
  else if (input.operation === "discardTurn") await _discardTurn(input);
  else if (input.operation === "manifest") await _manifest();
  else if (input.operation === "exec") await _execute(input);
  else if (input.operation === "abort") await _abortCommand(input);
  else await _fileOperation(input);
} catch (error) {
  _failure(error);
}
`;
