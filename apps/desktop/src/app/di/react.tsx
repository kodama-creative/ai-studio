import { Container, type ServiceIdentifier } from "inversify";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/shim/with-selector";

import {
  disposeRendererSessionContainer,
  RENDERER_SESSION_APPLICATION,
  type RendererApplication,
} from "./lifecycle";

export interface ObservableController<TSnapshot> {
  readonly getSnapshot: () => TSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
}

type ControllerSnapshot<TController> =
  TController extends ObservableController<infer TSnapshot> ? TSnapshot : never;

const RendererContainerContext = createContext<Container | null>(null);

/** Expose a bootstrap-owned Container without starting it from React. */
export function RendererContainerProvider({
  children,
  container,
}: {
  readonly children: ReactNode;
  readonly container: Container;
}) {
  return (
    <RendererContainerContext.Provider value={container}>
      {children}
    </RendererContainerContext.Provider>
  );
}

/** Own a child interaction session while surviving StrictMode effect replay. */
export function RendererSessionContainerProvider({
  children,
  container,
}: {
  readonly children: ReactNode;
  readonly container: Container;
}) {
  const generations = useRef(new WeakMap<Container, number>());
  useLayoutEffect(() => {
    const containerGenerations = generations.current;
    const generation = (containerGenerations.get(container) ?? 0) + 1;
    containerGenerations.set(container, generation);
    container.get<RendererApplication>(RENDERER_SESSION_APPLICATION).start();
    return () => {
      queueMicrotask(() => {
        // StrictMode replays setup for the same Container before this runs.
        // A different replacement Container must not cancel this cleanup.
        if (containerGenerations.get(container) !== generation) return;
        void disposeRendererSessionContainer(container).catch((error) => {
          console.error("Failed to dispose renderer session Container", error);
        });
      });
    };
  }, [container]);
  return (
    <RendererContainerContext.Provider value={container}>
      {children}
    </RendererContainerContext.Provider>
  );
}

export function useRendererContainer(): Container {
  const container = useContext(RendererContainerContext);
  if (!container) {
    throw new Error(
      "Renderer DI hooks must be used within RendererContainerProvider."
    );
  }
  return container;
}

export function useInject<T>(token: ServiceIdentifier<T>): T {
  return useRendererContainer().get(token);
}

export function useController<
  TController extends ObservableController<unknown>,
  TSelected = ControllerSnapshot<TController>,
>(
  token: ServiceIdentifier<TController>,
  selector?: (
    snapshot: ControllerSnapshot<TController>
  ) => TSelected,
  equality?: (left: TSelected, right: TSelected) => boolean
): { readonly controller: TController; readonly state: TSelected };
export function useController<
  TController extends ObservableController<unknown>,
  TSelected = ControllerSnapshot<TController>,
>(
  token: ServiceIdentifier<TController>,
  selector: (
    snapshot: ControllerSnapshot<TController>
  ) => TSelected = _identity as (
    snapshot: ControllerSnapshot<TController>
  ) => TSelected,
  equality: (left: TSelected, right: TSelected) => boolean = Object.is
): { readonly controller: TController; readonly state: TSelected } {
  const controller = useInject<TController>(token);
  const state = useSyncExternalStoreWithSelector(
    controller.subscribe,
    controller.getSnapshot as () => ControllerSnapshot<TController>,
    controller.getSnapshot as () => ControllerSnapshot<TController>,
    selector,
    equality
  );
  return { controller, state };
}

function _identity<T>(value: T): T {
  return value;
}
