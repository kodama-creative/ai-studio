# LLM Space Capability Map

- Last updated: 2026-07-25
- Map status: refreshed through shipped roadmap item 20. Items 12 through 16 and 18 through 20 are shipped under ADRs 0006-0009 and 0011-0013 where applicable; item 17 again passes its local real-Docker gate but existing shipment policy still awaits a current-head CI pass, which the owner deferred, so item 10 remains dependency-blocked.
- Evidence rule: entries marked `confirmed` cite current rendered-product or current-code evidence. Entries marked `stale` rely on previous logs or code paths not fully re-inspected in this loop. Entries marked `unknown` need a future product-surface check before they can drive a recommendation.

## First-Run Model Setup

- Status: shipped V1
- Freshness: confirmed
- Last checked: 2026-07-03
- Evidence:
  - Current discovery screenshot `audits/2026-07-03-223500-trace-inspector-discovery/01-current-fresh-first-run.png` shows onboarding with a locally detected `OpenAI Codex` provider.
  - Current CEF snapshot showed clicking the detected provider transitions onboarding to `OpenAI Codex is ready` and `Ready to run`.
  - `apps/desktop/src/components/onboard-dialog.tsx` fetches builtin provider discovery and adds detected providers through existing model hooks.
- Boundary: first launch with no configured provider can detect local credentials, add a provider, and reach a runnable model without entering Settings first.
- Explicit non-goals: no real provider connectivity test, no quota/API test run, no setup wizard state machine, no secret display.
- Visible gaps: no real provider connectivity test after setup.

## Workspace And Thread Management

- Status: operational
- Freshness: confirmed
- Last checked: 2026-07-14
- Evidence:
  - Current discovery screenshot `01-current-fresh-first-run.png` shows an empty workspace state with `Start from Example`, `Blank thread`, and `Configure models`.
  - Current CEF fixture check showed both `general-agent` and `trace-fixture` files in the sidebar after reload.
  - `apps/desktop/src/components/file-system-tree-view/use-file-system-tree.ts` creates quick files as local JSON threads.
  - `apps/desktop/src/components/thread-tabs/use-thread-tabs.ts` restores/open tabs and defaults first-run tabs through persisted tab state.
  - Current CEF screenshot `audits/2026-07-13-232652-agent-navigation-editor/01-stacked-sidebar-watching.png` shows the managed workspace tree and imported Agent Projects stacked in the same sidebar, with no direct Threads/Agents view switch and a default `Watching` label consuming row space.
  - Current CEF screenshots `audits/2026-07-14-005810-agent-navigation-editor/01-agents-sidebar.png` and `07-agent-thread-nested.png` show persisted Threads/Agents switching, the workspace Agent removed from the standalone Thread tree, and its project Thread nested under the Agent.
- Boundary: local workspace Thread tree, tabs, rename/move/delete/duplicate/reveal, prompt-example/blank thread creation, local JSON persistence, and a persisted sidebar inventory switch that keeps Agent Project roots out of the standalone Thread tree.
- Explicit non-goals: cloud sync, cross-workspace projects, external file watching beyond current tree refresh behavior.
- Visible gaps: richer standalone Thread organization remains out of scope; external writes to ordinary workspace Thread files still require reload/refresh to appear.

## Prompt And Thread Building

- Status: manual builder with prompt examples
- Freshness: confirmed
- Last checked: 2026-07-08
- Evidence:
  - Discovery CEF screenshot `audits/2026-07-08-173643-system-prompt-variables/01-current-system-prompt-editor.png` showed the pre-V1 system prompt editor exposed `Generate` and `Examples`, but no Variables entry, variable picker, rendered-preview affordance, date token, or skill selector in the prompt surface.
  - Discovery CEF snapshot on 2026-07-08 showed system prompt editing, model/tool rows, message editing, and run history active with no horizontal overflow before this capability was added.
  - Implementation screenshot `audits/2026-07-08-173643-system-prompt-variables/03-variables-button-thread.png` shows a new `Variables` action beside `Generate` and `Examples`.
  - Implementation screenshot `audits/2026-07-08-173643-system-prompt-variables/04-variables-popover-skills.png` shows current-date format preview and enabled-skill selection/preview inside the variables popover.
  - Implementation screenshot `audits/2026-07-08-173643-system-prompt-variables/05-date-skill-inserted.png` shows date and selected-skill placeholders inserted into the system prompt editor.
  - Runtime resolver check in the live CEF/Vite page resolved `{{llm_space.current_date format="default"}}` and `{{llm_space.skill name="deep-research" format="summary"}}` into concrete prompt text and returned an actionable error for a missing skill.
  - Variable Panel V2 screenshot `audits/2026-07-08-191806-variable-panel-v2/07-v2-skills-markdown-indent.png` shows simple placeholders in the editor while selected skills, `markdown-list` format, and `2 spaces` indentation live in the panel.
  - Variable Panel V2 screenshot `audits/2026-07-08-191806-variable-panel-v2/06-v2-custom-scenario.png` shows custom variable `customer_profile` under active scenario `scenario_2` with a multiline value.
  - Isolated runtime file `workspace/untitled-3.json` persisted `context.variables.available_skills` with `skillNames`, `format`, and `indent`, plus `context.variableVariants` with `baseline` and `scenario_2` value sets.
  - Live CEF resolver checks rendered `{{available_skills}}`, `{{customer_profile}}`, and `{{system_date}}`, and rejected legacy `{{llm_space.current_date format="default"}}`, empty skill selections, and empty custom values with actionable errors.
  - `packages/core/src/thread/prompt-variables.ts` owns date/skill formatting and placeholder semantics; desktop injects enabled local skills through `variable/prompt-variable-skills.ts`.
  - `apps/desktop/src/components/thread-playground/stores/thread-store.ts` now renders variables before `streamThread()` while run snapshots keep the rendered prompt and the live editor keeps the template.
  - Current screenshot `02-starter-thread-current.png` shows `Start from Example` now opens a prompt-example chooser rather than directly creating a single starter thread.
  - Current screenshot `03-example-thread-opened.png` shows a `general-agent` prompt example opened with a populated system prompt, fallback model, and an empty user message.
  - Current CEF discovery screenshot `audits/2026-07-04-175331-next-capability-discovery/01-current-first-run.png` confirms the first-run surface still offers `Start from Example`, `Blank thread`, and `Configure models`.
  - Reliability verification screenshot `audits/2026-07-04-185729-thread-editor-reliability-v1/02-blank-thread-codemirror.png` shows a fresh blank thread open in CEF with real CodeMirror editors rather than a blank app.
  - Reliability verification screenshot `audits/2026-07-04-185729-thread-editor-reliability-v1/05-reload-persisted-editor.png` shows a persisted blank-thread message restored after reload.
  - Reliability verification screenshot `audits/2026-07-04-185729-thread-editor-reliability-v1/06-example-thread-edited.png` shows a prompt example with edited system prompt and user message.
  - `apps/desktop/src/components/start-from-example-dialog.tsx` exposes the chooser.
  - `apps/desktop/src/components/thread-playground/prompt/prompt-examples.ts` defines the available prompt examples and stable file stems.
  - `apps/desktop/src/components/thread-playground/thread-playground.tsx` resolves a fallback model and enables run when a model exists.
- Boundary: user can choose built-in prompt examples or blank threads, manually edit model/tools/system prompt/messages, manage thread-owned prompt variables from a dedicated Variables row below Tools, configure current date and selected skill groups, add default custom variable values, preview formatted values in the Variables dialog, type simple `{{variable_name}}` placeholders into the system prompt, and run with those variables resolved while keeping the stored system prompt as a reusable template.
- Explicit non-goals: multi-file prompt projects, template marketplace, automated prompt optimization.
- Visible gaps: no smart spacing between consecutive inserted placeholders, no dedicated rendered-vs-template diff panel, no full keyboard/screen-reader audit for the variables panel, no guided task setup after choosing an example, and no automated CEF regression smoke for first-thread editing yet.

## System Prompt Variables

- Status: shipped V3 with dedicated Variables row and dialog
- Freshness: confirmed
- Last checked: 2026-07-09
- Evidence:
  - Discovery CEF screenshot `audits/2026-07-08-173643-system-prompt-variables/01-current-system-prompt-editor.png` confirmed the original prompt editor gap: no Variables affordance beside `Generate` and `Examples`.
  - Source inspection confirmed skill discovery and runtime loading already existed through Settings/RPC and the built-in `skill()` tool, so V1 reused existing enabled-skill data instead of introducing a new discovery model.
  - Implementation screenshot `audits/2026-07-08-173643-system-prompt-variables/03-variables-button-thread.png` shows `Variables` in the system prompt toolbar.
  - Implementation screenshot `audits/2026-07-08-173643-system-prompt-variables/04-variables-popover-skills.png` shows date and skill variable formats with previews.
  - Implementation screenshot `audits/2026-07-08-173643-system-prompt-variables/05-date-skill-inserted.png` shows durable date and skill placeholders inserted into the prompt editor.
  - `workspace/untitled.json` in the isolated CEF runtime persisted the placeholder template.
  - Focused resolver checks in the live CEF/Vite page confirmed concrete date/skill rendering and missing-skill errors.
  - V2 screenshot `audits/2026-07-08-191806-variable-panel-v2/07-v2-skills-markdown-indent.png` shows the persistent Variables panel below the editor with `available_skills`, selected `deep-research`, `markdown-list`, and `2 spaces`.
  - V2 screenshot `audits/2026-07-08-191806-variable-panel-v2/06-v2-custom-scenario.png` shows active scenario `scenario_2` and custom multiline variable `customer_profile`.
  - V2 isolated runtime file `workspace/untitled-3.json` persisted `context.variables` and `context.variableVariants`:
    - `available_skills`: `skillNames: ["deep-research"]`, `format: "markdown-list"`, `indent: 2`
    - `system_date`: `type: "currentDate"`, `format: "readable-date"`
    - `variableVariants.active: "scenario_2"` with `baseline` and `scenario_2` value sets.
  - Live CEF resolver checks rendered simple placeholders and returned blocking errors for legacy `llm_space.*` expressions, missing skills, and empty custom values.
  - Layout polish screenshot `audits/2026-07-08-220831-variable-panel-redesign/03-final-skills-detail.png` shows the Variables panel as a resizable section under the system prompt editor with a full-width header divider, compact rows, and a selected-row detail editor.
  - CEF drag verification on port `9333` moved the horizontal resize handle and changed the Variables panel from `243.39px` to `333.39px` without horizontal overflow.
  - Initial relocation screenshot `audits/2026-07-09-101033-variables-tools-entry/02-tools-row-variables-entry.png` showed `Variables` as a compact entry inside the Tools row; UI review corrected this to a separate row.
  - Correction screenshot `audits/2026-07-09-101033-variables-tools-entry/06-variables-separate-row.png` shows a dedicated `Variables` row below `Tools`, with `current_date` and `available_skills` visible as chips plus `Add`.
  - Correction screenshot `audits/2026-07-09-101033-variables-tools-entry/07-variable-chip-opens-detail.png` shows clicking `available_skills` opens the Variables dialog focused on the Skills detail.
  - CEF DOM checks on 2026-07-09 confirmed the row order `Tools` -> `Variables` -> `System prompt`, `documentElement.scrollWidth - innerWidth === 0`, and `0` visible `Insert` buttons.
  - Dialog screenshot `audits/2026-07-09-101033-variables-tools-entry/03-variables-dialog.png` shows the Variables management dialog reusing the variable list and selected-detail layout.
  - Skill-preview screenshot `audits/2026-07-09-101033-variables-tools-entry/05-skills-preview.png` shows the skills detail using `Add` to open skill selection and previewing the selected `deep-research` skill.
  - CEF DOM checks on 2026-07-09 found `0` visible `Insert` buttons in the Variables flow, `documentElement.scrollWidth - innerWidth === 0`, and no relevant console errors.
  - Isolated runtime file `workspace/untitled.json` persisted `context.variables.available_skills.skillNames = ["deep-research"]` and `context.variableVariants.variants.default.custom_variable = ""` after editing through the dialog.
  - Product-design audit notes `audits/2026-07-09-101033-variables-tools-entry/audit-notes.md` found the entry relocation healthy, with keyboard/screen-reader QA as the main remaining risk.
  - TypeScript, lint, diff check, console, and overflow checks passed for the implementation.
- Boundary: users can scan variables directly in a dedicated Variables row below Tools; click a variable chip to open the dialog focused on that variable; use `Add` to open the same dialog for management; rename/configure built-in current-date and skills variables; select an ordered group of enabled skills; choose `xml` or `markdown-list` skills format plus skills-only indentation; add default custom variables; persist all variable config in the thread; type simple `{{variable_name}}` placeholders in the system prompt; and render those variables before the model call. Saved run snapshots preserve the template system prompt rather than replacing it with rendered text.
- Explicit non-goals: no broad templating language, no prompt marketplace, no automatic skill invocation, no secret/env-variable interpolation, no background skill indexing beyond current discovery folders.
- Visible gaps: no direct variable Insert shortcut in the current dialog, no smart whitespace/newline insertion between consecutive placeholders, no rendered-template diff UI, no full accessibility audit beyond DOM labels/screenshot review, and no paid-provider smoke run in this loop.

## Thread Editor Reliability

- Status: shipped V1
- Freshness: confirmed
- Last checked: 2026-07-04
- Evidence:
  - Discovery on port `9351` reproduced the original blank-thread crash and CEF console later identified the root cause as duplicate `@codemirror/state` instances.
  - `apps/desktop/package.json` now declares `@codemirror/language`, `@codemirror/state`, and `@codemirror/view` as explicit desktop dependencies, and `apps/desktop/vite.config.ts` dedupes those identity-sensitive packages.
  - `apps/desktop/src/components/code-editor/extensions.ts` imports `EditorView` and `Extension` from the explicit CodeMirror packages instead of through the `@uiw/react-codemirror` re-export.
  - `apps/desktop/src/components/code-editor/index.tsx` now isolates CodeMirror render failures with a local error boundary and provides a textarea-style fallback with retry.
  - CEF verification on port `9352` with isolated runtime root showed a blank thread with 2 real CodeMirror editors, 0 fallback textareas, a persisted user-message edit in `workspace/untitled.json`, successful reload restore, and an edited `general-agent` example persisted in `workspace/general-agent.json`.
  - Vite's rebuilt dependency cache no longer references `@codemirror/state@6.6.0`, `@codemirror/view@6.43.1`, or `@codemirror/language@6.12.3`; it resolves to `state@6.7.0`, `view@6.43.5`, and `language@6.12.4`.
- Boundary: users need to open blank/example threads, see existing text, type into message/system/tool editors, persist edits, and recover from editor-render failures without losing the rest of the app.
- Explicit non-goals: no full editor replacement, no new thread JSON schema, no analytics/crash-reporting service, no broad CodeMirror redesign.
- Visible gaps: fallback recovery was reviewed in code but not triggered in the happy-path CEF run because the root cause is fixed; no automated CEF regression smoke or crash telemetry yet.

## Run And Streaming

- Status: shipped core loop on the Desktop Runtime Harness
- Freshness: confirmed
- Last checked: 2026-07-22
- Evidence:
  - Current screenshots `03-example-thread-opened.png` and `06-restored-run-message-view.png` show `Run` enabled once a fallback model exists.
  - Current discovery screenshot `audits/2026-07-04-110944-core-capability-discovery/03-general-agent-open.png` shows the General Agent example ready to run with model, messages, and tool definitions.
  - `apps/desktop/src/components/thread-playground/stores/thread-store.ts` streams through `streamThread()`, folds reducer events into messages, and records completed runs.
  - `apps/desktop/src/components/thread-tabs/thread-tab-pane.tsx` wires a single Electrobun RPC transport into the active thread.
  - A fresh real Electrobun CEF inspection on 2026-07-22 opened a blank Thread and its existing Run History surface through real Bun RPC. The page had no horizontal overflow or application console error; no model call was made. Run History remains the current terminal-state surface rather than a background-work dashboard.
- Roadmap item 03 focused fixtures prove standalone and Agent Project manual, auto-once, and ReAct execution through Pi `AgentSession`; full validation passed 158 tests, all five TypeScript projects, repository lint, the browser-safe harness bundle, and renderer-only Vite build.
- Boundary: one thread can run against its selected or fallback model, stream assistant/tool output, abort, and durably persist Runtime Run starts plus settled checkpoints through its Thread-owned Session Store record.
- Explicit non-goals: batch runs, scheduled runs, provider health validation.
- Visible gaps: live-provider continuation after a real paid/provider tool-call turn still needs a bounded smoke check; the global run control remains generic while the message-level continuation flow is specialized.

## Runtime Recovery And Replay

