import { describe, expect, test } from "bun:test";

import {
  type EvaluationRecord,
  type EvaluationRubricRecord,
  MAX_RUN_HISTORY,
  normalizeEvaluationRubrics,
  normalizeEvaluations,
  normalizeRunHistory,
  recordRun,
  type RunSnapshot,
  snapshotEvaluationRubric,
  upsertEvaluation,
  upsertEvaluationRubric,
  withRunMetadata
} from "./history";

import type { Thread } from "../types";

const RUNS: RunSnapshot[] = [
  { id: "run-a", thread: {}, timestamp: 1 },
  { id: "run-b", thread: {}, timestamp: 2 }
];

const CRITERIA = [
  { id: "criterion-correctness", name: "Correctness" },
  { id: "criterion-clarity", name: "Clarity" }
];

function _createRubric(): EvaluationRubricRecord {
  const result = upsertEvaluationRubric(
    [],
    { name: "Answer quality", criteria: CRITERIA },
    10
  );
  if (!result) {
    throw new Error("rubric fixture failed");
  }
  return result.rubric;
}

function _legacyEvaluation(): EvaluationRecord {
  return {
    id: "evaluation-1",
    leftRunId: "run-a",
    rightRunId: "run-b",
    verdict: "rightBetter",
    note: " Better answer ",
    createdAt: 3,
    updatedAt: 3
  };
}

describe("evaluation rubrics", () => {
  test("creates and materially revises a reusable definition", () => {
    const created = upsertEvaluationRubric(
      [],
      { name: " Answer quality ", criteria: CRITERIA },
      10
    );
    expect(created?.rubric).toMatchObject({
      name: "Answer quality",
      revision: 1,
      createdAt: 10,
      updatedAt: 10
    });

    const unchanged = upsertEvaluationRubric(
      created!.rubrics,
      {
        id: created!.rubric.id,
        name: created!.rubric.name,
        criteria: created!.rubric.criteria
      },
      11
    );
    expect(unchanged?.rubric).toEqual(created!.rubric);
    expect(unchanged?.rubric.updatedAt).toBe(10);

    const updated = upsertEvaluationRubric(
      created!.rubrics,
      {
        id: created!.rubric.id,
        name: "Agent answer quality",
        criteria: created!.rubric.criteria.slice().reverse()
      },
      12
    );
    expect(updated?.rubric).toMatchObject({
      id: created!.rubric.id,
      name: "Agent answer quality",
      revision: 2,
      createdAt: 10,
      updatedAt: 12
    });
    expect(updated?.rubric.criteria.map(criterion => criterion.id)).toEqual([
      "criterion-clarity",
      "criterion-correctness"
    ]);
  });

  test("defensively drops malformed and duplicate rubric data", () => {
    const raw = [
      null,
      {
        id: "rubric-1",
        name: "Rubric",
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
        criteria: [
          { id: "one", name: "Same" },
          { id: "two", name: "same" }
        ]
      },
      {
        id: "rubric-2",
        name: "Valid",
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
        criteria: CRITERIA
      }
    ] as unknown as Thread["evaluationRubrics"];
    expect(normalizeEvaluationRubrics(raw).map(rubric => rubric.id)).toEqual([
      "rubric-2"
    ]);
  });

  test("rejects duplicate criterion names on save", () => {
    expect(
      upsertEvaluationRubric([], {
        name: "Rubric",
        criteria: [
          { id: "one", name: "Correctness" },
          { id: "two", name: "correctness" }
        ]
      })
    ).toBeNull();
  });

  test("refuses to increment an exhausted safe revision", () => {
    const rubric = { ..._createRubric(), revision: Number.MAX_SAFE_INTEGER };
    expect(
      upsertEvaluationRubric([rubric], {
        id: rubric.id,
        name: "Updated",
        criteria: rubric.criteria
      })
    ).toBeNull();
  });

  test("enforces the per-thread rubric cap", () => {
    const rubrics = Array.from({ length: 20 }, (_, index) => ({
      ..._createRubric(),
      id: `rubric-${index}`,
      name: `Rubric ${index}`
    }));
    expect(
      upsertEvaluationRubric(rubrics, {
        name: "One too many",
        criteria: CRITERIA
      })
    ).toBeNull();
  });

  test("rejects an injected id already owned by another rubric", () => {
    const existing = { ..._createRubric(), id: "rubric-existing" };
    expect(
      upsertEvaluationRubric(
        [existing],
        { name: "New rubric", criteria: CRITERIA },
        20,
        { id: existing.id }
      )
    ).toBeNull();
  });
});

