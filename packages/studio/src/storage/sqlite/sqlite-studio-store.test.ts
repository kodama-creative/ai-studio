import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "bun:sqlite";

import { createSqliteStudioStore } from "./sqlite-studio-store";

test("refuses an unknown Studio schema without deleting its tables", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-studio-schema-"));
  const path = join(root, "studio.sqlite");
  const database = new Database(path, { create: true });
  database.run(`
    CREATE TABLE studio_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);
  database.run(
    "INSERT INTO studio_schema_migrations (version, applied_at) VALUES (4, 1)"
  );
  database.run("CREATE TABLE studio_playgrounds (sentinel TEXT NOT NULL)");
  database.run("INSERT INTO studio_playgrounds (sentinel) VALUES ('keep-me')");
  database.close();

  try {
    expect(() => createSqliteStudioStore({ path })).toThrow(
      "Studio database schema 4 requires an explicit migration to 5."
    );

    const reopened = new Database(path, { readonly: true });
    try {
      expect(
        reopened
          .query<{ sentinel: string }, []>(
            "SELECT sentinel FROM studio_playgrounds"
          )
          .get()
      ).toEqual({ sentinel: "keep-me" });
    } finally {
      reopened.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
