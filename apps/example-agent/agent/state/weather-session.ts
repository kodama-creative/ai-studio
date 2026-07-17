import { defineState } from "@llm-space/runtime/state";
import { Type } from "typebox";

export default defineState({
  name: "example.weather-session",
  version: 1,
  schema: Type.Object({
    requestedCities: Type.Array(Type.String())
  }),
  initial: { requestedCities: [] }
});
