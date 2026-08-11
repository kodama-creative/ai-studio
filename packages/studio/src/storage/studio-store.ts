import type {
  StudioExperimentRecord,
  StudioThreadEvent,
  ThreadRunReference,
} from "../domain";
import type { Evaluation, EvaluationRubric } from "../evaluation";

export interface StudioStoreTransaction {
  getExperiment(experimentId: string): StudioExperimentRecord | undefined;
  listExperiments(): readonly StudioExperimentRecord[];
  insertExperiment(experiment: StudioExperimentRecord): void;
  saveExperiment(experiment: StudioExperimentRecord): void;

  listRunReferences(experimentId: string): readonly ThreadRunReference[];
  replaceRunReferences(
    experimentId: string,
    references: readonly ThreadRunReference[]
  ): void;

  listEvaluations(experimentId: string): readonly Evaluation[];
  replaceEvaluations(
    experimentId: string,
    evaluations: readonly Evaluation[]
  ): void;
  listRubrics(experimentId: string): readonly EvaluationRubric[];
  replaceRubrics(
    experimentId: string,
    rubrics: readonly EvaluationRubric[]
  ): void;

  appendEvent(event: Omit<StudioThreadEvent, "sequence">): StudioThreadEvent;
  listEvents(
    experimentId: string,
    afterSequence: number
  ): readonly StudioThreadEvent[];
}

export interface StudioStore {
  transaction<T>(fn: (tx: StudioStoreTransaction) => T): T;
  close(): void;
}
