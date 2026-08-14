import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { openSshAcpConnection } from "./ssh-acp-connection";
import type { SshRemoteRuntimeConfig } from "./ssh-bootstrap-config";

const CONFIG: SshRemoteRuntimeConfig = {
  id: "remote:ssh-acp-test",
  name: "SSH ACP",
  host: "agent-host",
  extraArgs: [],
  remoteRepo: "",
  remoteInstallDir: "~/.llm-space/remote-runtime",
  remoteHome: "~/.llm-space-server",
  remoteServerPort: 39123,
  makeDefault: false,
};

test("opens official ACP over one direct SSH stdio process", async () => {
  const root = await mkdtemp(`${tmpdir()}/llm-space-ssh-acp-`);
  const script = resolve(root, "agent.ts");
  const closedMarker = resolve(root, "closed.txt");
  const acpUrl = pathToFileURL(resolve("packages/acp/src/index.ts")).href;
  const stdioUrl = pathToFileURL(resolve("packages/cli/src/acp-stdio.ts")).href;
  await writeFile(
    script,
    `import { writeFile } from "node:fs/promises";
import { agent, methods } from ${JSON.stringify(acpUrl)};
import { serveAcpStdio } from ${JSON.stringify(stdioUrl)};
const app = agent({ name: "remote-test" }).onRequest(
  methods.agent.initialize,
  ({ params }) => ({
    protocolVersion: params.protocolVersion,
    info: { name: "remote-test", version: "1" },
    capabilities: {},
  }),
);
try {
  await serveAcpStdio(app);
} finally {
  await writeFile(${JSON.stringify(closedMarker)}, "closed");
}
`
  );
  let sshArgs: readonly string[] = [];
  try {
    const handle = await openSshAcpConnection(CONFIG, {
      projectRoot: "/srv/agent",
      spawnProcess(command, args) {
        expect(command).toBe("ssh");
        sshArgs = args;
        return spawn("bun", [script], { stdio: ["pipe", "pipe", "pipe"] });
      },
    });
    expect(sshArgs.at(-1)).toBe(
      "exec llm-space acp --project '/srv/agent'"
    );
    await handle.stop();
    expect(await readFile(closedMarker, "utf8")).toBe("closed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
