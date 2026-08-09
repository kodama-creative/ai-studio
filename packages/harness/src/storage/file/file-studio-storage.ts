import {
  appendFile,
  link,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  Evaluation,
  EvaluationRepository,
  EvaluationRubric,
  EvaluationRubricRepository,
} from "../../evaluation";
import type { Run, RunOwner, RunRepository } from "../../run";
import type {
  StudioEventCursor,
  StudioStorage,
  StudioThread,
  StudioThreadEvent,
  StudioThreadEventLog,
  StudioThreadRepository,
  ThreadCheckpoint,
  ThreadCheckpointRepository,
  ThreadRunIndexRepository,
  ThreadRunReference,
} from "../../studio";

import { getFileErrorCode } from "./get-file-error-code";
import { getFileEventLogCoordinator } from "./get-file-event-log-coordinator";

export interface FileStudioStoragePaths {
  readonly threadsRoot: string;
  readonly runsRoot: string;
}

export function createFileStudioStorage(
  root: string | FileStudioStoragePaths
): StudioStorage {
  const paths =
    typeof root === "string"
      ? {
          threadsRoot: join(root, "threads"),
          runsRoot: join(root, "runs"),
        }
      : root;
  return {
    threadRepository: new FileStudioThreadRepository(paths),
    runRepository: new FileRunRepository(paths),
    evaluationRepository: new FileEvaluationRepository(paths),
    evaluationRubricRepository: new FileEvaluationRubricRepository(paths),
    checkpointRepository: new FileThreadCheckpointRepository(paths),
    runIndexRepository: new FileThreadRunIndexRepository(paths),
    eventLog: new JsonlStudioThreadEventLog(paths),
  };
}

class FileEvaluationRepository implements EvaluationRepository {
  constructor(private readonly _paths: FileStudioStoragePaths) {}

  create(evaluation: Evaluation): Promise<"created" | "existing"> {
    return _createJson(this._path(evaluation.threadId, evaluation.id), evaluation);
  }

  async load(evaluationId: string): Promise<Evaluation | undefined> {
    for (const thread of await new FileStudioThreadRepository(this._paths).list()) {
      const value = await _readJson(this._path(thread.id, evaluationId));
      if (value === undefined) continue;
      if (!_isEvaluation(value) || value.id !== evaluationId) {
        throw new Error(`Invalid Evaluation in "${this._path(thread.id, evaluationId)}".`);
      }
      return value;
    }
    return undefined;
  }

  save(evaluation: Evaluation): Promise<void> {
    return _saveJson(this._path(evaluation.threadId, evaluation.id), evaluation);
  }

  async remove(evaluationId: string): Promise<void> {
    const evaluation = await this.load(evaluationId);
    if (evaluation === undefined) return;
    await rm(this._path(evaluation.threadId, evaluation.id), { force: true });
  }

  listByThread(threadId: string): Promise<readonly Evaluation[]> {
    return _listThreadResources(
      this._root(threadId),
      threadId,
      "Evaluation",
      _isEvaluation
    );
  }

  private _root(threadId: string): string {
    return join(this._paths.threadsRoot, _storageKey(threadId), "evaluations");
  }

  private _path(threadId: string, evaluationId: string): string {
    return join(this._root(threadId), `${_storageKey(evaluationId)}.json`);
  }
}

class FileEvaluationRubricRepository implements EvaluationRubricRepository {
  constructor(private readonly _paths: FileStudioStoragePaths) {}

  create(rubric: EvaluationRubric): Promise<"created" | "existing"> {
    return _createJson(this._path(rubric.threadId, rubric.id), rubric);
  }

  async load(rubricId: string): Promise<EvaluationRubric | undefined> {
    for (const thread of await new FileStudioThreadRepository(this._paths).list()) {
      const value = await _readJson(this._path(thread.id, rubricId));
      if (value === undefined) continue;
      if (!_isEvaluationRubric(value) || value.id !== rubricId) {
        throw new Error(
          `Invalid Evaluation Rubric in "${this._path(thread.id, rubricId)}".`
        );
      }
      return value;
    }
    return undefined;
  }

