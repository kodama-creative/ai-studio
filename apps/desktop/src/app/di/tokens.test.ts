import { describe, expect, test } from "bun:test";

import { rendererToken } from "./tokens";

describe("rendererToken", () => {
  test("builds stable symbols under an explicit renderer namespace", () => {
    expect(rendererToken("models", "catalog")).toBe(
      rendererToken("models", "catalog")
    );
    expect(rendererToken("models", "catalog").description).toBe(
      "@llm-space/desktop/renderer/models/catalog"
    );
  });

  test("rejects an absent namespace or name", () => {
    expect(() => rendererToken("", "catalog")).toThrow();
    expect(() => rendererToken("models", "")).toThrow();
  });
});
