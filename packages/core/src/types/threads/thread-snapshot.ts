import * as z from "zod";

import { normalizeThread, type Thread } from "./thread";
import { ThreadZodSchema } from "./thread-zod";

export const THREAD_SNAPSHOT_KIND = "llm-space.thread-snapshot" as const;
export const THREAD_SNAPSHOT_SCHEMA_VERSION = 1 as const;

/** Portable projection of one selected Pi Session lane/leaf. */
export interface PortableThreadSnapshot {
  readonly kind: typeof THREAD_SNAPSHOT_KIND;
  readonly schemaVersion: typeof THREAD_SNAPSHOT_SCHEMA_VERSION;
  readonly source: {
    readonly product: "playground" | "experiment";
    readonly productId: string;
    readonly sessionId: string;
    readonly lane: string;
    readonly leafId: string | null;
  };
  readonly thread: Thread;
}

const THREAD_SNAPSHOT_SCHEMA: z.ZodType<PortableThreadSnapshot> = z.object({
  kind: z.literal(THREAD_SNAPSHOT_KIND),
  schemaVersion: z.literal(THREAD_SNAPSHOT_SCHEMA_VERSION),
  source: z.object({
    product: z.enum(["playground", "experiment"]),
    productId: z.string().min(1),
    sessionId: z.string().min(1),
    lane: z.string().min(1),
    leafId: z.string().nullable(),
  }),
  thread: ThreadZodSchema,
});

/** Validate an untrusted portable snapshot and normalize its Thread projection. */
export function parsePortableThreadSnapshot(
  value: unknown
): PortableThreadSnapshot {
  const snapshot = THREAD_SNAPSHOT_SCHEMA.parse(value);
  return { ...snapshot, thread: normalizeThread(snapshot.thread) };
}

/** Read either the current snapshot envelope or its viewer Thread projection. */
export function threadFromSnapshotDocument(value: unknown): Thread {
  if (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === THREAD_SNAPSHOT_KIND
  ) {
    return parsePortableThreadSnapshot(value).thread;
  }
  return normalizeThread(ThreadZodSchema.parse(value));
}
