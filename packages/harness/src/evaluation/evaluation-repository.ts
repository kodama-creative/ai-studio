import type { Evaluation, EvaluationRubric } from "./evaluation";

export interface EvaluationRepository {
  create(evaluation: Evaluation): Promise<"created" | "existing">;
  load(threadId: string, evaluationId: string): Promise<Evaluation | undefined>;
  save(evaluation: Evaluation): Promise<void>;
  remove(threadId: string, evaluationId: string): Promise<void>;
  listByThread(threadId: string): Promise<readonly Evaluation[]>;
}

export interface EvaluationRubricRepository {
  create(rubric: EvaluationRubric): Promise<"created" | "existing">;
  load(
    threadId: string,
    rubricId: string
  ): Promise<EvaluationRubric | undefined>;
  save(rubric: EvaluationRubric): Promise<void>;
  remove(threadId: string, rubricId: string): Promise<void>;
  listByThread(threadId: string): Promise<readonly EvaluationRubric[]>;
}
