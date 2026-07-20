import type { ExecutionEnv } from "@earendil-works/pi-agent-core";

import type {
  CompiledSandboxWorkspaceFile
} from "../agent/agent-project-snapshot";

export interface SandboxTurnEnvironment {
  readonly executionEnv: ExecutionEnv;
  readonly workspaceManifest: readonly string[];
}

export type SandboxProviderReadiness =
  | { readonly message: string; readonly state: "unavailable"; }
  | { readonly state: "ready"; };

export interface SandboxAttachmentInput {
  readonly content: Uint8Array;
  readonly fingerprint: string;
  readonly id: string;
  readonly mimeType?: string;
  readonly name: string;
}

export interface StagedSandboxAttachment {
  readonly fingerprint: string;
  readonly id: string;
  readonly mimeType?: string;
  readonly name: string;
  readonly path: string;
  readonly size: number;
}

export interface SandboxProviderSession {
  readonly executionEnv: ExecutionEnv;
  readonly sessionId: string;
  stageTurn(input: {
    readonly attachments: readonly SandboxAttachmentInput[];
    readonly turnId: string;
  }): Promise<readonly StagedSandboxAttachment[]>;
  workspaceManifest(): Promise<readonly string[]>;
}

export interface SandboxProvider {
  readiness(): Promise<SandboxProviderReadiness>;
  acquire(input: {
    readonly expectedExisting?: boolean;
    readonly seed: readonly CompiledSandboxWorkspaceFile[];
    readonly sessionId: string;
  }): Promise<SandboxProviderSession>;
  stop(sessionId: string): Promise<void>;
  delete(sessionId: string): Promise<void>;
}
