export const MODULE_EXTENSIONS = [
  ".cts",
  ".mts",
  ".cjs",
  ".mjs",
  ".ts",
  ".js",
] as const;

export function moduleBaseName(name: string): string | null {
  if (/\.d\.(?:cts|mts|ts)$/.test(name)) return null;
  const extension = MODULE_EXTENSIONS.find((candidate) =>
    name.endsWith(candidate)
  );
  return extension === undefined ? null : name.slice(0, -extension.length);
}
