import { ContainerModule } from "inversify";

import { NativeDialogsApplication } from "../native/native-dialogs-module";

import { AgentProjectLoader } from "./agent-project";
import {
  AgentProjectsApplication,
  DirectoryPicker,
  type DirectoryPicker as DirectoryPickerApi,
} from "./agent-projects-application";
import { ProjectWindowManager } from "./project-window-manager";
import {
  FileAgentProjectCatalogStore,
  FileProjectWindowStateStore,
} from "./project-window-state";

/** Bind the process-scoped Agent Project use cases. */
export function agentProjectsModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind<DirectoryPickerApi>(DirectoryPicker).toService(
      NativeDialogsApplication
    );
    bind(AgentProjectLoader).toSelf().inSingletonScope();
    bind(FileAgentProjectCatalogStore).toSelf().inSingletonScope();
    bind(FileProjectWindowStateStore).toSelf().inSingletonScope();
    bind(ProjectWindowManager).toSelf().inSingletonScope();
    bind(AgentProjectsApplication).toSelf().inSingletonScope();
  });
}
