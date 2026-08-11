import type {
  StudioExperimentRecord,
  StudioThreadEvent,
  ThreadRunReference,
} from "../domain";
import type { Evaluation, EvaluationRubric } from "../evaluation";

import type { StudioStore, StudioStoreTransaction } from "./studio-store";

interface MemoryState {
  experiments: Map<string, StudioExperimentRecord>;
  runReferences: Map<string, ThreadRunReference[]>;
  evaluations: Map<string, Evaluation[]>;
  rubrics: Map<string, EvaluationRubric[]>;
  events: Map<string, StudioThreadEvent[]>;
}

export class InMemoryStudioStore implements StudioStore {
  private _state: MemoryState = {
    experiments: new Map(),
    runReferences: new Map(),
    evaluations: new Map(),
    rubrics: new Map(),
    events: new Map(),
  };

  transaction<T>(fn: (tx: StudioStoreTransaction) => T): T {
    const next = structuredClone(this._state);
    const result = fn(new MemoryTransaction(next));
    this._state = next;
    return structuredClone(result);
  }

  close(): void {
    // The in-memory Adapter owns no external resources.
  }
}

class MemoryTransaction implements StudioStoreTransaction {
  constructor(private readonly _state: MemoryState) {}

  getExperiment(experimentId: string): StudioExperimentRecord | undefined {
    return _clone(this._state.experiments.get(experimentId));
  }

  listExperiments(): readonly StudioExperimentRecord[] {
    return _values(this._state.experiments).toSorted(
      (left, right) => right.updatedAt - left.updatedAt
    );
  }

  insertExperiment(experiment: StudioExperimentRecord): void {
    if (this._state.experiments.has(experiment.id)) {
      throw new Error(`Studio Experiment "${experiment.id}" already exists.`);
    }
    this._state.experiments.set(experiment.id, structuredClone(experiment));
  }

  saveExperiment(experiment: StudioExperimentRecord): void {
    if (!this._state.experiments.has(experiment.id)) {
      throw new Error(`Studio Experiment "${experiment.id}" was not found.`);
    }
    this._state.experiments.set(experiment.id, structuredClone(experiment));
  }

  listRunReferences(experimentId: string): readonly ThreadRunReference[] {
    return structuredClone(this._state.runReferences.get(experimentId) ?? []);
  }

  replaceRunReferences(
    experimentId: string,
    references: readonly ThreadRunReference[]
  ): void {
    this._state.runReferences.set(experimentId, [
      ...structuredClone(references),
    ]);
  }

  listEvaluations(experimentId: string): readonly Evaluation[] {
    return structuredClone(this._state.evaluations.get(experimentId) ?? []);
  }

  replaceEvaluations(
    experimentId: string,
    evaluations: readonly Evaluation[]
  ): void {
    this._state.evaluations.set(experimentId, [
      ...structuredClone(evaluations),
    ]);
  }

  listRubrics(experimentId: string): readonly EvaluationRubric[] {
    return structuredClone(this._state.rubrics.get(experimentId) ?? []);
  }

  replaceRubrics(
    experimentId: string,
    rubrics: readonly EvaluationRubric[]
  ): void {
    this._state.rubrics.set(experimentId, [...structuredClone(rubrics)]);
  }

  appendEvent(event: Omit<StudioThreadEvent, "sequence">): StudioThreadEvent {
    const events = this._state.events.get(event.threadId) ?? [];
    const stored = {
      ...structuredClone(event),
      sequence: (events.at(-1)?.sequence ?? 0) + 1,
    };
    events.push(stored);
    this._state.events.set(event.threadId, events);
    return structuredClone(stored);
  }

  listEvents(
    experimentId: string,
    afterSequence: number
  ): readonly StudioThreadEvent[] {
    return (this._state.events.get(experimentId) ?? [])
      .filter((event) => event.sequence > afterSequence)
      .map((event) => structuredClone(event));
  }
}

function _values<T>(values: Map<string, T>): T[] {
  return [...values.values()].map((value) => structuredClone(value));
}

function _clone<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : structuredClone(value);
}
