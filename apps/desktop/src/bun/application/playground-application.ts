import type {
  CreatePlaygroundInput,
  Playground,
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
}
