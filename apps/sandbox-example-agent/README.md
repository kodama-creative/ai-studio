# Sandbox Example Agent

A focused LLM Space Agent Project demonstrating a required Docker-backed
Sandbox, a one-time workspace seed, and the canonical `read`, `write`, and
`bash` tools.

## Open In LLM Space

1. Start Docker Desktop, OrbStack, or another compatible Docker Engine.
2. Start Desktop from the repository root with `bun dev`.
3. Choose **Open Agent Project** and select `apps/sandbox-example-agent`.
4. Open its default Thread. Desktop selects **Desktop Sandbox** because the
   Agent declares `defineSandbox({})`.
5. If the source model is unavailable, choose an available model directly in
   the Thread. This creates a Thread override and does not edit `agent.ts`.
6. Run the prepared user task. The Agent reads the seed, writes `result.txt`,
   and runs `wc -c result.txt` inside `/workspace`.

The workspace is owned by the Project Thread's Runtime Session. Desktop stops
its container on quit but retains the named volume, so later Turns can reuse
generated files. Deleting the Thread removes the container and volume through
the Host cleanup path.

Sandbox attachments are selected by Desktop and staged into the same workspace.
The renderer and Agent source never receive the original Host file path.

## Verify

The portable source contract does not need Docker:

```sh
bun test apps/sandbox-example-agent
```

Run the repository's real Docker provider acceptance separately:

```sh
bun run test:docker
```

The Docker acceptance covers isolation, seed delivery, collision preservation,
canonical tool execution, abort/timeout behavior, persistence, reconstruction,
workspace loss, and cleanup.
