import { describe, expect, test } from "bun:test";
import { Type } from "typebox";

import { defineOutput, isOutputDefinition } from "./output";

describe("defineOutput", () => {
  test("preserves a TypeBox-authored structured output contract", () => {
    const output = defineOutput({
      description: "A typed answer.",
      schema: Type.Object({ answer: Type.String() })
    });

    expect(isOutputDefinition(output)).toBe(true);
    expect(output.description).toBe("A typed answer.");
    expect(output.schema.properties.answer.type).toBe("string");
  });
});
