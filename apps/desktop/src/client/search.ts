import type { SearchSettings } from "@llm-space/core";

import type { RuntimeId } from "@/shared/runtime";

import { searchClient } from "./runtime-rpc-clients";

export async function getSearchSettings(
  runtimeId?: RuntimeId
): Promise<SearchSettings> {
  return searchClient.get(runtimeId);
}

export async function setSearchSettings(
  settings: SearchSettings,
  runtimeId?: RuntimeId
): Promise<SearchSettings> {
  return searchClient.set(runtimeId, settings);
}
