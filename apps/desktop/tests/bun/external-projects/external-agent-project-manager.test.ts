import { expect, test } from "bun:test";

import type { Thread } from "@llm-space/core";

import { duplicateExternalAgentProjectThreadState } from "../../../src/bun/external-projects/external-agent-project-manager";

test("duplicates editable state into a fresh Session for every Runtime Profile", () => {
  for (const profile of [
    { version: 1, type: "desktopDirect" },
    { version: 1, type: "desktopSandbox" },
    {
      version: 1,
      type: "localServer",
      artifactFingerprint: "a".repeat(64),
      serverSessionId: "server-session"
    }
  ] as const) {
    const messages = [{
      id: `message-${profile.type}`,
      role: "user" as const,
      content: [{ type: "text" as const, text: `keep-${profile.type}` }]
    }];
    const source: Thread = {
      title: profile.type,
      model: { provider: "fake", id: "model" },
      runtimeProfile: profile,
      context: {
        messages,
        snapshot: { variables: { prompt: { value: "run-only" } } }
      },
      runtimeSession: { budget: `do-not-copy-${profile.type}` },
      runtimeWorkingBase: {
        sessionId: `session-${profile.type}`,
        branchId: "branch-one",
        checkpointId: "checkpoint-one"
      },
      runHistory: [{
        id: `run-${profile.type}`,
        thread: { title: "Historical", context: { messages } },
        timestamp: 1
      }]
    };

    const duplicate = duplicateExternalAgentProjectThreadState(source);

    expect(duplicate.title).toBe(`${profile.type} copy`);
    expect(duplicate.context?.messages).toEqual(messages);
    expect(duplicate.context?.snapshot).toBeUndefined();
    expect(duplicate.model).toEqual(source.model);
    expect(duplicate.runtimeSession).toBeUndefined();
    expect(duplicate.runtimeWorkingBase).toBeUndefined();
    expect(duplicate.runHistory).toBeUndefined();
    expect(duplicate.evaluations).toBeUndefined();
    expect(duplicate.sandboxAttachments).toBeUndefined();
    expect(duplicate.runtimeProfile).toEqual(profile.type === "localServer"
      ? {
        version: 1,
        type: "localServer",
        artifactFingerprint: profile.artifactFingerprint
      }
      : { version: 1, type: profile.type });
  }
});