- Status: shipped crash-aware operation replay V1
- Freshness: confirmed
- Last checked: 2026-07-23
- Evidence:
  - `@llm-space/runtime/harness` exposes `recoverRuntimeSession()`, `claimRuntimeRunResume()`, and `replayRuntimeRunEvents()` over the existing Host-provided Session Store and ordered Run Journal.
  - Fresh-process fixtures reconstruct missing/idle Sessions and both `waitingForToolResults`/`waitingForContinue` waits without changing Run identity. Concurrent claims at one recovered version produce exactly one CAS winner.
  - Persisted `runningModel` and `runningTools` fixtures atomically transition to terminal `outcomeUnknown`; subsequent resume claims fail, while the terminal transition remains replayable as an ordered Host-facing control-plane event.
  - Replay fixtures confirm stable global journal sequence, exclusive cursor semantics, no duplicate delivery, immutable output, and rejection of cross-session, cross-Run, non-entry, future, and unsupported-version cursors.
  - Desktop coordinator/store fixtures persist recovered `outcomeUnknown` before returning and prove the Pi/transport path is never invoked for interrupted work. Existing settled manual reload/continuation remains green.
  - Runtime Session schema v2 adds one Run → Step → operation ledger around Pi's existing provider and executable-tool seams. Operations have stable identity, request/result fingerprints, bounded normalized replay material, retained size/timestamps, and `preCall`, `completed`, `failed`, `cancelled`, `parked`, or `outcomeUnknown` settlement; Pi `Agent` remains the sole ReAct-loop owner.
  - A Step records its exact pre-provider Pi transcript message count. Hosts persist the public transcript before checkpoint, and Desktop/Server recovery trims only to that durable count before injecting a proven completion. It never scans for equal message content or truncates repeated historical responses heuristically.
  - Desktop Direct/Sandbox and stateless/stateful Agent Project execution serialize Runtime Session plus transcript field updates through the existing owning Thread file. Server queues recoverable Runs from its atomic repository on startup. Fresh-controller/fresh-repository tests prove completed provider replay without adapter redispatch; ambiguous pre-calls become terminal `outcomeUnknown`.
  - Tool terminals commit in one transaction with the existing shared Session-state replacement. Known thrown failures and normal results explicitly flagged `isError: true` are recorded as `failed`, replay the same error flag through Pi, and still let ReAct choose its next action; an unknown sibling prevents Pi from receiving a partial batch.
  - Parked operations retain stable park/schema identity. Host-authenticated expected-version CAS admits one winner, while request fingerprints are checked both before the CAS transition and immediately before dispatch. Wrong input does not consume the park; post-resume drift is cancelled before side effects.
  - Replay is limited to 1 MiB per operation and 4 MiB per active Step, drops payload bytes after checkpoint while retaining metadata, and rejects old Session schema, non-JSON, oversize, mismatch, or completion-write uncertainty without reset or automatic retry.
  - Item-18 verification passed Runtime 167 tests with one opt-in Docker acceptance skip, Server 27, Desktop 107, Core/CLI/examples 64, all TypeScript configurations, repository lint, diff checks, renderer-only Vite, and a fresh real CEF 1280×800 Blank Thread/model-selector/Run-History guardrail. Standards review found no hard violation; large ledger/store modules and repeated canonical JSON remain explicit refactoring candidates.
- Boundary: a Host can recover safe waits, replay only durably completed provider/tool results, resume one exact parked operation through CAS, or stop ambiguous effects as `outcomeUnknown`, while preserving one Runtime Run and one Host-owned Session/transcript authority. Principal/transport authorization remains outside Runtime.
- Explicit non-goals: automatic retry of ambiguous provider/tool effects, authored idempotency declarations, exactly-once, distributed leases/heartbeats, workflow DSL, approval policy/UI, raw stream retention, generic operation inspector, canonical Trace, compaction, or background scheduling.
- Visible gaps: V1 deliberately has no trusted adapter idempotency evidence, distributed retry policy, approval policy, generic operation inspector, migration/reset flow for schema v1 Sessions, or live paid-provider crash injection. Imported Trace workbenches are explicitly outside item 18 and continue to use their trace-owned persistence path until canonical Trace integration in item 32.

## Long Session Context And Branch Navigation

- Status: shipped V1
- Freshness: confirmed
- Last checked: 2026-07-25
- Evidence:
  - Runtime Session schema V4 adds content-addressed immutable message entries, parent-linked checkpoints, stable branches and mutable labels, current branch/checkpoint pointers, and durable compaction provenance without replacing the Session Store CAS authority.
  - A Run started at the current settled tip continues the same branch. Starting at an older explicit working base atomically creates one child branch before provider/tool work; Inspect and Restore alone create neither a Run nor a branch.
  - Pi Agent Core 0.80.3 public context helpers prepare and project summary-plus-recent context while Pi `Agent` remains the ReAct-loop owner. The summary provider call uses the durable operation ledger, known completions replay, ambiguous effects become `outcomeUnknown`, and the main provider is fail-closed behind compaction.
  - Desktop persists `runtimeWorkingBase` with the editable Thread and renders Branch → Run → compaction/checkpoint history with independent `Current`, `Working from`, and inspection states, same-Thread Restore/Return to current, durable rename, keyboard navigation, and a read-only compaction inspector.
  - `Compact now` is a compaction-only Runtime Run at the current settled Desktop tip: it never dispatches the main provider or fabricates a message/checkpoint, and it is intentionally unavailable for an older restored base and Local Server V1. An unknown summary outcome requires an explicit warning confirmation before Desktop creates the retry Run/provider operation; other unknown operations remain fail-closed.
  - Server records transcript-backed Runtime checkpoints while keeping its transcript as the protected active-path projection/cache. Local Server create-Run commands validate the selected working base against the authenticated Server Session, rebuild fork input from that checkpoint, return the authoritative Runtime Session/checkpoint terminal projection, and rename branches through the Server authority. V3 Runtime bytes remain unchanged and execution rejects them explicitly rather than clearing or migrating development data.
  - Runtime history/compaction, Desktop, Server, and Core suites prove retained original entries, deterministic fork/CAS behavior, restart projection, 60 sequential Runtime Turns/checkpoints followed by two historical forks and restart, compaction completion and record-commit crash boundaries, summary fingerprint stability, Local Server same-base idempotent retry, failure/unknown handling, and no main-provider dispatch for explicit compaction. Final local acceptance passed 386 tests with one opt-in Docker acceptance skip (Core 41, Runtime 199, Server 29, Desktop 117), all eight TypeScript configurations, lint, diff checks, and renderer Vite.
  - Fresh real CEF evidence in `audits/2026-07-25-114849-runtime-history-compaction/` verifies the tree, inspector entry boundaries, main-message compaction marker, Restore/Return, rename persistence, Escape/arrow/F2 keyboard behavior, current-tip `Compact now` gating, explicit unknown-summary retry/cost confirmation, console cleanliness, and no page overflow at 1280×800 and 900×700.
- Boundary: a user can inspect a complete immutable checkpoint tree, explicitly select a safe same-Thread execution base, create and label a child branch only by executing from older history, and continue a long active path from an inspectable durable summary while all original messages and journal evidence remain retained.
- Explicit non-goals: destructive history deletion, implicit Thread creation, branch merge/rebase, cross-Thread branches, AI-generated labels, source compaction DSL, summary editing, generic operation inspector, token/cost enforcement, Pi `AgentHarness`/`Session` durable authority, or production migration/reset.
- Visible gaps: V1 has no branch merge/rebase/delete, cross-Thread lineage, production migration, Local Server explicit compaction control, formal ARIA tree semantics, or live paid-provider context-exhaustion acceptance. At 900×700 the full sidebar + two-pane editor + history layout is usable without page overflow but remains dense; variable labels and usage chips can wrap or clip.

## Trusted Session Context And Structured State

- Status: shipped V1
- Freshness: confirmed
- Last checked: 2026-07-17
- Evidence:
  - `agent/state/*.ts`, `defineState`, and the shared source/bundle compiler provide named/versioned TypeBox state with deterministic schema/artifact identity, JSON initial values, and 64-slot/64-KiB-per-slot/256-KiB-total limits.
  - `AgentSessionState` gives automatic Pi tool steps one shared temporary Map, deeply frozen reads, schema-valid updates, last-actual-write-wins concurrency, whole-step rollback, and one full-snapshot Session Store CAS before the next provider call. Commit uncertainty becomes terminal `outcomeUnknown` without replaying tools.
  - Manual execution is explicitly a development debugging boundary: tools are deferred and the step skips state validation/scope/commit. Automatic tool errors and deferred results discard temporary updates while retaining Pi's normal error handling, with no lifecycle branch based on whether an Agent declares state.
  - Raw `AgentRuntime` requires Host-supplied immutable context. Server projects exact authenticated principal/initiator, optional tenant context, HTTP channel, and durable Turn lineage; tenant remains context rather than changing ADR 0002 ownership. Desktop supplies its fixed local principal and Project Thread/Run lineage.
  - Server repository integration preserves isolated state for two principals across restart and blocks removed/version/schema-drifted definitions. Desktop commits through the existing Thread-owned Runtime Session record, hands the newest version to the renderer before settlement, and reopens the committed value without a second authority.
  - Focused item-12 acceptance passed 80 tests; full repository verification passed 256/257 tests and 1014 assertions, with the sole Server observation-disconnect timeout reproduced at the clean fixed point. Six TypeScript projects, root lint, Runtime browser/Bun bundles, Server Bun bundle, renderer-only Vite, and diff check passed.
- Boundary: authored tools can read Host-verified Session/Turn identity and maintain typed Session-local working state across automatic tool steps, Turns, Desktop Project Thread reopen, and Server restart. State/context remain outside Pi events and model history; transcript and external memory remain separate authorities.
- Explicit non-goals: no generic memory object sent to the model, bundled vector database, automatic memory extraction, cross-Session queries, state-backed secret store, hosted tenant database, organization-policy UI, hidden principal metadata, or replacement of the existing Session Store.
- Visible gaps: no migration/reset/drop path for changed definitions, state inspector/editor/history, cross-Session sharing, external long-term memory, or durable staged state for mixed deferred tool steps; automatic mixed-deferred steps deliberately discard temporary state instead of persisting an incomplete step.

## Composable Static And Dynamic Instructions

- Status: shipped V1
- Freshness: confirmed
- Last checked: 2026-07-18
- Evidence:
  - Required `instructions.md` remains first; an optional flat `instructions/` directory accepts regular `.md`, `.ts`, and `.js` entries in stable code-point filename order. Static code exports `defineInstructions({ markdown })`; dynamic code uses the Eve-shaped `defineDynamic({ events: { "turn.started": ... } })` contract.
  - Source discovery rejects nested, symbolic, non-regular, unsupported, and invalid-export entries. Instruction code cannot import tool/connection/Node/package source or dynamically load modules; its only runtime dependency graph is the authored instructions SDK plus confined `state/` definitions using the state SDK and TypeBox.
  - Artifact and closed-bundle fixtures preserve identical entry kind, logical source path, static Markdown, dependency identity, and executable dynamic callbacks across equivalent roots. Dynamic source changes remain covered by the Agent artifact fingerprint.
  - `AgentSessionInstructions` resolves once before Pi provider execution from the Host-verified deeply frozen Session/Turn context. Automatic execution exposes authored state read-only; manual debugging deliberately has no state scope. Resolver failure, missing Session Store, artifact drift, persistence conflict, or snapshot-integrity mismatch blocks provider execution.
  - The existing Session Store records one immutable per-Turn snapshot containing ordered entry provenance, exact combined Markdown, Agent fingerprint, Turn ID, and a recomputed SHA-256. Every Pi provider call in that Turn receives those bytes; reload/continuation reuses them, while transcript messages, Pi events, and Run replay exclude instruction content/journal entries.
  - Server integration proves authenticated principal/tenant/HTTP/Turn context plus read-only state across restart. Desktop Project Threads publish the committed Runtime Session before execution settlement and reopen the same snapshot; an edited Thread system prompt is recorded explicitly as Host-owned input while unchanged project prompts retain source-entry provenance.
  - Item-13 focused acceptance covers source, bundle, Runtime, Session Store, Server, Desktop, and example artifact behavior. Six TypeScript projects, root lint, browser/Bun bundles, renderer-only Vite, and final Standards/Spec review passed; the full suite retains only the independently reproduced fixed-point Server shutdown timeout.
- Boundary: authors can compose deterministic standing instructions and trusted per-Turn context/state-derived instructions into one explainable prompt snapshot used through Pi without adding a message protocol or a second execution loop.
- Explicit non-goals: no Session- or step-scoped prompt mutation, dynamic model/tool/connection/stream options, arbitrary runtime module loading, tool execution from instructions, variable-provider system, hooks, UI editor/preview, prompt registry, template language, or instruction migration.
- Visible gaps: item 14 still owns broader dynamic capability snapshots; item 10 still owns Agent Variable authoring/promotion; hostile-code isolation remains part of the later Sandbox/ExecutionEnv boundary rather than an instruction-specific sandbox.

## Dynamic Capability Snapshots

- Status: shipped V1
- Freshness: confirmed
- Last checked: 2026-07-23
- Evidence:
  - ADR 0007 fixes Eve-shaped `defineDynamic({ events: { "turn.started": ... } })` for model and tool authoring only. Dynamic models require a fallback; resolver failure/null uses it. Dynamic tool resolvers may generate schemas and override static names, skip only their own failure, and fail the Turn on dynamic/dynamic name collision.
  - The compiler assigns inline dynamic tool callbacks stable artifact-owned step IDs and captures JSON closure values. Artifact and closed-bundle tests preserve resolver/step identity; Session reload reconstructs the callback from the persisted snapshot and compiled registry without re-running the resolver or prior tool call. Dynamic capability Projects require a Session Store.
  - Every Host supplies a cloned serializable `AgentCapabilityPolicy` over model/reasoning choices, safe option bounds, and compiled tool/connection contribution IDs. Desktop Thread values are Turn requests within that policy; unavailable or denied selections fail before Pi.
  - `AgentSession` resolves instructions and capabilities from one frozen Turn view and commits both in one Session Store CAS. The integrity-checked capability snapshot records Agent/policy/request fingerprints, effective model/reasoning and safe Turn-level model options, tool definitions/provenance, dynamic step closures, and static connection tool fingerprints; its journal entry stays outside transcript, Pi events, and Run replay.
  - Manual mode still records capabilities but exposes no state scope and keeps tools deferred. Continuation reuses the persisted snapshot; changed requests are rejected, artifact drift fails closed, and changed Host policy produces explicit Desktop/Server `hostPolicyChanged` termination without mutation or re-resolution.
  - Static MCP connections remain compiled and Host-owned. Snapshots include only the remote tool surface exposed to the model—logical connection/contribution names plus schema fingerprints—never URL, auth, headers, environment, callbacks, or connection runtime objects.
  - Item 19 adds static approval requirements to immutable tool capability snapshots and rehydrates them without replaying the resolver. Dynamically generated tools may use a static requirement, while conditional callbacks are rejected explicitly because the existing dynamic-step closure cannot safely persist new executable policy behavior.
  - Focused acceptance passes 59 tests across compiler/Runtime/Session Store/Desktop/Server. Full verification passes 283/284 tests and 1116 assertions with only the independently reproduced fixed-point Server shutdown timeout; six package TypeScript projects plus root TypeScript, root lint, five non-packaging bundles, renderer-only Vite, and diff checks pass.
- Boundary: each external Turn resolves one authored capability set from verified context and automatic read-only state, intersects it with explicit Host policy and safe Host requests, records it immutably beside instructions, and uses that same selection throughout Pi iteration and restart continuation. Pi remains the provider/tool loop and performs its own context-dependent `maxTokens` reduction per provider call.
- Explicit non-goals: no dynamic connections, session/step capability mutation, runtime code/plugin discovery, arbitrary path loading, dynamically generated conditional approval callbacks, Sandbox, advanced MCP lifecycle, policy UI, Trace UI, provider-specific secret options, automatic resolver/tool retry, or permission escalation.
- Visible gaps: item 23 owns remote tool-list refresh and schema drift; item 17 owns hostile-code isolation and Sandbox authority; item 26 owns lifecycle hooks. V1 exposes no dedicated capability snapshot UI and does not attempt semantic secret-taint detection inside trusted authored JSON closure values.

## Named Structured Output Contracts

- Status: shipped V1
- Freshness: confirmed
- Last checked: 2026-07-18
- Evidence:
  - ADR 0008 fixes flat filename-owned `outputs/<name>.ts|js` modules with public `defineOutput({ description, schema })` and TypeBox schemas. Discovery rejects nested, symbolic, non-regular, unsupported, duplicate, invalid, and reserved entries; compiler, immutable snapshot, artifact, schema/capability fingerprint, and closed-bundle fixtures preserve exact contract identity.
  - Runtime adds one Eve-shaped reserved Pi tool, `final_output`, only when a caller selects a compiled name. Raw arguments are checked before Pi coercion; duplicate or mixed batches block every sibling before execution; manual mode automatically validates only this terminal tool; missing, invalid, and oversized values fail once with the three stable codes and no repair, retry, prose parsing, or fallback.
  - Host size authority defaults to 256 KiB and is configurable only from 1–768 KiB. Runtime Run configuration records name, schema fingerprint, and effective limit; the completed terminal atomically stores the identical JSON value. Session Store hydration rejects non-JSON values, mismatched contracts/fingerprints, oversized values, and completed Runs missing their configured result.
  - Protected Server Run creation accepts only an optional declared name. Text-only idempotency remains byte-compatible; selected-name identity, Pi execution, durable repository terminal, real stop/restart replay, and the generic browser client are covered by Server integration tests. The replayed terminal must equal the first terminal exactly. The protocol remains schema version 1 and adds the typed value only to existing `runTerminal`.
  - Agent Project Threads persist an optional selection, snapshot it per Run, and forward only the name through Desktop Direct or Local Server. The Output row sits between Tools and Variables, schema detail is read-only, ordinary Threads have no row, and the internal tool pair renders as one generic success/failure card in the message flow and Run History.
  - Current real-CEF audit `audits/2026-07-18-175602-named-structured-output/` proves selection, schema inspection, generic result projection, hidden `final_output` mechanics, Run History reuse, semantic controls, clean console output, and 1280×800/900×700 layouts without document overflow.
  - Eighty-four focused compiler/Runtime/Desktop/Server/client/Core checks pass across valid, missing, invalid, mixed, duplicate, manual, Host-limit, collision, persistence, restart, replay, idempotency, stale-prior-result, and continuation-branch boundaries. Full verification runs 299 tests: 298 pass with 1166 assertions; the only failure remains the independently reproduced fixed-point Server shutdown timeout. Seven TypeScript configurations, lint, five non-packaging Bun bundles, renderer-only Vite, and diff gates pass.
