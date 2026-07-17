import { describe, expect, test } from "bun:test";
import { Type } from "typebox";

import { defineState, isStateDefinition } from "./state";

describe("defineState", () => {
  test("preserves typed authored identity while requiring managed execution", () => {
    const state = defineState({
      name: "demo.profile",
      version: 2,
      schema: Type.Object({ displayName: Type.String() }),
      initial: { displayName: "Ada" }
    });

    expect(isStateDefinition(state)).toBe(true);
    expect(state.initial.displayName).toBe("Ada");
    expect(() => state.get()).toThrow("outside authored Runtime execution");
    expect(() => {
      state.update(current => ({
        displayName: current.displayName.toUpperCase()
      }));
    }).toThrow("outside authored Runtime execution");
  });

  test("rejects schema-incompatible initial values at typecheck", () => {
    const typecheck = () => defineState({
      name: "demo.count",
      version: 1,
      schema: Type.Object({ count: Type.Number() }),
      // @ts-expect-error initial values are inferred from the TypeBox schema
      initial: { count: "one" }
    });
    expect(typecheck).toBeFunction();
  });
});
