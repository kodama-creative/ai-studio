import { describe, expect, test } from "bun:test";

import {
  type DockerCommandOptions,
  type DockerCommandResult,
  type DockerCommandRunner,
  DockerSandboxProvider
} from "./docker-sandbox-provider";
import { SandboxWorkspaceLostError } from "../../runtime/sandbox/sandbox-workspace-lost-error";

describe("DockerSandboxProvider", () => {
  test("creates one fixed isolated Session, stages a Turn, and deletes it", async () => {
    const runner = new FakeDockerRunner();
    const provider = new DockerSandboxProvider({ runner });

    expect(await provider.readiness()).toEqual({ state: "ready" });
    const session = await provider.acquire({
      sessionId: "session-one",
      seed: [{
        path: "README.md",
        size: 5,
        fingerprint:
          "4a6689419b00b11700c9b6246bcfa8936c8f5e1e824db3a7e57030e2d1c1a684",
        contentBase64: "c2VlZAo="
      }]
    });
    expect(runner.createdArguments).toEqual(expect.arrayContaining([
      "--network",
      "none",
      "--read-only",
      "--user",
      "1000:1000",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges"
    ]));
    expect(runner.createdArguments.join(" ")).not.toContain("/Users/");
    expect(runner.helperOperations).toEqual(["seed"]);

    const staged = await session.stageTurn({
      turnId: "turn-one",
      attachments: [{
        id: "attachment-one",
        name: "notes.txt",
        fingerprint:
          "ab5aa97074c454a0632057e704220d9a6678fbf773a0a5806fc09b8173b07309",
        content: new TextEncoder().encode("notes")
      }]
    });
    expect(staged).toEqual([expect.objectContaining({
      id: "attachment-one",
      name: "notes.txt",
      path: expect.stringMatching(/^\/workspace\//),
      size: 5
    })]);
    expect(await session.workspaceManifest()).toEqual([
      "README.md",
      "attachments/"
    ]);
    expect(await session.executionEnv.writeFile("generated.txt", "hello"))
      .toEqual({ ok: true, value: undefined });
    expect(await session.executionEnv.readTextFile("generated.txt"))
      .toEqual({ ok: true, value: "hello" });
    const streamed: string[] = [];
    expect(await session.executionEnv.exec("printf hello", {
      onStdout: chunk => { streamed.push(chunk); }
    })).toEqual({
      ok: true,
      value: { stdout: "hello", stderr: "", exitCode: 0 }
    });
    expect(streamed).toEqual(["hello"]);

    await provider.delete("session-one");
    expect(runner.deletedContainer).toBe(true);
    expect(runner.deletedVolume).toBe(true);
  });

  test("does not recreate an expected Session whose volume is missing", async () => {
    const runner = new FakeDockerRunner();
    runner.imageExists = true;
    const provider = new DockerSandboxProvider({ runner });

    expect(await _rejection(provider.acquire({
      expectedExisting: true,
      sessionId: "lost-session",
      seed: []
    }))).toBeInstanceOf(SandboxWorkspaceLostError);
    expect(runner.createdVolume).toBe(false);
  });

  test("rejects an existing Session whose seed marker is missing", async () => {
    const runner = new FakeDockerRunner();
    runner.imageExists = true;
    runner.volumeExists = true;
    const provider = new DockerSandboxProvider({ runner });

    expect(await _rejection(provider.acquire({
      expectedExisting: true,
      sessionId: "corrupt-session",
      seed: []
    }))).toBeInstanceOf(SandboxWorkspaceLostError);
    expect(runner.helperOperations).toEqual(["seedFingerprint"]);
  });

  test("rejects an oversized Turn before Docker receives partial staging", async () => {
    const runner = new FakeDockerRunner();
    const provider = new DockerSandboxProvider({ runner });
    const session = await provider.acquire({
      sessionId: "bounded-session",
      seed: []
    });

    expect(await _rejection(session.stageTurn({
      turnId: "turn-large",
      attachments: Array.from({ length: 21 }, (_, index) => ({
        id: `attachment-${index}`,
        name: `file-${index}.txt`,
        fingerprint: `fingerprint-${index}`,
        content: new Uint8Array()
      }))
    }))).toMatchObject({ message: "A Turn supports at most 20 attachments" });
    expect(runner.helperOperations).toEqual(["seed"]);
  });
});

class FakeDockerRunner implements DockerCommandRunner {
  imageExists = false;
  volumeExists = false;
  containerExists = false;
  createdVolume = false;
  deletedContainer = false;
  deletedVolume = false;
  createdArguments: string[] = [];
  helperOperations: string[] = [];
  files = new Map<string, string>();
  seedFingerprint: string | null = null;

  async run(
    arguments_: readonly string[],
    options: DockerCommandOptions = {}
  ): Promise<DockerCommandResult> {
    const [command, subject] = arguments_;
    if (command === "version") { return _result(0, "26.1.0\n"); }
    if (command === "image" && subject === "inspect") {
      return _result(this.imageExists ? 0 : 1);
    }
    if (command === "build") {
      this.imageExists = true;
      return _result(0);
    }
    if (command === "volume" && subject === "inspect") {
      return _result(this.volumeExists ? 0 : 1);
    }
    if (command === "volume" && subject === "create") {
      this.volumeExists = true;
      this.createdVolume = true;
      return _result(0);
    }
    if (command === "container" && subject === "inspect") {
      return _result(this.containerExists ? 0 : 1);
    }
    if (command === "create") {
      this.createdArguments = [...arguments_];
      this.containerExists = true;
      return _result(0);
    }
    if (command === "start" || command === "stop") { return _result(0); }
    if (command === "rm") {
      this.deletedContainer = true;
      this.containerExists = false;
      return _result(0);
    }
    if (command === "volume" && subject === "rm") {
      this.deletedVolume = true;
      this.volumeExists = false;
      return _result(0);
    }
    if (command === "exec") {
      const input = JSON.parse(options.stdin ?? "{}") as {
        attachments?: Array<{ contentBase64: string; fingerprint: string; id: string; name: string; }>;
        operation: string;
      };
      this.helperOperations.push(input.operation);
      if (input.operation === "seed") {
        this.seedFingerprint = (input as {
          fingerprint: string;
        } & typeof input).fingerprint;
      }
      if (input.operation === "seedFingerprint") {
        if (!this.seedFingerprint) {
          return _result(1, "", "Sandbox seed marker is missing");
        }
        return _result(0, _terminal(this.seedFingerprint));
      }
      if (input.operation === "writeFile") {
        const file = input as { contentText?: string; path: string; } & typeof input;
        this.files.set(file.path, file.contentText ?? "");
        return _result(0, _terminal(undefined));
      }
      if (input.operation === "readTextFile") {
        const file = input as { path: string; } & typeof input;
        return _result(0, _terminal(this.files.get(file.path) ?? ""));
      }
      if (input.operation === "exec") {
        const output = `${[
          JSON.stringify({ type: "stdout", chunk: "hello" }),
          JSON.stringify({
            type: "result",
            ok: true,
            value: { stdout: "hello", stderr: "", exitCode: 0 }
          })
        ].join("\n")}\n`;
        options.onStdout?.(output);
        return _result(0, output);
      }
      if (input.operation === "stageTurn") {
        return _result(0, `${JSON.stringify({
          type: "result",
          ok: true,
          value: input.attachments?.map(attachment => ({
            id: attachment.id,
            name: attachment.name,
            fingerprint: attachment.fingerprint,
            path: `/workspace/attachments/turn-one/${attachment.name}`,
            size: Buffer.from(attachment.contentBase64, "base64").byteLength
          })) ?? []
        })}\n`);
      }
      if (input.operation === "manifest") {
        return _result(0, `${JSON.stringify({
          type: "result",
          ok: true,
          value: ["README.md", "attachments/"]
        })}\n`);
      }
      return _result(0, `${JSON.stringify({
        type: "result",
        ok: true,
        value: null
      })}\n`);
    }
    throw new Error(`Unexpected Docker command: ${arguments_.join(" ")}`);
  }
}

function _terminal(value: unknown): string {
  return `${JSON.stringify({ type: "result", ok: true, value })}\n`;
}

function _result(
  exitCode: number,
  stdout = "",
  stderr = ""
): DockerCommandResult {
  return { exitCode, stdout, stderr };
}

async function _rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error("Expected operation to reject");
}
