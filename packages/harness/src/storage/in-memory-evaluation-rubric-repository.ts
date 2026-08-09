import type {
  EvaluationRubric,
  EvaluationRubricRepository,
} from "../evaluation";

export class InMemoryEvaluationRubricRepository implements EvaluationRubricRepository {
  private readonly _rubrics = new Map<string, EvaluationRubric>();

  create(rubric: EvaluationRubric): Promise<"created" | "existing"> {
    const key = _key(rubric.threadId, rubric.id);
    if (this._rubrics.has(key)) return Promise.resolve("existing");
    this._rubrics.set(key, structuredClone(rubric));
    return Promise.resolve("created");
  }

  load(
    threadId: string,
    rubricId: string
  ): Promise<EvaluationRubric | undefined> {
    const rubric = this._rubrics.get(_key(threadId, rubricId));
    return Promise.resolve(
      rubric === undefined ? undefined : structuredClone(rubric)
    );
  }

  save(rubric: EvaluationRubric): Promise<void> {
    this._rubrics.set(
      _key(rubric.threadId, rubric.id),
      structuredClone(rubric)
    );
    return Promise.resolve();
  }

  remove(threadId: string, rubricId: string): Promise<void> {
    this._rubrics.delete(_key(threadId, rubricId));
    return Promise.resolve();
  }

  listByThread(threadId: string): Promise<readonly EvaluationRubric[]> {
    return Promise.resolve(
      [...this._rubrics.values()]
        .filter((rubric) => rubric.threadId === threadId)
        .map((rubric) => structuredClone(rubric))
    );
  }
}

function _key(threadId: string, resourceId: string): string {
  return `${threadId}\0${resourceId}`;
}
