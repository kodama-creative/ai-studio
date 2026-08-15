import type {
  StudioExperimentRecord,
  StudioThreadEvent,
  ThreadRunReference,
} from "../domain";
import type { Evaluation, EvaluationRubric } from "../evaluation";
import type { PlaygroundRecord } from "../playground";

import type {
  StudioCommandReceipt,
  StudioStore,
  StudioStoreTransaction,
} from "./studio-store";

interface MemoryState {
  playgrounds: Map<string, PlaygroundRecord>;
  commandReceipts: Map<string, StudioCommandReceipt>;
  experiments: Map<string, StudioExperimentRecord>;
  operationReferences: Map<string, ThreadRunReference[]>;
  evaluations: Map<string, Evaluation[]>;
  rubrics: Map<string, EvaluationRubric[]>;
  events: Map<string, StudioThreadEvent[]>;
}

export class InMemoryStudioStore implements StudioStore {
  private _state: MemoryState = {
    playgrounds: new Map(),
    commandReceipts: new Map(),
    experiments: new Map(),
    operationReferences: new Map(),
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

  getPlayground(playgroundId: string): PlaygroundRecord | undefined {
    return _clone(this._state.playgrounds.get(playgroundId));
  }

  listPlaygrounds(): readonly PlaygroundRecord[] {
    return _values(this._state.playgrounds).toSorted(
      (left, right) => right.updatedAt - left.updatedAt
    );
  }

  insertPlayground(playground: PlaygroundRecord): void {
    if (this._state.playgrounds.has(playground.id)) {
      throw new Error(`Playground "${playground.id}" already exists.`);
    }
    this._state.playgrounds.set(playground.id, structuredClone(playground));
  }

  savePlayground(playground: PlaygroundRecord): void {
    if (!this._state.playgrounds.has(playground.id)) {
      throw new Error(`Playground "${playground.id}" was not found.`);
    }
    this._state.playgrounds.set(playground.id, structuredClone(playground));
  }

  getCommandReceipt(
    sessionId: string,
    commandId: string
  ): StudioCommandReceipt | undefined {
    return _clone(
      this._state.commandReceipts.get(`${sessionId}\0${commandId}`)
    );
  }

  insertCommandReceipt(receipt: StudioCommandReceipt): void {
    const key = `${receipt.sessionId}\0${receipt.commandId}`;
    const existing = this._state.commandReceipts.get(key);
    if (existing !== undefined) {
      throw new Error(
        `Command "${receipt.commandId}" already has a durable receipt.`
      );
    }
    this._state.commandReceipts.set(key, structuredClone(receipt));
  }

  saveCommandReceipt(receipt: StudioCommandReceipt): void {
    const key = `${receipt.sessionId}\0${receipt.commandId}`;
    if (!this._state.commandReceipts.has(key)) {
      throw new Error(
        `Command "${receipt.commandId}" does not have a durable receipt.`
      );
    }
    this._state.commandReceipts.set(key, structuredClone(receipt));
  }

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

  listOperationReferences(experimentId: string): readonly ThreadRunReference[] {
    return structuredClone(
      this._state.operationReferences.get(experimentId) ?? []
    );
  }

  replaceOperationReferences(
    experimentId: string,
    references: readonly ThreadRunReference[]
  ): void {
    this._state.operationReferences.set(experimentId, [
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
