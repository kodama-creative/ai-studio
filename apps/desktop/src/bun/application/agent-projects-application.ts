import type { AgentProjectSummary } from "../../shared/agent-project";
import type { ProjectWindowManager } from "../projects/project-window-manager";

export interface AgentProjectsApplicationApi {
  list(): Promise<readonly AgentProjectSummary[]>;
  open(rootPath: string): Promise<void>;
  pickAndOpen(): Promise<void>;
}

export interface DirectoryPicker {
  pickDirectory(): Promise<string | null>;
}

/** Main-window use cases for cataloging and opening Agent Project windows. */
export class AgentProjectsApplication implements AgentProjectsApplicationApi {
  constructor(
    private readonly _projects: ProjectWindowManager,
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

  /** Open or activate the unique window for a project root. */
  open(rootPath: string): Promise<void> {
    return this._projects.openProject(rootPath);
  }

  /** Pick a project directory and open it; cancellation is a no-op. */
  async pickAndOpen(): Promise<void> {
    const rootPath = await this._dialogs.pickDirectory();
    if (rootPath !== null) await this.open(rootPath);
  }
}
