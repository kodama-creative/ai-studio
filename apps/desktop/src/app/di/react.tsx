import type { ServiceIdentifier } from "inversify";
import {
  createContext,
  useContext,
  useLayoutEffect,
  type ReactNode,
} from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/shim/with-selector";

import { RendererScope } from "./lifecycle";
import type { RendererToken } from "./tokens";

export interface ObservableController<TSnapshot> {
  readonly getSnapshot: () => TSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
}

type ControllerSnapshot<TController> =
  TController extends ObservableController<infer TSnapshot> ? TSnapshot : never;

const RendererScopeContext = createContext<RendererScope | null>(null);

export function RendererScopeProvider({
  children,
  scope,
}: {
  readonly children: ReactNode;
  readonly scope: RendererScope;
}) {
  useLayoutEffect(() => {
    scope.start();
    return () => scope.stop();
  }, [scope]);
  return (
    <RendererScopeContext.Provider value={scope}>
      {children}
    </RendererScopeContext.Provider>
  );
}

export function useRendererScope(): RendererScope {
  const scope = useContext(RendererScopeContext);
  if (!scope) {
    throw new Error(
      "Renderer DI hooks must be used within RendererScopeProvider."
    );
  }
  return scope;
}

export function useInject<T>(token: RendererToken<T>): T;
export function useInject<T>(token: ServiceIdentifier<T>): T;
export function useInject<T>(token: ServiceIdentifier<T>): T {
  return useRendererScope().get(token);
}

export function useController<
  TController extends ObservableController<unknown>,
  TSelected = ControllerSnapshot<TController>,
>(
  token: RendererToken<TController>,
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
