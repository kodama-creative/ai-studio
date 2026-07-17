# Thread-To-Agent Project Promotion Contract Blocker

- Status: done
- Outcome: blocked
- Roadmap item: 10

## Trigger

The user asked to continue iteration after item 09 completed. This bounded pass
started on clean, synchronized `develop` at `3a81e26`. Items 01-09 and item
10's dependency, item 09, are complete, making item 10 the lowest-numbered
dependency-ready item. No concurrent or ambiguous worktree change existed.

## Product stage and context

LLM Space now creates canonical portable Agent Projects and uses editable
standalone Threads as the rapid build/debug/evaluation surface. It does not yet
have a truthful one-way bridge from the richer Desktop Thread record into
portable authored source.

The mismatch is structural. Thread state includes Host-owned tools, dynamic and
literal variable values, editable conversation messages, Runtime checkpoints,
and Thread-owned manual evaluations. Agent Project source currently compiles
only definition, instructions, local executable tools, HTTP MCP connections,
and skills. The roadmap's promotion contract names variables, tools, examples,
and evaluation intent, but existing ADRs do not define their portable mapping.

## Evidence reviewed

- `AGENTS.md`, `LOOP_TASK.md`, `LOOP_PLAN.md`, `CONTEXT.md`, ADRs 0001 and
  0005, clean git state, current package scripts, capability map, and the latest
  item-08/item-09 blocker and completion logs.
- Core Thread/message/tool/variable/run/evaluation schemas and normalization;
  Desktop Thread store, prompt-variable, tool, example, Run History, evaluation,
  command, RPC, storage, and project-manager paths.
- Runtime authored definitions, discovery/compiler slots, artifact capture,
  canonical scaffolder, and example Agent source.
- Current isolated real Electrobun CEF at 1280×800. A blank standalone Thread
  exposed model, tools, variables, prompt, messages, Run History, and Evaluation
  surfaces but no promotion entry or preview. The isolated Thread JSON remained
  Desktop-owned under the temporary `LLM_SPACE_HOME`; the process and temporary
  data were removed after inspection.
- The `Agent Studio Roadmap` Loopany loop remains paused. No schedule, goal,
  enabled state, task-file configuration, or product code changed.

## External market scan

Access date: 2026-07-17.

Primary sources:

- Dify app management/export:
  https://docs.dify.ai/en/cloud/use-dify/workspace/app-management
- Langflow import/export:
  https://docs.langflow.org/concepts-flows-import
- Langflow flows/versioning:
  https://docs.langflow.org/concepts-flows
- Promptfoo evaluation configuration:
  https://www.promptfoo.dev/docs/configuration/guide/

Dify exports configuration, workflow, model settings, and prompt templates,
while explicitly separating credentials, knowledge content, logs, and
conversation data; it also version-checks imports. Langflow exports a named
JSON flow, distinguishes literal key values from variable-name references, and
requires missing variables to be supplied after import. Promptfoo makes tests
and assertions explicit authored inputs rather than deriving them from prior
comparison records.

Table stakes are therefore an explicit export action, inspectable/versioned
contents, unchanged source object, clear reference-versus-value handling,
credential exclusion, and precise unsupported or post-import requirements. The
true LLM Space gap is a lossless, authority-aware promotion plan, not merely a
button that serializes current UI state. The sources do not decide LLM Space's
tool authority, variable runtime, portable Eval boundary, or Thread ownership.
The OpenAI Agent Builder documentation endpoint was unreachable during this
scan, so no claim depends on it.

## Capability-map freshness

- `Prompt And Thread Building`: confirmed from current CEF and Thread source;
  it owns editable Desktop development state, not portable Agent source.
- `Agent Project Activation` and `Canonical Agent Project Scaffolding`:
  confirmed from item-09 code/tests/audit; they provide the absent-target,
  user-owned source and Desktop-owned registry/Thread publication boundary.
- `Agent Definition And Runtime`: confirmed; no variable/example/Eval source
  slot exists.
- `Evaluation Workspace`: confirmed; rubrics and evaluations remain local,
  manual, Thread-owned evidence.
- `Thread-To-Agent Project Promotion`: added as confirmed blocked before V1.

## Product north-star metric

- Name: Thread-to-buildable-Agent completion without manual source repair.
- Why it matters: Studio becomes an Agent builder only when successful Thread
  work can cross into portable source without re-authoring or hidden loss.
- Baseline: 0%; there is no promotion command, preview, converter, source
  contract, or accepted eligibility matrix.
- V1 target after approval: 100% of explicitly eligible fixture Threads preview,
  promote atomically, load/build, and open as an independent Agent Project with
  no manual source edit; every ineligible fixture fails before writing with a
  field-specific diagnosis.
- Measurement: an exhaustive eligibility/mapping matrix across model,
  reasoning, prompt, variables, all four tool kinds, examples, and evaluation
  intent; source byte assertions; Runtime load/OCI-context build; original
  Thread immutability; Desktop registry/default-Thread ownership; failure
  rollback; real CEF audit; TypeScript/lint/non-packaging builds; and two-axis
  review.
- Guardrails: no secret/credential/transcript leak, silent tool substitution,
  Host authority expansion, hidden metadata, live sync, original Thread
  mutation, source merge/overwrite, Pi protocol change, premature Eval format,
  Electrobun packaging, signing, notarization, or release command.

## Candidate opportunities

1. Main recommendation: approve a strict versioned promotion plan and
   eligibility matrix. Preview every portable mapping and every omission;
   atomically publish only when every selected field has an exact authorized
   representation, otherwise block before writing.
