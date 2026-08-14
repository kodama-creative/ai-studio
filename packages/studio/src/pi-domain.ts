import type { JsonValue, Message } from "@llm-space/core";
import type { PiSessionSnapshot, RuntimeTool } from "@llm-space/pi-runtime";

export const STUDIO_PI_RUNTIME_FORMAT_VERSION = 1;
export const STUDIO_PI_LANE = "main";

/** UI-editable state; committed transcript content remains authoritative in Pi. */
export interface StudioConversation {
  readonly messages: readonly Message[];
  readonly state: Readonly<Record<string, JsonValue>>;
}

export interface StudioToolSnapshot {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema?: Readonly<Record<string, unknown>>;
  readonly implementationId: string;
  readonly replay: "never" | "safe";
  readonly hostBinding: Readonly<Record<string, unknown>>;
}

/** Product-facing Agent metadata used to freeze a Pi RuntimeBinding. */
export interface StudioAgentSnapshot {
  readonly agentSpecId: string;
  readonly sourceRevision: string;
  readonly model: string;
  readonly instructions: readonly string[];
  readonly tools: readonly StudioToolSnapshot[];
}

/** Current source-backed Agent plus host executors resolved by Studio. */
export interface StudioExecutableAgent {
  readonly snapshot: StudioAgentSnapshot;
  readonly tools: ReadonlyMap<string, RuntimeTool>;
}

/** Pi execution identity embedded by both Playgrounds and Experiments. */
export interface StudioPiIdentity {
  readonly sessionId: string;
  readonly lane: typeof STUDIO_PI_LANE;
  readonly leafId: string | null;
  readonly operationId?: string;
  readonly runtimeFormatVersion: typeof STUDIO_PI_RUNTIME_FORMAT_VERSION;
}

export interface StudioOperationReceipt {
  readonly sessionId: string;
  readonly operationId: string;
}

export interface StudioStepInput {
  readonly commandId: string;
  readonly expectedActionId: string;
  readonly kind: "model" | "tool";
}

export interface StudioContinueInput {
  readonly commandId: string;
}

/** Stable Studio ordering/evaluation target over one Pi operation. */
export interface StudioOperationReference {
  readonly sessionId: string;
  readonly lane: typeof STUDIO_PI_LANE;
  readonly operationId: string;
  readonly leafId?: string;
  readonly agentSnapshot: StudioAgentSnapshot;
  readonly relation: "executed" | "inherited";
}

export interface StudioSessionUpdate {
  readonly snapshot: PiSessionSnapshot;
  readonly conversation: StudioConversation;
}
