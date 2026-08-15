import type {
  CreatePlaygroundInput,
  Playground,
  PlaygroundApplication,
  SavePlaygroundInput,
} from "@llm-space/studio";

import type { PlaygroundHost } from "../playgrounds/playground-host";

/** Application boundary for the durable, user-level Playground workspace. */
export interface DesktopPlaygroundApplication {
  list(): Promise<readonly Playground[]>;
  create(input: CreatePlaygroundInput): Promise<Playground>;
  load(playgroundId: string): Promise<Playground | undefined>;
  save(
    playgroundId: string,
    document: SavePlaygroundInput
  ): Promise<Playground>;
  run: PlaygroundApplication["run"];
  inspectRun: PlaygroundApplication["inspectRun"];
  stepRun: PlaygroundApplication["stepRun"];
  continueRun: PlaygroundApplication["continueRun"];
  resolveToolApproval: PlaygroundApplication["resolveToolApproval"];
  cancelRun: PlaygroundApplication["cancelRun"];
  cancelActiveRun: PlaygroundApplication["cancelActiveRun"];
}

/** Keep RPC naming and follow policy out of the Studio Playground host. */
export class DesktopPlaygroundApplicationImpl implements DesktopPlaygroundApplication {
  constructor(private readonly _host: PlaygroundHost) {}
  list() {
    return this._host.listPlaygrounds();
  }
  create(input: CreatePlaygroundInput) {
    return this._host.createPlayground(input);
  }
  load(playgroundId: string) {
    return this._host.loadPlayground(playgroundId);
  }
  save(playgroundId: string, document: SavePlaygroundInput) {
    return this._host.savePlayground(playgroundId, document);
  }
  run(
    playgroundId: string,
    input: Parameters<PlaygroundApplication["run"]>[1]
  ) {
    return this._host.run(playgroundId, input);
  }
  inspectRun(playgroundId: string, operationId: string) {
    return this._host.inspectRun(playgroundId, operationId);
  }
  stepRun(
    playgroundId: string,
    operationId: string,
    input: Parameters<PlaygroundApplication["stepRun"]>[2]
  ) {
    return this._host.stepRun(playgroundId, operationId, input);
  }
  continueRun(
    playgroundId: string,
    operationId: string,
    input: Parameters<PlaygroundApplication["continueRun"]>[2]
  ) {
    return this._host.continueRun(playgroundId, operationId, input);
  }
  resolveToolApproval(
    playgroundId: string,
    operationId: string,
    input: Parameters<PlaygroundApplication["resolveToolApproval"]>[2]
  ) {
    return this._host.resolveToolApproval(playgroundId, operationId, input);
  }
  cancelRun(playgroundId: string, operationId: string) {
    return this._host.cancelRun(playgroundId, operationId);
  }
  cancelActiveRun(playgroundId: string) {
    return this._host.cancelActiveRun(playgroundId);
  }
}
