export interface EvaluationCriterion {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
}

export interface EvaluationRubricSnapshot {
  readonly id: string;
  readonly name: string;
  readonly criteria: readonly EvaluationCriterion[];
  readonly revision: number;
}

export interface EvaluationCriterionScore {
  readonly criterionId: string;
  readonly score: number;
}

export interface EvaluationRunScores {
  readonly runId: string;
  readonly scores: readonly EvaluationCriterionScore[];
}

export type EvaluationVerdict =
  "leftBetter" | "rightBetter" | "tie" | "pass" | "fail";

interface EvaluationBase {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly threadId: string;
  readonly leftRunId: string;
  readonly rightRunId: string;
  readonly verdict: EvaluationVerdict;
  readonly note?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type Evaluation = EvaluationBase &
  (
    | { readonly rubric?: never; readonly runScores?: never }
    | {
        readonly rubric: EvaluationRubricSnapshot;
        readonly runScores: readonly EvaluationRunScores[];
      }
  );

export interface EvaluationRubric {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly threadId: string;
  readonly name: string;
  readonly criteria: readonly EvaluationCriterion[];
  readonly revision: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type EvaluationInput = Evaluation extends infer Value
  ? Value extends unknown
    ? Omit<Value, "schemaVersion" | "threadId">
    : never
  : never;
export type EvaluationRubricInput = Omit<
  EvaluationRubric,
  "schemaVersion" | "threadId"
>;

export interface StudioEvaluationMetadata {
  readonly evaluations: readonly Evaluation[];
  readonly rubrics: readonly EvaluationRubric[];
}

export interface StudioEvaluationMetadataInput {
  readonly evaluations: readonly EvaluationInput[];
  readonly rubrics: readonly EvaluationRubricInput[];
}
