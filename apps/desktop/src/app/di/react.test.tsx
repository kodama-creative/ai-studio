/* eslint-disable @typescript-eslint/no-empty-function */
import { afterEach, describe, expect, test } from "bun:test";

import EventEmitter from "eventemitter3";
import { ContainerModule } from "inversify";
import { act, StrictMode, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";

import { RENDERER_LIFECYCLE_CONTRIBUTION, RendererScope } from "./lifecycle";
import { RendererScopeProvider, useController, useInject } from "./react";
import { rendererToken } from "./tokens";

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

const TEST_CONTROLLER = rendererToken<TestController>("test", "controller");
const TEST_EVENTS = rendererToken<EventEmitter<{ started: [] }>>(
  "test",
  "events"
);
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
  test("StrictMode restarts the scope and selector updates only when selected state changes", () => {
    const controller = new TestController();
    const scope = new RendererScope({
      modules: [
        new ContainerModule(({ bind }) => {
          bind(TEST_CONTROLLER).toConstantValue(controller);
          bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(TEST_CONTROLLER);
        }),
      ],
    });
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
          <RendererScopeProvider scope={scope}>
            <Probe />
          </RendererScopeProvider>
        </StrictMode>
      );
    });

    expect({ starts: controller.starts, stops: controller.stops }).toEqual({
      starts: 2,
      stops: 1,
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
      starts: 2,
      stops: 2,
    });
  });

  test("child layout listeners observe events emitted during scope startup", () => {
    const events = new EventEmitter<{ started: [] }>();
    const received: string[] = [];
    const scope = new RendererScope({
      modules: [
        new ContainerModule(({ bind }) => {
          bind(TEST_EVENTS).toConstantValue(events);
          bind(RENDERER_LIFECYCLE_CONTRIBUTION).toConstantValue({
            start: () => events.emit("started"),
            stop: () => undefined,
          });
        }),
      ],
    });

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
          <RendererScopeProvider scope={scope}>
            <Probe />
          </RendererScopeProvider>
        </StrictMode>
      );
    });

    expect(received).toEqual(["started", "started"]);
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
