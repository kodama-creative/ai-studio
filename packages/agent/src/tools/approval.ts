import type { MaybePromise } from "../shared/types";

export type ApprovalStatus =
  | undefined
  | boolean
  | "not-applicable"
  | "approved"
  | "denied"
  | "user-approval"
  | { readonly type: "not-applicable"; readonly reason?: never }
  | { readonly type: "approved"; readonly reason?: string }
  | { readonly type: "denied"; readonly reason?: string }
  | { readonly type: "user-approval"; readonly reason?: never };

export interface ApprovalContext<TInput = Record<string, unknown>> {
  readonly approvedTools: ReadonlySet<string>;
  readonly toolInput?: TInput extends object ? Readonly<TInput> : TInput;
  readonly session: { readonly id: string };
  readonly callId: string;
  readonly toolName: string;
}

export type Approval<TInput = Record<string, unknown>> = (
  context: ApprovalContext<TInput>
) => MaybePromise<ApprovalStatus>;

export function always<TInput = unknown>(): Approval<TInput> {
  return () => "user-approval";
}

export function never<TInput = unknown>(): Approval<TInput> {
  return () => "not-applicable";
}

export function once<TInput = unknown>(): Approval<TInput> {
  return ({ approvedTools, toolName }) =>
    approvedTools.has(toolName) ? "not-applicable" : "user-approval";
}
