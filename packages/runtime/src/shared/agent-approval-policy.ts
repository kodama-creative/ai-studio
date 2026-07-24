import type { ApprovalPolicy } from "../public/definitions/approval";

export interface AgentHostApprovalPolicy {
  readonly id: string;
  readonly evaluate: ApprovalPolicy;
}