  save(rubric: EvaluationRubric): Promise<void> {
    return _saveJson(this._path(rubric.threadId, rubric.id), rubric);
  }

  async remove(rubricId: string): Promise<void> {
    const rubric = await this.load(rubricId);
    if (rubric === undefined) return;
    await rm(this._path(rubric.threadId, rubric.id), { force: true });
  }

  listByThread(threadId: string): Promise<readonly EvaluationRubric[]> {
    return _listThreadResources(
      this._root(threadId),
      threadId,
      "Evaluation Rubric",
      _isEvaluationRubric
    );
  }

  private _root(threadId: string): string {
    return join(
      this._paths.threadsRoot,
      _storageKey(threadId),
      "evaluation-rubrics"
    );
  }

  private _path(threadId: string, rubricId: string): string {
    return join(this._root(threadId), `${_storageKey(rubricId)}.json`);
  }
}

class FileStudioThreadRepository implements StudioThreadRepository {
  constructor(private readonly _paths: FileStudioStoragePaths) {}

  create(thread: StudioThread): Promise<"created" | "existing"> {
    return _createJson(this._path(thread.id), thread);
  }

  async load(threadId: string): Promise<StudioThread | undefined> {
    const value = await _readJson(this._path(threadId));
    if (value === undefined) return undefined;
    if (!_isStudioThread(value) || value.id !== threadId) {
      throw new Error(`Invalid Studio Thread in "${this._path(threadId)}".`);
    }
    return value;
  }

  save(thread: StudioThread): Promise<void> {
    return _saveJson(this._path(thread.id), thread);
  }

  async list(): Promise<readonly StudioThread[]> {
    let entries;
    try {
      entries = await readdir(this._paths.threadsRoot, {
        withFileTypes: true,
      });
    } catch (error) {
      if (getFileErrorCode(error) === "ENOENT") return [];
      throw error;
    }
    const threads = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => this.load(entry.name))
    );
    return threads.filter((thread): thread is StudioThread => thread !== undefined);
  }

  private _path(threadId: string): string {
    return join(
      this._paths.threadsRoot,
      _storageKey(threadId),
      "thread.json"
    );
  }
}

export class FileRunRepository implements RunRepository {
  constructor(private readonly _paths: FileStudioStoragePaths) {}

  create(run: Run): Promise<"created" | "existing"> {
    return _createJson(this._path(run.id), run);
  }

  async load(runId: string): Promise<Run | undefined> {
    const value = await _readJson(this._path(runId));
    if (value === undefined) return undefined;
    if (!_isRun(value) || value.id !== runId) {
      throw new Error(`Invalid Run in "${this._path(runId)}".`);
    }
    return value;
  }

  save(run: Run): Promise<void> {
    return _saveJson(this._path(run.id), run);
  }

  async listByOwner(owner: RunOwner): Promise<readonly Run[]> {
    let names: string[];
    try {
      names = await readdir(this._paths.runsRoot);
    } catch (error) {
      if (getFileErrorCode(error) === "ENOENT") return [];
      throw error;
    }
    const runs = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map((name) => this.load(_decodeJsonName(name)))
    );
    return runs.filter(
      (run): run is Run => run !== undefined && _sameOwner(run.owner, owner)
    );
  }

  private _path(runId: string): string {
    return join(this._paths.runsRoot, `${_storageKey(runId)}.json`);
  }
}

