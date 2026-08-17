/* eslint-disable @typescript-eslint/no-empty-function */
import { afterEach, describe, expect, test } from "bun:test";

import EventEmitter from "eventemitter3";
import { Container, type ServiceIdentifier } from "inversify";
import { act, StrictMode, useLayoutEffect, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  disposeRendererContainer,
  RENDERER_LIFECYCLE_CONTRIBUTION,
  RENDERER_SESSION_APPLICATION,
  RendererApplication,
} from "./lifecycle";
import {
  RendererContainerProvider,
  RendererSessionContainerProvider,
  useController,
  useInject,
} from "./react";

interface Snapshot {
  readonly ignored: number;
  readonly selected: number;
}

class TestController {
  private readonly _listeners = new Set<() => void>();
  private _snapshot: Snapshot = { ignored: 0, selected: 0 };
  starts = 0;
  stops = 0;

  readonly getSnapshot = () => this._snapshot;

  readonly subscribe = (listener: () => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  start(): void {
    this.starts += 1;
  }

  stop(): void {
    this.stops += 1;
  }

  setSnapshot(snapshot: Snapshot): void {
    this._snapshot = snapshot;
    for (const listener of this._listeners) listener();
  }
}

const TEST_CONTROLLER: ServiceIdentifier<TestController> =
  Symbol("TestController");
const TEST_EVENTS: ServiceIdentifier<EventEmitter<{ started: [] }>> =
  Symbol("TestEvents");
const ORIGINAL_DOCUMENT = globalThis.document;
const ORIGINAL_HTML_ELEMENT = globalThis.HTMLElement;
const ORIGINAL_IFRAME_ELEMENT = globalThis.HTMLIFrameElement;
const ORIGINAL_WINDOW = globalThis.window;
let activeRoot: Root | null = null;

afterEach(() => {
  if (activeRoot) {
    act(() => activeRoot?.unmount());
    activeRoot = null;
  }
  globalThis.document = ORIGINAL_DOCUMENT;
  globalThis.HTMLElement = ORIGINAL_HTML_ELEMENT;
  globalThis.HTMLIFrameElement = ORIGINAL_IFRAME_ELEMENT;
  globalThis.window = ORIGINAL_WINDOW;
});

describe("renderer DI React hooks", () => {
  test("StrictMode does not restart the renderer Application", async () => {
    const controller = new TestController();
    const container = new Container();
    container.bind(TEST_CONTROLLER).toConstantValue(controller);
    container.bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(TEST_CONTROLLER);
    container.bind(RendererApplication).toSelf().inSingletonScope();
    container.get(RendererApplication).start();
    const renders: number[] = [];

    function Probe() {
      const selected = useController(
        TEST_CONTROLLER,
        (snapshot) => snapshot.selected
      ).state;
      renders.push(selected);
      return null;
    }

    activeRoot = _createRoot();
    act(() => {
      activeRoot?.render(
        <StrictMode>
          <RendererContainerProvider container={container}>
            <Probe />
          </RendererContainerProvider>
        </StrictMode>
      );
    });

    expect({ starts: controller.starts, stops: controller.stops }).toEqual({
      starts: 1,
      stops: 0,
    });
    const renderCount = renders.length;

    act(() => {
      controller.setSnapshot({ ignored: 1, selected: 0 });
    });
    expect(renders).toHaveLength(renderCount);

    act(() => {
      controller.setSnapshot({ ignored: 1, selected: 1 });
    });
    expect(renders.length).toBeGreaterThan(renderCount);
    expect(renders.at(-1)).toBe(1);

    act(() => activeRoot?.unmount());
    activeRoot = null;
    expect({ starts: controller.starts, stops: controller.stops }).toEqual({
      starts: 1,
      stops: 0,
    });
    await disposeRendererContainer(container);
    expect(controller.stops).toBe(1);
  });

  test("hooks resolve values from the bootstrap-owned Container", () => {
    const events = new EventEmitter<{ started: [] }>();
    const received: string[] = [];
    const container = new Container();
    container.bind(TEST_EVENTS).toConstantValue(events);

    function Probe() {
      const injectedEvents = useInject(TEST_EVENTS);
      useLayoutEffect(() => {
        const listener = () => received.push("started");
        injectedEvents.on("started", listener);
        return () => {
          injectedEvents.off("started", listener);
        };
      }, [injectedEvents]);
      return null;
    }

    activeRoot = _createRoot();
    act(() => {
      activeRoot?.render(
        <StrictMode>
          <RendererContainerProvider container={container}>
            <Probe />
          </RendererContainerProvider>
        </StrictMode>
      );
    });

    void act(() => events.emit("started"));
    expect(received).toEqual(["started"]);
  });

  test("replacing a session Container disposes the replaced child only", async () => {
    const firstController = new TestController();
    const secondController = new TestController();
    const createSession = (controller: TestController) => {
      const container = new Container();
      container.bind(TEST_CONTROLLER).toConstantValue(controller);
      container
        .bind(RENDERER_LIFECYCLE_CONTRIBUTION)
        .toService(TEST_CONTROLLER);
      container.bind(RendererApplication).toSelf().inSingletonScope();
      container
        .bind(RENDERER_SESSION_APPLICATION)
        .toService(RendererApplication);
      return container;
    };
    const first = createSession(firstController);
    const second = createSession(secondController);

    activeRoot = _createRoot();
    act(() => {
      activeRoot?.render(
        <StrictMode>
          <RendererSessionContainerProvider container={first}>
            {null}
          </RendererSessionContainerProvider>
        </StrictMode>
      );
    });
    act(() => {
      activeRoot?.render(
        <StrictMode>
          <RendererSessionContainerProvider container={second}>
            {null}
          </RendererSessionContainerProvider>
        </StrictMode>
      );
    });
    await act(() => Promise.resolve());

    expect({
      first: { starts: firstController.starts, stops: firstController.stops },
      second: {
        starts: secondController.starts,
        stops: secondController.stops,
      },
    }).toEqual({
      first: { starts: 1, stops: 1 },
      second: { starts: 1, stops: 0 },
    });

    act(() => activeRoot?.unmount());
    activeRoot = null;
    await act(() => Promise.resolve());
    expect(secondController.stops).toBe(1);
  });

  test("closing and reopening an interaction creates a fresh session", async () => {
    const controllers: TestController[] = [];
    const createSession = () => {
      const controller = new TestController();
      controllers.push(controller);
      const container = new Container();
      container.bind(TEST_CONTROLLER).toConstantValue(controller);
      container
        .bind(RENDERER_LIFECYCLE_CONTRIBUTION)
        .toService(TEST_CONTROLLER);
      container.bind(RendererApplication).toSelf().inSingletonScope();
      container
        .bind(RENDERER_SESSION_APPLICATION)
        .toService(RendererApplication);
      return container;
    };
    function OpenSession() {
      const container = useMemo(createSession, []);
      return (
        <RendererSessionContainerProvider container={container}>
          {null}
        </RendererSessionContainerProvider>
      );
    }

    activeRoot = _createRoot();
    act(() => activeRoot?.render(<OpenSession />));
    act(() => activeRoot?.render(null));
    await act(() => Promise.resolve());
    act(() => activeRoot?.render(<OpenSession />));

    expect(controllers).toHaveLength(2);
    expect({
      first: { starts: controllers[0]?.starts, stops: controllers[0]?.stops },
      second: { starts: controllers[1]?.starts, stops: controllers[1]?.stops },
    }).toEqual({
      first: { starts: 1, stops: 1 },
      second: { starts: 1, stops: 0 },
    });
  });
});

class FakeHTMLElement {}
class FakeHTMLIFrameElement extends FakeHTMLElement {}

interface FakeDocument {
  activeElement: null;
  addEventListener(): void;
  defaultView: FakeWindow;
  documentElement: { namespaceURI: string };
  nodeName: "#document";
  nodeType: 9;
  removeEventListener(): void;
}

interface FakeWindow {
  document: FakeDocument;
  event: undefined;
  HTMLElement: typeof FakeHTMLElement;
  HTMLIFrameElement: typeof FakeHTMLIFrameElement;
}

class FakeContainer extends FakeHTMLElement {
  readonly children: FakeContainer[] = [];
  readonly namespaceURI = "http://www.w3.org/1999/xhtml";
  readonly nodeName = "DIV";
  readonly nodeType = 1;
  readonly tagName = "DIV";
  parentNode: FakeContainer | null = null;

