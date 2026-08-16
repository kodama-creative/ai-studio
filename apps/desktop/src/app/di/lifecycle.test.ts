import { describe, expect, test } from "bun:test";

import { ContainerModule } from "inversify";

import {
  RENDERER_LIFECYCLE_CONTRIBUTION,
  RendererScope,
  type RendererLifecycleContribution,
} from "./lifecycle";
import { rendererToken } from "./tokens";

describe("RendererScope", () => {
  test("starts once, stops in reverse order, and can restart", () => {
    const calls: string[] = [];
    const first = _contribution("first", calls);
    const second = _contribution("second", calls);
    const scope = new RendererScope({
      modules: [
        new ContainerModule(({ bind }) => {
          bind(RENDERER_LIFECYCLE_CONTRIBUTION).toConstantValue(first);
          bind(RENDERER_LIFECYCLE_CONTRIBUTION).toConstantValue(second);
        }),
      ],
    });

    scope.start();
    scope.start();
    scope.stop();
    scope.stop();
    scope.start();
    scope.stop();

    expect(calls).toEqual([
      "first:start",
      "second:start",
      "second:stop",
      "first:stop",
      "first:start",
      "second:start",
      "second:stop",
      "first:stop",
    ]);
  });

  test("rolls back started contributions when startup fails", () => {
    const calls: string[] = [];
    let fail = true;
    const scope = new RendererScope({
      modules: [
        new ContainerModule(({ bind }) => {
          bind(RENDERER_LIFECYCLE_CONTRIBUTION).toConstantValue(
            _contribution("first", calls)
          );
          bind(RENDERER_LIFECYCLE_CONTRIBUTION).toConstantValue({
            start() {
              calls.push("second:start");
              if (fail) {
                fail = false;
                throw new Error("startup failed");
              }
            },
            stop() {
              calls.push("second:stop");
            },
          });
        }),
      ],
    });

    expect(() => scope.start()).toThrow("startup failed");
    scope.start();
    scope.stop();

    expect(calls).toEqual([
      "first:start",
      "second:start",
      "second:stop",
      "first:stop",
      "first:start",
      "second:start",
      "second:stop",
      "first:stop",
    ]);
  });

  test("can retry when contribution resolution fails", () => {
    const contributionToken = rendererToken<RendererLifecycleContribution>(
      "test",
      "unstable-contribution"
    );
    let resolutions = 0;
    const scope = new RendererScope({
      modules: [
        new ContainerModule(({ bind }) => {
          bind(contributionToken)
            .toDynamicValue(() => {
              resolutions += 1;
              if (resolutions === 1) throw new Error("resolution failed");
              return { start: () => undefined, stop: () => undefined };
            })
            .inSingletonScope();
          bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(contributionToken);
        }),
      ],
    });

    expect(() => scope.start()).toThrow("resolution failed");
    expect(() => scope.start()).not.toThrow();
    scope.stop();
    expect(resolutions).toBe(2);
  });

  test("inherits services without restarting the parent lifecycle", () => {
    const service = rendererToken<{ readonly value: string }>("test", "value");
    const calls: string[] = [];
    const parent = new RendererScope({
      modules: [
        new ContainerModule(({ bind }) => {
          bind(service).toConstantValue({ value: "parent" });
          bind(RENDERER_LIFECYCLE_CONTRIBUTION).toConstantValue(
            _contribution("parent", calls)
          );
        }),
      ],
    });
    const child = new RendererScope({
      parent,
      modules: [
        new ContainerModule(({ bind }) => {
          bind(RENDERER_LIFECYCLE_CONTRIBUTION).toConstantValue(
            _contribution("child", calls)
          );
        }),
      ],
    });

    parent.start();
    child.start();
    expect(child.get(service)).toEqual({ value: "parent" });
    child.stop();
    parent.stop();

    expect(calls).toEqual([
      "parent:start",
      "child:start",
      "child:stop",
      "parent:stop",
    ]);
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
