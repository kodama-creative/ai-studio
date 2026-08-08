import type { MaybePromise } from "../shared/types";

export interface SandboxCommandResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

export interface SandboxRunOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

export interface SandboxSession {
  run(
    command: string,
    options?: SandboxRunOptions
  ): Promise<SandboxCommandResult>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: string | Uint8Array): Promise<void>;
}

export interface SandboxBackend<
  TBootstrapOptions = Record<string, never>,
  TSessionOptions = Record<string, never>,
> {
  readonly kind: string;
  readonly bootstrapOptions?: TBootstrapOptions;
  readonly sessionOptions?: TSessionOptions;
  readonly [key: string]: unknown;
}

export type SandboxBootstrapUseFn<TOptions = Record<string, never>> = (
  options?: TOptions
) => Promise<SandboxSession>;
export type SandboxSessionUseFn<TOptions = Record<string, never>> = (
  options?: TOptions
) => Promise<SandboxSession>;

export interface SandboxBootstrapContext<TOptions = Record<string, never>> {
  readonly use: SandboxBootstrapUseFn<TOptions>;
}

export interface SandboxSessionContext<TOptions = Record<string, never>> {
  readonly ctx: unknown;
  readonly use: SandboxSessionUseFn<TOptions>;
}

export type SandboxRevalidationKeyFn = () => MaybePromise<string>;

interface SandboxDefinitionBase<
  TBootstrapOptions = Record<string, never>,
  TSessionOptions = Record<string, never>,
> {
  readonly backend?:
    | SandboxBackend<TBootstrapOptions, TSessionOptions>
    | (() => SandboxBackend<TBootstrapOptions, TSessionOptions>);
  readonly description?: string;
  onSession?(input: SandboxSessionContext<TSessionOptions>): MaybePromise<void>;
}

export interface SandboxDefinitionWithBootstrap<
  TBootstrapOptions = Record<string, never>,
  TSessionOptions = Record<string, never>,
> extends SandboxDefinitionBase<TBootstrapOptions, TSessionOptions> {
  bootstrap(
    input: SandboxBootstrapContext<TBootstrapOptions>
  ): MaybePromise<void>;
  readonly revalidationKey?: SandboxRevalidationKeyFn;
}

export interface SandboxDefinitionWithoutBootstrap<
  TBootstrapOptions = Record<string, never>,
  TSessionOptions = Record<string, never>,
> extends SandboxDefinitionBase<TBootstrapOptions, TSessionOptions> {
  bootstrap?: undefined;
  readonly revalidationKey?: never;
}

export type SandboxDefinition<
  TBootstrapOptions = Record<string, never>,
  TSessionOptions = Record<string, never>,
> =
  | SandboxDefinitionWithBootstrap<TBootstrapOptions, TSessionOptions>
  | SandboxDefinitionWithoutBootstrap<TBootstrapOptions, TSessionOptions>;

export function defineSandbox<
  TBootstrapOptions = Record<string, never>,
  TSessionOptions = Record<string, never>,
>(
  definition: SandboxDefinition<TBootstrapOptions, TSessionOptions>
): SandboxDefinition<TBootstrapOptions, TSessionOptions> {
  return definition;
}

export class SandboxTemplateNotProvisionedError extends Error {
  readonly backendName: string;
  readonly templateKey: string;

  constructor(input: {
    readonly backendName: string;
    readonly templateKey: string;
  }) {
    super(
      `Sandbox template "${input.templateKey}" is not provisioned for backend "${input.backendName}".`
    );
    this.name = "SandboxTemplateNotProvisionedError";
    this.backendName = input.backendName;
    this.templateKey = input.templateKey;
  }

  static is(error: unknown): error is SandboxTemplateNotProvisionedError {
    return (
      error instanceof SandboxTemplateNotProvisionedError ||
      (typeof error === "object" &&
        error !== null &&
        (error as { name?: unknown }).name ===
          "SandboxTemplateNotProvisionedError" &&
        typeof (error as { backendName?: unknown }).backendName === "string" &&
        typeof (error as { templateKey?: unknown }).templateKey === "string")
    );
  }
}
