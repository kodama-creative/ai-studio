import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { LocalFileSystem } from "@llm-space/core/server";
import { ThreadStorageRegistry } from "@llm-space/runtime/plugins";

import { DEVELOPMENT_DEEP_LINK_SCHEME } from "../../shared/deep-link-scheme";
import type { GitHubAuthManager } from "../auth/github-auth-manager";

import { createDeepLinkHandler, isStudioOpenDeepLink } from ".";

const roots: string[] = [];

afterEach(() => {
  roots.splice(0).forEach((root) =>
    rmSync(root, {
      recursive: true,
      force: true,
    })
  );
});

describe("Thread Storage deep links", () => {
  test("classifies only Studio-open URLs for the active scheme", () => {
    expect(
      isStudioOpenDeepLink(
        "llm-space-dev://studio/open?project=%2Ftmp%2Fagent",
        DEVELOPMENT_DEEP_LINK_SCHEME
      )
    ).toBe(true);
    expect(
      isStudioOpenDeepLink(
        "llm-space-dev://threads/aurora/task",
        DEVELOPMENT_DEEP_LINK_SCHEME
      )
    ).toBe(false);
    expect(
      isStudioOpenDeepLink(
        "llm-space://studio/open?project=%2Ftmp%2Fagent",
        DEVELOPMENT_DEEP_LINK_SCHEME
      )
    ).toBe(false);
  });

  test("opens an Agent Project from the Studio CLI deep link", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "llm-space-deep-link-"));
    roots.push(root);
    const opened: string[] = [];
    const handler = createDeepLinkHandler({
      localFs: new LocalFileSystem(path.join(root, "workspace")),
      threadStorages: new ThreadStorageRegistry(),
      githubAuth: {} as GitHubAuthManager,
      notifySharedImport: () => undefined,
      openAgentProject: (projectRoot) => {
        opened.push(projectRoot);
        return Promise.resolve();
      },
    });

    await handler.handle(
      "llm-space://studio/open?project=%2Ftmp%2FAgent%20Project"
    );

    expect(opened).toEqual(["/tmp/Agent Project"]);
  });

  test("imports a registered storage URL into the local workspace", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "llm-space-deep-link-"));
    roots.push(root);
    const localFs = new LocalFileSystem(path.join(root, "workspace"));
    const threadStorages = new ThreadStorageRegistry();
    const resolvedIds: string[] = [];
    threadStorages.registerBuiltin({
      id: "test:aurora",
      deepLinkId: "aurora",
      displayName: "Aurora",
      reader: {
        resolveLatest: (id) => {
          resolvedIds.push(id);
          return Promise.resolve({ id, filename: "aurora.json" });
        },
        read: (locator) =>
          Promise.resolve({
            title: "Aurora task",
            context: {
              messages: [
                {
                  id: "message",
                  role: "user",
                  content: [{ type: "text", text: locator.id }],
                },
              ],
            },
          }),
      },
    });
    const statuses: unknown[] = [];
    const handler = createDeepLinkHandler({
      localFs,
      threadStorages,
      githubAuth: {} as GitHubAuthManager,
      notifySharedImport: (payload) => statuses.push(payload),
    });
    const url = "llm-space://threads/aurora/folder/task-uuid?revision=2#output";

    await handler.handle(url);

    expect(statuses).toEqual([
      { status: "importing" },
      {
        status: "success",
        path: "imported/Aurora task.json",
        title: "Aurora task",
      },
    ]);
    expect(resolvedIds).toEqual(["folder/task-uuid?revision=2#output"]);
    expect(await localFs.read("imported/Aurora task.json")).toMatchObject({
      title: "Aurora task",
      originalURL: url,
      context: {
        messages: [
          {
            content: [
              { type: "text", text: "folder/task-uuid?revision=2#output" },
            ],
          },
        ],
      },
    });
  });

  test("reports an unregistered storage alias", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "llm-space-deep-link-"));
    roots.push(root);
    const statuses: unknown[] = [];
    const handler = createDeepLinkHandler({
      localFs: new LocalFileSystem(path.join(root, "workspace")),
      threadStorages: new ThreadStorageRegistry(),
      githubAuth: {} as GitHubAuthManager,
      notifySharedImport: (payload) => statuses.push(payload),
    });

    await handler.handle("llm-space://threads/missing/task-uuid");

    expect(statuses).toEqual([
      { status: "importing" },
      {
        status: "error",
        message: `Can't import: unknown Thread Storage "missing".`,
      },
    ]);
  });

  test("uses the development scheme without accepting the production scheme", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "llm-space-deep-link-"));
    roots.push(root);
    const statuses: unknown[] = [];
    const handler = createDeepLinkHandler({
      localFs: new LocalFileSystem(path.join(root, "workspace")),
      threadStorages: new ThreadStorageRegistry(),
      githubAuth: {} as GitHubAuthManager,
      notifySharedImport: (payload) => statuses.push(payload),
      scheme: DEVELOPMENT_DEEP_LINK_SCHEME,
    });

    await handler.handle("llm-space://threads/missing/task-uuid");
    expect(statuses).toEqual([]);

    await handler.handle("llm-space-dev://threads/missing/task-uuid");
    expect(statuses).toEqual([
      { status: "importing" },
      {
        status: "error",
        message: `Can't import: unknown Thread Storage "missing".`,
      },
    ]);
  });
});