describe("Local Server Run lineage", () => {
  test("keeps exact non-secret Server authority on a valid checkpoint", () => {
    const [run] = normalizeRunHistory([{
      id: "snapshot-one",
      thread: {},
      timestamp: 1,
      runtime: {
        runId: "run-server",
        state: "completed",
        checkpointOrder: 1,
        continuationFingerprint: "local-server:artifact:session:run",
        profile: "localServer",
        server: {
          profile: "localServer",
          artifactFingerprint: "artifact-one",
          sessionId: "session-one",
          runId: "run-server"
        }
      }
    }]);
    expect(run?.runtime?.server).toEqual({
      profile: "localServer",
      artifactFingerprint: "artifact-one",
      sessionId: "session-one",
      runId: "run-server"
    });
    expect(run?.runtime?.profile).toBe("localServer");
  });

  test("rejects a checkpoint whose duplicated Server Run ID disagrees", () => {
    const [run] = normalizeRunHistory([{
      id: "snapshot-one",
      thread: {},
      timestamp: 1,
      runtime: {
        runId: "run-authoritative",
        state: "completed",
        checkpointOrder: 1,
        continuationFingerprint: "fingerprint",
        server: {
          profile: "localServer",
          artifactFingerprint: "artifact-one",
          sessionId: "session-one",
          runId: "run-other"
        }
      }
    } as never]);
    expect(run?.runtime).toBeUndefined();
  });
});

describe("run history persistence", () => {
  test("backfills stable ids and retains only the newest runs", () => {
    const raw = Array.from({ length: MAX_RUN_HISTORY + 2 }, (_, index) => ({
      thread: { title: `Run ${index}` },
      timestamp: index + 0.9
    }));
    const normalized = normalizeRunHistory(raw);

    expect(normalized).toHaveLength(MAX_RUN_HISTORY);
    expect(normalized[0]?.id).toBe("run-2-2");
    expect(normalized.at(-1)?.id).toBe(
      `run-${MAX_RUN_HISTORY + 1}-${MAX_RUN_HISTORY + 1}`
    );
  });

  test("does not append beyond the run cap", () => {
    const runs = Array.from({ length: MAX_RUN_HISTORY }, (_, index) => ({
      id: `run-${index}`,
      thread: {},
      timestamp: index
    }));
    const next = recordRun(runs, { title: "Latest" }, 100, {
      id: "run-latest"
    });

    expect(next).toHaveLength(MAX_RUN_HISTORY);
    expect(next[0]?.id).toBe("run-1");
    expect(next.at(-1)?.id).toBe("run-latest");
  });

  test("keeps Sandbox attachment descriptors outside the message transcript", () => {
    const next = recordRun([], {
      lockedSandboxAttachmentMessageIds: ["message-one"],
      sandboxAttachments: {
        "message-one": [{
          id: "attachment-one",
          name: "notes.txt",
          path: "/workspace/attachments/turn-one/notes.txt",
          size: 5,
          fingerprint: "a".repeat(64)
        }]
      },
      context: {
        messages: [{
          id: "message-one",
          role: "user",
          content: [{ type: "text", text: "Inspect it." }]
        }]
      }
    });

    expect(next[0]?.thread.sandboxAttachments?.["message-one"]).toHaveLength(1);
    expect(next[0]?.thread.lockedSandboxAttachmentMessageIds).toEqual([
      "message-one"
    ]);
    expect(next[0]?.thread.context?.messages?.[0]).not.toHaveProperty(
      "attachments"
    );
  });

  test("keeps Runtime checkpoint identity while de-nesting Session metadata", () => {
    const runtimeSession = { version: 1, opaque: true };
    const runtimeWorkingBase = {
      sessionId: "session-one",
      branchId: "branch-one",
      checkpointId: "checkpoint-one"
    };
    const next = recordRun(
      [],
      {
        agentRuntime: {
          projectId: "project-one",
          snapshot: "snapshot-one",
          definitionFingerprint: "definition-one",
          modelSource: "agent"
        },
        runtimeSession
      },
      100,
      {
        id: "checkpoint-one",
        runtime: {
          runId: "runtime-run-one",
          state: "waitingForContinue",
          checkpointOrder: 1,
          continuationFingerprint: "fingerprint-one",
          profile: "desktopSandbox"
        }
      }
    );
    const thread = withRunMetadata(
      { runtimeSession, runtimeWorkingBase, runHistory: next },
      { runHistory: next }
    );

    expect(next[0]?.runtime?.runId).toBe("runtime-run-one");
    expect(next[0]?.runtime?.profile).toBe("desktopSandbox");
    expect(next[0]?.thread.agentRuntime?.snapshot).toBe("snapshot-one");
    expect(next[0]?.thread).not.toHaveProperty("runtimeSession");
    expect(thread.runtimeSession).toBe(runtimeSession);
    expect(thread.runtimeWorkingBase).toBe(runtimeWorkingBase);
    expect(thread.runHistory?.[0]?.thread).not.toHaveProperty("runtimeSession");
    expect(thread.runHistory?.[0]?.thread).not.toHaveProperty(
      "runtimeWorkingBase"
    );
  });

  test("retains validated structured output and failure terminals", () => {
    const fingerprint = "a".repeat(64);
    const completed = recordRun([], { outputContract: "answer" }, 100, {
      structuredOutput: {
        contract: "answer",
        schemaFingerprint: fingerprint,
        value: { answer: "Ada" }
      }
    });
    const failed = recordRun(completed, { outputContract: "answer" }, 101, {
      structuredOutputFailure: {
        contract: "answer",
        schemaFingerprint: fingerprint,
        code: "structured_output_missing"
      }
    });

    expect(normalizeRunHistory(failed)).toMatchObject([
      { structuredOutput: { value: { answer: "Ada" } } },
      { structuredOutputFailure: { code: "structured_output_missing" } }
    ]);
  });
});

