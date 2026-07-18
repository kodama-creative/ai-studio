---
status: accepted
---

# Deliver named structured outputs through Pi tool calls

## Context

Roadmap item 15 requires a Thread or Channel to select one source-declared
named output contract, have Runtime constrain and validate the result, and
receive one typed terminal value across Desktop and Server. Pi `0.80.3` and
current upstream expose neither a structured-output stream option nor a
structured-result event. ADR 0002 already fixes version-pinned Pi `AgentEvent`
as the public execution vocabulary and permits only the existing Runtime
control terminal.

Eve demonstrates a portable execution technique: advertise an internal
`final_output` tool with the requested schema and intercept its arguments as
the result. Eve's caller-supplied schemas and `result.completed` event do not
fit LLM Space's authored-authority or protocol boundaries.

## Decision

### Authored contracts

Agent Projects may declare flat `outputs/<name>.ts` or `.js` modules. Identity
is derived from the filename under the same lowercase tool-name rules; nested,
symbolic, non-regular, duplicate, and reserved entries fail Build. Each module
default-exports `defineOutput({ description, schema })`, where `description` is
non-empty and `schema` is a TypeBox `TSchema`. V1 has no authored name,
default, version, execute, repair, provider option, Standard Schema adapter, or
schema code generation.

Build requires a plain serializable schema accepted by TypeBox `Compile` and
includes the source, description, canonical schema, and schema fingerprint in
the Agent artifact. Runtime forwards the exact schema through Pi without
provider-specific normalization. Tool calling and schema compatibility are
basic model/author responsibilities; Runtime does not maintain provider/model
support tables or text fallbacks.

### Selection and immutable identity

No contract is selected by source default. `Text`/absence preserves ordinary
assistant behavior. An Agent Project Desktop Thread may persist one selected
contract name; a protected Server Run may receive only an optional declared
`outputContract` name, never a schema. Selection is snapshotted per Turn and
Runtime Run with the exact contract name and schema fingerprint. Changing a
Desktop selection follows the existing execution-affecting edit,
supersession, branch, undo, and redo rules. Local Server Threads may change the
selection between Runs because it is Channel Turn input, not artifact or
Runtime Profile authority.

### Pi execution and failure semantics

When a contract is selected, Runtime advertises one reserved internal tool
named `final_output` using the contract schema. It has no authored authority,
external side effect, approval, state scope, or manual execution control. Its
validated arguments are the typed result and its tool result terminates Pi's
current tool batch. Manual mode continues to defer ordinary tools but validates
and terminates `final_output` automatically.

`final_output` must be the only tool call in an assistant response and occur
exactly once. Duplicate calls or a mixed batch fail before any sibling tool
executes. Static, dynamic, connection, or Host tool name collisions with the
reserved name fail before provider execution.

V1 performs no automatic repair. A schema-invalid call fails as
`structured_output_invalid`; a Turn that ends without the tool fails as
`structured_output_missing`; an oversized result fails as
`structured_output_too_large`. Runtime never parses prose as fallback, adds a
repair prompt, retries a provider, or silently downgrades to text. Ordinary
provider/tool errors keep their existing failure semantics.

### Size, persistence, and terminal ownership

Validated result JSON defaults to a maximum canonical UTF-8 size of 256 KiB.
Desktop and Server Hosts may configure `maxStructuredOutputBytes` from 1 KiB
through 768 KiB. Agent source, Thread, and Channel cannot raise the Host limit.
The effective limit participates in Run configuration identity; results are
never truncated or partially committed.

The Pi transcript retains the assistant `final_output` tool call and matching
tool result as execution evidence and future model context. The durable Runtime
Run terminal is the typed-result authority and atomically records contract
name, schema fingerprint, and JSON value. Persistence uncertainty after any
external operation remains `outcomeUnknown` under ADR 0001 and is never
replayed automatically.

Server run creation and the existing `runTerminal` receive additive optional
fields. Old requests and records remain valid, so V1 does not add an event,
endpoint, protocol-version bump, or migration. The browser client exposes an
optional result generic defaulting to `JsonValue`; Server validation remains
authoritative and the client does not revalidate.

### Studio interaction

Agent Project Threads show an `Output` selector between `Tools` and
`Variables`, with `Text` plus compiled contract names and a read-only schema
detail. Standalone Threads do not show it. Selection is disabled during a Run.

The renderer keeps the underlying Pi transcript but projects the internal tool
pair as a generic `Structured output · <contract>` card. Success renders
formatted JSON with copy and bounded expand/collapse behavior. Invalid,
missing, and oversized results render stable failure cards without automatic
retry. Run History and the existing Trace inspector reuse the read-only card
and show contract name plus schema fingerprint. V1 does not generate forms or
contract-specific UI.

## Consequences

Structured output remains a Pi-native tool interaction rather than a second
model loop or message protocol. Source and Host authority stay explicit, and
the same validated result can survive Desktop/Server restart and replay.
Provider-native response formats may be adopted later only through a stable Pi
capability without changing the named contract or terminal contract.

The additive source/artifact fields do not require migration because old
projects declare no outputs and old persisted records omit optional result
fields. A future breaking schema change remains roadmap item 11.