- Boundary: a trusted Agent Project may declare deterministic named TypeBox output contracts; one Thread or Channel Turn may select exactly one name or ordinary text. Pi remains the provider/tool loop and `AgentEvent` vocabulary, while the Runtime terminal is the authoritative typed result across Desktop, Server, restart, and replay.
- Explicit non-goals: caller-supplied schemas, authored defaults/names/versions/repair logic, Standard Schema adapters, provider compatibility tables or probing, provider-native response-format forks, prose parsing, automatic repair/retry, generated forms, contract-specific UI, a second event vocabulary, or public plugin SDK.
- Visible gaps: no credential-backed live-provider smoke was available in the isolated audit; provider-native response formats may become an internal optimization only if Pi later exposes a stable portable contract. Full assistive-technology and clipboard-permission testing, schema-generated forms, and contract evolution remain later work.

## Headless Thread Execution And Evaluation

- Status: shipped V1
- Freshness: confirmed
- Last checked: 2026-07-13
- Evidence:
  - `packages/core/src/types/threads/thread.ts` owns the durable schemas for prompt variables, variable snapshots, run snapshots, evaluation rubrics, scores, and evaluations.
  - `packages/core/src/client/` owns transport-independent streaming, event reduction, conversion, and run eligibility; `packages/core/src/parsers/` owns native/foreign thread parsing and normalization.
  - `packages/core/src/thread/` now owns prompt-variable rendering/snapshot semantics, usage validation/arithmetic/fallback, run-history normalization/recording, and rubric/evaluation persistence rules behind `@llm-space/core/thread`.
  - Desktop imports durable variable behavior directly from core. `variable/prompt-variable-skills.ts` owns enabled local skill discovery, `prompt-variable-options.ts` owns UI labels, and `prompt-variable-display.ts` owns CodeMirror completion/hover presentation; the former mirror façade was deleted. Desktop undo/redo and image-memory policy remain in `stores/thread-history.ts`.
  - `apps/desktop/src/bun/traces/trace-manager.ts` now uses the core usage aggregators instead of a private duplicate implementation.
  - The public-entrypoint headless workflow test materializes prompt variables, records two runs with usage, and persists a structured evaluation without desktop imports; frozen prompt bytes and the missing-skill error contract have focused coverage.
  - All 54 Bun tests, core TypeScript, lint with its one pre-existing warning, and the Vite production build passed on 2026-07-12. Focused tests cover usage compatibility, run caps/fallback IDs, injected-ID collisions, variable normalization, multi-place snapshots, and template-preserving snapshot application. Desktop TypeScript retains the same pre-existing unused `HELLO_WORLD_BUILT_IN_TOOLS` diagnostic.
  - Real Electrobun CEF loaded the existing configured `GPT-5.3 Codex Spark`, materialized a current-date/skills template, and entered the real run path without prompt/RPC/render errors. The provider then failed with `Unable to connect`, so no completed run was available for live persistence inspection; the temporary test thread was removed.
- Boundary: a core-only consumer can materialize a variableized Thread with injected skills/time, apply canonical usage semantics, record and normalize bounded runs, and create/update valid rubrics and evaluations. Desktop supplies local skill discovery and owns UI/session behavior.
- Explicit non-goals: React/Zustand state, CodeMirror completion UI, Electrobun RPC and commands, native menus/windows/updates, desktop analytics, and dynamic third-party plugins do not belong to this capability.
- Visible gaps: core still contains desktop-specific window-state persistence; the new public entrypoint has no real second product consumer beyond desktop and its headless integration test; a successful live-provider run/reload smoke remains pending because the configured provider was unreachable in this loop.

## Agent Definition And Runtime

- Status: shipped Agent Definition And Runtime V1, inspectable Artifact V1, and Desktop Runtime Harness integration
- Freshness: confirmed
- Last checked: 2026-07-16
- Evidence:
  - Eve commit `626c17678b0398d64b1c38f5c293f88889807941` was inspected as the primary structural reference. `packages/runtime/src` now separates public definitions, shared authored/compiled representations, internal authored validation, non-executing discovery, trusted compiler normalization, runtime Agent/model preparation, runtime session lifecycle, and execution policy/event projection.
  - `@llm-space/runtime` now exports only authored and cross-environment pure contracts; `@llm-space/runtime/node` explicitly exports filesystem discovery/compiler and host execution without re-exporting root. A browser-target root bundle succeeds, and `public/`/`shared/` contain no Node/runtime/execution imports.
  - Discovery emits source manifests and diagnostics without executing authored modules; the trusted compiler imports code and returns an immutable snapshot. Focused tests cover no-execution discovery, missing/invalid/symlinked slots, definition/tool/skill compilation, fingerprinting, and hot reload.
  - Definition data now progresses through `AgentDefinition` -> `CompiledAgentDefinition` -> resolved runtime model. `AgentRuntime` creates a Pi Agent-backed `AgentSession`; runtime-owned prepared tools keep Pi deferred markers/placeholders out of Desktop while preserving manual, auto-once, ReAct, dangerous-bash deferral, and MCP error behavior.
  - Runtime tests cover definition loading/hot reload/symlink rejection, default and override model resolution, unavailable defaults, manual deferred continuation across session reload, auto-once termination, abort terminal persistence, persistence-before-terminal-event ordering, and a complete Pi ReAct project-tool run.
  - Desktop Agent Project Threads route through the Bun-owned runtime session over typed RPC. Thread remains the single durable transcript while runtime owns model/tool/continue/ReAct execution; each run records effective model/reasoning and Agent-vs-override provenance.
  - Current CEF audit `audits/2026-07-14-155043-agent-definition-runtime/` shows required `agent.ts` in Build, raw authored unavailable-model display without fallback, `From Agent`/`Thread override`, watched drift, field-specific sync confirmation, one-step undo, and no document overflow or relevant console errors at 1280×800 and 900×700.
  - The prior Desktop Builder/Target experiment is preserved as historical evidence in `audits/2026-07-13-002622-agent-builder-v1/`, but the current Desktop intentionally no longer exposes that second Agent product model.
  - Current CEF audit `audits/2026-07-14-005810-agent-navigation-editor/` shows one Agent Build surface for both default-directory and explicitly opened projects, with source editing and desktop-owned nested Threads behind the same typed runtime/RPC boundary.
  - Roadmap item 01 audited installed `@earendil-works/pi-agent-core@0.80.3`, npm `0.80.7` at `818d674`, and upstream main at `5e336cf`. Harness can only model manual work by keeping the whole run busy on an unresolved tool Promise; it cannot provide LLM Space's settled manual/reload contract. The accepted session boundary therefore uses official Pi `Agent.continue()` under LLM Space `AgentSession`, removes the runtime snapshot's `AgentHarnessResources` dependency, and passes the 14/14 focused runtime/Desktop behavior matrix.
  - Fresh item-01 acceptance on 2026-07-16 passed 14/14 focused Runtime Harness fixtures, 136/136 repository tests, all five TypeScript projects, focused and repository-wide lint, a browser-target runtime bundle, and the renderer-only Vite build. Pi upstream moved only for an unrelated Windows terminal-title fix; npm latest remains `0.80.7`.
  - Roadmap item 02 exposes `@llm-space/runtime/harness` as a browser-safe Host seam. Its nine-state Runtime Run matrix, one-active-Run branch rule, immutable configuration identity, versioned Session snapshot, ordered journal, atomic rollback, and stale/simultaneous CAS rejection pass 7 focused tests with 106 assertions and the 143-test repository suite.
  - Roadmap item 03 stores the validated Session Store record inside each Desktop Thread, keeps one Runtime Run identity across settled manual reload/continue without a synthetic user message, atomically supersedes configuration/context branches, and groups immutable checkpoints under the current Session-authoritative state. Agent Project Bun-side transcript writes were removed, and standalone execution now uses Pi `AgentSession` for all three execution modes.
  - Roadmap item 04 classifies fresh-process Session state at the public harness seam, preserves safe wait identity, protects resume claims through CAS, validates journal-to-snapshot reconstruction, projects ordered scoped cursor replay, and terminalizes unsafe model/tool work as `outcomeUnknown`. Desktop persists the unknown outcome before refusing transport execution.
  - Roadmap item 05 deepens the trusted compiler's immutable snapshot with a versioned plain-data artifact descriptor. Canonical SHA-256 sections identify logical source, exact bundled inputs, compiled capabilities, local tool schemas, exact Bun/resolved dependency/production runtime source, and the Bun environment requirement; the overall fingerprint excludes absolute project paths.
  - Item-05 fixtures prove repeated and cross-root determinism, same-byte compiler/artifact capture even when authored code edits its own source during import, dependency-only change isolation, capability/schema isolation, deep freezing, and absence of credential/URL plaintext from the descriptor. The canonical example builds without repair and inspects all six sections.
  - Final item-05 acceptance passed 18 focused tests, 171 repository tests, all five TypeScript projects, touched and repository lint, browser-safe runtime/harness bundles, renderer-only Vite build, `git diff --check`, and Standards/Spec re-review with no remaining findings.
- Boundary: a filesystem-authored Agent must define static model/reasoning defaults in `agent.ts`, plus instructions, TypeScript/JavaScript tools, and skills. Trusted compilation returns an immutable executable snapshot with an inspectable artifact identity; sessions may persistently override model/reasoning, and Desktop standalone plus Project Threads execute/debug through the same Runtime Harness while retaining editable messages and grouped checkpoint history. Each Desktop Thread is its Session Store and sole durable transcript owner; recovery/replay operates only on existing control-plane state.
- Explicit non-goals: serialized artifact files/registries, SBOM/signing/attestation, dynamic model resolvers, automatic compaction/session budgets, Server Session Store migration, filesystem/database/cloud persistence adapters, external-effect retry or exactly-once claims, distributed workflow durability, channels, schedules, sandbox provisioning, subagents, public plugin SDK, dynamic third-party loading, or separate Desktop Builder/Target Agent model.
- Visible gaps: Studio Server profiles, artifact/source migrations after a real schema evolution, source-declared environment variables, trusted adapter idempotency evidence, compaction, and canonical Trace remain later roadmap capabilities. Isolated CEF did not execute a paid live provider; deterministic Pi/Session Store fixtures cover runtime behavior. Trusted project tools remain unsandboxed. Pi has no native durable pause-before-tool state, so settled manual mode remains an LLM Space-owned deferred-result policy over Pi `Agent`.

## Independent Agent Serving

- Status: shipped Local Server Protocol V1
- Freshness: confirmed
- Last checked: 2026-07-16
- Evidence:
  - ADR 0002 fixes the approved fail-closed principal, TLS/terminator, exact Session ownership, continuation lifecycle, atomic Server repository, Pi event, SSE cursor, limits, CORS/Host, recovery, and shutdown contract.
  - Private `@llm-space/server` loads one immutable compiled Agent, owns many isolated Runtime Sessions, persists one versioned/revision-checked atomic envelope per Session under an exclusive process lock, and recovers unsafe work as one durable `outcomeUnknown` terminal.
  - `llm-space serve` validates and scrubs Bearer secrets and reads TLS material before authored modules load. Local-dev plaintext is loopback-only; all other startup requires direct TLS or an exact trusted terminator boundary.
  - `@llm-space/runtime/client` generates 32-byte continuation credentials, issues idempotent commands, parses version-pinned Pi `AgentEvent` SSE, reconnects after real transport failure, honors bounded retry hints, advances only contiguous cursors, and deduplicates only exact replays.
  - Focused Server/client/serializer acceptance passes 24 tests with 126 assertions covering authentication/ownership, persistent idempotency, repository locking/CAS/schema, input-before-`202`, Pi streaming/sanitization, exact replay and disconnect, restart unknown outcome, TTL/rotate/revoke, abort, capacity, CORS/Host/TLS/proxy, limits, safe errors, graceful/timed-out shutdown, terminal settlement ordering, and authorization-before-cursor/body privacy.
  - Final non-packaging validation passes 195 repository tests with 729 assertions, all six TypeScript projects, repository lint, a 12.42 KB browser client bundle, a 6.39 MB Bun Server bundle, renderer-only Vite, and `git diff --check`.
- Boundary: one Bun deployment loads one compiled Agent artifact and serves many principal-owned isolated Runtime Sessions through fail-closed authenticated HTTP/SSE, Runtime-owned Session/Run IDs, Channel-owned continuation credentials, ordered Pi plus terminal events, explicit abort, restart recovery, and authorized exclusive-cursor reconnect. Server source/configuration remains Host-owned and immutable for the process lifetime.
- Explicit non-goals: anonymous production fallback, vendor Channel adapters, hosted identity/OAuth, attachments or caller model overrides, remote agents, schedules, multi-project loading, distributed storage, OCI/container/cloud control plane, sandbox claims, exactly-once effects, canonical Trace, or Studio Runtime Profile UI.
- Visible gaps: OCI packaging, vendor Channel normalization/delivery, approval/attachment semantics, richer authenticators, external-effect idempotency, distributed storage, actual sandboxing, and canonical cross-host Trace remain later roadmap items.

## Studio Runtime Profiles And Server Trace Handoff

- Status: shipped V1
- Freshness: confirmed
- Last checked: 2026-07-21
- Evidence:
  - ADR 0003 established Bun-only continuation-secret custody, stable Desktop principal identity, per-artifact embedded Server lifecycle, Server-owned Run identity, non-secret lineage, and artifact-drift rules. The owner revised only its development-time per-Thread profile immutability on 2026-07-21: settled Project Threads now select profiles in place without migrating or clearing debug data.
  - Core Thread and Run History schemas default legacy Threads to Desktop Direct, persist only artifact/Server Session/Run lineage, and reject inconsistent duplicated Server Run IDs.
  - The Desktop Bun composition lazily owns one protected loopback Server per artifact through `DesktopHost`; `LocalServerCredentialStore` persists raw continuation credentials separately under `LLM_SPACE_HOME/credentials/` with private permissions and atomic writes. Deletion revokes through the active Server or an exclusive Server-owned offline repository command, including full restart plus artifact drift, before deleting the Desktop credential.
  - Local Server execution remains on the existing typed RPC stream and version-pinned Pi event projection. The transport supplies authoritative Server Run identity, so the Desktop store creates no second `runtimeSession` or Runtime Run.
  - Agent Project Threads expose Desktop Direct, Desktop Sandbox, and Local Server with explicit differences and lifecycle state. Local Server locks Agent configuration, uses Server-owned transcript/Run identity, and permits one trailing pure-text user draft. Profile or latest-artifact selection updates the current Thread; historical Run provenance remains frozen and a changed continuation boundary branches.
  - Terminal Server Runs open in existing Run History and `RunTraceView`, which displays non-secret artifact/Session/Run lineage. The experimental Langfuse Trace sidebar remains separate; canonical cross-host instrumentation remains roadmap item 32.
  - Focused parity/authority/restart/credential/schema fixtures pass 60 tests with 213 assertions. Full validation passes 204 repository tests with 778 assertions, six TypeScript projects, repository lint, browser and Bun Server bundles, renderer-only Vite, and diff checks.
  - Current real Electrobun CEF evidence under `audits/2026-07-17-060917-studio-server-runtime-profile/` covers Ready, profile explanation, disabled Sandbox, pure-text draft, stale recovery, Run History, Server lineage, keyboard/focus, 1280×800 and 900×700 overflow, and a clean application console.
  - Current 2026-07-21 CEF evidence under `audits/2026-07-20-180358-agent-debugging-parity/` confirms Sandbox → Local Server → Sandbox keeps one Thread and its messages/Runtime Session, while Run History freezes the effective `Desktop Sandbox` profile and current model override.
- Boundary: users may choose Desktop Direct, Desktop Sandbox, or one protected Local Server artifact/Session authority in the current Project Thread at settled checkpoints. Historical Runs retain their authority, incompatible waits branch, required Sandbox cannot downgrade to Direct, and projected Server Runs remain inspectable in existing Run History.
- Explicit non-goals: production migration for old Threads, profile switching during active execution, remote Server URL/token management, production fleet lifecycle, cloud control plane, raw provider payload retention, caller-supplied Server history/configuration, or copying secrets into Agent source, Thread JSON, Run snapshots, Trace data, or analytics.
- Visible gaps: remote/fleet Server management, Keychain-backed credentials, transcript migration, raw event inspection, canonical item-32 Trace, and cloud lifecycle remain later roadmap capabilities.

## OCI Agent Deployment

