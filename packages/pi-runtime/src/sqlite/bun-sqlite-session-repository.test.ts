import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSessionBackendConformance } from "@earendil-works/pi-agent-core/session/testing";
import { Database } from "bun:sqlite";

import { BunSqliteSessionRepository } from "./bun-sqlite-session-repository";

const roots: string[] = [];
const cases = createSessionBackendConformance(async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-pi-session-"));
  roots.push(root);
  const repository = new BunSqliteSessionRepository({
    path: join(root, "studio.sqlite"),
  });
  return {
    repository,
    async [Symbol.asyncDispose]() {
      await repository.close();
    },
  };
});

describe("BunSqliteSessionRepository Pi conformance", () => {
  for (const conformanceCase of cases) {
    test(`${conformanceCase.group}: ${conformanceCase.name}`, () =>
      conformanceCase.run());
  }
});

afterAll(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true }))
  );
});

test("shares one physical database without touching Studio-owned tables", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-pi-shared-db-"));
  roots.push(root);
  const path = join(root, "studio.sqlite");
  const studio = new Database(path, { create: true });
  studio.run(`CREATE TABLE studio_sentinel (value TEXT NOT NULL)`);
  studio.query(`INSERT INTO studio_sentinel (value) VALUES (?)`).run("kept");
  studio.close();

  const repository = new BunSqliteSessionRepository({ path });
  await repository.create({ id: "pi-session" });
  await repository.close();

  const inspected = new Database(path);
  const sentinel = inspected
    .query<{ value: string }, []>(`SELECT value FROM studio_sentinel`)
    .get();
  const piTables = inspected
    .query<{ name: string }, []>(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name LIKE 'pi_%' ORDER BY name`
    )
    .all()
    .map((row) => row.name);
  inspected.close();

  expect(sentinel?.value).toBe("kept");
  expect(piTables).toContain("pi_sessions");
  expect(piTables).toContain("pi_writer_leases");
});

test("fences a competing repository until the active owner closes", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-pi-writer-"));
  roots.push(root);
  const path = join(root, "studio.sqlite");
  const owner = new BunSqliteSessionRepository({ path });
  const session = await owner.create({ id: "claimed" });
  const metadata = await session.getMetadata();
  const competitor = new BunSqliteSessionRepository({ path });

  expect(competitor.open(metadata)).rejects.toMatchObject({
    code: "storage",
  });
  await owner.close();
  const reopened = await competitor.open(metadata);
  expect((await reopened.getMetadata()).id).toBe("claimed");
  await competitor.close();
});
