import type {
  AgentProjectsEvents,
  AgentProjectsRequests,
} from "../../shared/agent-project-rpc";
import type { Disposable } from "../../shared/disposable";
import { EventHub } from "../../shared/event-hub";

import type { ProjectWindowManager } from "./project-window-manager";

export interface DirectoryPicker {
  pickDirectory(): Promise<string | null>;
}

/** Main-window use cases for cataloging and opening Agent Project windows. */
export class AgentProjectsApplication
  implements AgentProjectsRequests, Disposable
{
  readonly events = new EventHub<AgentProjectsEvents>();

  constructor(
    private readonly _projects: Pick<
      ProjectWindowManager,
      "listProjects" | "openProject"
    >,
    private readonly _dialogs: DirectoryPicker
  ) {}

  /** Return durable catalog entries without loading Studio runtimes. */
  async list() {
    return (await this._projects.listProjects()).map((project) => ({
      id: project.id,
      name: project.name,
      rootPath: project.rootPath,
    }));
  }

  /** Own the complete user action; failures are events, never unhandled tasks. */
  async open(rootPath?: string): Promise<void> {
    try {
      const selected = rootPath ?? (await this._dialogs.pickDirectory());
      if (selected === null) return;
      await this._projects.openProject(selected);
      this.events.publish("changed", {});
    } catch (error) {
      this.events.publish("openFailed", { message: _errorMessage(error) });
    }
  }

  dispose(): void {
    this.events.dispose();
  }
}

function _errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