- Status: shipped OCI Deployment V1
- Freshness: confirmed
- Last checked: 2026-07-17
- Evidence:
  - `defineAgent().environment` declares validated, immutable config/secret names without values; invalid names/kinds/defaults, duplicate authored keys, and Server Host collisions fail before deployment. Requirements participate in the Agent Artifact fingerprint.
  - `createAgentProjectBundle()` captures stable source bytes, preserves local tools, MCP auth/header callbacks, skills and the exact item-05 descriptor, embeds the full expected descriptor, rejects non-literal runtime loading and external package imports, and emits no absolute project path or source map.
  - `llm-space build <project> --target oci --output <dir>` atomically emits exactly `Containerfile`, `agent.bundle.mjs`, `artifact.json`, `bootstrap.mjs`, `environment.json`, and `healthcheck.mjs` without invoking an OCI engine or overwriting an existing path.
  - The bootstrap validates descriptor integrity, the locked Bun compiler identity, Host settings, Bearer principals, declared Agent environment, and runtime secret absence before dynamically importing authored code. It deletes `LLM_SPACE_SERVER_AUTH_KEYS` first and reports only sanitized startup stages.
  - The generated image pins `oven/bun:1.3.14-debian` to index digest `sha256:9dba1a1b43ce28c9d7931bfc4eb00feb63b0114720a0277a8f939ae4dfc9db6f`, runs `1000:1000`, persists only `/var/lib/llm-space`, exposes `7331`, uses readiness healthcheck, and receives `SIGTERM` directly with an eight-second default drain.
  - Only a loopback peer requesting loopback `/v1/health` or `/v1/ready` may bypass trusted-proxy HTTPS/Host proof; every business route retains ADR 0002 authentication, principal, continuation, and Session authorization.
  - Non-release GitHub Actions run `29558014986` passes real `linux/amd64` and QEMU-backed `linux/arm64` image execution plus one two-platform OCI index. It proves image configuration/secret absence, health/readiness, authenticated Session stop/recreate persistence, fixed non-root volume access, bad-permission/artifact-mismatch/single-writer rejection, and clean ten-second `SIGTERM` stop. The optional live Pi provider smoke was explicitly skipped because no real credential was supplied.
  - Final local gates pass 220 tests with 849 assertions, all seven TypeScript projects, full lint, Runtime browser bundles, Bun Server/OCI bootstrap bundles, renderer-only Vite, and `git diff --check`; final Standards and Spec reviews have no hard findings.
- Boundary: one immutable project-specific Agent Deployment Image runs the existing protected Bun Server from a closed bundle, receives declared values only at runtime, exposes existing health/readiness semantics, persists Server Sessions only on the declared single-writer mount, and terminates through the bounded Server shutdown path.
- Explicit non-goals: hosted control plane, Kubernetes operator, autoscaling, managed secrets, distributed/shared storage, dynamic multi-project loading, artifact registry product, SBOM/signing/attestation, or a new Agent message protocol.
- Visible gaps: registry publication, managed secret resolvers/files, SBOM/signing/attestation, deployment UI/control plane, distributed storage, autoscaling, backup/retention automation, and live paid-provider smoke remain outside V1. Docker Actions currently emits a non-failing Node 20 deprecation notice while being forced onto Node 24; future action upgrades are maintenance, not a capability gap.

## Agent Action Authoring

- Status: shipped Portable Agent Actions V1
- Freshness: confirmed
- Last checked: 2026-07-23
- Evidence:
  - `packages/runtime/src/public/tools` exposes branded `defineTool()` definitions with path-owned identity, typed input, optional output validation, a bounded execution context, and JSON-compatible results; raw Pi `AgentTool` exports are rejected.
  - `packages/runtime/src/public/connections` exposes branded `defineMcpClientConnection()` definitions with Streamable HTTP transport, Bun-only auth/header callbacks, and required exact allowlists. Discovery remains offline and the trusted compiler owns callbacks and fingerprints.
  - Runtime tests cover local adaptation, allowlist filtering, qualified `<connection>__<tool>` names, metadata re-auth, one-attempt calls, schema validation, connection-local degradation, attempt persistence, client disposal, and connection/schema removal drift.
  - Review-fix tests cover qualified-name and duplicate connection-stem rejection, pending-only batch calls, Bun-side rejection of drifted calls, unavailable-tool model filtering, grouped durable attempt identity, session/deactivation cancellation through a real delayed MCP transport, source-reload activation serialization, awaited client disposal, deterministic preflight rejection versus ambiguous interrupted outcomes, real model tool-call identity in manual execution, bundled-dependency fingerprints/hot reload, runtime rejection of authored `name`/`label`, and a checked-in `apps/example-agent/agent/connections/fixture.ts` reference beside the local tool.
  - Fresh CEF screenshots `audits/2026-07-15-103250-portable-agent-actions-v1/01-ready-1280x800.png` and `02-source-jump-1280x800.png` show local `get-weather` plus remote `fixture__remote_echo` as read-only Project actions and the remote chip opening `connections/fixture.ts` in Build.
  - Fresh CEF screenshots `03-unavailable-900x700.png`, `04-schema-drift-900x700.png`, and `05-schema-synced-900x700.png` show connection-local retry, retained descriptors, explicit drift blocking, and Sync recovery at narrow size with no document overflow.
  - Fresh restart screenshot `06-outcome-unknown-900x700.png` shows a persisted remote pre-call attempt without output rendering `Outcome unknown` with an explicit Retry; `07-retry-warning-900x700.png` shows the guarded retry warning that the previous remote call may have completed and retry can repeat side effects.
  - The same audit found only Vite/React development console information, no application errors, and native button semantics/focusability for source chips, Retry, and Sync.
  - Current code inspection on 2026-07-22 confirms this manual remote-action path persists only a per-call `started` marker before MCP dispatch. It is a useful guarded-retry precedent, not a general Runtime operation ledger: automatic Agent tools, provider calls, result memoization, and crash-point recovery remain separate.
  - ADR 0012 adds `defineTool({ approval })` plus canonical ExecutionEnv helper approval options. Prepared tools retain approval outside Pi-visible definitions; static requirements survive immutable capability-snapshot rehydration, and conditional source policies remain trusted compiled callbacks.
  - Final closure validation passes 131 Bun tests, runtime/core/CLI/example/Desktop TypeScript, Vite production build, and `git diff --check`. Canary packaging reaches code signing and stops only because `ELECTROBUN_DEVELOPER_ID` is unavailable. The final parallel Standards and Spec reviews report zero findings.
- Boundary: a trusted Agent Project can package path-owned local TypeScript tools and flat source-declared Streamable HTTP MCP connections. Opening a Project Thread activates allowlisted remote descriptors without Settings or per-Thread selection; all Project actions are source-owned/read-only, remote names are qualified exactly, remote calls remain visibly manual, safe provenance/attempts persist, outcome-unknown retry is explicit and warns about duplicate side effects, and schema/connection drift blocks new runs until Sync.
- Explicit non-goals: no project stdio, OAuth browser/refresh/account lifecycle, dynamic connection search, blocklists, `tools/listChanged`, automatic project-MCP calls, OpenAPI connections, MCP resources/prompts, sandbox, or public plugin SDK.
- Visible gaps: no live third-party authenticated service audit, no dynamic remote tool-list subscription, and no automatic test harness for the CEF workflow yet.

## Live Project MCP Tool Freshness

- Status: deferred by owner; no active implementation plan
- Freshness: confirmed
- Last checked: 2026-07-26
- Evidence:
  - `packages/runtime/src/node/connections/remote-mcp-client.ts` lists tools once after connection and registers no `notifications/tools/list_changed` handler, even though the installed MCP SDK 1.29.0 exposes negotiated list-change handlers and automatic refresh support.
  - `ProjectMcpSession` freezes the initial allowlisted descriptors and active call map for its lifetime. A remote name or schema change is detected only after Desktop explicitly creates a new activation.
  - `ExternalAgentProjectManager` already compares persisted descriptor fingerprints on activation, blocks drifted calls before dispatch, and projects `Remote actions changed` plus explicit `Sync from Agent`; this is a safe recovery surface but it is not notified while a connection remains active.
  - Fresh real CEF evidence in `audits/2026-07-26-223657-advanced-mcp-lifecycle-discovery/` shows the checked-in Project Thread exposing only `Retry connections` when its fixture endpoint is unavailable. At 1280×800 there is no document/body overflow and the console contains only Vite/React development information.
  - MCP specification 2025-11-25 requires servers to advertise `tools.listChanged` and defines `notifications/tools/list_changed` followed by `tools/list`; the current client ignores that negotiated lifecycle.
- Boundary: active Project connections retain their activation-time exact allowlist and descriptor fingerprints. A later explicit activation detects drift and reuses the existing blocked Sync/unavailable Retry interaction; live protocol notifications are intentionally not implemented.
- Explicit non-goals: no automatic retry of `tools/call`, cancellation claim for an already-dispatched call, model-side `connection_search`, blocklists or newly exposed unknown tools, OAuth, OpenAPI, MCP resources/prompts, background polling for servers without `listChanged`, or protected-Server connection hosting.
- Visible gaps: current remote descriptors can remain stale for the lifetime of an active Project Thread. On 2026-07-26 the owner classified this as a protocol-boundary issue and deferred it together with broader MCP lifecycle expansion.

## Portable Execution Tools

- Status: shipped V1
- Freshness: confirmed
- Last checked: 2026-07-19
- Evidence:
  - The pinned `@earendil-works/pi-agent-core` 0.80.3 exposes a Host-neutral `ExecutionEnv` with fallible filesystem and shell operations, stable `FileError`/`ExecutionError` codes, addressed versus canonical paths, explicit symlink metadata, abort signals, shell timeout and stdout/stderr callbacks, temporary files, and best-effort cleanup. `NodeExecutionEnv` is a reference implementation, not a confinement boundary.
  - ADR 0009 and `packages/runtime/src/public/tools/define-{read,write,bash}-tool.ts` restrict authority to zero-configuration canonical static helpers; mismatched filenames and dynamic helper creation are compiler errors, while ordinary `defineTool()` retains its bounded context.
  - Compiler, artifact, bundle, Runtime, and Session Store fixtures prove immutable helper kind/schema/requirement identity, effective-tool filtering before the missing-authority gate, restart rehydration with a newly supplied environment, and no persisted environment configuration or `/sandbox` path.
  - One shared behavior suite passes against explicit `NodeExecutionEnv` and an isolated fake adapter for relative paths, parent creation, UTF-8 write bytes, pagination, symlink delegation, streamed stdout/stderr, nonzero exit, large-output truncation/full-output paths, file abort, shell cancellation/timeout, no retry, and Runtime-owned cleanup count zero.
  - Desktop Direct and protected Server fixtures both propagate stable `executionEnvUnavailable` terminals before Pi without constructing a host fallback. Fifty-two focused checks, seven TypeScript configurations, lint, Runtime/Server bundles, renderer-only Vite, and 307/308 full tests pass; the sole failure is the unchanged Server teardown timeout debt.
- Boundary: a project can explicitly author portable read/write/bash capability whose final effective Turn snapshot borrows exactly one Host-supplied Session-scoped Pi `ExecutionEnv`. Manual mode defers the helpers; automatic modes execute through Pi. Runtime neither translates paths nor owns environment lifecycle.
- Explicit non-goals: Sandbox/container provider implementation, workspace or attachment delivery, implicit NodeExecutionEnv construction, direct Desktop/Server filesystem access, generic permission system, approval policy, or cleanup/retention policy inside the tool definitions themselves.
- Visible gaps: the implemented Sandbox capability supplies the production Docker reference environment where the Host enables it and now passes its deterministic local real-provider gate; current-head CI is deferred by the owner. Approvals remain item 19, while additional providers and numeric resource quotas remain later Sandbox work.

## Sandbox Workspace And Attachment Delivery

