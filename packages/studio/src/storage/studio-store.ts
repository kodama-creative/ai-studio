import type {
  StudioExperimentRecord,
  StudioThreadEvent,
  ThreadRunReference,
} from "../domain";
import type { Evaluation, EvaluationRubric } from "../evaluation";
import type { PlaygroundRecord } from "../playground";

export interface StudioCommandReceipt {
  readonly sessionId: string;
  readonly commandId: string;
  readonly method: "step" | "continue";
  readonly fingerprint: string;
  readonly operationId?: string;
  readonly leafId?: string;
  readonly createdAt: number;
}

export interface StudioStoreTransaction {
  getPlayground(playgroundId: string): PlaygroundRecord | undefined;
  listPlaygrounds(): readonly PlaygroundRecord[];
  insertPlayground(playground: PlaygroundRecord): void;
  savePlayground(playground: PlaygroundRecord): void;

  getCommandReceipt(
    sessionId: string,
    commandId: string
  ): StudioCommandReceipt | undefined;
  insertCommandReceipt(receipt: StudioCommandReceipt): void;

  getExperiment(experimentId: string): StudioExperimentRecord | undefined;
  listExperiments(): readonly StudioExperimentRecord[];
  insertExperiment(experiment: StudioExperimentRecord): void;
  saveExperiment(experiment: StudioExperimentRecord): void;

  listOperationReferences(experimentId: string): readonly ThreadRunReference[];
  replaceOperationReferences(
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
