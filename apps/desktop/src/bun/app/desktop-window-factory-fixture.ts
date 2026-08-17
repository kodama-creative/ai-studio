import { mock } from "bun:test";

const events: string[] = [];
type ConfigureScope = (
  scope: FakeScope,
  context: {
    readonly kind: "main" | "project";
    readonly commandSink: { sendToWebview(): void };
    readonly rpcEventSink: { sendEvent(): void; sendStreamEvent(): void };
  }
) => void;
type OnCreated = (window: object, state: object) => void;

await mock.module("../projects/project-module", () => ({
  PROJECT_STUDIO: Symbol("PROJECT_STUDIO"),
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
  DesktopWindowRuntime: class {
    readonly rpc = {};

    constructor(
      scope: FakeScope,
      kind: "main" | "project",
      configure: ConfigureScope
    ) {
      events.push(`runtime:${kind}`);
      configure(scope, {
        kind,
        commandSink: { sendToWebview: () => undefined },
        rpcEventSink: {
          sendEvent: () => undefined,
          sendStreamEvent: () => undefined,
        },
      });
    }

    /** Record native attachment without constructing an Electrobun window. */
    attach(): void {
      events.push("runtime:attach");
    }

    /** Stub command routing; this fixture only verifies composition stages. */
    execute(): void {
      events.push("runtime:execute");
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

class FakeScope {
  readonly id: string;
  isDisposing = false;
  private readonly _disposedListeners: (() => void)[] = [];

  constructor(id: string) {
    this.id = id;
  }

  /** Resolve the Studio identity between Project source and view stages. */
  getAsync(): Promise<unknown> {
    events.push("project:studio");
    return Promise.resolve({
      agent: { agentSpecId: "agent", sourceRevision: "revision" },
    });
  }

  /** Retain factory cleanup observers for parity with a real window scope. */
  onDisposed(listener: () => void): void {
    this._disposedListeners.push(listener);
  }

  /** Record failed-scope cleanup and notify every observer once. */
  dispose(): Promise<void> {
    this.isDisposing = true;
    events.push(`scope:dispose:${this.id}`);
    for (const listener of this._disposedListeners) listener();
    return Promise.resolve();
  }
}

const project = {
  id: "project-id",
  name: "Project",
  rootPath: "/tmp/project",
  agentRoot: "/tmp/project/agent",
} as never;
const composition = {
  configureMainIdentity: () => events.push("configure:main-identity"),
  configureProjectSource: () => events.push("configure:project-source"),
  configureProjectIdentity: (_scope: FakeScope, projectView: { id: string }) => {
    if (projectView.id !== "project-id") {
      throw new Error("Project view was not resolved before identity binding.");
    }
    events.push("configure:project-identity");
  },
  configureRuntime: (_scope: FakeScope, { kind }: { kind: string }) =>
    events.push(`configure:runtime:${kind}`),
};
let projectScope = new FakeScope("project:project-id");
const processContainer = {
  createWindowScope: () => projectScope,
} as never;
const factory = new DesktopWindowFactory(
  processContainer,
  "/tmp/home",
  composition as never
);

await factory.createMain(new FakeScope("main") as never);
const mainExpected = [
  "configure:main-identity",
  "runtime:main",
  "configure:runtime:main",
  "native:main",
  "runtime:attach",
];
if (JSON.stringify(events) !== JSON.stringify(mainExpected)) {
  throw new Error(`Unexpected Main composition: ${events.join(", ")}`);
}

events.length = 0;
await factory.create(project);
const projectExpected = [
  "configure:project-source",
  "project:studio",
  "configure:project-identity",
  "runtime:project",
  "configure:runtime:project",
  "project:state",
  "native:project",
  "runtime:attach",
];
if (JSON.stringify(events) !== JSON.stringify(projectExpected)) {
  throw new Error(`Unexpected Project composition: ${events.join(", ")}`);
}

events.length = 0;
projectScope = new FakeScope("project:project-id");
const failedFactory = new DesktopWindowFactory(
  processContainer,
  "/tmp/home",
  {
    ...composition,
    configureProjectSource: () => {
      events.push("configure:project-source");
      throw new Error("source registration failed");
    },
  } as never
);
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
const failureExpected = [
  "configure:project-source",
  "scope:dispose:project:project-id",
];
if (JSON.stringify(events) !== JSON.stringify(failureExpected)) {
  throw new Error(`Unexpected Project failure cleanup: ${events.join(", ")}`);
}
