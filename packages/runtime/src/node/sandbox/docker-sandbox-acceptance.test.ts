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
  const firstNames = _names(firstId);
  const secret = `host-secret-${crypto.randomUUID()}`;
  process.env.LLM_SPACE_SANDBOX_ACCEPTANCE_SECRET = secret;
  try {
    expect(await provider.readiness()).toEqual({ state: "ready" });
    const first = await provider.acquire({
      sessionId: firstId,
      seed: [{
        path: "README.md",
        size: 5,
        fingerprint:
          "4a6689419b00b11700c9b6246bcfa8936c8f5e1e824db3a7e57030e2d1c1a684",
        contentBase64: "c2VlZAo="
      }]
    });
    expect(await first.executionEnv.readTextFile("README.md"))
      .toEqual({ ok: true, value: "seed\n" });

    const staged = await first.stageTurn({
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
      "README.md",
      "attachments/"
    ]);

    const failedTurnId = "atomic-staging-failure";
    const failedTurnKey = createHash("sha256").update(failedTurnId)
      .digest("hex")
      .slice(0, 24);
    const failedDestination = `/workspace/attachments/${failedTurnKey}`;
    expect(await first.executionEnv.createDir(failedDestination))
      .toEqual({ ok: true, value: undefined });
    expect(await first.executionEnv.writeFile(
      `${failedDestination}/existing.txt`,
      "keep"
    )).toEqual({ ok: true, value: undefined });
    expect(await _rejection(first.stageTurn({
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
      seed: []
    });
    expect(await reconnected.executionEnv.readTextFile("generated.txt"))
      .toEqual({ ok: true, value: "durable" });

    expect((await runner.run([
      "rm", "--force", firstNames.container
    ])).exitCode).toBe(0);
    const reconstructed = await provider.acquire({
      expectedExisting: true,
      sessionId: firstId,
      seed: []
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
      seed: []
    }))).toBeInstanceOf(SandboxWorkspaceLostError);
  } finally {
    delete process.env.LLM_SPACE_SANDBOX_ACCEPTANCE_SECRET;
    await Promise.allSettled([
      provider.delete(firstId),
      provider.delete(secondId)
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
