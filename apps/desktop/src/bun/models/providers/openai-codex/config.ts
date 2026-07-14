import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { CustomProviderApi } from "../../types";

import { CodexCredentials } from './CodexCredentials';

const CODEX_DIR = path.join(os.homedir(), ".codex");
const AUTH_PATH = path.join(CODEX_DIR, "auth.json");
const CONFIG_PATH = path.join(CODEX_DIR, "config.toml");

const WIRE_API_MAP: Record<string, CustomProviderApi> = {
  responses: "openai-responses",
  completions: "openai-completions",
  messages: "anthropic-messages",
};

/**
 * Read `~/.codex/auth.json` + `config.toml` and return usable credentials.
 *
 * OAuth token takes precedence over flat API key.
 */
export function getCodexCredentials(): CodexCredentials | undefined {
  const auth = _readAuthJSON();
  if (!auth) {
    return;
  }

  if (auth.oauthToken) {
    return { mode: "oauth", apiKey: auth.oauthToken };
  }

  if (auth.apiKey) {
    const config = _readConfigToml();
    const baseUrl = config?.baseUrl ?? "";
    const api = config?.api ?? "openai-responses";
    return { mode: "apikey", apiKey: auth.apiKey, baseUrl, api };
  }

  return;
}

function _readAuthJSON(): { oauthToken?: string; apiKey?: string; } | undefined {
  if (!existsSync(AUTH_PATH)) {
    return;
  }
  try {
    const parsed = JSON.parse(readFileSync(AUTH_PATH, "utf8")) as Record<
      string,
      unknown
    >;

    let oauthToken: string | undefined;
    let apiKey: string | undefined;

    // { "tokens": { "access_token": "..." } }
    const tokens = parsed.tokens as
      | { access_token?: unknown }
      | undefined;
    if (typeof tokens?.access_token === "string") {
      oauthToken = tokens.access_token;
    }

    // { "OPENAI_API_KEY": "sk-..." }
    if (typeof parsed.OPENAI_API_KEY === "string") {
      apiKey = parsed.OPENAI_API_KEY;
    }

    if (!oauthToken && !apiKey) {
      return;
    }
    return { oauthToken, apiKey };
  } catch {
    return;
  }
}

/**
 * Parse the active provider section from `~/.codex/config.toml`.
 */
function _readConfigToml(): { baseUrl: string; api: CustomProviderApi; } | undefined {
  if (!existsSync(CONFIG_PATH)) {
    return;
  }
  try {
    const content = readFileSync(CONFIG_PATH, "utf8");
    const lines = content.split("\n");

    let activeProvider: string | undefined;
    for (const line of lines) {
      const match = /^\s*model_provider\s*=\s*"([^"]+)"/.exec(line);
      if (match) {
        activeProvider = match[1];
        break;
      }
    }
    if (!activeProvider) {
      return;
    }

    const sectionHeader = `[model_providers.${activeProvider}]`;
    let inSection = false;
    let baseUrl: string | undefined;
    let wireApi: string | undefined;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === sectionHeader) {
        inSection = true;
        continue;
      }
      if (inSection && trimmed.startsWith("[")) {
        break;
      }
      if (!inSection) {
        continue;
      }
      const kvMatch = /^(\w+)\s*=\s*"([^"]*)"/.exec(trimmed);
      if (!kvMatch) {
        continue;
      }
      const [, key, value] = kvMatch;
      if (key === "base_url") {
        baseUrl = value;
      } else if (key === "wire_api") {
        wireApi = value;
      }
    }

    if (!baseUrl) {
      return;
    }

    const api = (wireApi ? WIRE_API_MAP[wireApi] : undefined) ?? "openai-responses";
    return { baseUrl, api };
  } catch {
    return;
  }
}
