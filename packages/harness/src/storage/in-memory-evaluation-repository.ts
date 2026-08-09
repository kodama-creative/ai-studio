import type { Evaluation, EvaluationRepository } from "../evaluation";

export class InMemoryEvaluationRepository implements EvaluationRepository {
  private readonly _evaluations = new Map<string, Evaluation>();

  create(evaluation: Evaluation): Promise<"created" | "existing"> {
    const key = _key(evaluation.threadId, evaluation.id);
    if (this._evaluations.has(key)) return Promise.resolve("existing");
    this._evaluations.set(key, structuredClone(evaluation));
    return Promise.resolve("created");
  }

  load(
    threadId: string,
    evaluationId: string
  ): Promise<Evaluation | undefined> {
    const evaluation = this._evaluations.get(_key(threadId, evaluationId));
    return Promise.resolve(
      evaluation === undefined ? undefined : structuredClone(evaluation)
    );
  }

  save(evaluation: Evaluation): Promise<void> {
    this._evaluations.set(
      _key(evaluation.threadId, evaluation.id),
      structuredClone(evaluation)
    );
    return Promise.resolve();
  }

  remove(threadId: string, evaluationId: string): Promise<void> {
    this._evaluations.delete(_key(threadId, evaluationId));
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

function _key(threadId: string, resourceId: string): string {
  return `${threadId}\0${resourceId}`;
}
