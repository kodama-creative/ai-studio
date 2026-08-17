import { describe, expect, test } from "bun:test";

import { Emitter } from "../../shared/event";

import type { AgentProject } from "./agent-project";
import { AgentProjectsApplication } from "./agent-projects-application";

const PROJECT: AgentProject = {
  id: "project-1",
  name: "Agent One",
  rootPath: "/projects/agent-one",
  agentRoot: "/projects/agent-one/agent",
  studioStateRoot: "/data/project-1",
  databasePath: "/data/project-1/studio.sqlite",
};

describe("AgentProjectsApplication", () => {
  test("publishes catalog changes after command-owned open actions", async () => {
    const opened: string[] = [];
    const projectEvents = new Emitter<void>();
    const app = new AgentProjectsApplication(
      {
        onDidChange: projectEvents.event,
        listProjects: () => Promise.resolve([PROJECT]),
        openProject: (rootPath) => {
          opened.push(rootPath);
          projectEvents.fire();
          return Promise.resolve();
        },
      },
      { pickDirectory: () => Promise.resolve("/projects/picked") }
    );
    let changes = 0;
    app.events.subscribe("changed", () => {
      changes += 1;
    });

    await app.open(PROJECT.rootPath);
    await app.open();

    expect(opened).toEqual([PROJECT.rootPath, "/projects/picked"]);
    expect(changes).toBe(2);
    expect(await app.list()).toEqual([
      { id: PROJECT.id, name: PROJECT.name, rootPath: PROJECT.rootPath },
    ]);
  });

  test("contains open failures and publishes renderer-safe feedback", async () => {
    const app = new AgentProjectsApplication(
      {
        onDidChange: new Emitter<void>().event,
        listProjects: () => Promise.resolve([]),
        openProject: () => Promise.reject(new Error("Not an Agent Project")),
      },
      { pickDirectory: () => Promise.resolve(null) }
    );
    const failures: string[] = [];
    let changes = 0;
    app.events.subscribe("openFailed", ({ message }) => {
      failures.push(message);
    });
    app.events.subscribe("changed", () => {
      changes += 1;
    });

    await app.open("/invalid");
    await app.open();

    expect(failures).toEqual(["Not an Agent Project"]);
    expect(changes).toBe(0);
  });

  test("publishes catalog changes opened outside the renderer command", () => {
    const projectEvents = new Emitter<void>();
    const app = new AgentProjectsApplication(
      {
        onDidChange: projectEvents.event,
        listProjects: () => Promise.resolve([]),
        openProject: () => Promise.resolve(),
      },
      { pickDirectory: () => Promise.resolve(null) }
    );
    let changes = 0;
    app.events.subscribe("changed", () => {
      changes += 1;
    });

    projectEvents.fire();

    expect(changes).toBe(1);
  });
});