2. Alternative: ship prompt/model-only export and label the rest unsupported.
   Rejected for item 10 because it omits tools, variables, examples, and
   evaluation intent from the Done-when contract and would normalize partial
   promotion as success.
3. Alternative: defer item 10 until tool portability item 16 and portable Eval
   item 29 ship. This is architecturally safe but delays the core Thread-to-Agent
   activation loop and changes the approved roadmap dependency/order.

## Main recommendation

Treat promotion as a compiler-like plan rather than UI serialization. A pure
planner should classify every Thread field as exactly materialized,
intentionally excluded by the approved contract, or blocking. The preview must
show source destination/files, model/reasoning/prompt lowering, variable value
or reference behavior, tool mapping and authority, selected examples,
evaluation-intent representation, sensitive-value warnings, and the new
Desktop-owned Project Thread result. Publication should reuse ADR 0005's absent
user-owned target and rollback boundary.

This direction is recommended because it preserves the roadmap's no-hidden-
metadata/no-silent-substitution guarantees and provides a stable test seam. It
cannot be implemented until the owner chooses what is eligible and what new
portable authored representation, if any, item 10 may introduce.

## V1 capability definition and non-goals

After approval, an eligible standalone Thread can open a complete preview,
choose an absent user-owned destination, and produce a loadable/buildable
independent Agent Project plus its initial Desktop-owned Project Thread. The
original Thread remains byte-for-byte independent. Unsupported or sensitive
inputs receive precise pre-write diagnoses and no fallback mapping.

Explicit non-goals: reverse sync, live sync, original Thread mutation, source
merge/overwrite, secret or credential copy, transcript/run/evaluation-history
migration unless explicitly approved, fake tool implementations, implicit
Desktop built-in permission, broad source migration, item-29 Eval execution,
or promotion of every future Thread capability by default.

## Acceptance and audit plan

Acceptance must cover each tool kind and variable kind, empty and populated
messages, images/tool results/thinking, run snapshots, rubrics/evaluations,
sensitive values, missing model, unsupported MCP transport, collision, cancel,
injected failure, restart, and original-Thread immutability. Eligible outputs
must pass Runtime load and OCI context creation without edits; ineligible inputs
must leave no source, registry, trust, or Project Thread delta.

The future real CEF audit must cover discoverable Thread entry, preview mapping
and warnings, destination/name choice, disabled/error/progress/cancel states,
successful Build/default-Thread landing, keyboard/focus, 1280×800 and 900×700
overflow, console state, source bytes, and strict separation of original Thread,
portable source, and `LLM_SPACE_HOME` data.

## Implementation plan and approval status

1. Resolve the design branches one at a time and record the accepted source,
   authority, persistence, and sensitive-data contract in an ADR.
2. Add a pure promotion planner with an exhaustive eligibility matrix and
   preview model before any filesystem or registry write.
3. Extend only the approved portable authored source contract and artifact
   identity; preserve item-29 and later tool boundaries explicitly.
4. Materialize through ADR 0005's atomic user-owned publication seam, then use
   the existing trust/default-Thread flow with complete rollback.
5. Add the approved Thread command and concrete preview interaction; verify
   through real CEF and the full repository gates.

Approval status: blocked before implementation. The roadmap outcome is
pre-approved, but current contracts do not decide:

1. whether V1 supports only a strict eligible subset or pulls later portable
   tool capabilities forward;
2. which tool kinds have exact mappings and whether unsupported tools block the
   whole promotion;
3. whether variables remain references, are copied as literal values, or are
   lowered into prompt/example text, including sensitive-value treatment;
4. what counts as an example and whether any transcript content enters source;
5. how evaluation intent is represented without creating item 29's Eval
   protocol or copying Thread-owned scores/history;
6. whether the new Project Thread is empty, a clean authored example, or a
   transcript/evaluation copy.

## `$grill-me` requirements discussion

Invoked because the branches change portable source, Host authority, security,
persistence, and data ownership. Codebase facts were resolved locally. The
first one-question-at-a-time owner decision is pending: whether item-10 V1 may
define a strict eligible subset and block every unsupported Thread before any
write, or must promote every currently runnable Thread by pulling later tool
and Eval capabilities into scope. No implementation may begin until all
dependent branches, interaction details, acceptance criteria, and stop
conditions are resolved and the consolidated plan is explicitly approved.

## Work performed

- Reconciled item 10 against current Thread schemas, Runtime source slots,
  scaffolding/trust boundaries, rendered Desktop surface, and current market
  expectations.
- Added the confirmed promotion capability blocker to the capability map,
  roadmap, and bounded executor memory.
- Performed no product-code, source-protocol, Loopany, packaging, signing,
  notarization, or release change.

## Review and remaining risks

The documentation-only diff was reviewed against the current source and ADR
boundaries. The blocker is neither a missing implementation detail nor a
repeat of item 09: guessing would either leak Thread/Settings data, synthesize
nonfunctional tools, expand Desktop authority, or prematurely define the Eval
format. No product regression was introduced. The known unrelated Server test
shutdown timeout remains existing debt and is not exercised by this
documentation-only pass.

## Follow-up product bets

1. Resume the one-question-at-a-time `$grill-me` session for item 10.
2. If the owner rejects a strict eligible subset, explicitly re-plan item 10's
   dependencies on items 16, 23, and 29 rather than absorbing them silently.
3. Keep reverse/live sync, transcript migration, and source merge as separate
   future product decisions.

## Outcome

Blocked before implementation on new portable-source, tool-authority,
sensitive-data, Eval-boundary, and Project-Thread ownership decisions. The
next suggested action is the first owner answer; this pass ends without
starting item 11.
