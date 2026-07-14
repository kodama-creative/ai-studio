import type { CustomProviderApi } from '../../types';

export type CodexCredentials =
  { mode: "oauth"; apiKey: string; }
  | { mode: "apikey"; apiKey: string; baseUrl: string; api: CustomProviderApi; };
