import { describe, expect, test } from "bun:test";

import { verifyBunDiBundle } from "./verify-bun-di-bundle";

describe("verifyBunDiBundle", () => {
  test("accepts legacy Inversify parameter decorators", () => {
    expect(() =>
      verifyBunDiBundle(`
        var __legacyDecorateParamTS = () => {};
        __legacyDecorateParamTS(0, inject(DesktopPlaygroundApplication));
      `)
    ).not.toThrow();
  });

  test("rejects a bundle containing only stage-3 class decorators", () => {
    expect(() =>
      verifyBunDiBundle(`
        ThreadSharingApplication = __decorateElement(
          [], 0, "ThreadSharingApplication", [injectable()]
        );
      `)
    ).toThrow("dropped Inversify parameter decorators");
  });
});
