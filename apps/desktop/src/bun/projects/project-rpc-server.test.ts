import { expect, test } from "bun:test";

import type { ProjectSourceTransport } from "../../shared/project-source-rpc";
import type { StudioTransport } from "../../shared/studio-rpc";

import {
  ProjectSourceRpcServer,
  StudioRpcServer,
} from "./project-rpc-server";

test("Project window RPC keeps source and Studio Thread interfaces separate", () => {
  const source = new ProjectSourceRpcServer({} as ProjectSourceTransport);
  const threads = new StudioRpcServer({} as StudioTransport);

  expect(source.namespace.name).toBe("projectSource");
  expect(Object.keys(source.requests)).toEqual(["readSourceFile"]);
  expect(Object.keys(source.streams)).toEqual(["watchSourceFiles"]);

  expect(threads.namespace.name).toBe("studio");
  expect(Object.keys(threads.requests)).toEqual([
    "listThreads",
    "listRunHistory",
    "saveRunHistory",
    "listEvaluationMetadata",
    "saveEvaluationMetadata",
    "forkThread",
    "createThread",
    "loadThread",
    "saveDocument",
  ]);
  expect(Object.keys(threads.streams)).toEqual(["events"]);
});
