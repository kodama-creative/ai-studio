import type { Conversation } from "../conversation";

import type { AgentSnapshot } from "./agent-snapshot";

export interface StudioThreadDocument {
  readonly title: string;
  readonly agent: AgentSnapshot;
  readonly conversation: Conversation;
  readonly commitId: string;
}

export interface StudioThread {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly document: StudioThreadDocument;
  readonly provenance?:
    | {
        readonly type: "session";
        readonly sessionId: string;
      }
    | {
        readonly type: "fork";
        readonly threadId: string;
        readonly checkpointId?: string;
      };
  readonly activeRunId?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}
