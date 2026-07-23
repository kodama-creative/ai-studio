export class UnsupportedRuntimeSessionSchemaError extends Error {
  readonly code = "unsupportedSessionSchema" as const;
  readonly schemaVersion: unknown;

  constructor(schemaVersion: unknown) {
    super(`Unsupported Runtime Session schema version: ${String(schemaVersion)}`);
    this.name = "UnsupportedRuntimeSessionSchemaError";
    this.schemaVersion = schemaVersion;
  }
}
