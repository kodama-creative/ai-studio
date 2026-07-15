import { type Static, Type } from "typebox";

export const JSONSchema = Type.Object({}, { additionalProperties: true });
export type JSONSchema = Static<typeof JSONSchema>;
