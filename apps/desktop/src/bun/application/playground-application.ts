import type { RunEventCursor } from "@llm-space/engine";
import type {
  CreatePlaygroundInput,
  Playground,
  RunPlaygroundInput,
  SavePlaygroundInput,
  StudioRunReceipt,
} from "@llm-space/studio";

import type { PlaygroundHost } from "../playgrounds/playground-host";

/** Application boundary for the durable, user-level Playground workspace. */
export interface DesktopPlaygroundApplication {
  list(): Promise<readonly Playground[]>;
  create(input: CreatePlaygroundInput): Promise<Playground>;
  load(playgroundId: string): Promise<Playground | undefined>;
  save(playgroundId: string, document: SavePlaygroundInput): Promise<Playground>;
  run(playgroundId: string, input: RunPlaygroundInput): Promise<StudioRunReceipt>;
  stepRun(runId: string, input?: { readonly toolCallId?: string }): Promise<StudioRunReceipt>;
  continueRun(runId: string): Promise<StudioRunReceipt>;
  cancelRun(runId: string): Promise<void>;
  streamRun(runId: string, cursor?: RunEventCursor): ReturnType<PlaygroundHost["streamRun"]>;
}

/** Keep RPC naming and follow policy out of the Studio Playground host. */
export class DesktopPlaygroundApplicationImpl
  implements DesktopPlaygroundApplication
{
  constructor(private readonly _host: PlaygroundHost) {}
  list() { return this._host.listPlaygrounds(); }
  create(input: CreatePlaygroundInput) { return this._host.createPlayground(input); }
  load(playgroundId: string) { return this._host.loadPlayground(playgroundId); }
  save(playgroundId: string, document: SavePlaygroundInput) { return this._host.savePlayground(playgroundId, document); }
  run(playgroundId: string, input: RunPlaygroundInput) { return this._host.run(playgroundId, input); }
  stepRun(runId: string, input: { readonly toolCallId?: string } = {}) { return this._host.stepRun(runId, input); }
  continueRun(runId: string) { return this._host.continueRun(runId); }
  cancelRun(runId: string) { return this._host.cancelRun(runId); }
  streamRun(runId: string, cursor: RunEventCursor = {}) {
    return this._host.streamRun(runId, { ...cursor, follow: true });
  }
}
