---
status: accepted
---

# Promote Threads through an explicit one-way compilation plan

A standalone Desktop Thread contains editable development state that is richer
than portable Agent source. LLM Space will therefore promote a Thread through
an inspectable compiler-like plan, not by serializing the Thread or silently
dropping unsupported fields. The planner classifies every relevant field as
materialized, intentionally excluded, or blocking; publication remains
preview-first and uses ADR 0005's absent-target, whole-root atomic boundary.

Portable source keeps distinct ownership domains. `agent.ts` owns the model,
reasoning, and Agent-level environment requirements. Prompt variables live in
`agent/variables/*.ts` as source-owned declarations and provider intent;
durable state lives separately in `agent/state/*.ts` after the trusted Session
state capability ships. `current_date` resolves from trusted Turn context,
`available_skills` resolves from the effective capability snapshot, and custom
variables must be classified explicitly as a source default, required runtime
input, environment input, or Session state. A source default may copy its
literal value only after exact preview, with an additional confirmation for a
potentially sensitive value. Session state starts from its source declaration
and never inherits a Thread value or prompt-place snapshot.

Tool promotion preserves implementation and authority. A matching Project
tool copies its exact authored source and closed project-local import graph;
missing, drifted, conflicting, or unclosed source blocks publication. A manual
function tool may use the Thread's current model to draft `defineTool()` source,
but the user must review or edit it, Runtime must compile and load it, and the
user must confirm it before publication; generated code is never executed as
part of drafting and placeholders do not count as implementations. Filesystem
and bash built-ins lower only to ExecutionEnv-backed tools and require Sandbox.
Stdio MCP remains an MCP connection whose process is started only by Sandbox;
there is no Desktop Direct, Local Server, or direct Host-process fallback.

Agent-, tool-, and connection-local environment declarations aggregate into
one effective requirement set. Identical declarations merge and conflicting
kind, required, or description fields fail the build. Environment references
declare requirements without copying values; literal MCP headers remain
literal and potential secrets require exact preview plus explicit confirmation.
Effective requirements participate in artifact identity, startup validation,
and the OCI environment manifest.

Conversation examples are deliberately excluded from this promotion contract.
The current Runtime has no executable example consumer, and defining a message
fixture format now would pre-empt portable Eval cases in item 29. Evaluation
intent is limited to a selected rubric's name, criteria, and descriptions in
human-readable, non-executable `agent/evaluation-intent.md`; scores, verdicts,
notes, Run references, and evaluation history remain Thread-owned evidence.

Promotion creates a fresh Project Thread with the promoted Agent defaults and
no messages, Runs, evaluations, Session state, or inherited Session identity.
The original Thread remains independent. The Desktop interaction is a
temporary preview tab entered through the Thread menu or Command Palette:
Analyze, Resolve, then Review & Publish. It shows the destination, complete
file tree, exact source diff, warnings, confirmations, and blockers; no source,
registry, trust, or Project Thread write occurs before the final atomic publish.

## Consequences

Item 10 depends on items 12, 13, 16, and 17 in addition to item 09, so trusted
state/dynamic-instruction and ExecutionEnv/Sandbox contracts ship before the
promotion implementation. A Sandbox-dependent Thread may be previewed without
a provider but cannot publish. Unsupported content blocks the whole operation;
there is no silent omission, tool substitution, source merge, secret-store
copy, live sync, transcript migration, hidden metadata, or Eve dependency and
compatibility promise.