class FileThreadCheckpointRepository
  implements ThreadCheckpointRepository
{
  constructor(private readonly _paths: FileStudioStoragePaths) {}

  create(checkpoint: ThreadCheckpoint): Promise<"created" | "existing"> {
    return _createJson(this._path(checkpoint.threadId, checkpoint.id), checkpoint);
  }

  async load(checkpointId: string): Promise<ThreadCheckpoint | undefined> {
    const threads = new FileStudioThreadRepository(this._paths);
    for (const thread of await threads.list()) {
      const value = await _readJson(this._path(thread.id, checkpointId));
      if (value === undefined) continue;
      if (!_isThreadCheckpoint(value) || value.id !== checkpointId) {
        throw new Error(
          `Invalid Thread Checkpoint in "${this._path(thread.id, checkpointId)}".`
        );
      }
      return value;
    }
    return undefined;
  }

  async listByThread(threadId: string): Promise<readonly ThreadCheckpoint[]> {
    const root = this._checkpointRoot(threadId);
    let names: string[];
    try {
      names = await readdir(root);
    } catch (error) {
      if (getFileErrorCode(error) === "ENOENT") return [];
      throw error;
    }
    const checkpoints = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => {
          const value = await _readJson(join(root, name));
          if (!_isThreadCheckpoint(value) || value.threadId !== threadId) {
            throw new Error(`Invalid Thread Checkpoint in "${join(root, name)}".`);
          }
          return value;
        })
    );
    return checkpoints;
  }

  private _checkpointRoot(threadId: string): string {
    return join(
      this._paths.threadsRoot,
      _storageKey(threadId),
      "checkpoints"
    );
  }

  private _path(threadId: string, checkpointId: string): string {
    return join(
      this._checkpointRoot(threadId),
      `${_storageKey(checkpointId)}.json`
    );
  }
}

class FileThreadRunIndexRepository implements ThreadRunIndexRepository {
  constructor(private readonly _paths: FileStudioStoragePaths) {}

  async append(reference: ThreadRunReference): Promise<void> {
    const path = this._path(reference.threadId);
    const current = [...(await this.list(reference.threadId))];
    const index = current.findIndex((item) => item.runId === reference.runId);
    if (index === -1) current.push(reference);
    else current[index] = reference;
    await _saveJson(path, current);
  }

  replace(
    threadId: string,
    references: readonly ThreadRunReference[]
  ): Promise<void> {
    return _saveJson(this._path(threadId), references);
  }

  async list(threadId: string): Promise<readonly ThreadRunReference[]> {
    const value = await _readJson(this._path(threadId));
    if (value === undefined) return [];
    if (!Array.isArray(value) || !value.every(_isThreadRunReference)) {
      throw new Error(`Invalid Thread Run index for "${threadId}".`);
    }
    return value;
  }

  private _path(threadId: string): string {
    return join(
      this._paths.threadsRoot,
      _storageKey(threadId),
      "run-index.json"
    );
  }
}

class JsonlStudioThreadEventLog implements StudioThreadEventLog {
  private readonly _coordinator = getFileEventLogCoordinator();

  constructor(private readonly _paths: FileStudioStoragePaths) {}

