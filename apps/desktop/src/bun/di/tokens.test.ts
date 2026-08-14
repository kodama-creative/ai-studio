import { describe, expect, test } from "bun:test";

import { desktopToken } from "./tokens";

describe("desktopToken", () => {
  test("builds stable symbols under an explicit namespace", () => {
    const token = desktopToken("github-account", "application");

    expect(Symbol.keyFor(token)).toBe(
      "@llm-space/desktop/github-account/application"
    );
    expect(desktopToken("github-account", "application")).toBe(token);
  });

  test("rejects an absent namespace or name", () => {
    expect(() => desktopToken("", "application")).toThrow(
      "Desktop token namespace and name are required."
    );
    expect(() => desktopToken("github-account", "")).toThrow(
      "Desktop token namespace and name are required."
    );
  });
});
