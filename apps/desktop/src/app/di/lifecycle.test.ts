import { describe, expect, test } from "bun:test";

import { Container, ContainerModule } from "inversify";

import {
  createRendererSessionContainer,
  disposeRendererContainer,
  disposeRendererSessionContainer,
  RENDERER_LIFECYCLE_CONTRIBUTION,
  RENDERER_SESSION_APPLICATION,
  RendererApplication,
  type RendererLifecycleContribution,
} from "./lifecycle";

describe("RendererApplication", () => {
  test("starts once and stops its fixed contributions in reverse order", () => {
    const calls: string[] = [];
    const application = new RendererApplication([
      _contribution("first", calls),
      _contribution("second", calls),
    ]);

    application.start();
    application.start();
    application.stop();
    application.stop();

    expect(calls).toEqual([
      "first:start",
      "second:start",
      "second:stop",
      "first:stop",
    ]);
  });

  test("rolls back started contributions when startup fails", () => {
    const calls: string[] = [];
    const application = new RendererApplication([
      _contribution("first", calls),
      {
        start() {
          calls.push("second:start");
          throw new Error("startup failed");
        },
        stop: () => calls.push("second:stop"),
      },
    ]);

    expect(() => application.start()).toThrow("startup failed");

    expect(calls).toEqual(["first:start", "second:start", "first:stop"]);
  });

  test("quiesces command and event ingress before the React unmount phase", () => {
    const calls: string[] = [];
    const application = new RendererApplication([
      _contribution("controller", calls),
      _contribution("ingress", calls),
    ]);

    application.start();
    application.prepareToStop();
    calls.push("react:unmount");
    application.stop();

    expect(calls).toEqual([
      "controller:start",
      "ingress:start",
      "ingress:stop",
      "controller:stop",
      "react:unmount",
    ]);
  });

  test("child disposal stops only its session and preserves the parent", async () => {
    const calls: string[] = [];
    const parent = new Container();
    parent
      .bind(RENDERER_LIFECYCLE_CONTRIBUTION)
      .toConstantValue(_contribution("parent", calls));
    parent.bind(RendererApplication).toSelf().inSingletonScope();
    const parentApplication = parent.get(RendererApplication);
    parentApplication.start();
    const child = createRendererSessionContainer(parent, [
      new ContainerModule(({ bind }) => {
        bind(RENDERER_LIFECYCLE_CONTRIBUTION).toConstantValue(
          _contribution("child", calls)
        );
        bind(RendererApplication).toSelf().inSingletonScope();
        bind(RENDERER_SESSION_APPLICATION).toService(RendererApplication);
      }),
    ]);
    child.get<RendererApplication>(RENDERER_SESSION_APPLICATION).start();

    await disposeRendererSessionContainer(child);
    expect(calls).toEqual(["parent:start", "child:start", "child:stop"]);

    parentApplication.stop();
    await parent.unbindAllAsync();
    expect(calls.at(-1)).toBe("parent:stop");
  });

  test("parent disposal releases child dependencies before parent bindings", async () => {
    const calls: string[] = [];
    const parent = new Container();
    const dependency = Symbol("ParentDependency");
    class ChildController {
      constructor(readonly value: string) {}
      start(): void {
        calls.push(`child:start:${this.value}`);
      }
      stop(): void {
        calls.push("child:stop");
      }
    }
    parent.bind(dependency).toConstantValue("parent");
    parent.bind(RendererApplication).toSelf().inSingletonScope();
    const child = createRendererSessionContainer(parent, [
      new ContainerModule(({ bind }) => {
        bind(ChildController)
          .toDynamicValue((context) =>
            new ChildController(context.get<string>(dependency))
          )
          .inSingletonScope();
        bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(ChildController);
        bind(RendererApplication).toSelf().inSingletonScope();
        bind(RENDERER_SESSION_APPLICATION).toService(RendererApplication);
      }),
    ]);
    child.get<RendererApplication>(RENDERER_SESSION_APPLICATION).start();

    await disposeRendererContainer(parent);
    await disposeRendererSessionContainer(child);

    expect(calls).toEqual(["child:start:parent", "child:stop"]);
  });
});

function _contribution(
  name: string,
  calls: string[]
): RendererLifecycleContribution {
  return {
    start: () => calls.push(`${name}:start`),
    stop: () => calls.push(`${name}:stop`),
  };
}
