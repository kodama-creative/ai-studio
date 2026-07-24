import type { AgentSessionContext } from "../../shared/agent-session-context";

export const APPROVAL_REQUIREMENT_MODES = [
  "never",
  "always",
  "once"
] as const;

export type ApprovalRequirementMode =
  typeof APPROVAL_REQUIREMENT_MODES[number];

export interface ApprovalDeniedRequirement {
  readonly reason: string;
  readonly type: "deny";
}

export type ApprovalRequirement =
  | ApprovalDeniedRequirement
  | ApprovalRequirementMode;

export interface ApprovalContext<TInput = unknown> {
  readonly callId: string;
  readonly session: AgentSessionContext;
  readonly toolInput: Readonly<TInput>;
  readonly toolName: string;
}

export type ApprovalPolicy<TInput = unknown> = (
  context: ApprovalContext<TInput>
) => ApprovalRequirement | Promise<ApprovalRequirement>;

export type Approval<TInput = unknown> =
  | ApprovalPolicy<TInput>
  | ApprovalRequirement;

export function isApprovalRequirement(
  value: unknown
): value is ApprovalRequirement {
  const denied = value && typeof value === "object" && !Array.isArray(value)
    ? value as { reason?: unknown; type?: unknown; }
    : null;
  return (
    value === "never"
    || value === "always"
    || value === "once"
    || Boolean(
      denied
      && Object.getPrototypeOf(denied) === Object.prototype
      && Reflect.ownKeys(denied).length === 2
      && Object.hasOwn(denied, "type")
      && Object.hasOwn(denied, "reason")
      && denied.type === "deny"
      && typeof denied.reason === "string"
      && denied.reason.length > 0
      && denied.reason.length <= 1_024
    )
  );
}
