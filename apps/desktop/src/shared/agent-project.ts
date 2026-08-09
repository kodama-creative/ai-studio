import type {
  HarnessEvent,
  HarnessSessionSnapshot,
  SessionCommandReceipt,
  SessionEventCursor,
} from "@llm-space/harness";

export interface AgentProjectView {
  readonly id: string;
  readonly name: string;
  readonly rootPath: string;
  readonly agentRoot: string;
  readonly agentId: string;
  readonly generationId: string;
}

export interface ProjectThread {
  readonly id: string;
  readonly title: string;
  readonly sessionId: string;
  readonly agentId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ProjectThreadSession {
  readonly thread: ProjectThread;
  readonly snapshot: HarnessSessionSnapshot;
}

export type DesktopWindowContext =
  | { readonly kind: "playground" }
  | { readonly kind: "agentProject"; readonly project: AgentProjectView };

/** Renderer-safe seam for one project window's Harness sessions. */
export interface HarnessSessionTransport {
  listThreads(): Promise<readonly ProjectThread[]>;
  createThread(input?: {
    readonly title?: string;
  }): Promise<ProjectThreadSession>;
  attachThread(threadId: string): Promise<ProjectThreadSession>;
  send(sessionId: string, message: string): Promise<SessionCommandReceipt>;
  cancel(sessionId: string): Promise<void>;
  snapshot(sessionId: string): Promise<HarnessSessionSnapshot>;
  events(
    sessionId: string,
    cursor?: SessionEventCursor
  ): AsyncIterable<HarnessEvent>;
}
