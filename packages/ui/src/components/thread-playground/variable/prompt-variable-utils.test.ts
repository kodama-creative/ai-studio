import { describe, expect, test } from "bun:test";

import type { ThreadVariable } from "@llm-space/core";

import {
  isBuiltInNameAvailable,
  isCustomNameAvailable,
  jsonError,
  jsonStatus,
  normalizeDirectoryPath,
  selectionExists,
  uniqueName,
} from "./prompt-variable-utils";

const variables: Record<string, ThreadVariable> = {
  current_date: { type: "currentDate", format: "iso" },
};
const customNames = new Set(["audience"]);

describe("prompt variable rules", () => {
  test("reports empty, valid, and invalid JSON without throwing", () => {
    expect(jsonError("")).toBeNull();
    expect(jsonStatus("")).toBe("(empty)");
    expect(jsonStatus('{ "enabled": true }')).toBe('{ "enabled": true }');
    expect(jsonStatus("{")).toBe("Invalid JSON");
    expect(jsonError("{")).toBeString();
  });

  test("keeps built-in and custom names in one collision domain", () => {
    expect(
      isBuiltInNameAvailable(
        "current_date",
        "current_date",
        variables,
        customNames
      )
    ).toBe(true);
    expect(
      isBuiltInNameAvailable("audience", "current_date", variables, customNames)
    ).toBe(false);
    expect(
      isCustomNameAvailable("current_date", "audience", variables, customNames)
    ).toBe(false);
    expect(
      isCustomNameAvailable("target_user", "audience", variables, customNames)
    ).toBe(true);
    expect(
      isCustomNameAvailable("not-valid", "audience", variables, customNames)
    ).toBe(false);
  });

  test("checks both selection stores and chooses a deterministic unique name", () => {
    expect(
      selectionExists({ kind: "builtIn", name: "current_date" }, variables, {
        audience: "developers",
      })
    ).toBe(true);
    expect(
      selectionExists({ kind: "custom", name: "audience" }, variables, {
        audience: "developers",
      })
    ).toBe(true);
    expect(
      selectionExists({ kind: "custom", name: "missing" }, variables, {
        audience: "developers",
      })
    ).toBe(false);
    expect(uniqueName("data", new Set(["data", "data_2", "data_3"]))).toBe(
      "data_4"
    );
  });

  test("normalizes trailing separators without changing filesystem roots", () => {
    expect(normalizeDirectoryPath("/")).toBe("/");
    expect(normalizeDirectoryPath("C:\\")).toBe("C:\\");
    expect(normalizeDirectoryPath("/tmp/project///")).toBe("/tmp/project");
    expect(normalizeDirectoryPath("  ~/project/  ")).toBe("~/project");
  });
});
