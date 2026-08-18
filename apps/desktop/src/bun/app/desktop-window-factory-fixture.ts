import { mock } from "bun:test";

import { Container, ContainerModule } from "inversify";

const events: string[] = [];
type OnCreated = (window: object, state: object) => void;

class ProjectService {
  private stopped = false;
  readonly projectView = {
    id: "project-id",
    name: "Project",
    rootPath: "/tmp/project",
    agentRoot: "/tmp/project/agent",
    agentId: "agent",
    generationId: "revision",
  };

  start(): void {
    events.push("project:start");
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    events.push("project:stop");
  }

  getWindowContext() {
    return { kind: "agentProject", project: this.projectView } as const;
  }
}

await mock.module("../projects/project-module", () => ({
  ProjectService,
}));
await mock.module("../projects/project-window-state", () => ({
  ProjectWindowStateFile: {
    load: () => {
      events.push("project:state");
      return Promise.resolve({});
    },
  },
}));
await mock.module("./desktop-window-runtime", () => ({
  DESKTOP_WINDOW_CLOSE: Symbol("DESKTOP_WINDOW_CLOSE"),
  DESKTOP_WINDOW_KIND: Symbol("DESKTOP_WINDOW_KIND"),
  DesktopWindowRuntime: class {
    readonly rpc = {};
    private disposed = false;

    constructor() {
      events.push("runtime:create");
    }

    /** Record explicit Registry startup from the Application root. */
    start(): void {
      events.push("runtime:start");
    }

    /** Record native attachment without constructing an Electrobun window. */
    attach(): void {
      events.push("runtime:attach");
    }

    /** Stub command routing; this fixture only verifies composition stages. */
    execute(): void {
      events.push("runtime:execute");
    }

    /** Record Application-owned runtime shutdown. */
    dispose(): void {
      if (this.disposed) return;
      this.disposed = true;
      events.push("runtime:dispose");
    }
  },
}));
await mock.module("./window", () => ({
  createMainWindow: ({ onCreated }: { onCreated: OnCreated }) => {
    events.push("native:main");
    const window = { id: 1, activate: () => events.push("main:activate") };
    onCreated(window, {});
    return Promise.resolve(window);
  },
  createAgentProjectWindow: ({ onCreated }: { onCreated: OnCreated }) => {
    events.push("native:project");
    const window = { id: 2, activate: () => undefined };
    onCreated(window, {});
    return Promise.resolve(window);
  },
}));

const { DesktopWindowFactory } = await import("./desktop-window-factory");

const project = {
  id: "project-id",
  name: "Project",
  rootPath: "/tmp/project",
  agentRoot: "/tmp/project/agent",
} as never;
const composition = {
  common: [({ kind }: { kind: string }) => {
    events.push(`configure:runtime:${kind}`);
    return new ContainerModule(() => undefined);
  }],
  main: [() => {
    events.push("configure:main-identity");
    return new ContainerModule(() => undefined);
  }],
  project: [() => {
    events.push("configure:project-source");
    return new ContainerModule(({ bind }) => {
      bind(ProjectService).toConstantValue(new ProjectService());
    });
  }],
};
const desktopContainer = new Container();
const factory = new DesktopWindowFactory(
  desktopContainer,
  "/tmp/home",
  composition
);

const main = await factory.createMain();
const mainExpected = [
  "configure:main-identity",
  "configure:runtime:main",
  "runtime:create",
  "runtime:start",
  "native:main",
  "runtime:attach",
];
if (JSON.stringify(events) !== JSON.stringify(mainExpected)) {
  throw new Error(`Unexpected Main composition: ${events.join(", ")}`);
}

let closeNotifications = 0;
main.onDidClose(() => {
  closeNotifications += 1;
});
await main.close();
if (closeNotifications !== 1) {
  throw new Error("Main close subscribers did not observe disposal.");
}
let replayedCloseNotifications = 0;
main.onDidClose(() => {
  replayedCloseNotifications += 1;
});
if (replayedCloseNotifications !== 1) {
  throw new Error("Late Main close subscribers did not observe disposal.");
}
events.length = 0;

events.length = 0;
const projectWindow = await factory.create(project);
const projectExpected = [
  "configure:project-source",
  "configure:runtime:project",
  "runtime:create",
  "project:start",
  "runtime:start",
  "project:state",
  "native:project",
  "runtime:attach",
];
if (JSON.stringify(events) !== JSON.stringify(projectExpected)) {
  throw new Error(`Unexpected Project composition: ${events.join(", ")}`);
}

events.length = 0;
await projectWindow.close();
if (
  JSON.stringify(events) !== JSON.stringify(["runtime:dispose", "project:stop"])
) {
  throw new Error(`Unexpected Project shutdown: ${events.join(", ")}`);
}

events.length = 0;
const failedFactory = new DesktopWindowFactory(desktopContainer, "/tmp/home", {
  ...composition,
  project: [() => {
    events.push("configure:project-source");
    throw new Error("source registration failed");
  }],
});
try {
  await failedFactory.create(project);
  throw new Error("Project window unexpectedly survived registration failure.");
} catch (error) {
  if (
    !(error instanceof Error) ||
    error.message !== "source registration failed"
  ) {
    throw error;
  }
}
const failureExpected = ["configure:project-source"];
if (JSON.stringify(events) !== JSON.stringify(failureExpected)) {
  throw new Error(`Unexpected Project failure cleanup: ${events.join(", ")}`);
}
