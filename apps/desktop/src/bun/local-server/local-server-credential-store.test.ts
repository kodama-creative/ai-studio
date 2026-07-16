import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import { LocalServerCredentialStore } from "./local-server-credential-store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async root => rm(root, { recursive: true, force: true }))
  );
});

describe("LocalServerCredentialStore", () => {
  test("persists one Bun-only credential atomically with private permissions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "llm-space-credentials-"));
    roots.push(root);
    const credential = {
      artifactFingerprint: "artifact-one",
      continuationToken: "raw-secret-that-must-stay-in-the-bun-process",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      projectId: "project-one",
      sessionId: "session-one",
      threadId: "thread-one"
    };
    const store = new LocalServerCredentialStore(root);
    await store.set(credential);

    const restarted = new LocalServerCredentialStore(root);
    expect(await restarted.get("project-one", "thread-one")).toEqual(
      credential
    );
    const directory = path.join(root, "credentials");
    const file = path.join(directory, "local-server.json");
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readFile(file, "utf8")).toContain(credential.continuationToken);

    expect(await restarted.delete("project-one", "thread-one")).toEqual(
      credential
    );
    expect(await restarted.get("project-one", "thread-one")).toBeNull();
    expect(await readFile(file, "utf8")).not.toContain(
      credential.continuationToken
    );
  });
});