- Status: shipped V1 under owner-approved local acceptance policy
- Freshness: confirmed
- Last checked: 2026-07-26
- Evidence:
  - `defineSandbox({})`, discovery, compiler, artifact, and bundle fixtures preserve only an abstract source minimum plus a bounded immutable `agent/sandbox/workspace/**` seed. Host policy may tighten but never weaken it; unavailable required-Sandbox projects open Build without silently creating or downgrading a Thread.
  - `SandboxProvider` and `DockerSandboxProvider` supply one Thread/Session-scoped Pi `ExecutionEnv`, one LLM Space-owned named volume mounted at `/workspace`, a fixed non-root/read-only/no-capabilities/no-network container, a deterministic bounded manifest, stop/reconnect/reconstruct/delete lifecycle, and no Host bind, login environment, provider secret, or dynamic connection surface.
  - Host-owned Docker labels identify the seed, while a fresh acquire that finds an existing volume fails lost instead of adopting a crash-partial seed. Missing or mismatched volumes never reseed the same identity; Desktop persists active/lost/cleanup tombstones and retries partial deletion.
  - Attachment bytes travel from Bun's native file picker directly into an exclusive Host-random staging directory and publish by rename. Its durable staging identity and ownership marker let recovery remove only Host-owned partial/final directories; collisions fail without merging or deleting Session data. The Host transaction compensates descriptor-write failure, blocks Run when compensation is incomplete, reconciles a crash after descriptor persistence, and locks exact renderer-selected message identities included in the Pi Turn. Source may still own ordinary `attachments/**` paths because delivery uses a dedicated per-Turn top-level directory rather than a reserved source namespace.
  - Focused coverage proves source/Host policy, unavailable/lost states, seed limits and identity, same-handle no-follow workspace and Host attachment reads, attachment bounds/atomicity/locking, manual/automatic binding, isolation, Pi read/write/bash/abort/timeout behavior, cleanup tombstones, and Desktop/Server fail-closed composition.
  - The current macOS arm64 host runs Docker 29.4.0 through OrbStack. The concurrent final-destination collision trigger now uses a bounded immediate watcher instead of 10 ms polling while preserving the real `renameat2(RENAME_NOREPLACE)` path. The complete real-Docker acceptance passes 10/10 sequentially with 42 assertions each and no residual containers or volumes, covering create/seed/stage/collision preservation/tool/abort/timeout/network denial/isolation/stop/reconnect/reconstruct/loss/delete behavior.
  - Prior current-head GitHub Actions run [29726512966](https://github.com/kodama-creative/ai-studio/actions/runs/29726512966) exposed the old 10 ms polling race. The local trigger correction has not been rerun in Actions because the owner explicitly deferred Actions for this loop; it is no longer a local acceptance blocker but remains an existing shipment-policy gate.
  - Current real Electrobun CEF evidence under `audits/2026-07-20-125359-sandbox-delivery-v1/` shows Build without an auto-created Thread, explicit new-Thread failure when Docker is absent, an inspectable unavailable existing Thread, the `From Files` menu, clean application console, and no page overflow at 1280×800 or 900×700.
  - Current real Electrobun CEF evidence under `audits/2026-07-20-180358-agent-debugging-parity/` shows a required-Sandbox source making an existing Direct Thread stale, fresh `Desktop Sandbox · Ready` creation, canonical bash/read/write tools, and `From Files`/`From Clipboard` attachment entry with no application console errors.
  - Current 2026-07-21 CEF acceptance in the same audit shows a fresh in-process acquire as `Preparing` rather than cleanup-pending, retained Session workspace across profile changes, GPT-5.5 Thread override provenance in Run History, no application console errors, and no document overflow at 1280×800 or 900×700. The real Docker acceptance passes 42 assertions including seed, canonical read/write/bash, attachment staging, stop/reconnect, isolation, and cleanup.
  - Current ADR/runtime inspection for item 19 reconfirms the separation: Sandbox and `ExecutionEnv` decide where an already-authorized call can run, while no Sandbox declaration, provider readiness state, attachment descriptor, or environment handle is an approval decision.
- Boundary: an Agent may require abstract Sandbox execution, while the Host exclusively selects and owns the provider, isolation arguments, Session identity, workspace, approved attachment bytes/descriptors, retention, and cleanup. Canonical tools continue to use Pi `ExecutionEnv`, and attachments remain Pi-native user text/image content plus workspace paths rather than a new message protocol.
- Explicit non-goals: Vercel Sandbox, Firecracker fleet, Apple-container V1 adapter, arbitrary host paths, project source write-back, silent Desktop Direct/Node fallback, approval policy, numeric CPU/memory/PID/disk quotas, workspace explorer/export, dynamic provider connections, generic container orchestration, cloud control plane, or source-owned engine credentials.
- Visible gaps: current-head Actions remain optional deferred evidence, not a capability or Item 10 blocker, under the owner's local-first policy. Numeric quotas, export/adoption, additional providers, and fleet operations require separate product evidence.

## Agent Project Debug Workbench

- Status: shipped V1
- Freshness: confirmed
- Last checked: 2026-07-27
- Evidence:
  - The trusted compiler can already build static/dynamic models, model options, reasoning, environment declarations, input/output Session budgets, the default-25 per-Run model-call fuse, composed static/dynamic instructions, static/dynamic typed tools, durable typed state, named structured outputs, markdown skills, MCP exact allowlists, required Sandbox/workspace seeds, canonical ExecutionEnv tools, and tool approvals.
  - The Project inspector is read-only and exposes fixed VS Code/Zed/Cursor project/file handoff, remembered editor preference, explicit unavailable-editor states, watcher-driven Building/Ready/Invalid feedback, path-specific compiler diagnostics, and a secret-safe compiled artifact summary over model, limits, environment names, Sandbox, and capabilities.
  - Source writes, dirty-buffer ownership, overwrite/conflict actions, and dirty tab/quit guards were removed from renderer, RPC, and Bun composition. Missing required source remains a confined non-existing editor target, while internal reads continue to require an existing regular non-symlink file.
  - Imported and scaffolded Projects begin with no Desktop Thread. Opening a Project selects the inspector, creating a Thread is explicit, watched source never creates or repositions one, and frozen Thread prompts/tools/connections remain unchanged until explicit Sync from Agent.
  - Watch reload revisions keep Building visible until the newest observed edit settles; older reloads cannot publish stale Ready/Invalid state.
  - CLI supports `init`, OCI-only `build`, and `serve`; it has no checkout-independent `validate`/`info` command and no Eval command. The user guide documents Thread debugging and OCI deployment but does not document Agent Project source authoring.
  - Current audit evidence under `audits/2026-07-27-122712-agent-project-debug-workbench-v1/` covers Ready artifact, Invalid diagnostics, and 1280×800/900×700 layouts. A final isolated real-CEF regression proves no initial Thread, explicit New Thread with model selector, missing `instructions.md` handoff to Zed, Invalid→Ready recovery, one retained Thread, no document overflow, and no application console error.
  - Eve `main@e40cce456284d901c73860c8e464b645d656bc01` exposes a broader authored project surface: agent config/compaction, static and dynamic instructions/tools/skills, state, MCP/OpenAPI connections and search, sandbox backends/policy, hooks, local/remote subagents, schedules, Evals, extensions, channels, and instrumentation. LLM Space matches the foundational execution subset but not the whole source surface.
- Boundary: Agent Project development belongs in VS Code, Zed, Cursor, or another external editor. Desktop may create the initial canonical scaffold, but imported/created source is thereafter read-only in LLM Space. Desktop owns source watching, compiler diagnostics, artifact inspection, and explicit user-directed Thread debugging; source changes never create, clear, sync, or move a Thread automatically.
- Explicit non-goals: in-app source authoring, capability Add/Create/Rename/Delete, source templates after initial scaffolding, visual graph builder, AI-generated source, dependency/package manager, Git client, arbitrary terminal, runtime plugin install, hosted control plane, or claiming unsupported Eve ecosystem slots through UI templates.
- Visible gaps: independent core source gaps remain local Subagents and portable Eval suites; most remaining Eve differences are integration/ecosystem layers rather than prerequisites for an Agent Studio author-debug-evaluate loop. The large combined Project Thread/inspector module is a future extraction candidate, not a V1 behavior gap.

## Agent Project Activation

- Status: shipped V1; packaged Desktop regression repaired
- Freshness: confirmed
- Last checked: 2026-07-26
- Evidence:
  - The 2026-07-26 prerequisite repair replaces rebased `import.meta.url`
    compiler-source lookup with the Runtime-owned
    `createAgentProjectBundle(agentRoot, { compilerSupportPath? })` boundary.
    One deterministic minified `agent-bundle-compiler-support.mjs` embeds the
    closed Runtime authored SDK, TypeBox, bundle reconstruction, validation,
    and dynamic-tool transformation graph; it has no sourcemap or broad copied
    source/`node_modules` tree.
  - A sidecar pins schema version, byte length, and SHA-256. Runtime reads and
    validates the exact bytes once, writes only that verified value into a
    private temporary module, and imports the copy rather than the mutable
    packaged path. Source/CLI use one process-frozen generated support;
    packaged Desktop injects its explicit `Resources/app/bun/support/` path
    with no environment-variable or path guessing.
  - Desktop generates support before direct dev, CEF dev, canary, or stable
    build entry points, copies it only into the Bun resource tree, and validates
    it before manager, RPC, or window construction. Missing, stale, truncated,
    or fingerprint-mismatched support fails Host startup without classifying an
    Agent invalid or clearing Projects, Threads, Sessions, or snapshots.
  - Top-level Runtime tests prove byte-identical generation from two different
    checkout roots, absence of checkout/dependency paths, missing/schema/
    length/fingerprint rejection, verified-byte swap resistance,
    source/support bundle-byte equality, every authored SDK surface, import
    confinement, and source-edit capture safety. Desktop's A-waits → sync-B →
    restart fixture injects the generated support and restores frozen A before
    a later Run selects B.
  - Fresh real CEF acceptance opens the checked-in `apps/example-agent` through
    the actual renderer client and Electrobun RPC as `ready`, opens Build and
    its default Thread, persists a 508-KiB closed snapshot, and restores the
    same Thread/fingerprint after process restart. The support is 4,178,318
    bytes in the checked dev build. 1280×800 and 900×700 DOM checks have no
    document/body overflow and the console has no application error.
  - Historical discovery evidence in `audits/2026-07-26-103139-general-limits-v2-discovery/02-agent-project-bundle-regression.png` records the repaired failure: both the workspace and explicitly opened `apps/example-agent` were `invalid` because packaged `createAgentProjectBundle()` resolved an unshipped `validate-authored-source.ts` beside `Resources/app/bun/index.js`.
  - `packages/cli` exposes mandatory-destination `llm-space init <directory>` over the shared Runtime Node scaffolder, with repeatable `--preset`, empty-preset `--blank` compatibility, and explicit MCP URL/tool inputs.
  - Desktop exposes New Agent Project through Welcome, the Agents sidebar, and Command Palette. It asks for a parent folder, creates only an absent kebab-case child, then auto-trusts it, creates the existing default Project Thread under `LLM_SPACE_HOME`, switches to Agents, and opens Build.
  - Current CEF audit `audits/2026-07-17-175010-canonical-agent-project/` proves default and conditional MCP dialog states, keyboard/focus behavior, 1280×800 and 900×700 reflow, real Bun RPC creation, source inspection in Build, separated source/registry/Thread ownership, and no application console errors.
  - `packages/runtime/src/manifest.ts` and `src/node/project-manifest.ts` define and safely resolve the V1 `llm-space.json` contract while rejecting traversal, absolute Agent paths, and source-root symlinks.
  - Desktop `ExternalAgentProjectManager` keeps registry/trust and project Threads under `LLM_SPACE_HOME`, validates before trust without importing tools, recursively watches trusted source, retains frozen snapshots, and executes project tools in Bun through typed RPC.
  - Current CEF screenshots `audits/2026-07-13-182809-external-agent-project-v1/02-project-restored.png`, `03-project-build.png`, and `04-project-thread.png` show the separate Agent Projects sidebar, external Build/source surface, project tool, project skill variable, and reused Thread Playground.
  - Current CEF screenshots `05-prompt-out-of-sync.png`, `07-sync-confirm-local-edit.png`, and `08-sync-undone.png` show watch-driven prompt drift, confirmation only when a local Thread prompt would be lost, and Sync from Project participating in normal undo history.
  - Current CEF screenshots `09-invalid-source.png` and `10-source-recovered.png` show an imported tool syntax error blocking the project and automatic recovery after the source is repaired.
  - Current CEF screenshot `11-project-tool-result.png` shows the existing Playground `Call tools` flow executing the trusted project `get_weather` implementation and persisting `Shanghai: Sunny, 22°C` in desktop-owned Thread data.
  - Current CEF screenshots `12-narrow-build.png` and `14-narrow-thread-final.png` plus DOM checks confirm 900×700 Build/Thread layouts without document overflow or a visible editor horizontal scrollbar; the final console contained no application errors.
  - Isolated filesystem verification found only `llm-space.json`, instructions, tool, and skill source inside the external project; registry, trust, Thread, messages, tool results, and run state remained under the temporary `LLM_SPACE_HOME`.
  - Focused and full validation passed 76 Bun tests, runtime/CLI/core TypeScript, lint (one pre-existing warning), and Vite production build; desktop TypeScript reports only the same pre-existing unused example constant.
  - `apps/example-agent` is now a private Bun workspace and canonical manifest-defined reference project with dependency-free portable Agent source, app-local instructions, deterministic `get_weather`, `weather-brief`, README trust/data-boundary guidance, and a contract test against the public runtime loader.
  - Current CEF screenshots `audits/2026-07-13-220758-example-agent-app/03-example-project-build.png`, `05-example-project-tool-result.png`, `06-example-project-narrow.png`, and `08-example-tool-result-restored.png` show the checked-in app restored as a watched external project, all three source slots, project tool/skill state, `Shanghai: Sunny, 22°C` from real Bun RPC execution, a 900×700 overflow-free layout, and full app-restart persistence.
  - Full validation now passes 77 Bun tests, example/runtime/CLI/core TypeScript, lint with the same pre-existing warning, and Vite production build. Desktop TypeScript retains only the same pre-existing unused example constant diagnostic.
  - Current CEF screenshots `audits/2026-07-13-232652-agent-navigation-editor/02-single-source-editor-watching.png` and `03-typescript-as-markdown-single-file.png` confirm the Build surface uses one replace-in-place source selection, exposes `Watching` in three Agent contexts, and mounts one CodeMirror whose `.ts` content is parsed through the default Markdown path rather than TypeScript language support.
  - Current CEF audit `audits/2026-07-14-005810-agent-navigation-editor/` shows a manifestless workspace Agent auto-discovered into the same inventory and Build/Threads flow as explicitly opened projects, with no provenance badge or separate Builder/Target path.
  - `packages/runtime/src/node/project-manifest.ts` defaults a missing manifest to schema version 1 and `agent: "agent"`; focused tests preserve explicit-manifest confinement and symlink rejection.
  - Desktop now has one Agent Project manager/typed path. It recursively discovers canonical workspace paths, merges and deduplicates registered paths, auto-trusts only the canonical workspace boundary, and keeps every project Thread under desktop-owned `LLM_SPACE_HOME/projects` data.
  - Current CEF audit `audits/2026-07-20-180358-agent-debugging-parity/` confirms Project Threads reuse `ThreadPlayground`, `ModelConfigEditor`, and `ModelParamsPopover`; Desktop Direct/Sandbox model and reasoning overrides are editable, selecting GPT-5.5 changes provenance from `From Agent` to `Thread override`, and `Sync from Agent` resets the local override. Only Local Server sets configuration read-only.
  - Current 2026-07-21 acceptance makes the shared selector and parameter actions visible at rest, persists repeated model-change events as one Thread override, and grants only Desktop `threadOverride` runs explicit Host model-configuration authority. The real Run History records `openai-codex/gpt-5.5 · Desktop Sandbox`; Local Server remains Agent-owned and read-only.
  - Runtime Profile selection now mutates the current Project Thread in place. Direct/Sandbox/Local Server transitions preserve messages, Run History, and Desktop Runtime Session data; profile changes branch a waiting Runtime Run through the continuation fingerprint instead of resuming under the wrong authority. Leaving Sandbox stops its container without deleting the named volume.
  - `apps/sandbox-example-agent` is a separate checked-in learning path with `defineSandbox({})`, an immutable workspace README seed, canonical read/write/bash declarations, README walkthrough, and a source contract test. It is intentionally not added to the Desktop template picker.
- Boundary: source/runtime and packaged Desktop support creating or opening one portable Agent Project in the default workspace or an explicit user-owned directory, compiling it through one validated closed support boundary, persisting Bun-only frozen snapshots, and using the shared Build and nested Project Thread flow without repository-only compiler paths.
- Explicit non-goals: no external source copy, Git/cloud/deployment workflow, Builder Agent or AI source mutation, sandbox or per-call approval system, public plugin SDK, multiple Agents per manifest, graphs/subagents/schedules, breakpoint debugger, directory merge/overwrite, directory-move migration, or destructive deletion of desktop-owned project data.
- Visible gaps: the legacy automatic first-workspace example seed still emits a pre-canonical bare tool object and is independently invalid; the checked-in canonical `apps/example-agent` is ready and remains the compiler acceptance target. The unavailable-model badge still does not include a dedicated adjacent action, native-picker completion remains a manual supplementary check, and source moves plus automated CEF coverage remain future work.

## Canonical Agent Project Scaffolding

- Status: shipped V1
- Freshness: confirmed
- Last checked: 2026-07-20
- Evidence:
  - ADR 0005 fixes user-owned portable source, Desktop-owned registry/trust/Threads, absent-target collision semantics, canonical base content, the three shipped presets and defaults, CLI compatibility, MCP constraints, and repository-owned conformance.
  - `@llm-space/runtime/node` exports the sole `scaffoldAgentProject()` implementation; browser-safe Runtime exports share preset/config validation with the renderer without importing Node execution code.
  - The scaffolder canonicalizes an existing parent, validates a strict kebab-case child and preset input, renders in a sibling private stage, loads the complete project through Runtime, atomically reserves the absent destination, and publishes the whole root with one rename. Failures remove staging and never merge with or recursively delete a raced target.
  - The canonical base always emits manifest, instructions, Agent model/reasoning, and an environment requirement. Independent `echo`, `concise-response`, and explicit HTTP(S) MCP contributions compose in canonical order without secrets or network validation.
  - Repository-owned tests exhaust all eight preset combinations and prove Runtime load, local-tool execution, MCP/skill shape, and deterministic OCI context creation without source repair. Focused final acceptance passes 32 tests with 187 assertions.
  - CLI parsing tests prove mandatory destination, default local-tool + skill, `--blank`, repeated explicit presets, MCP inputs, and invalid combinations. Desktop manager tests prove successful source/trust/default-Thread ownership and source cleanup when Desktop activation cannot commit.
  - Real Electrobun evidence under `audits/2026-07-17-175010-canonical-agent-project/` verifies the three creation entry points, dialog states and accessibility, conditional MCP fields, real RPC generation, and Build landing at both target sizes.
  - Current source inspection confirms V1 still exposes only `local-tool`, `skill`, and `mcp-connection`; neither the scaffolder nor `apps/example-agent` teaches `defineSandbox({})`, `agent/sandbox/workspace/**`, canonical read/write/bash helpers, or Sandbox attachments.
- Boundary: CLI and Studio create the same canonical portable source into a wholly absent user-owned directory. V1 composes only `local-tool`, `skill`, and `mcp-connection`; defaults are local tool plus skill, and MCP requires an HTTP(S) URL plus one or more exact allowlisted names. Generated projects intentionally carry no repository-specific test/Eval protocol.
- Explicit non-goals: no marketplace, remote/community templates, duplicated full templates, unshipped capability presets, dependency installer, Git setup, auth/OAuth/stdio MCP, secret values, network validation, source mutation after creation, or silent overwrite/merge.
- Visible gaps: a Sandbox example/preset is absent. Portable generated Eval suites remain item 29, Thread promotion remains item 10, and native folder selection is not automated in the CEF audit. Remote templates, dependency management, and source merge/adoption require separate future product decisions.

## Thread-To-Agent Project Promotion

- Status: contract accepted; blocked on item 17 acceptance; V1 not implemented
- Freshness: confirmed
- Last checked: 2026-07-20
- Evidence:
  - A current isolated Electrobun CEF run at 1280×800 created a real blank standalone Thread. The Thread surface exposes model, tools, variables, system prompt, editable messages, run history, and evaluations, but Welcome, Thread toolbar, menus, Command Palette metadata, typed RPC, and Bun managers contain no promotion command, preview, or materializer.
  - Core `Thread` stores optional model/reasoning parameters, system-prompt and message templates, built-in/custom variable state, four distinct tool kinds, Runtime snapshots, run history, reusable rubrics, and manual evaluations. These are Desktop development/session records rather than portable Agent source.
  - Runtime Agent Project discovery compiles `agent.ts`, `instructions.md`, `state/*`, `tools/*`, `connections/*`, `skills/*`, `outputs/*`, and `sandbox.ts`/`sandbox/*`. It has no variable, example, promotion-intent, or Eval source slot; adding one would change the authored source and artifact contract.
  - Thread `function` tools carry schema/description but no executable implementation. `builtin` tools execute through the trusted Desktop registry, `mcp` tools reference Settings-owned server identity/transport/auth, and `project` tools reference another trusted project snapshot. Copying any of them as a local authored tool would be a silent substitution or authority expansion.
  - Thread custom variables are literal Desktop values that may contain private data; built-in values such as current date and available skills are Host/runtime-derived. The current project Runtime does not resolve Thread variable definitions in portable instructions.
  - Manual evaluation rubrics, run scores, verdicts, and notes are explicitly Thread-owned evidence. ADR 0005 says generated projects carry no test/Eval protocol before roadmap item 29, so item 10 cannot invent one or silently reinterpret comparison history as portable assertions.
  - Dify and Langflow primary docs make export contents, credentials/variable references, version compatibility, and non-exported logs/conversations explicit. Promptfoo requires authored test cases and assertions rather than inferring evaluation contracts from past runs.
  - ADR 0006 and the Eve state research fix the future contract: promotion is preview-first and atomic; Agent Variables, Turn context, Session State, transcript, and external memory remain distinct; local tool and stdio MCP authority is Sandbox-only; exact literals require visible confirmation; evaluation intent is non-executable; and conversation examples defer to item 29.
- Boundary: today a standalone Thread and an Agent Project remain independent product objects. The accepted implementation will classify every field, resolve all blockers in a temporary preview tab, publish only into an absent user-owned target, and create a fresh independent Project Thread with no transcript, Run, evaluation, state, or Session identity inheritance.
- Explicit non-goals: no hidden promotion metadata, live Thread/source synchronization, secret-store or Session-state copying, implicit Desktop built-in authority, generated fake tool implementations, Host fallback for Sandbox requirements, source overwrite/merge, transcript migration, Eve compatibility promise, conversation-example format before item 29, or premature executable Eval protocol.
- Visible gaps: items 12, 13, and 16 are shipped, while item 17 passes local deterministic real-Docker acceptance but awaits the deferred current-head CI gate under existing shipment policy. Product code still lacks the planner, variable/evaluation-intent source slots, preview interaction, atomic coordinator, acceptance matrix, and real CEF audit evidence defined by ADR 0006.

## Agent And Thread Workbench Navigation

- Status: shipped One Agent Model And Source Workspace V1
- Freshness: confirmed
- Last checked: 2026-07-14
- Evidence:
  - Current CEF baseline `audits/2026-07-13-232652-agent-navigation-editor/01-stacked-sidebar-watching.png` shows Threads/files and imported Agents stacked rather than switchable.
  - Current Build baseline `02-single-source-editor-watching.png` shows a source explorer feeding one replace-in-place editor with no open-file tabs.
  - Current TypeScript baseline `03-typescript-as-markdown-single-file.png` and DOM inspection show one `.cm-editor`; TypeScript keywords and identifiers do not receive the dedicated CodeMirror TypeScript parse/highlight classes.
  - The pre-implementation `apps/desktop/src/app/page.tsx` owned only a conditional `files | traces` mode, leaving `FileSystemTreeView` and `ExternalAgentProjectsPanel` stacked; the current implementation persists `threads | agents | traces` and falls back safely when Traces is disabled.
  - The pre-implementation `_ProjectBuildPane` owned one replace-in-place source buffer and the editor supported only Markdown/JSON. The current pane owns independent per-path buffers and selects explicit Markdown/TypeScript/JavaScript CodeMirror modes.
  - Current CEF screenshots `audits/2026-07-14-005810-agent-navigation-editor/02-build-instructions-tab.png`, `03-three-source-tabs-dirty.png`, `04-dirty-source-close-confirm.png`, `05-source-conflict.png`, `06-narrow-three-tabs.png`, and `08-reload-dirty-confirm.png` prove initial instructions opening, independent three-file buffers, TypeScript parsing, dirty state, safe close, disk-conflict resolution, 900×700 reflow, and typed reload protection.
  - Current DOM/console inspection found one active CodeMirror, dedicated TypeScript token spans, zero `Watching` labels, zero document overflow at 1280×800 and 900×700, and no relevant application console errors.
- Boundary: users can persistently switch the sidebar among Threads, Agents, and optional Traces; discover default-directory and explicitly opened Agents through one inventory; expand Agent Threads; and safely open, edit, switch, save, conflict-resolve, and close multiple Markdown/TypeScript/JavaScript source buffers inside one Agent Build surface.
- Explicit non-goals: no project-wide search, split editors, drag-reorder, LSP, IntelliSense, diagnostics/lint service, Git status, source creation/deletion/rename, or broad app-tab redesign in V1.
- Visible gaps: source tabs and drafts intentionally do not persist across restart; project-wide search, LSP, split editing, source CRUD, tab reordering, and automated end-to-end CEF coverage remain future work.

## Token Usage Visibility

- Status: shipped V1
- Freshness: confirmed
- Last checked: 2026-07-05
- Evidence:
  - Current discovery screenshot `audits/2026-07-05-002359-token-usage-discovery/01-current-first-run.png` shows the first-run/product surface is healthy enough to inspect.
  - Current discovery screenshot `audits/2026-07-05-002359-token-usage-discovery/02-example-run-history-no-usage.png` shows the thread editor and Run history panel expose model, messages, and run-history controls, but no token/cost counters or per-step usage summary.
  - `node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js` emits `message_end` with the provider's final assistant message, including `usage`.
  - `node_modules/@earendil-works/pi-ai/dist/types.d.ts` defines provider `Usage` with input, output, cache read/write, reasoning, total tokens, and cost fields.
  - `packages/core/src/client/reducer.ts` now copies non-empty provider usage from `message_end` into the final assistant message.
  - `packages/core/src/types/messages/usage.ts` and `messages.ts` define a backwards-compatible optional assistant-message `usage` field.
  - `packages/core/src/client/converters.ts` preserves saved assistant usage when replaying context to pi.
  - `apps/desktop/src/components/thread-playground/message/token-usage-summary.tsx` renders compact per-step token/cost chips with tooltip breakdowns.
  - `apps/desktop/src/components/thread-playground/token-usage.ts` formats provider usage, aggregates assistant-step usage, and falls back to old snapshot aggregation only when older saved runs lack their own `usage`.
  - Implementation screenshots `audits/2026-07-05-002359-token-usage-visibility-v1/02-token-usage-thread-open.png`, `06-run-history-layout-fixed.png`, `07-run-trace-visible.png`, and `04-token-usage-after-reload.png` show per-step usage, run/trace usage, and reload persistence in the real CEF renderer.
  - Follow-up screenshot `audits/2026-07-05-002359-token-usage-visibility-v1/08-token-usage-header-cache.png` and DOM checks on port `9362` show assistant usage chips in the same header row as `Assistant`, with cache read shown as `cached` and cache write shown as `cache write`.
  - Review-fix screenshots `audits/2026-07-05-002359-token-usage-visibility-v1/10-review-fix-run-history-open.png` and `11-review-fix-run-trace.png`, plus DOM checks on port `9363`, confirm Run history and trace headers use saved-run `usage` deltas (`210 tok ...`) rather than cumulative thread totals, include input/output/reasoning/cache/cost, omit `Cache Write 1h`, and keep `documentElement.scrollWidth === innerWidth` at 1280px.
- Boundary: users can see and retain provider-reported token/cost/cache consumption per assistant/model step, per saved run, and inside the saved-run trace inspector. Per-run displays use the run's own usage delta when available, with best-effort old-file fallback to snapshot aggregation. Per-step usage appears in the assistant message header row. Missing or all-zero provider usage is intentionally omitted from the main editor.
- Explicit non-goals: no provider billing reconciliation, quota enforcement, usage dashboard across workspaces, token estimation before sending, alerts/budgets, or non-LLM tool runtime cost model.
- Visible gaps: no global usage dashboard, no context-window preflight, no evaluation cost-diff UI, no live paid-provider smoke in this loop, and no full keyboard/screen-reader audit of tooltip details yet.

## Agent Session Token Budgets

- Status: shipped V1
- Freshness: confirmed
- Last checked: 2026-07-25
- Evidence:
  - Fresh real Electrobun CEF evidence in `audits/2026-07-25-162558-session-token-budget-discovery/01-current-thread-usage-no-budget.png` shows provider-reported input/output usage on completed assistant steps but no authored limit, remaining-window summary, or reached state.
  - `audits/2026-07-25-162558-session-token-budget-discovery/02-current-run-settings-no-budget.png` and current DOM inspection show Run settings contains only `Enable ReAct loop` and `Auto run tools`; the page contains no budget text or decision action.
  - The 1280×800 CEF viewport, document, and body dimensions match exactly, and the console contains only Vite/React development information.
  - ADR 0014 and `defineAgent({ limits })` expose independent positive-safe-integer-or-`false` input/output Session limits through normalized source, compiled artifacts, immutable Run configurations, and Direct/Sandbox/Server execution.
  - Runtime Session schema V5 owns lifetime usage, dual fresh-window baselines, unmetered main-provider calls, append-only waits/decisions, and the `waitingForBudget` Run state under the existing Session Store CAS authority.
  - Durable provider settlement records non-zero real input/output usage exactly once with the operation terminal; missing/all-zero usage contributes zero and is visibly unmetered. Compaction operations remain excluded.
  - The Pi Agent Core 0.80.3 patch forwards its existing `shouldStopAfterTurn` hook through the stateful `Agent`, so crossing calls and complete approval/tool batches settle before the same Run parks and no second ReAct loop is introduced.
  - Desktop Direct/Sandbox, embedded Local Server, and protected Server share one authenticated fresh-window/Stop protocol. Renderer data never supplies limits, usage, Session version, or Run authority.
  - Desktop stores every valid trusted compiled Agent as a Bun-only closed bundle plus artifact descriptor. Active Runs select that bundle from the immutable Runtime Run configuration, so an A wait remains on A after source sync to B and Desktop restart; only a later new Run selects B. Missing or mismatched frozen bytes block without current-source fallback.
  - Current real CEF evidence in `audits/2026-07-25-230642-session-token-budget-v1/` proves header usage, confirmations, same-Run grant, active-Run Stop, restart recovery, Run/Cmd+Enter focus, read-only history boundaries, no page overflow at 1280×800 and 900×700, and no application console error.
  - Explicit Project Thread Duplicate creates a new Runtime Session for Direct, Sandbox, and Local Server profiles without copying budget, Run History, checkpoint/branch authority, or Server identity; budget handling itself never creates a Thread.
  - Fresh 2026-07-26 packaged-compiler acceptance repairs that regression: the checked-in example reaches `ready`, opens its Project Thread, persists a closed snapshot, and restores the same fingerprint after Desktop restart. Runtime/Server budget evidence and current Desktop interaction are no longer blocked by Agent activation.
- Boundary: Agent Project authors can declare independent input/output limits based only on settled main-provider usage. Runtime completes the crossing call and full tool batch, then blocks the first forbidden next provider dispatch until the user grants a fresh dual-axis window or stops the active Run. Totals, baselines, reached axes, decisions, unmetered calls, and the active Run's compiled Agent survive restart and remain Session-global across model changes, source sync, checkpoint restore, and branches.
- Explicit non-goals: no estimated enforcement, cost/turn/tool/time/concurrency/schedule limits, auxiliary compaction-call accounting, ordinary Thread budgets, Thread-local overrides, provider quota guarantees, organization policy, subagent inheritance, or automatic Thread creation/reset.
- Visible gaps: no Host-tightened general policy, parent/child budget aggregation, cost limits, live paid-provider audit, production migration tool, or full screen-reader matrix. The narrow Pi wrapper patch remains until upstream exposes the existing turn-stop hook.

## General Runtime Limits

- Status: shipped model-call V1; broader policy expansion deferred
- Freshness: confirmed
- Last checked: 2026-07-26
- Evidence:
  - ADR 0015 and compiled Agent definitions add `maxModelCallsPerRun`: omission freezes 25, explicit `false` is unlimited, positive safe integers are accepted, and invalid values fail compilation.
  - Runtime Session schema V6 stores an attributable `failed + runLimitExceeded` terminal whose limit matches the immutable Run configuration and whose consumed count matches unique non-cancelled main-provider durable operations.
  - Runtime checks the boundary before a new durable main-provider claim. Success, known provider failure, and unknown outcome consume the identity; durable replay, proven pre-dispatch cancellation, and auxiliary compaction provider slots do not.
  - Runtime and protected-Server integration fixtures prove that a limit-1 ReAct Run completes its tool call, blocks its second model request before dispatch, persists the failure, and exposes the Runtime projection and error code to clients while the physical provider-call count remains exactly one.
  - Desktop Direct, Sandbox, embedded Local Server, and protected Server propagate the same Runtime-owned terminal. Desktop shows read-only `Model calls n/limit`, hides explicit `false`, uses `Run limit reached` for the terminal toast, and persists `Model limit reached · n/limit` in Run History and inspector.
  - Real Electrobun CEF evidence in `audits/2026-07-26-205500-per-run-model-call-limit-v1/` uses an isolated temporary `LLM_SPACE_HOME`. It confirms default `Model calls 0/25`, explicit-unlimited hiding, frozen A before sync, reached `1/1` error styling, Run History and inspector attribution at 1280×800 and 900×700, exact viewport dimensions without page overflow, and no application console error.
  - Primary-source market review on 2026-07-26 found OpenAI Agents `maxTurns`, Pydantic AI request/tool/token limits, Claude Agent SDK `maxTurns`/`maxBudgetUsd`, AI SDK `stopWhen` with a default `isStepCount(20)` runaway-loop safety measure, and LangGraph `recursionLimit`. These establish per-run request/step fuses as table stakes, but not one universal durable continuation model.
  - Roadmap Item 22 still combines future cost/tool/time and Host policy with schedules and parent-child aggregation even though schedules belong to Item 28 and inheritance requires Item 27. On 2026-07-26 the owner closed active quota work at the model-call V1 and deferred tool quotas plus the broader boundary matrix.
- Boundary: an Agent author can bound each Runtime Run's main-model dispatches. Reaching the limit fails the same Run before the first forbidden dispatch and leaves the user to choose the next normal execution point; it never grants, continues, retries, creates, resets, or clears a Thread or Session.
- Explicit non-goals: no tool-call quota, cost, duration, concurrency, schedule, Host/organization tightening, provider quota guarantee, or child-policy aggregation. Auxiliary compaction remains outside the model-call count.
- Visible gaps: cost, tool, duration, Host policy, production migration, and parent-child aggregation are not active product gaps. Reopen them only with concrete user evidence; schedules and child composition must be judged independently as product capabilities rather than quota extensions.

## Tool Step Orchestration

- Status: shipped manual, auto-once, ReAct, and durable approval paths
- Freshness: confirmed
- Last checked: 2026-07-23
- Evidence:
  - Current discovery screenshot `audits/2026-07-04-110944-core-capability-discovery/03-general-agent-open.png` shows the General Agent example ships with tool definitions such as `web_search`, `web_fetch`, `bash`, `read`, `write`, and `edit`.
  - Current fixture screenshot `audits/2026-07-04-110944-core-capability-discovery/04-tool-step-fixture-after-run.png` shows a thread with an assistant tool call and editable `Response` field, but no product-level pending-tool state or explicit `Continue` action tied to completed tool outputs.
  - Current discovery screenshot `audits/2026-07-04-224500-different-feature-discovery/04-tool-step-response-filled.png` shows a real CEF thread with a pending `web_search` tool call, a manually filled `Response`, and no visible `Continue`/pending-tool workflow beyond generic run controls.
  - Current CEF button/text inspection on 2026-07-04 showed `Run from this message` remains available on the assistant tool-call message, while no `Continue`, `Approve`, `Reject`, or all-tools-ready state appears after the tool response is supplied.
  - `packages/core/src/server/agent/stream.ts` converts all configured tools into step-by-step agent tools whose `execute()` returns an empty text result and `terminate: true`, so the app intentionally stops at tool calls rather than executing web, shell, or filesystem operations.
  - `packages/core/src/client/converters.ts` can lower assistant `toolCalls` plus their outputs into pi `toolResult` messages, so the underlying continuation path exists once a tool output is filled.
  - Manual Tool Continuation V1 screenshots `audits/2026-07-04-231420-manual-tool-continuation-v1/01-pending-needs-response.png`, `02-ready-continue-enabled.png`, `04-multi-one-missing.png`, and `05-error-result-ready.png` show pending, ready, multi-tool, and error-result continuation states in the real CEF renderer.
  - `apps/desktop/src/components/thread-playground/message/tool-call-status.ts` derives pending/ready/error summary state from existing `toolCall.output` data without changing the thread schema.
  - `apps/desktop/src/components/thread-playground/message/message-list-item.tsx` shows `Waiting for Tools` / `Tool Results Ready` and a message-level `Continue` CTA that calls the existing `run(message.id)` path.
  - `apps/desktop/src/components/thread-playground/message/tool-call-list-item.tsx` lets users mark or clear error results with the existing `isError` flag and keeps Cmd+Enter continuation gated until all tool calls have text output.
  - Current `packages/runtime/src/shared/runtime-execution-mode.ts`, `execution/tool-execution-policy.ts`, and `runtime/sessions/agent-session.ts` own `manual`, `autoOnce`, and `react` execution, internal deferred results, continuation, and mode changes behind the public Agent session.
  - Current `apps/desktop/src/components/thread-playground/stores/run-mode.ts` preserves explicit user preferences for manual calls, one-step auto-run, and the full ReAct loop. `tool-call-list-item.tsx` still provides the visible per-call play action and editable/error result path.
  - Fresh CEF Thread inspection on 2026-07-14 showed the current Tools row and run controls render without document overflow; no live provider tool turn was attempted in this discovery loop.
  - Fresh non-UI Runtime Harness verification on 2026-07-16 passed settled manual reload and exact-result continuation without a synthetic user message, auto-once, complete ReAct tool execution, dangerous/deferred tool boundaries, persistence-before-terminal-event ordering, abort settlement, and Desktop Agent Project streaming fixtures.
  - Fresh real CEF item-19 acceptance at `audits/2026-07-24-205445-durable-approvals-v1/` shows exact arguments, policy reason, Source/Host requirement, call scope, Direct provenance, `Approve & run`, `Deny`, pending batch state, and a real persisted denied result at 1280×800 and 900×700. Both sizes have zero document overflow and no application console errors.
- Roadmap item 03 confirms incomplete results block only same-Run continuation; execution-affecting edits may atomically supersede and branch from an earlier boundary without fabricating results for the old Run.
- Roadmap item 04 confirms safe waits resume only through a one-winner CAS claim; an interrupted model/tool operation is terminalized as `outcomeUnknown` and never enters Pi/transport automatically.
- Boundary: ordinary Threads and Agent Project Threads can receive model tool calls, run visible executable tools manually, edit/mark ordinary tool results, continue after all results are ready, or opt into automatic one-step/ReAct behavior. Approval-managed results are read-only and use durable same-Run park/decision/resume. Pi `AgentSession` owns the loop and deferred state for both surfaces; the Desktop Thread remains the sole durable transcript and Session Store authority.
- Explicit non-goals: no background tool queue, automatic retry of ambiguous side effects, global approval inbox, or multi-agent orchestration.
- Visible gaps: live paid-provider approval continuation remains unaudited; keyboard semantics are covered by native button/status structure and focused logic inspection but not a full screen-reader matrix.

## Durable Human Approval

- Status: shipped V1
- Freshness: confirmed
- Last checked: 2026-07-24
- Evidence:
  - ADR 0012 fixes the source-minimum × Host-tightenable lattice `deny > always > once > never`, exact conditional failure-closed behavior, and the separation that approval decides whether while Sandbox decides where.
  - Runtime Session schema V3 persists pending/approved/denied/stale requests and principal-bound Session grants beside exact item-18 operation identity. Approve leaves the operation parked; a separate authorized CAS claim crosses into `preCall`, so pre-claim restart is resumable while post-claim loss remains `outcomeUnknown`.
  - Runtime tests cover source/Host policy merge, async/invalid/denial behavior, once grants with conditional re-evaluation, principal isolation, fresh-session resume, denied not-run Pi results, parallel batch barriers in both call orders, and Agent/Host/principal drift expiring and cancelling parked work without dispatch.
  - Desktop Bun binds request IDs to authoritative standalone or Agent Project Thread stores and accepts only request ID plus decision from the renderer. Inline cards, message continuation, and Run History expose safe pending/approved/denied/stale state without principal, policy fingerprint, Host path, or resume-claim data.
  - Protected Server exposes an owner- and continuation-authorized approval endpoint, browser client helper, safe SSE pending event, code-configured Host approval policy, same-Run resume, cross-principal hiding, and exactly-one execution/terminal integration evidence.
  - Fresh real CEF screenshots in `audits/2026-07-24-205445-durable-approvals-v1/` verify pending and real Deny states at 1280×800 and 900×700, corrected decision-specific resume copy, no document overflow, and a console containing only development information.
  - Final local acceptance passes 384 Bun tests including the real-Docker Sandbox guardrail, all eight TypeScript projects, root lint, renderer Vite production build, and `git diff --check`; Actions and packaging/release remain intentionally omitted by owner direction.
- Boundary: an effective approval decides whether one exact tool call may dispatch, remains bound to the authenticated principal, Agent/tool/policy identity, Session, operation, and request fingerprint, and resumes the same Thread/Runtime Run after restart. Static dynamically generated requirements persist; dynamically generated conditional callbacks are an explicit V1 rejection. Sandbox independently decides the execution environment.
- Explicit non-goals: model self-approval, treating a manual result or tool failure as approval, cross-principal or cross-Session grants, edited-argument approval reuse, exactly-once side effects, generic workflow DSL, organization administration UI, or a generic operation inspector.
- Visible gaps: no organization/four-eyes approval, external notification channel, global inbox, Host policy settings UI, dynamic generated conditional callback rehydration, live paid-provider end-to-end audit, or screenshot coverage of every durable recovery/stale/unknown state; those non-rendered state transitions are covered by deterministic Runtime/Desktop/Server fixtures.

## MCP Server Integration

- Status: shipped V1
- Freshness: confirmed
- Last checked: 2026-07-15
- Evidence:
  - Implementation screenshot `audits/2026-07-04-122756-mcp-integration-v1/01-settings-mcp-empty.png` shows Settings now has an `MCP` page and empty server state.
  - Implementation screenshot `audits/2026-07-04-122756-mcp-integration-v1/02-settings-mcp-fixture-tools.png` shows a configured stdio fixture server tested through Settings with one discovered tool, `mcp__fixture__echo`.
  - Implementation screenshot `audits/2026-07-04-122756-mcp-integration-v1/03-thread-mcp-tool-added.png` shows the thread Tools area can add `mcp__fixture__echo` from the configured MCP server.
  - Implementation screenshot `audits/2026-07-04-122756-mcp-integration-v1/04-call-mcp-tool-result.png` shows an assistant MCP tool call exposes `Call MCP Tool` and fills the response with `fixture:cef`.
  - `apps/desktop/src/bun/mcp/mcp-manager.ts` persists `settings/mcp.json`, manages MCP clients in the Bun process, supports `StdioClientTransport` and `StreamableHTTPClientTransport`, lists tools, calls tools, normalizes direct names, and flattens tool results to text.
  - `apps/desktop/src/shared/rpc.ts` and `apps/desktop/src/bun/rpc/index.ts` expose typed MCP server/tool/call requests across the renderer/Bun boundary.
  - `packages/core/src/types/tools/index.ts` stores optional MCP provenance on function tools while preserving plain function tools.
  - Manager fixture verification discovered `mcp__fixture__echo` and returned `fixture:ok`; rendered CEF verification returned `fixture:cef`.
  - Readiness audit screenshot `audits/2026-07-04-151659-mcp-tool-readiness-v1/01-settings-ready-tools-current.png` shows Settings > MCP presenting Ready status, tool count, tested time, and live-session connection state after an explicit Test.
  - Readiness audit screenshot `audits/2026-07-04-151659-mcp-tool-readiness-v1/02-after-restart-last-test-current.png` shows the last tested status and tool summaries persist after an app restart without automatically reconnecting the MCP server.
  - Readiness audit screenshot `audits/2026-07-04-151659-mcp-tool-readiness-v1/03-add-mcp-readiness-popover-current.png` shows the thread `Add MCP` popover using persisted readiness/tool summaries with an explicit refresh and `Open Settings` path.
  - Readiness audit screenshot `audits/2026-07-04-151659-mcp-tool-readiness-v1/04-error-state-current.png` shows a readable failed readiness state for a missing environment variable.
  - `apps/desktop/src/bun/mcp/mcp-manager.ts` persists readiness snapshots in `settings/mcp.json`, including status, tested time, redacted latest error, tool count, and compact tool summaries.
  - Current discovery screenshot `audits/2026-07-04-202128-remote-mcp-diagnostics-discovery/03-settings-mcp-remote-form.png` confirms the MCP settings form exposes Streamable HTTP URL and headers.
  - Current discovery screenshot `audits/2026-07-04-202128-remote-mcp-diagnostics-discovery/04-remote-connection-error.png` shows an unreachable Streamable HTTP endpoint reports a generic connectivity error.
  - Current discovery screenshot `audits/2026-07-04-202128-remote-mcp-diagnostics-discovery/05-add-mcp-error-popover.png` shows the thread Add MCP popover carries the persisted remote error and retry/open-settings paths.
  - Remote diagnostics implementation screenshots `audits/2026-07-04-211429-remote-mcp-diagnostics-v1/01-settings-remote-success-diagnostics.png`, `02-settings-remote-auth-diagnostics.png`, and `03-settings-remote-env-diagnostics.png` show successful, unauthorized, and missing-env Streamable HTTP tests with redacted diagnostic timelines.
  - Remote diagnostics implementation screenshot `audits/2026-07-04-211429-remote-mcp-diagnostics-v1/04-add-mcp-diagnostic-headline.png` shows the thread Add MCP popover surfacing the latest diagnostic headline and Settings path.
  - Fresh CEF screenshot `audits/2026-07-14-225653-tools-connections-discovery/04-current-mcp-import-empty.png` confirms the current boundary remains machine-local: Add MCP tools says `No MCP servers configured` and routes to `Configure MCP` / `Open settings`; it has no Agent Project or source-declared connection path.
  - Current `apps/desktop/src/components/thread-playground/tool/mcp-tool-import-popover.tsx`, `components/settings/mcp-page.tsx`, `bun/mcp/mcp-manager.ts`, and typed RPC source confirm the same Settings -> readiness/list -> explicit Thread selection -> explicit call flow. The already-running Vite server could not load the lazy Settings module during this CEF run, so the Settings sub-surface was not freshly screenshot-verified.
  - Portable Agent Actions V1 extracts the shared Streamable HTTP transport and result flattening into `@llm-space/runtime/node`; focused TypeScript/build checks and the fresh CEF fixture confirm ordinary Settings remains separate while Project connections use the shared protocol client.
- Boundary: users can configure machine-local MCP servers in Settings, with stdio or Streamable HTTP transport fields; discover MCP tools; inspect persisted readiness status, last-known tool summaries, and latest redacted diagnostic timeline; explicitly refresh/test a server; copy a safe diagnostic summary; explicitly add selected tools to an ordinary Thread as `mcp__{server_name}__{tool_name}` direct tools; and explicitly execute visible assistant MCP tool calls after a click. Agent Projects separately declare portable allowlisted Streamable HTTP connections in source without mutating Settings.
- Explicit non-goals: no full built-in OAuth authorization-code callback, token refresh, revoke, or account-management flow; no resources/prompts browser; no sampling, elicitation, tasks, registry browsing, or authored per-connection approval policy.
- Visible gaps: real third-party authenticated remote services remain unaudited; full OAuth is intentionally out of scope; readiness is last-known rather than monitored; outputs are flattened to text; ordinary Threads still add Settings tools explicitly one by one; direct normalized-name collisions disable ordinary tools rather than auto-suffixing. Resources/prompts remain an intentional near-term non-goal.

## Remote MCP Diagnostics

- Status: shipped V1
- Freshness: confirmed
- Last checked: 2026-07-04
- Evidence:
  - Current discovery screenshot `audits/2026-07-04-202128-remote-mcp-diagnostics-discovery/03-settings-mcp-remote-form.png` shows Streamable HTTP configuration is possible with URL and headers.
  - Current discovery screenshot `audits/2026-07-04-202128-remote-mcp-diagnostics-discovery/04-remote-connection-error.png` shows an unreachable remote endpoint collapses to `Unable to connect. Is the computer able to access the url?`.
  - Current discovery screenshot `audits/2026-07-04-202128-remote-mcp-diagnostics-discovery/05-add-mcp-error-popover.png` shows the same remote failure is visible from the thread Add MCP popover, but without a transport-specific diagnosis.
  - `apps/desktop/src/bun/mcp/mcp-manager.ts` supports Streamable HTTP transport through the MCP SDK, resolves env/header values, redacts sensitive text, and persists readiness snapshots.
  - `apps/desktop/src/bun/mcp/mcp-manager.ts` now captures compact diagnostics around config validation, secret/env/header resolution, transport open, MCP initialize, and list-tools phases.
  - `apps/desktop/src/components/settings/mcp-page.tsx` now renders the latest diagnostic timeline and copy summary action under readiness.
  - `apps/desktop/src/components/thread-playground/tool/mcp-tool-import-popover.tsx` now surfaces the latest diagnostic headline and routes full details to Settings.
  - Implementation screenshots `audits/2026-07-04-211429-remote-mcp-diagnostics-v1/01-settings-remote-success-diagnostics.png`, `02-settings-remote-auth-diagnostics.png`, `03-settings-remote-env-diagnostics.png`, and `04-add-mcp-diagnostic-headline.png` verify success, auth failure, missing-env failure, and Add MCP handoff states at 1280x800.
  - Persisted-summary verification in the implementation loop confirmed diagnostic summaries omit query strings, bearer/header values, and fixture secret values while preserving endpoint origin and path.
  - Post-review fixture verification covers Streamable HTTP success, 401/403 auth, missing env/header, malformed protocol response, 404 transport mismatch, timeout, and a stdio control case with no diagnostic rendered.
- Boundary: users can enter remote MCP URL/header settings, run a connection test, see whether the latest failure came from config, secret resolution, transport/auth/HTTP/protocol, initialization, list-tools, or final result, copy a redacted diagnostic summary, and open Settings from the thread Add MCP popover for full details.
- Explicit non-goals: no full OAuth authorization-code callback, no token refresh/revoke/account lifecycle, no MCP resources/prompts, no registry browsing, no automatic execution, no background monitor.
- Visible gaps: no real third-party authenticated remote MCP service audit; no full OAuth authorization-code lifecycle; no background health history beyond latest readiness/diagnostic snapshot; no raw request/response protocol inspector.

## MCP Context Primitives

- Status: deferred/non-goal for current stage
- Freshness: confirmed
- Last checked: 2026-07-04
- Evidence:
  - Current discovery screenshot `audits/2026-07-04-142708-mcp-next-discovery/01-settings-mcp-empty.png` shows the Settings > MCP surface has server management only; no resources or prompts section is present.
  - Current discovery screenshots `audits/2026-07-04-142708-mcp-next-discovery/02-blank-thread-add-mcp-entry.png` and `03-add-mcp-no-servers.png` show the thread-level MCP entry is scoped to adding MCP tools, not browsing or inserting context/prompt primitives.
  - `apps/desktop/src/bun/mcp/mcp-manager.ts` currently implements `listTools()` and `callTool()` but no `listResources()`, `readResource()`, `listPrompts()`, or `getPrompt()` path.
  - `apps/desktop/src/shared/rpc.ts` exposes MCP server CRUD, tool listing, and tool calls only.
  - `apps/desktop/node_modules/@modelcontextprotocol/sdk/README.md` confirms the installed SDK exposes high-level client helpers for tools, resources, and prompts.
- Boundary: users cannot discover MCP resources, read text resources, discover MCP prompt templates, provide prompt arguments, preview prompt messages, or insert MCP-provided context into a thread.
- Explicit non-goals: no automatic context inclusion, no resource subscriptions/templates, no binary/resource gallery, no MCP sampling, elicitation, tasks, apps, or full OAuth account lifecycle.
- Visible gaps: all user-facing resource and prompt flows are absent, but this is no longer treated as the next priority. Product decision on 2026-07-04: keep MCP tool-only for now because resources/prompts exist in the protocol but appear rarely used in practice.

## Skill Discovery And Runtime Loading

- Status: partially shipped, evidence-limited
- Freshness: unknown
- Last checked: 2026-07-08
- Evidence:
  - Source inspection on 2026-07-08 found `apps/desktop/src/components/settings/skills-page.tsx` exposes a Settings > Skills page with discovery folders, per-skill enable switches, bulk enable/disable, and folder removal confirmation.
  - Source inspection found `apps/desktop/src/bun/skills/skills-manager.ts` persists `settings/skills.json`, seeds default discovery folders, validates `SKILL.md` frontmatter, resolves enabled skills by name, and reads selected skill content for runtime use.
  - Source inspection found `apps/desktop/src/bun/skills/seed.ts` seeds a bundled `deep-research` skill under the app data root on fresh installs.
  - Source inspection found `apps/desktop/src/components/thread-playground/examples/prompts.ts` injects enabled skills into the General Agent starter thread's `<available-skills>` reminder.
  - Source inspection found `apps/desktop/src/bun/tools/built-in/fs.ts` implements the runtime `skill()` tool and returns the selected skill base directory plus `SKILL.md` body.
  - Current CEF/CDP product-surface verification was attempted with an isolated `LLM_SPACE_HOME` on port `9381`, but Electrobun stayed in the CEF dependency download path and never exposed CDP during this loop.
- Boundary: source evidence indicates users can configure local skill discovery folders, enable or hide discovered skills, seed a bundled Deep Research skill, expose enabled skills in the General Agent starter context, and load skill instructions at runtime through `skill(name)`.
- Explicit non-goals: no skill creation/editing UI, no runtime skill preview/test call from Settings, no skill provenance panel inside threads, no conflict resolution for duplicate names beyond first-folder-wins, no packaged skill registry/marketplace.
- Visible gaps: rendered flow is unconfirmed in this loop; users likely cannot test from Settings that a skill can be loaded by a thread, see which skills a particular thread captured, or diagnose duplicate/invalid skills without source-level knowledge.

## Bundled Extension Authoring

- Status: shipped internal V1 for trusted bundled tool modules
- Freshness: confirmed
- Last checked: 2026-07-11
- Evidence:
  - `apps/desktop/src/bun/app/start-desktop-app.ts` is the production composition root and constructs process-scoped model, MCP, search, skills, trace, analytics, storage, streaming, updater, RPC, and window dependencies explicitly.
  - `apps/desktop/src/bun/host/desktop-host.ts` registers bundled modules before RPC/window creation, freezes contributions, reports module-context startup failures, and performs reverse-order best-effort cleanup.
  - `apps/desktop/src/bun/tools/tool-registry.ts` snapshots and freezes `ToolContribution` definitions, rejects duplicate ids/names, lists tools, and dispatches calls through the unchanged RPC contract.
  - `apps/desktop/src/bun/tools/built-in/built-in-tools-module.ts` is the reference bundled module. Filesystem and web tool factories receive only declared workspace, skill, search, and environment dependencies.
  - `apps/desktop/src/bun/app/shutdown-coordinator.ts` synchronously cancels the first Electrobun quit, awaits idempotent runtime cleanup, and permits the second quit.
  - Final verification on 2026-07-11: `bun test` passed 42/42; core TypeScript and Vite production build passed; lint had only the existing `HELLO_WORLD_BUILT_IN_TOOLS` warning; desktop TypeScript had only the matching existing unused-variable diagnostic.
  - Real CEF verification on port 9341 returned all 16 original tool names in order, called `todo_write` with `{ contentText: "OK" }`, reported zero horizontal overflow, and showed no relevant console errors.
- Boundary: a core-team author can add a trusted, compile-time bundled Bun module that contributes built-in tools, receives explicit narrow dependencies, fails startup with module context, and participates in deterministic lifecycle. The registry is permanently frozen before RPC/window creation; existing renderer, RPC, persistence, and tool behavior stay unchanged.
- Explicit non-goals: no public plugin SDK, third-party or runtime package loading, manifests, marketplace, dynamic enable/disable, hot reload, sandboxing, permissions, compatibility negotiation, renderer/UI contribution points, or contribution types beyond built-in tools.
- Visible gaps: no plugin discovery or user management surface; no isolation or trust model; no compatibility/version contract; additional contribution seams should be added only after a concrete product use case proves them necessary.

## Debug Timeline

- Status: shipped V1 with Runtime Run grouping
- Freshness: confirmed
- Last checked: 2026-07-16
- Evidence:
  - Current screenshot `04-trace-fixture-run-history.png` shows two durable run snapshots listed in the Run history panel.
  - Current screenshot `06-restored-run-message-view.png` shows restoring a run displays assistant thinking and tool call outputs in the main message editor.
  - Implementation audit screenshot `audits/2026-07-03-225143-trace-inspector-v1/02-run-history-open.png` shows run-history rows with compare, inspect, and restore actions visible inside the right panel at 1280x800.
  - `apps/desktop/src/components/thread-playground/run-history-list-view.tsx` renders run history, inspect controls, restore controls, removal, comparison selection, and saved evaluation cards.
- Current item-03 CEF audit `audits/2026-07-16-134144-desktop-runtime-harness/` shows two settled checkpoints grouped under one stable Runtime Run, keyboard inspection and comparison preserved, Session-authoritative `Superseded` status, no horizontal overflow at 1280×800, and no application console errors.
- Boundary: settled checkpoints are recorded per Thread and grouped under their stable Runtime Run with current lifecycle state sourced from the Session Store; each checkpoint remains independently inspectable, comparable, removable, and intentionally restorable into the editor.
- Explicit non-goals: full raw trace event persistence, step-through trace inspector, global run database.
- Visible gaps: restore still intentionally mutates the working thread; raw event timing and step-through playback remain out of scope.

## Evaluation Workspace

- Status: shipped V2 with Structured Evaluation Rubrics V1
- Freshness: confirmed
- Last checked: 2026-07-10
- Evidence:
  - Current CEF screenshot `audits/2026-07-10-145713-evaluation-rubrics-discovery/01-current-run-history.png` shows two durable run cards, comparison selection, inspect/restore actions, and one saved evaluation in the 1280x800 desktop renderer.
  - Current CEF screenshot `audits/2026-07-10-145713-evaluation-rubrics-discovery/02-current-evaluation-dialog.png` shows the comparison dialog with Run A/Run B evidence, five fixed overall verdicts, and one unstructured evaluation note; there is no criterion/rubric configuration or per-side structured score.
  - Current CDP checks on 2026-07-10 found `documentElement.scrollWidth === innerWidth === 1280`, a 1040x728 evaluation dialog inside the 1280x800 viewport, and no relevant console errors.
  - Current screenshot `04-trace-fixture-run-history.png` shows a saved evaluation card for two runs.
  - Current screenshot `05-current-evaluation-dialog.png` shows the evaluation dialog comparing two run snapshots with model/message metadata, system prompt, last user message, result text, tool inputs, and tool outputs.
  - Implementation audit screenshots `04-evaluation-dialog-with-inspect.png` and `06-inspector-inside-evaluation.png` show each comparison side can open a read-only inspector inside the saved evaluation dialog without stacking a second modal.
  - Structured-rubric screenshot `audits/2026-07-10-154419-structured-evaluation-rubrics-v1/05-six-criterion-editor.png` shows the same-dialog editor at the maximum six-criterion boundary.
  - Structured-rubric screenshot `audits/2026-07-10-154419-structured-evaluation-rubrics-v1/06-six-criterion-scorecard.png` shows complete 1-5 scores for both runs and the derived aggregate summary.
  - Structured-rubric screenshot `audits/2026-07-10-154419-structured-evaluation-rubrics-v1/07-reversed-six-criterion-scorecard.png` shows the same run-keyed scores with A/B orientation reversed and a correctly flipped directional verdict/delta.
  - Structured-rubric screenshot `audits/2026-07-10-154419-structured-evaluation-rubrics-v1/08-saved-snapshot-after-revision.png` shows the immutable saved v1 snapshot remaining selectable beside the edited v2 definition.
  - Structured-rubric screenshot `audits/2026-07-10-154419-structured-evaluation-rubrics-v1/09-delete-confirmation.png` documents the destructive-action guard and explains that historical snapshots survive definition deletion.
  - Structured-rubric screenshot `audits/2026-07-10-154419-structured-evaluation-rubrics-v1/10-narrow-scorecard.png` plus CDP geometry checks confirm a 700x700 viewport has no document or dialog horizontal overflow.
  - The isolated persisted Thread JSON retained one six-criterion rubric snapshot and twelve scores keyed by the two stable run IDs after save, reload, definition revision, and definition deletion.
  - Real CDP keyboard smoke confirmed roving radio focus and ArrowRight/ArrowDown, ArrowLeft/ArrowUp, Home, End, Space, and Tab behavior; the final renderer console contained no errors.
  - Twenty-four focused Bun tests cover schema bounds, malformed/duplicate normalization, rubric CRUD/revisions/caps, immutable snapshots, unordered run-pair orientation, score completeness/aggregation, cross-rubric isolation, and saved-snapshot score restoration.
  - `packages/core/src/types/threads/thread.ts` models legacy and structured evaluations as a compatible union with bounded rubric/snapshot/score data.
  - `apps/desktop/src/components/thread-playground/run-evaluation-dialog.tsx`, `run-evaluation-scorecard.tsx`, and `evaluation-rubric-editor.tsx` implement the comparison, scoring, and rubric-management surfaces.
- Boundary: two durable runs in one thread can be compared and inspected, labeled with the existing overall verdict/note, or scored against a reusable thread-owned rubric with 2-6 ordered criteria and complete integer 1-5 scores. One evaluation per unordered pair persists immutable rubric evidence, per-run scores, unweighted averages, and B-minus-A delta; editing or deleting the reusable definition does not alter history, and legacy verdict-only evaluations remain valid.
- Explicit non-goals: dataset/experiment runner, automated or model judge, weighted/formula criteria, thresholds, global rubric library, multiple evaluations per run pair, CI/export, cloud sync, evaluation telemetry, and raw side-by-side trace diff.
- Visible gaps: rubric weights and mixed criterion types, reusable cross-thread libraries, aggregate experiment tables, evaluation cost comparison, dataset execution, automated judges, and side-by-side trace/timing diff remain unimplemented. The 80% rubric-backed completion target still needs a ten-comparison maintainer dogfood set after merge.

## Trace Inspection

- Status: shipped V1
- Freshness: confirmed
- Last checked: 2026-07-03
- Evidence:
  - README promises Trace as a top-level product capability.
  - Current screenshot `05-current-evaluation-dialog.png` shows evaluation can display compact tool input/output text, but not thinking or a chronological evidence path.
  - Current screenshot `06-restored-run-message-view.png` shows the main editor can display assistant thinking and tool call outputs only after a run is restored.
  - Implementation audit screenshot `03-inspector-from-run-history.png` shows a read-only run inspector opened from Run history with system prompt, last user message, assistant result, thinking, and ordered tool calls.
  - Implementation audit screenshot `06-inspector-inside-evaluation.png` shows the same inspector opened from a saved evaluation run side inside one dialog layer, including a clear `No thinking captured` empty state.
  - `apps/desktop/src/components/thread-playground/run-trace-dialog.tsx` renders the inspector from existing `RunSnapshot` data.
  - `apps/desktop/src/components/thread-playground/run-history-list-view.tsx` and `apps/desktop/src/components/thread-playground/run-evaluation-dialog.tsx` wire the inspect actions.
  - `packages/core/src/client/reducer.ts` reduces stream events into final assistant messages with `thinking` and `toolCalls`, but raw event timings are not persisted.
  - `packages/core/src/types/threads/thread.ts` persists run snapshots as reduced thread snapshots, not raw event timelines.
- Boundary: users can inspect reduced saved-run evidence non-destructively from Run history or either side of an Evaluation dialog, including prompt, last user message, final assistant result, thinking, tool inputs, and tool outputs.
- Explicit non-goals: raw token/event timeline, per-step latency, global trace database, side-by-side step diff, automated diagnosis.
- Visible gaps: V1 is limited to reduced run snapshots; it does not preserve exact event timing, token deltas, intermediate stream chronology, or cross-run trace diffs.

## External Trace Import

- Status: shipped V1
- Freshness: confirmed
- Last checked: 2026-07-06
- Evidence:
  - Current discovery screenshot `audits/2026-07-05-160904-langfuse-trace-import-discovery/01-current-native-debug-surface.png` shows the product can render a native reduced debug fixture with assistant thinking, tool calls, token usage, manual continuation state, and Run history.
  - Current discovery screenshot `audits/2026-07-05-160904-langfuse-trace-import-discovery/02-current-run-trace-inspector.png` shows the saved-run trace inspector can render a local `ThreadRunSnapshot` as a non-mutating debug view with usage and step evidence.
  - Current discovery screenshot `audits/2026-07-05-160904-langfuse-trace-import-discovery/03-raw-langfuse-opens-empty.png` shows a Langfuse-observation-shaped JSON file opens as an empty thread with no run history, losing the observation rows for debugging.
  - Implementation screenshot `audits/2026-07-05-160904-langfuse-trace-import-v1/03-final-cef-trace-debug.png` shows the new `Files | Traces` sidebar, a manual Langfuse Trace Project, an imported `llm-call` trace row, and the trace opened directly in a reused `ThreadPlayground` debug workbench.
  - CEF verification on port `9367` with isolated runtime root created a Trace Project, imported the supported Langfuse Observations JSON fixture, opened the trace tab, displayed user/assistant messages, usage (`98 in / 68 out`), a `web_search` tool call/result, and a compact `Langfuse · Manual Import · trace trace-1` context header.
  - The same CEF run confirmed the tab-bar `New blank thread` command still creates and opens `workspace/untitled.json` while the sidebar is in `Traces` mode.
  - Storage verification under the isolated root showed trace-owned files at `traces/projects/{project_id}/traces/llm-call-17fe6f3033/raw.json`, `trace.json`, and lazy-created `workbench.json`, with no `workspace/` thread created by the trace import path.
  - `apps/desktop/src/bun/traces/trace-manager.ts` owns trace-project storage and best-effort Langfuse JSON normalization for `{ data: [...] }` and bare observation arrays.
  - `apps/desktop/src/components/trace-panel/trace-panel.tsx` provides the independent Trace Panel with project creation, selected-project import, and trace rows.
  - `apps/desktop/src/components/thread-tabs/use-thread-tabs.ts` and `trace-tab-pane.tsx` add typed trace tabs backed by trace-owned `workbench.json`.
  - `apps/desktop/src/lib/import-threads.ts` and `packages/core/src/parsers/thread-parser-registry.ts` only route `.json` files through the generic JSON thread parser.
  - `packages/core/src/parsers/json-thread-parser.ts` accepts any non-foreign JSON that satisfies the optional-field `Thread` schema; a Langfuse observations payload with top-level `data` can therefore be written as a native-looking but empty thread instead of being rejected or normalized.
  - `packages/core/src/parsers/normalize-thread.ts` normalizes OpenAI/Anthropic chat-like `messages`, tools, images, tool calls, and tool results, but has no Langfuse trace/observation normalization path.
  - External Langfuse docs reviewed on 2026-07-05 say Langfuse traces are containers of observations, Observations API v2 returns row-level spans/generations/events, and UI/Blob exports can produce JSON/JSONL data that includes observations and trace context.
  - Protocol repair on 2026-07-06 checked the current Langfuse OpenAPI: v2 observations expose field groups including `io`, but input/output are always raw strings and `parseIoAsJson=true` is deprecated and returns 400. `TraceManager` now decodes JSON-shaped raw strings locally when creating the workbench and repairs existing workbench text wrappers such as `{"content":"..."}` on read.
- Boundary: users can create local Trace Projects, manually import supported Langfuse JSON (`{ data: [...] }` or bare observation arrays) into the selected project, list imported traces in the dedicated Trace Panel, and open each trace directly as a trace tab that reuses `ThreadPlayground` over a lazy-created trace-owned `workbench.json`. Langfuse raw-string IO is normalized into user/assistant/tool text where it clearly wraps message content.
- Explicit non-goals: no live Langfuse sync, no automatic connect UI, no JSONL in V1, no write-back to Langfuse, no account-management flow, no OTLP collector, no full read-only trace timeline UI, no Trace/Debug/Runs detail tabs in V1, and no mixing trace-owned workbenches into `workspace/`.
- Visible gaps: no background sync, no JSONL import, no full raw trace timeline, no import preview, no delete/rename/credential-rotation project management, no schema-specific coverage for every Langfuse export variant, and no global trace search.

## Langfuse Connected Trace Source

- Status: shipped V1
- Freshness: confirmed
- Last checked: 2026-07-06
- Evidence:
  - Pre-implementation CEF discovery screenshot `audits/2026-07-05-221840-langfuse-connect-v1/01-current-trace-panel-empty.png` showed the Trace Panel empty state only supported creating a local Trace Project and manually importing Langfuse JSON; there was no connect/test/sync entry.
  - Pre-implementation CEF snapshot on 2026-07-05 showed the Trace Panel toolbar actions were `New Trace Project` and `Import Langfuse Export`; there was no API credential path.
  - `.env` at the repo root contains `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, and `LANGFUSE_SECRET_KEY`; discovery checked names/presence only and did not log secret values.
  - A redacted API smoke against the configured Langfuse host returned `200` for `GET /api/public/projects` and found one accessible project, proving the provided keys can read the project-scoped API.
  - A redacted API smoke against `GET /api/public/v2/observations?limit=3&fields=core,basic,time,io,model,usage,trace_context,metrics` returned observation rows with trace ids, project ids, input/output, model, usage, cost, and trace context fields that match the existing manual-import normalizer inputs.
  - `apps/desktop/src/shared/traces.ts` already reserves `TraceProjectSource` mode `connected`, but it does not persist credentials, sync status, or imported-at cursors.
  - `apps/desktop/src/bun/traces/trace-manager.ts` imports already-read JSON files only; it has no Langfuse HTTP client, credential storage, API pagination, or source test method.
  - `apps/desktop/src/components/trace-panel/trace-panel.tsx` has local project creation/import UI only and no connect form or sync action.
  - Langfuse OpenAPI on 2026-07-05 declares Basic Auth and public endpoints for project, trace, and v2 observation reads; v2 observations expose field selection and cursor/pagination-oriented extraction.
  - Implementation screenshot `audits/2026-07-05-221840-langfuse-connect-v1/02-connected-sync-debug.png` shows a connected Langfuse Trace Project with redacted key preview, explicit trace-id/search sync controls, a synced trace row, and the trace opened directly in the reused `ThreadPlayground` debug workbench.
  - CEF verification with isolated `LLM_SPACE_HOME` connected a Langfuse project from the Trace Panel using `.env` credentials, showed `No traces synced yet` after connect, searched recent remote traces, synced a selected trace, opened it as a trace tab, and confirmed no relevant console errors or horizontal overflow at 1280px.
  - Storage verification confirmed `traces/projects/{project_id}/project.json` persists full local `publicKey` and `secretKey` as requested, while `traceListProjects` / `traceCreateConnectedProject` responses strip full keys and expose only redacted previews.
  - Bun smoke verification confirmed failed credential tests do not create a project, successful sync writes `raw.json` and `trace.json`, repeat sync upserts by remote trace id, and existing `workbench.json` is preserved.
  - `apps/desktop/src/bun/traces/langfuse-client.ts` owns Basic Auth, base URL normalization, redacted HTTP errors, bounded recent trace search, and bounded v2 observation fetching.
  - `apps/desktop/src/bun/traces/trace-manager.ts` now creates connected projects after credential validation, rejects manual JSON import for connected projects, syncs selected Langfuse trace ids, persists redacted sync status/errors, and reuses the manual trace normalizer/write path.
  - `apps/desktop/src/components/trace-panel/trace-panel.tsx` now exposes `Connect Langfuse`, connected project badges/previews, no-auto-sync empty state, trace-id sync, remote trace search/select sync, and manual import only for manual projects.
  - Polish audit screenshots `audits/2026-07-05-232553-trace-panel-polish/11-clean-connected-list.png`, `13-clean-sync-dialog-final.png`, `14-clean-connect-dialog.png`, and `15-clean-empty-traces.png` confirm the Trace Panel now has a visible panel title, clearer project/source hierarchy, labeled Langfuse connection fields, and a two-path sync dialog for exact trace-id sync or search/select sync.
  - Follow-up screenshot `audits/2026-07-05-232553-trace-panel-polish/16-connect-dialog-no-project-name.png` confirms connected Langfuse setup now only asks for base URL, public key, and secret key; the local project name is derived after validation.
  - Clean CEF verification on port `9372` confirmed no horizontal overflow at 1280px and no relevant console errors after the polish pass; screenshots and DOM text showed only redacted key previews.
  - Trace header/protocol repair evidence on 2026-07-06: CEF screenshot `audits/2026-07-06-trace-head-protocol/01-existing-cef-trace-head.png` shows the trace source header moved into `ThreadPlayground`, with the trace id rendered as a compact badge and a `Copy trace ID` action; DOM check showed no horizontal overflow.
  - Focused Bun regressions on 2026-07-06 verified trace title rename updates `trace.json`, `workbench.json`, and the listed trace title; v2 raw-string IO imports produce normal system/user/assistant text; existing workbenches with JSON wrapper text are repaired on read.
- Boundary: users can create a connected Langfuse Trace Project by entering base URL/public key/secret key, validate before save, persist the local connection in `project.json`, explicitly sync by trace id or by selecting from a bounded recent remote trace search, upsert the same remote trace without duplicating local rows, and open the synced trace in the existing trace-owned Debug workbench. Trace tabs expose editable trace titles, source context inside the workbench header, and a copyable trace-id badge.
- Explicit non-goals: no background daemon or automatic initial sync, no write-back to Langfuse, no org-wide multi-project account picker in V1, no full secret display after save, no OAuth, no OTLP collector, no raw timeline UI, no automatic deletion of local traces when remote traces disappear, and no exhaustive historical backfill.
- Visible gaps: date-range/cursor UI for large projects, credential rotation/delete/rename project management, richer sync diagnostics/history beyond latest redacted status, full raw trace timeline, global trace search, and JSONL/export variant expansion.

## Model Settings And Provider Management

- Status: operational settings surface
- Freshness: confirmed
- Last checked: 2026-07-03
- Evidence:
  - Current first-run CEF flow added `OpenAI Codex` through onboarding and persisted provider settings in the isolated root.
  - Previous log `logs/2026-07-02-195244-first-run-model-setup-v1.md` verified provider add/persist flows through onboarding and settings.
  - `apps/desktop/src/components/settings/models-page.tsx` owns provider/model CRUD UI.
- Boundary: manage builtin/custom providers and enabled models through local settings.
- Explicit non-goals: account management, cloud sync, provider billing/quota checks.
- Visible gaps: no V1 connectivity validation after a provider is configured.
