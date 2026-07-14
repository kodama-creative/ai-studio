import { existsSync } from "node:fs";
import { basename } from "node:path";

let _hydrated = false;

const _POSIX_SHELLS = new Set(["zsh", "bash", "sh", "dash", "ksh"]);

const _SKIP_KEYS = new Set([
  "_",
  "SHLVL",
  "PWD",
  "OLDPWD",
  "TERM",
  "LLM_SPACE_RESOLVING_ENV"
]);

/**
 * Merge the POSIX login-shell environment into `process.env` once.
 * Failures leave the current environment unchanged.
 */
export function hydrateShellEnv(): void {
  if (_hydrated) {
    return;
  }
  _hydrated = true;

  if (process.platform === "win32") {
    return;
  }

  try {
    const resolved = _readLoginShellEnv();
    if (!resolved) {
      return;
    }
    for (const [key, value] of Object.entries(resolved)) {
      if (_SKIP_KEYS.has(key)) {
        continue;
      }
      process.env[key] = value;
    }
  } catch (error) {
    console.error("Failed to resolve login shell environment", error);
  }
}

/**
 * Read environment variables from the user's login shell.
 */
function _readLoginShellEnv(): Record<string, string> | null {
  const shell = _resolveShell();
  const delimiter = `__LLM_SPACE_ENV_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2)}__`;
  const script = `echo ${delimiter}; command env; echo ${delimiter}`;

  const result = Bun.spawnSync([shell, "-ilc", script], {
    env: {
      ...process.env,
      LLM_SPACE_RESOLVING_ENV: "1",
      TERM: "dumb"
    },
    stdout: "pipe",
    stderr: "ignore",
    timeout: 8000
  });

  if (!result.success) {
    return null;
  }
  return _parseEnvBlock(Buffer.from(result.stdout).toString("utf8"), delimiter);
}

/**
 * Resolve a supported POSIX shell with a system-shell fallback.
 */
function _resolveShell(): string {
  const shell = process.env.SHELL;
  if (shell && _POSIX_SHELLS.has(basename(shell))) {
    return shell;
  }
  return existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/bash";
}

/**
 * Parse delimited `KEY=VALUE` output and preserve multiline values.
 */
function _parseEnvBlock(
  output: string,
  delimiter: string
): Record<string, string> | null {
  const start = output.indexOf(delimiter);
  const end = output.lastIndexOf(delimiter);
  if (start === -1 || end === -1 || start === end) {
    return null;
  }

  const block = output.slice(start + delimiter.length, end);
  const env: Record<string, string> = {};
  let lastKey: string | null = null;

  for (const line of block.split("\n")) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (match) {
      lastKey = match[1];
      env[lastKey] = match[2];
    } else if (lastKey !== null) {
      env[lastKey] += `\n${line}`;
    }
  }
  return env;
}
