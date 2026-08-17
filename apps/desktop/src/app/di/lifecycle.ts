import {
  Container,
  type ContainerModule,
  injectable,
  multiInject,
} from "inversify";

export interface RendererLifecycleContribution {
  start(): void;
  stop(): void;
}

export const RENDERER_LIFECYCLE_CONTRIBUTION = Symbol(
  "RendererLifecycleContribution"
);
export const RENDERER_SESSION_APPLICATION = Symbol(
  "RendererSessionApplication"
);

interface ContainerOwnership {
  readonly children: Set<Container>;
  readonly parent?: Container;
  disposal?: Promise<void>;
  disposed: boolean;
}

const containerOwnership = new WeakMap<Container, ContainerOwnership>();

/** Sole lifecycle root for one renderer window or interaction session. */
@injectable()
export class RendererApplication {
  private _activeContributions: RendererLifecycleContribution[] = [];
  private _started = false;

  constructor(
    @multiInject(RENDERER_LIFECYCLE_CONTRIBUTION)
    private readonly _contributions: RendererLifecycleContribution[]
  ) {}

  /** Start every fixed contribution once, rolling back a partial startup. */
  start(): void {
    if (this._started) return;
    this._started = true;
    let startedCount = 0;
    try {
      this._activeContributions = this._contributions;
      for (const contribution of this._contributions) {
        contribution.start();
        startedCount += 1;
      }
    } catch (error) {
      for (let index = startedCount - 1; index >= 0; index -= 1) {
        _stopBestEffort(this._contributions[index]);
      }
      this._activeContributions = [];
      this._started = false;
      throw error;
    }
  }

  /** Quiesce every event/command source before React releases its consumers. */
  prepareToStop(): void {
    this.stop();
  }

  /** Stop the remaining started contributions after React releases its views. */
  stop(): void {
    if (!this._started) return;
    this._started = false;
    const contributions = this._activeContributions;
    this._activeContributions = [];
    for (let index = contributions.length - 1; index >= 0; index -= 1) {
      _stopBestEffort(contributions[index]);
    }
  }
}

/** Create an unstarted child session Container with one Application root. */
export function createRendererSessionContainer(
  parent: Container,
  modules: readonly ContainerModule[]
): Container {
  const container = new Container({ parent });
  for (const module of modules) container.load(module);
  _ownershipOf(parent).children.add(container);
  containerOwnership.set(container, {
    children: new Set(),
    parent,
    disposed: false,
  });
  return container;
}

/** Stop a renderer Application before releasing only its local bindings. */
export async function disposeRendererContainer(
  container: Container
): Promise<void> {
  await _disposeContainer(container, RendererApplication);
}

/** Stop one named session Application before releasing local bindings. */
export async function disposeRendererSessionContainer(
  container: Container
): Promise<void> {
  await _disposeContainer(container, RENDERER_SESSION_APPLICATION);
}

/**
 * Release nested session Containers before their parent loses shared bindings.
 * The shared promise makes React cleanup and window teardown safely idempotent.
 */
function _disposeContainer(
  container: Container,
  applicationId:
    | typeof RendererApplication
    | typeof RENDERER_SESSION_APPLICATION
): Promise<void> {
  const ownership = _ownershipOf(container);
  if (ownership.disposed) return Promise.resolve();
  if (ownership.disposal) return ownership.disposal;

  const disposal = (async () => {
    const errors: unknown[] = [];
    try {
      container.get<RendererApplication>(applicationId).stop();
    } catch (error) {
      errors.push(error);
    }
    const children = [...ownership.children];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      try {
        await disposeRendererSessionContainer(children[index]);
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      await container.unbindAllAsync();
    } catch (error) {
      errors.push(error);
    }
    ownership.disposed = true;
    ownership.children.clear();
    if (ownership.parent) {
      containerOwnership.get(ownership.parent)?.children.delete(container);
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to dispose renderer Container.");
    }
  })();
  ownership.disposal = disposal;
  return disposal;
}

/** Return the single ownership record for a renderer Container. */
function _ownershipOf(container: Container): ContainerOwnership {
  const existing = containerOwnership.get(container);
  if (existing) return existing;
  const ownership: ContainerOwnership = {
    children: new Set(),
    disposed: false,
  };
  containerOwnership.set(container, ownership);
  return ownership;
}

/** Contain one failing stop so later owned contributions still release. */
function _stopBestEffort(
  contribution: RendererLifecycleContribution | undefined
): void {
  if (!contribution) return;
  try {
    contribution.stop();
  } catch (error) {
    console.error("Failed to stop renderer lifecycle contribution", error);
  }
}
