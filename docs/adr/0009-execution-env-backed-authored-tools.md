---
status: accepted
---

# Keep portable execution authority behind canonical ExecutionEnv tools

Agent Projects may declare exactly three framework-owned execution helpers as
canonical static files: `tools/read.ts`, `tools/write.ts`, and `tools/bash.ts`.
Each file default-exports its matching zero-configuration declaration from
`@llm-space/runtime/tools`. Filename and helper kind must agree. Dynamic tool
resolvers cannot create these capabilities.

The three helpers are the only authored surface that receives filesystem or
process authority. Ordinary `defineTool()` callbacks retain their existing
bounded Session context and never receive an `ExecutionEnv`. Compiler artifacts
and per-Turn capability snapshots record the canonical name, helper kind,
fixed schema identity, and `requiresExecutionEnv` marker so a helper cannot be
renamed to evade Host policy. They never record an environment instance, cwd,
container identifier, environment variables, or Sandbox configuration.

Runtime borrows an optional Session-scoped Pi `ExecutionEnv` supplied by the
Host. It never constructs `NodeExecutionEnv`, never falls back to Desktop or
Server filesystem/process APIs, and never calls `cleanup()`. When a helper is
part of the final effective capability snapshot and no environment was
supplied, the Turn fails before the provider call with the stable
`executionEnvUnavailable` terminal code. Declared helpers filtered out by Host
policy or the explicit Turn request do not require an environment. The Sandbox
provider, Session lifetime, retention, workspace seed, attachment delivery,
and exactly-once cleanup belong to roadmap item 17.

Path addressing, symlink behavior, confinement, and canonicalization belong to
the supplied `ExecutionEnv`; helpers do not translate paths through host APIs or
build a second sandbox. The explicit Node adapter is a portability reference,
not an isolation claim. Production Sandbox adapters must keep addressed paths
inside their own namespace.

Model-visible inputs follow current Pi coding-agent conventions:

- `read`: `{ path, offset?, limit? }`
- `write`: `{ path, content }`
- `bash`: `{ command, timeout? }`, with timeout expressed in seconds

Results use Pi `AgentTool` content/details and the existing Pi event vocabulary.
Read reuses Pi truncation constants and notices; write performs one whole-file
overwrite through `ExecutionEnv.writeFile`; bash uses Pi
`executeShellWithCapture`, including bounded tail output, optional full-output
path, abort/timeout/error semantics, and existing tool execution updates. A
model-visible environment-addressed full-output path may persist as ordinary Pi
tool-result evidence. Environment configuration and host paths may not. Runtime
does not repair, retry, or automatically rerun a failed helper. Non-zero shell
exit is a completed execution result and Pi cancellation remains explicit.

Manual execution defers all three helpers. `autoOnce` and ReAct may execute
them only when an environment is present. Approval remains roadmap item 19;
Sandbox decides where execution occurs and approval later decides whether it
may occur.

## Consequences

The same compiled Agent capability and Pi tool contract can run against the
explicit Node reference adapter and a fake or isolated adapter without importing
Node filesystem/process modules into portable helper code. Item 17 can provide
Sandbox authority without changing authored source or tool protocol, and ADR
0006 promotion can lower matching Desktop built-ins to canonical source without
copying Desktop host authority.

V1 does not add edit, grep, list, tree, images, attachments, arbitrary helper
configuration, generic permissions, approval UI, environment selection,
Sandbox construction, source write-back, host fallback, or a second streaming
protocol.
