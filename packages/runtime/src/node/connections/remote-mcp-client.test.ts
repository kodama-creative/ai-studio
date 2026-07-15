import { afterEach, describe, expect, test } from "bun:test";

import { RemoteMcpClient } from "./remote-mcp-client";

const PROCESSES: Bun.Subprocess[] = [];

afterEach(async () => {
  await Promise.all(
    PROCESSES.splice(0).map(async process => {
      process.kill();
      await process.exited;
    })
  );
});

describe("RemoteMcpClient", () => {
  test("lists and calls tools over Streamable HTTP", async () => {
    const port = 18_000 + Math.floor(Math.random() * 10_000);
    const process = Bun.spawn(
      ["bun", ".agents/kaizen-loop/fixtures/remote-mcp-fixture.mjs"],
      {
        cwd: new URL("../../../../../", import.meta.url).pathname,
        env: { ..._processEnv(), PORT: String(port) },
        stdout: "pipe",
        stderr: "pipe"
      }
    );
    PROCESSES.push(process);
    await _waitUntilReady(process);

    const client = await RemoteMcpClient.connect({
      url: `http://127.0.0.1:${port}/mcp`,
      headers: {}
    });
    try {
      const tools = await client.listTools();
      expect(tools.map(tool => tool.name)).toEqual(["remote_echo"]);
      const result = await client.callTool("remote_echo", {});
      expect(result).toEqual({
        contentText: "remote fixture ok",
        isError: false
      });
    } finally {
      await client.close();
    }
  });

  test("cancels an in-flight Streamable HTTP tools/call", async () => {
    const port = 18_000 + Math.floor(Math.random() * 10_000);
    const process = Bun.spawn(
      ["bun", ".agents/kaizen-loop/fixtures/remote-mcp-fixture.mjs"],
      {
        cwd: new URL("../../../../../", import.meta.url).pathname,
        env: {
          ..._processEnv(),
          PORT: String(port),
          CALL_DELAY_MS: "5000"
        },
        stdout: "pipe",
        stderr: "pipe"
      }
    );
    PROCESSES.push(process);
    await _waitUntilReady(process);

    const client = await RemoteMcpClient.connect({
      url: `http://127.0.0.1:${port}/mcp`,
      headers: {}
    });
    try {
      const controller = new AbortController();
      const call = client.callTool("remote_echo", {}, controller.signal);
      await Bun.sleep(50);
      controller.abort(new Error("cancel fixture call"));

      await expect(call).rejects.toThrow("cancel fixture call");
    } finally {
      await client.close();
    }
  });
});

function _processEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  );
}

async function _waitUntilReady(process: Bun.Subprocess): Promise<void> {
  const reader = (process.stdout as ReadableStream<Uint8Array>).getReader();
  const timeout = setTimeout(() => { process.kill(); }, 5_000);
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) { throw new Error("MCP fixture exited before startup"); }
      if (new TextDecoder().decode(chunk.value).includes("listening")) { return; }
    }
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
}
