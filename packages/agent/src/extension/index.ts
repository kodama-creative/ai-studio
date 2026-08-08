import type { StandardSchemaV1 } from "@standard-schema/spec";

import { EXTENSION_MOUNT_BRAND } from "../shared/types";

export interface MountedExtension {
  readonly [EXTENSION_MOUNT_BRAND]: true;
}

export interface ExtensionHandle<
  S extends StandardSchemaV1 = StandardSchemaV1,
> {
  (values: StandardSchemaV1.InferInput<S>): MountedExtension;
  readonly config: StandardSchemaV1.InferOutput<S>;
  readonly schema: S;
}

export interface NoConfigExtensionHandle {
  (): MountedExtension;
  readonly config: Record<string, never>;
  readonly schema: undefined;
}

function _validate(
  schema: StandardSchemaV1 | undefined,
  values: unknown
): Record<string, unknown> {
  if (schema === undefined) return {};
  const result = schema["~standard"].validate(values ?? {});
  if (result instanceof Promise) {
    throw new Error("Extension config must validate synchronously.");
  }
  if (result.issues !== undefined) {
    throw new Error(
      `Invalid extension config: ${result.issues.map((issue) => issue.message).join("; ")}`
    );
  }
  return result.value as Record<string, unknown>;
}

export function defineExtension<const S extends StandardSchemaV1>(options: {
  readonly config: S;
}): ExtensionHandle<S>;
export function defineExtension(options?: {
  readonly config?: undefined;
}): NoConfigExtensionHandle;
export function defineExtension(options?: {
  readonly config?: StandardSchemaV1;
}): ExtensionHandle | NoConfigExtensionHandle {
  const schema = options?.config;
  let config: Record<string, unknown> | undefined;
  const handle = ((values?: unknown) => {
    config = _validate(schema, values);
    return { [EXTENSION_MOUNT_BRAND]: true };
  }) as ExtensionHandle & NoConfigExtensionHandle;
  Object.defineProperty(handle, "schema", { enumerable: true, value: schema });
  Object.defineProperty(handle, "config", {
    enumerable: true,
    get: () => config ?? _validate(schema, {}),
  });
  return handle;
}