  async append(event: StudioThreadEvent): Promise<void> {
    const path = this._path(event.threadId);
    await this._coordinator.append(path, async () => {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await appendFile(path, `${JSON.stringify(event)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
    });
  }

  async *read(
    threadId: string,
    cursor: StudioEventCursor = {}
  ): AsyncIterable<StudioThreadEvent> {
    const path = this._path(threadId);
    let afterSequence = cursor.afterSequence ?? 0;
    while (!cursor.signal?.aborted) {
      for (const event of await this._readEvents(path, threadId)) {
        if (event.sequence <= afterSequence) continue;
        afterSequence = event.sequence;
        yield event;
      }
      if (cursor.follow !== true) return;
      await this._coordinator.wait(
        path,
        cursor.signal,
        async () =>
          (await this._readEvents(path, threadId)).at(-1)?.sequence !==
          afterSequence
      );
    }
  }

  private async _readEvents(
    path: string,
    threadId: string
  ): Promise<StudioThreadEvent[]> {
    let source: string;
    try {
      source = await readFile(path, "utf8");
    } catch (error) {
      if (getFileErrorCode(error) === "ENOENT") return [];
      throw error;
    }
    return source
      .split("\n")
      .filter(Boolean)
      .map((line, index) => {
        let value: unknown;
        try {
          value = JSON.parse(line) as unknown;
        } catch (cause) {
          throw new Error(
            `Invalid Studio Thread event JSON at line ${index + 1} in "${path}".`,
            { cause }
          );
        }
        if (!_isStudioThreadEvent(value) || value.threadId !== threadId) {
          throw new Error(
            `Invalid Studio Thread event at line ${index + 1} in "${path}".`
          );
        }
        return value;
      });
  }

  private _path(threadId: string): string {
    return join(
      this._paths.threadsRoot,
      _storageKey(threadId),
      "events.jsonl"
    );
  }
}

async function _createJson(
  destination: string,
  value: unknown
): Promise<"created" | "existing"> {
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = _temporaryPath(destination);
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    try {
      await link(temporary, destination);
      return "created";
    } catch (error) {
      if (getFileErrorCode(error) === "EEXIST") return "existing";
      throw error;
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

async function _saveJson(destination: string, value: unknown): Promise<void> {
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = _temporaryPath(destination);
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function _readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (getFileErrorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

async function _listThreadResources<T extends { readonly threadId: string }>(
  root: string,
  threadId: string,
  label: string,
  validate: (value: unknown) => value is T
): Promise<readonly T[]> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch (error) {
    if (getFileErrorCode(error) === "ENOENT") return [];
    throw error;
  }
  return Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => {
        const path = join(root, name);
        const value = await _readJson(path);
        if (!validate(value) || value.threadId !== threadId) {
          throw new Error(`Invalid ${label} in "${path}".`);
        }
        return value;
      })
  );
}

function _temporaryPath(destination: string): string {
  return `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
}

function _decodeJsonName(name: string): string {
  return name.slice(0, -".json".length);
}

function _storageKey(id: string): string {
  if (!/^[A-Za-z0-9_-]+$/u.test(id)) {
    throw new Error(`Invalid Studio storage ID "${id}".`);
  }
  return id;
}

function _isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function _isStudioThread(value: unknown): value is StudioThread {
  return (
    _isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.id === "string" &&
    _isRecord(value.document) &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number"
  );
}

function _isRun(value: unknown): value is Run {
  return (
    _isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.id === "string" &&
    _isRecord(value.owner) &&
    typeof value.triggerMessageId === "string" &&
    typeof value.status === "string" &&
    typeof value.createdAt === "number"
  );
}

function _isThreadCheckpoint(value: unknown): value is ThreadCheckpoint {
  return (
    _isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.id === "string" &&
    typeof value.threadId === "string" &&
    _isRecord(value.source) &&
    _isRecord(value.document) &&
    typeof value.createdAt === "number"
  );
}

function _isEvaluation(value: unknown): value is Evaluation {
  return (
    _isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.id === "string" &&
    typeof value.threadId === "string" &&
    typeof value.leftRunId === "string" &&
    typeof value.rightRunId === "string" &&
    typeof value.verdict === "string" &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number"
  );
}

function _isEvaluationRubric(value: unknown): value is EvaluationRubric {
  return (
    _isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.id === "string" &&
    typeof value.threadId === "string" &&
    typeof value.name === "string" &&
    Array.isArray(value.criteria) &&
    typeof value.revision === "number" &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number"
  );
}

function _isThreadRunReference(value: unknown): value is ThreadRunReference {
  return (
    _isRecord(value) &&
    typeof value.threadId === "string" &&
    typeof value.runId === "string" &&
    (value.relation === "executed" || value.relation === "inherited")
  );
}

function _isStudioThreadEvent(value: unknown): value is StudioThreadEvent {
  return (
    _isRecord(value) &&
    typeof value.threadId === "string" &&
    typeof value.sequence === "number" &&
    typeof value.timestamp === "number" &&
    _isRecord(value.event) &&
    typeof value.event.type === "string"
  );
}

function _sameOwner(left: RunOwner, right: RunOwner): boolean {
  return left.type === "session"
    ? right.type === "session" && left.sessionId === right.sessionId
    : right.type === "thread" && left.threadId === right.threadId;
}
