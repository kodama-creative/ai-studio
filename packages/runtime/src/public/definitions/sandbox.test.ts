import { describe, expect, test } from "bun:test";

import { defineSandbox, isSandboxDefinition } from "./sandbox";

describe("defineSandbox", () => {
  test("declares only the abstract zero-configuration Sandbox requirement", () => {
    const sandbox = defineSandbox({});

    expect(isSandboxDefinition(sandbox)).toBe(true);
    expect(Object.keys(sandbox)).toEqual([]);
    expect(() => defineSandbox({ provider: "docker" } as never)).toThrow(
      "defineSandbox({}) does not accept configuration"
    );
  });
});
