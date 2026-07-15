import type { CustomProviderApi } from "../../types";

export type CodexCredentials =
  { api: CustomProviderApi; apiKey: string; baseUrl: string; mode: "apikey"; }
  | { apiKey: string; mode: "oauth"; };
