import type {
  Evaluation,
  EvaluationRepository,
  EvaluationRubric,
  EvaluationRubricRepository,
} from "../evaluation";

export class InMemoryEvaluationRepository implements EvaluationRepository {
  private readonly _evaluations = new Map<string, Evaluation>();

  create(evaluation: Evaluation): Promise<"created" | "existing"> {
    if (this._evaluations.has(evaluation.id)) return Promise.resolve("existing");
    this._evaluations.set(evaluation.id, structuredClone(evaluation));
    return Promise.resolve("created");
  }

  load(evaluationId: string): Promise<Evaluation | undefined> {
    const evaluation = this._evaluations.get(evaluationId);
    return Promise.resolve(
      evaluation === undefined ? undefined : structuredClone(evaluation)
    );
  }

  save(evaluation: Evaluation): Promise<void> {
    this._evaluations.set(evaluation.id, structuredClone(evaluation));
    return Promise.resolve();
  }

  remove(evaluationId: string): Promise<void> {
    this._evaluations.delete(evaluationId);
    return Promise.resolve();
  }

  listByThread(threadId: string): Promise<readonly Evaluation[]> {
    return Promise.resolve(
      [...this._evaluations.values()]
        .filter((evaluation) => evaluation.threadId === threadId)
        .map((evaluation) => structuredClone(evaluation))
    );
  }
}

export class InMemoryEvaluationRubricRepository
  implements EvaluationRubricRepository
{
  private readonly _rubrics = new Map<string, EvaluationRubric>();

  create(rubric: EvaluationRubric): Promise<"created" | "existing"> {
    if (this._rubrics.has(rubric.id)) return Promise.resolve("existing");
    this._rubrics.set(rubric.id, structuredClone(rubric));
    return Promise.resolve("created");
  }

  load(rubricId: string): Promise<EvaluationRubric | undefined> {
    const rubric = this._rubrics.get(rubricId);
    return Promise.resolve(
      rubric === undefined ? undefined : structuredClone(rubric)
    );
  }

  save(rubric: EvaluationRubric): Promise<void> {
    this._rubrics.set(rubric.id, structuredClone(rubric));
    return Promise.resolve();
  }

  remove(rubricId: string): Promise<void> {
    this._rubrics.delete(rubricId);
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
