import {
  claimRuntimeToolApproval,
  decideRuntimeToolApproval,
  fingerprintRuntimeApprovalPrincipal,
  InMemorySessionStore,
  recoverRuntimeSession,
  RuntimeApprovalAuthorizationError,
  type RuntimeRunConfigurationSnapshot,
  runtimeRunHasParkedToolApprovals
} from "@llm-space/runtime/harness";
import { describe, expect, test } from "bun:test";

import type { AgentPrincipal } from "@llm-space/runtime";

const OWNER: AgentPrincipal = {
  issuer: "test",
  principalId: "owner",
  principalType: "user"
};
const OTHER: AgentPrincipal = {
  issuer: "test",
  principalId: "other",
  principalType: "user"
};
const REQUEST_FINGERPRINT = "a".repeat(64);
const RESUME_SCHEMA_FINGERPRINT = "b".repeat(64);
const SOURCE_POLICY_FINGERPRINT = "c".repeat(64);
const HOST_POLICY_FINGERPRINT = "d".repeat(64);

describe("durable tool approval", () => {
  test("only the bound principal can create a reusable Session grant", async () => {
    const store = new InMemorySessionStore();
    const started = await store.commit({
      sessionId: "session-approval",
      expectedVersion: null,
      mutations: [{
        type: "startRun",
        runId: "run-approval",
        messages: [],
        configuration: _configuration()
      }]
    });
    const principalFingerprint = await fingerprintRuntimeApprovalPrincipal(
      OWNER
    );
    const requested = await store.commit({
      sessionId: "session-approval",
      expectedVersion: started.version,
      mutations: [
        {
          type: "startOperation",
          runId: "run-approval",
          stepId: "run-approval:step:1",
          stepSequence: 1,
          transcriptMessageCount: 1,
          operationId: "run-approval:step:1:tool:call-approval",
          kind: "tool",
          toolCallId: "call-approval",
          requestFingerprint: REQUEST_FINGERPRINT,
          park: {
            parkId: "approval-request-one",
            reason: "Tool approval required",
            resumeSchemaFingerprint: RESUME_SCHEMA_FINGERPRINT
          }
        },
        {
          type: "requestToolApproval",
          requestId: "approval-request-one",
          runId: "run-approval",
          stepId: "run-approval:step:1",
          operationId: "run-approval:step:1:tool:call-approval",
          toolCallId: "call-approval",
          toolName: "transfer_funds",
          contributionId: "tool:tools/transfer_funds.ts",
          requestFingerprint: REQUEST_FINGERPRINT,
          agentSnapshotFingerprint: "agent-one",
          sourcePolicyFingerprint: SOURCE_POLICY_FINGERPRINT,
          sourceRequirement: "once",
          hostRequirement: "never",
          hostPolicyFingerprint: HOST_POLICY_FINGERPRINT,
          currentPrincipalFingerprint: principalFingerprint,
          initiatorPrincipalFingerprint: principalFingerprint,
          scope: "session",
          reason: "Transfers require approval"
        }
      ]
    });

    let unauthorizedError: unknown;
    try {
      await decideRuntimeToolApproval(store, {
        actor: { current: OTHER, initiator: OWNER },
        decision: "approved",
        expectedVersion: requested.version,
        requestId: "approval-request-one",
        runId: "run-approval",
        sessionId: "session-approval"
      });
    } catch (error) {
      unauthorizedError = error;
    }
    expect(unauthorizedError).toBeInstanceOf(
      RuntimeApprovalAuthorizationError
    );

    const approved = await decideRuntimeToolApproval(store, {
      actor: { current: OWNER, initiator: OWNER },
      decision: "approved",
      expectedVersion: requested.version,
      requestId: "approval-request-one",
      runId: "run-approval",
      sessionId: "session-approval"
    });
    expect(approved.snapshot.approvalLedger).toMatchObject({
      schemaVersion: 1,
      requests: [{
        id: "approval-request-one",
        state: "approved",
        scope: "session"
      }],
      grants: [{
        contributionId: "tool:tools/transfer_funds.ts",
        currentPrincipalFingerprint: principalFingerprint,
        initiatorPrincipalFingerprint: principalFingerprint,
        agentSnapshotFingerprint: "agent-one",
        sourcePolicyFingerprint: SOURCE_POLICY_FINGERPRINT,
        hostPolicyFingerprint: HOST_POLICY_FINGERPRINT
      }]
    });
  });

  test("keeps an approval parked until a Host claim crosses dispatch", async () => {
    const store = new InMemorySessionStore();
    const started = await store.commit({
      sessionId: "session-resume",
      expectedVersion: null,
      mutations: [{
        type: "startRun",
        runId: "run-resume",
        messages: [],
        configuration: _configuration()
      }]
    });
    const principalFingerprint = await fingerprintRuntimeApprovalPrincipal(
      OWNER
    );
    const operationId = "run-resume:step:1:tool:call-resume";
    const requestId = "approval-request-resume";
    const requested = await store.commit({
      sessionId: "session-resume",
      expectedVersion: started.version,
      mutations: [
        {
          type: "startOperation",
          runId: "run-resume",
          stepId: "run-resume:step:1",
          stepSequence: 1,
          transcriptMessageCount: 1,
          operationId,
          kind: "tool",
          toolCallId: "call-resume",
          requestFingerprint: REQUEST_FINGERPRINT,
          park: {
            parkId: requestId,
            reason: "Tool approval required",
            resumeSchemaFingerprint: RESUME_SCHEMA_FINGERPRINT
          }
        },
        {
          type: "requestToolApproval",
          requestId,
          runId: "run-resume",
          stepId: "run-resume:step:1",
          operationId,
          toolCallId: "call-resume",
          toolName: "transfer_funds",
          contributionId: "tool:tools/transfer_funds.ts",
          requestFingerprint: REQUEST_FINGERPRINT,
          agentSnapshotFingerprint: "agent-one",
          sourcePolicyFingerprint: SOURCE_POLICY_FINGERPRINT,
          sourceRequirement: "always",
          hostRequirement: "never",
          hostPolicyFingerprint: HOST_POLICY_FINGERPRINT,
          currentPrincipalFingerprint: principalFingerprint,
          initiatorPrincipalFingerprint: principalFingerprint,
          scope: "call"
        }
      ]
    });
    const approved = await decideRuntimeToolApproval(store, {
      actor: { current: OWNER, initiator: OWNER },
      decision: "approved",
      expectedVersion: requested.version,
      requestId,
      runId: "run-resume",
      sessionId: "session-resume"
    });
    expect(runtimeRunHasParkedToolApprovals(approved, "run-resume")).toBe(true);

    expect(await recoverRuntimeSession(store, "session-resume")).toMatchObject({
      status: "parked",
      session: { version: approved.version }
    });

    const claimed = await claimRuntimeToolApproval(store, {
      actor: { current: OWNER, initiator: OWNER },
      expectedVersion: approved.version,
      requestId,
      runId: "run-resume",
      sessionId: "session-resume"
    });
    expect(claimed.snapshot.operationLedger?.steps[0]?.operations[0])
      .toMatchObject({ state: "preCall" });
    expect(runtimeRunHasParkedToolApprovals(claimed, "run-resume")).toBe(false);
    expect(await recoverRuntimeSession(store, "session-resume")).toMatchObject({
      status: "outcomeUnknown",
      run: { state: "outcomeUnknown" }
    });
  });
});

function _configuration(): RuntimeRunConfigurationSnapshot {
  return {
    id: "configuration-approval",
    agentSnapshotFingerprint: "agent-one",
    contextFingerprint: "context-one",
    executionMode: "react",
    model: { provider: "test", id: "model" },
    toolConfigurationFingerprint: "tools-one"
  };
}
