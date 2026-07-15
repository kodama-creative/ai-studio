import { parse } from "best-effort-json-parser";

export function parseJSON(text: string): unknown {
  return parse(text);
}

export function deepCloneJSON<T>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}