  constructor(readonly ownerDocument: FakeDocument) {
    super();
  }

  addEventListener(): void {}

  appendChild(child: FakeContainer): FakeContainer {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  insertBefore(child: FakeContainer, before: FakeContainer): FakeContainer {
    const index = this.children.indexOf(before);
    this.children.splice(index === -1 ? this.children.length : index, 0, child);
    child.parentNode = this;
    return child;
  }

  removeChild(child: FakeContainer): FakeContainer {
    const index = this.children.indexOf(child);
    if (index !== -1) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  removeEventListener(): void {}
}

function _createRoot(): Root {
  const fakeWindow = {} as FakeWindow;
  const fakeDocument: FakeDocument = {
    activeElement: null,
    addEventListener() {},
    defaultView: fakeWindow,
    documentElement: { namespaceURI: "http://www.w3.org/1999/xhtml" },
    nodeName: "#document",
    nodeType: 9,
    removeEventListener() {},
  };
  Object.assign(fakeWindow, {
    document: fakeDocument,
    event: undefined,
    HTMLElement: FakeHTMLElement,
    HTMLIFrameElement: FakeHTMLIFrameElement,
  });
  globalThis.document = fakeDocument as unknown as Document;
  globalThis.HTMLElement = FakeHTMLElement as unknown as typeof HTMLElement;
  globalThis.HTMLIFrameElement =
    FakeHTMLIFrameElement as unknown as typeof HTMLIFrameElement;
  globalThis.window = fakeWindow as unknown as Window & typeof globalThis;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  return createRoot(new FakeContainer(fakeDocument) as unknown as Element);
}
