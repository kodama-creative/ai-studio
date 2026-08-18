import { inject, injectable, preDestroy } from "inversify";

import type {
  AgentProjectsEvents,
  AgentProjectsRequests,
} from "../../shared/agent-project-rpc";
import type { Disposable } from "../../shared/disposable";
import { EventHub } from "../../shared/event-hub";

import { ProjectWindowManager } from "./project-window-manager";

export const DirectoryPicker = Symbol("DirectoryPicker");

export interface DirectoryPicker {
  pickDirectory(): Promise<string | null>;
}

/** Main-window use cases for cataloging and opening Agent Project windows. */
@injectable()
export class AgentProjectsApplication
  implements AgentProjectsRequests, Disposable
{
  readonly events = new EventHub<AgentProjectsEvents>();
  private readonly _catalogSubscription: Disposable;

  constructor(
    @inject(ProjectWindowManager)
    private readonly _projects: Pick<
      ProjectWindowManager,
      "onDidChange" | "listProjects" | "openProject"
    >,
    @inject(DirectoryPicker)
    private readonly _dialogs: DirectoryPicker
  ) {
    this._catalogSubscription = this._projects.onDidChange(() =>
      this.events.publish("changed", {})
    );
  }

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
    } catch (error) {
      this.events.publish("openFailed", { message: _errorMessage(error) });
    }
  }

  @preDestroy()
  async dispose(): Promise<void> {
    await this._catalogSubscription.dispose();
    this.events.dispose();
  }
}

function _errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
