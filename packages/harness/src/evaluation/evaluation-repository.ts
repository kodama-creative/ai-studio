import type { Evaluation, EvaluationRubric } from "./evaluation";

export interface EvaluationRepository {
  create(evaluation: Evaluation): Promise<"created" | "existing">;
  load(evaluationId: string): Promise<Evaluation | undefined>;
  save(evaluation: Evaluation): Promise<void>;
  remove(evaluationId: string): Promise<void>;
  listByThread(threadId: string): Promise<readonly Evaluation[]>;
}

export interface EvaluationRubricRepository {
  create(rubric: EvaluationRubric): Promise<"created" | "existing">;
  load(rubricId: string): Promise<EvaluationRubric | undefined>;
  save(rubric: EvaluationRubric): Promise<void>;
  remove(rubricId: string): Promise<void>;
  listByThread(threadId: string): Promise<readonly EvaluationRubric[]>;
}