describe("structured evaluation persistence", () => {
  test("canonicalizes run and criterion score order", () => {
    const rubric = snapshotEvaluationRubric(_createRubric());
    const saved = upsertEvaluation(
      [],
      RUNS,
      {
        leftRunId: "run-a",
        rightRunId: "run-b",
        verdict: "rightBetter",
        rubric,
        runScores: [
          {
            runId: "run-b",
            scores: [
              { criterionId: "criterion-clarity", score: 4 },
              { criterionId: "criterion-correctness", score: 5 }
            ]
          },
          {
            runId: "run-a",
            scores: [
              { criterionId: "criterion-clarity", score: 3 },
              { criterionId: "criterion-correctness", score: 2 }
            ]
          }
        ]
      },
      20
    );
    expect(saved?.[0]?.runScores).toEqual([
      {
        runId: "run-a",
        scores: [
          { criterionId: "criterion-correctness", score: 2 },
          { criterionId: "criterion-clarity", score: 3 }
        ]
      },
      {
        runId: "run-b",
        scores: [
          { criterionId: "criterion-correctness", score: 5 },
          { criterionId: "criterion-clarity", score: 4 }
        ]
      }
    ]);
  });

  test("degrades a malformed optional payload to the legacy record", () => {
    const malformed = {
      ..._legacyEvaluation(),
      rubric: snapshotEvaluationRubric(_createRubric()),
      runScores: [{ runId: "run-a", scores: [] }]
    } as unknown as EvaluationRecord;
    expect(normalizeEvaluations([malformed], RUNS)).toEqual([
      {
        ..._legacyEvaluation(),
        note: "Better answer"
      }
    ]);
  });

  test("keeps one evaluation per unordered pair and follows latest orientation", () => {
    const original = _legacyEvaluation();
    const saved = upsertEvaluation(
      [original],
      RUNS,
      {
        leftRunId: "run-b",
        rightRunId: "run-a",
        verdict: "leftBetter"
      },
      30
    );
    expect(saved).toHaveLength(1);
    expect(saved?.[0]).toMatchObject({
      id: original.id,
      leftRunId: "run-b",
      rightRunId: "run-a",
      verdict: "leftBetter",
      createdAt: original.createdAt,
      updatedAt: 30
    });
  });

  test("rejects an injected id already owned by another evaluation", () => {
    const existing = _legacyEvaluation();
    const runs = [...RUNS, { id: "run-c", thread: {}, timestamp: 3 }];
    expect(
      upsertEvaluation(
        [existing],
        runs,
        {
          id: existing.id,
          leftRunId: "run-a",
          rightRunId: "run-c",
          verdict: "tie"
        },
        40
      )
    ).toBeNull();
  });

  test("keeps the last valid duplicate run ID and unordered evaluation pair", () => {
    const runs = normalizeRunHistory([
      { id: "duplicate", thread: { title: "Old" }, timestamp: 1 },
      { id: "unique", thread: {}, timestamp: 2 },
      { id: "duplicate", thread: { title: "New" }, timestamp: 3 }
    ]);
    expect(runs.map(run => [run.id, run.thread.title])).toEqual([
      ["unique", undefined],
      ["duplicate", "New"]
    ]);

    const duplicatePair = {
      ..._legacyEvaluation(),
      id: "evaluation-2",
      leftRunId: "run-b",
      rightRunId: "run-a",
      verdict: "leftBetter" as const,
      updatedAt: 4
    };
    expect(
      normalizeEvaluations([_legacyEvaluation(), duplicatePair], RUNS)
    ).toEqual([{ ...duplicatePair, note: "Better answer" }]);
  });

  test("definition updates do not mutate an evaluation snapshot", () => {
    const definition = _createRubric();
    const snapshot = snapshotEvaluationRubric(definition);
    const before = structuredClone(snapshot);
    const updated = upsertEvaluationRubric(
      [definition],
      {
        id: definition.id,
        name: "Updated rubric",
        criteria: definition.criteria
      },
      40
    );
    expect(updated?.rubric.revision).toBe(2);
    expect(snapshot).toEqual(before);
  });

  test("reattaches rubrics while keeping run snapshots de-nested", () => {
    const rubric = _createRubric();
    const thread = withRunMetadata(
      { title: "Thread", context: { systemPrompt: "Prompt" } },
      { runHistory: RUNS, evaluations: [], evaluationRubrics: [rubric] }
    );
    expect(thread.evaluationRubrics).toEqual([rubric]);
    expect(thread.runHistory?.[0]?.thread).toEqual({});
    expect(thread.runHistory?.[0]?.thread).not.toHaveProperty(
      "evaluationRubrics"
    );
  });
});
