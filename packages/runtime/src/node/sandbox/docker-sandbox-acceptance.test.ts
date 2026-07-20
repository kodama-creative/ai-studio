import { createHash } from "node:crypto";
import { expect, test } from "bun:test";

import {
  BunDockerCommandRunner,
  DockerSandboxProvider
} from "./docker-sandbox-provider";
import { SandboxWorkspaceLostError } from "../../runtime/sandbox/sandbox-workspace-lost-error";

const dockerTest = process.env.LLM_SPACE_DOCKER_ACCEPTANCE === "1"
  ? test
  : test.skip;

dockerTest("real Docker isolates, retains, reconstructs, and deletes a Sandbox Session", async () => {
  const runner = new BunDockerCommandRunner();
  const provider = new DockerSandboxProvider({ runner });
  const firstId = `acceptance-first-${crypto.randomUUID()}`;
  const secondId = `acceptance-second-${crypto.randomUUID()}`;
  const interruptedId = `acceptance-interrupted-${crypto.randomUUID()}`;
  const firstNames = _names(firstId);
  const interruptedNames = _names(interruptedId);
  const secret = `host-secret-${crypto.randomUUID()}`;
  const seed = [{
    path: "README.md",
    size: 5,
    fingerprint:
      "4a6689419b00b11700c9b6246bcfa8936c8f5e1e824db3a7e57030e2d1c1a684",
    contentBase64: "c2VlZAo="
  }];
  process.env.LLM_SPACE_SANDBOX_ACCEPTANCE_SECRET = secret;
  try {
    expect(await provider.readiness()).toEqual({ state: "ready" });
    const seedFingerprint = createHash("sha256").update(JSON.stringify(
      seed.map(file => ({
        path: file.path,
        size: file.size,
        fingerprint: file.fingerprint
      }))
    )).digest("hex");
    expect((await runner.run([
      "volume",
      "create",
      "--label",
      `llm-space.sandbox-seed=${seedFingerprint}`,
      interruptedNames.volume
    ])).exitCode).toBe(0);
    expect(await _rejection(provider.acquire({
      sessionId: interruptedId,
      seed
    }))).toBeInstanceOf(SandboxWorkspaceLostError);

    const first = await provider.acquire({
      sessionId: firstId,
      seed
    });
    expect(await first.executionEnv.readTextFile("README.md"))
      .toEqual({ ok: true, value: "seed\n" });

    const staged = await first.stageTurn({
      stagingId: "staging-one",
      turnId: "turn-one",
      attachments: [{
        id: "attachment-one",
        name: "notes.txt",
        fingerprint:
          "ab5aa97074c454a0632057e704220d9a6678fbf773a0a5806fc09b8173b07309",
        content: new TextEncoder().encode("notes")
      }]
    });
    expect(await first.executionEnv.readTextFile(staged[0]!.path))
      .toEqual({ ok: true, value: "notes" });
    expect(await first.workspaceManifest()).toEqual([
      expect.stringMatching(/^\.llm-space-attachments-[0-9a-f]{24}\/$/),
      "README.md"
    ]);

    const failedTurnId = "atomic-staging-failure";
    const failedStagingId = "atomic-failure-staging";
    const failedStagingKey = createHash("sha256").update(failedStagingId)
      .digest("hex")
      .slice(0, 24);
    const failedDestination =
      `/workspace/.llm-space-attachments-${failedStagingKey}`;
    expect(await first.executionEnv.createDir(failedDestination))
      .toEqual({ ok: true, value: undefined });
    expect(await first.executionEnv.writeFile(
      `${failedDestination}/existing.txt`,
      "keep"
    )).toEqual({ ok: true, value: undefined });
    expect(await _rejection(first.stageTurn({
      stagingId: failedStagingId,
      turnId: failedTurnId,
      attachments: [{
        id: "atomic-failure-attachment",
        name: "notes.txt",
        fingerprint:
          "ab5aa97074c454a0632057e704220d9a6678fbf773a0a5806fc09b8173b07309",
        content: new TextEncoder().encode("notes")
      }]
    }))).toMatchObject({ message: expect.stringMatching(/EEXIST|ENOTEMPTY/) });
    expect(await first.executionEnv.exists(`${failedDestination}/notes.txt`))
      .toEqual({ ok: true, value: false });
    expect(await first.executionEnv.readTextFile(
      `${failedDestination}/existing.txt`
    )).toEqual({ ok: true, value: "keep" });

    const emptyCollisionStagingId = "empty-final-collision";
    const emptyCollisionStagingKey = createHash("sha256")
      .update(emptyCollisionStagingId)
      .digest("hex")
      .slice(0, 24);
    const emptyCollisionDestination =
      `/workspace/.llm-space-attachments-${emptyCollisionStagingKey}`;
    expect(await first.executionEnv.createDir(emptyCollisionDestination))
      .toEqual({ ok: true, value: undefined });
    expect(await _rejection(first.stageTurn({
      stagingId: emptyCollisionStagingId,
      turnId: "empty-collision-turn",
      attachments: [{
        id: "empty-collision-attachment",
        name: "notes.txt",
        fingerprint:
          "ab5aa97074c454a0632057e704220d9a6678fbf773a0a5806fc09b8173b07309",
        content: new TextEncoder().encode("notes")
      }]
    }))).toMatchObject({
      message: expect.stringContaining(
        "Sandbox attachment destination already exists"
      )
    });
    expect(await first.executionEnv.exists(emptyCollisionDestination))
      .toEqual({ ok: true, value: true });

    const racingStagingId = "racing-final-collision";
    const racingStagingKey = createHash("sha256")
      .update(racingStagingId)
      .digest("hex")
      .slice(0, 24);
    const racingTemporary =
      `/workspace/.llm-space-staging-${racingStagingKey}.tmp`;
    const racingDestination =
      `/workspace/.llm-space-attachments-${racingStagingKey}`;
    const collisionRace = first.executionEnv.exec(
      `while [ ! -d '${racingTemporary}' ]; do sleep 0.01; done; mkdir '${racingDestination}'`
    );
    expect(await _rejection(first.stageTurn({
      stagingId: racingStagingId,
      turnId: "racing-collision-turn",
      attachments: [{
        id: "racing-collision-attachment",
        name: "large.bin",
        fingerprint: "b".repeat(64),
        content: new Uint8Array(8 * 1024 * 1024)
      }]
    }))).toMatchObject({
      message: expect.stringContaining(
        "Sandbox attachment destination already exists"
      )
    });
    expect(await collisionRace).toMatchObject({
      ok: true,
      value: { exitCode: 0 }
    });
    expect(await first.executionEnv.exists(racingDestination))
      .toEqual({ ok: true, value: true });

    const interruptedTurnId = "interrupted-turn";
    const interruptedStagingId = "interrupted-staging";
    const interruptedStagingKey = createHash("sha256")
      .update(interruptedStagingId)
      .digest("hex")
      .slice(0, 24);
    const interruptedTemporary =
      `/workspace/.llm-space-staging-${interruptedStagingKey}.tmp`;
    expect(await first.executionEnv.createDir(interruptedTemporary))
      .toEqual({ ok: true, value: undefined });
    expect(await first.executionEnv.writeFile(
      `${interruptedTemporary}/.llm-space-staging-owner`,
      interruptedStagingId
    )).toEqual({ ok: true, value: undefined });
    expect(await first.executionEnv.writeFile(
      `${interruptedTemporary}/orphan.txt`,
      "orphan"
    )).toEqual({ ok: true, value: undefined });
    await first.discardTurn({
      stagingId: interruptedStagingId,
      turnId: interruptedTurnId
    });
    expect(await first.executionEnv.exists(interruptedTemporary))
      .toEqual({ ok: true, value: false });

    const collisionStagingId = "source-owned-staging-collision";
    const collisionStagingKey = createHash("sha256")
      .update(collisionStagingId)
      .digest("hex")
      .slice(0, 24);
    const collisionTemporary =
      `/workspace/.llm-space-staging-${collisionStagingKey}.tmp`;
    expect(await first.executionEnv.createDir(collisionTemporary))
      .toEqual({ ok: true, value: undefined });
    expect(await first.executionEnv.writeFile(
      `${collisionTemporary}/source-owned.txt`,
      "keep"
    )).toEqual({ ok: true, value: undefined });
    expect(await _rejection(first.stageTurn({
      stagingId: collisionStagingId,
      turnId: "collision-turn",
      attachments: [{
        id: "collision-attachment",
        name: "notes.txt",
        fingerprint:
          "ab5aa97074c454a0632057e704220d9a6678fbf773a0a5806fc09b8173b07309",
        content: new TextEncoder().encode("notes")
      }]
    }))).toMatchObject({ message: expect.stringMatching(/EEXIST/) });
    await first.discardTurn({
      stagingId: collisionStagingId,
      turnId: "collision-turn"
    });
    expect(await first.executionEnv.readTextFile(
      `${collisionTemporary}/source-owned.txt`
    )).toEqual({ ok: true, value: "keep" });

    expect(await first.executionEnv.writeFile("generated.txt", "durable"))
      .toEqual({ ok: true, value: undefined });
    const chunks: string[] = [];
    expect(await first.executionEnv.exec("printf streamed", {
      onStdout: chunk => { chunks.push(chunk); }
    })).toEqual({
      ok: true,
      value: { stdout: "streamed", stderr: "", exitCode: 0 }
    });
    expect(chunks.join("")).toBe("streamed");
    const abortController = new AbortController();
    const aborted = first.executionEnv.exec(
      "sleep 30; printf escaped > aborted.txt",
      { abortSignal: abortController.signal }
    );
    setTimeout(() => { abortController.abort(); }, 100);
    expect(await aborted).toMatchObject({
      ok: false,
      error: { code: "aborted" }
    });
    await Bun.sleep(300);
    expect(await first.executionEnv.exists("aborted.txt"))
      .toEqual({ ok: true, value: false });
    expect(await first.executionEnv.exec("sleep 2", { timeout: 0.1 }))
      .toMatchObject({ ok: false, error: { code: "timeout" } });
    const network = await first.executionEnv.exec(
      `bun -e 'fetch("https://example.com").then(() => process.exit(7)).catch(() => console.log("blocked"))'`
    );
    expect(network).toMatchObject({
      ok: true,
      value: { exitCode: 0, stdout: expect.stringContaining("blocked") }
    });

    const second = await provider.acquire({ sessionId: secondId, seed: [] });
    expect(await second.executionEnv.readTextFile("generated.txt"))
      .toMatchObject({ ok: false, error: { code: "not_found" } });

    const inspection = await runner.run([
      "inspect",
      "--format",
      "{{.HostConfig.NetworkMode}} {{.HostConfig.ReadonlyRootfs}} {{.Config.User}} {{json .Config.Env}}",
      firstNames.container
    ]);
    expect(inspection.exitCode).toBe(0);
    expect(inspection.stdout).toContain("none true 1000:1000");
    expect(inspection.stdout).not.toContain(secret);

    await provider.stop(firstId);
    const reconnected = await provider.acquire({
      expectedExisting: true,
      sessionId: firstId,
      seed
    });
    expect(await reconnected.executionEnv.readTextFile("generated.txt"))
      .toEqual({ ok: true, value: "durable" });

    expect((await runner.run([
      "rm", "--force", firstNames.container
    ])).exitCode).toBe(0);
    const reconstructed = await provider.acquire({
      expectedExisting: true,
      sessionId: firstId,
      seed
    });
    expect(await reconstructed.executionEnv.readTextFile("generated.txt"))
      .toEqual({ ok: true, value: "durable" });

    expect((await runner.run([
      "rm", "--force", firstNames.container
    ])).exitCode).toBe(0);
    expect((await runner.run([
      "volume", "rm", "--force", firstNames.volume
    ])).exitCode).toBe(0);
    expect(await _rejection(provider.acquire({
      expectedExisting: true,
      sessionId: firstId,
      seed
    }))).toBeInstanceOf(SandboxWorkspaceLostError);
  } finally {
    delete process.env.LLM_SPACE_SANDBOX_ACCEPTANCE_SECRET;
    await Promise.allSettled([
      provider.delete(firstId),
      provider.delete(secondId),
      provider.delete(interruptedId)
    ]);
  }
}, 120_000);

function _names(sessionId: string) {
  const key = createHash("sha256").update(sessionId).digest("hex")
    .slice(0, 24);
  return {
    container: `llm-space-sandbox-${key}`,
    volume: `llm-space-sandbox-workspace-${key}`
  };
}

async function _rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error("Expected operation to reject");
}
