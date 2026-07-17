# Canonical Template And Capability Presets Contract Blocker

- Status: done
- Outcome: blocked
- Roadmap item: 09

## Trigger

The user asked whether the roadmap needed a retrospective and, if not, to
continue. The pass started on `develop` at `a1f84cb`, synchronized with
`origin/develop`, with a clean worktree. Items 01-08 and item 09's dependency,
item 05, are complete, so item 09 is the lowest-numbered dependency-ready item.
A broad roadmap retrospective was unnecessary because the roadmap, capability
map, current implementation, and item-08 acceptance evidence agree.

## Product stage and context

LLM Space has one portable Agent Project contract, a trusted compiler, a
checked-in reference Agent, protected serving/deployment, a CLI initializer,
and a Studio workflow for discovering, trusting, editing, and running existing
projects. It does not yet have one canonical project generator shared by Studio
and CLI.

The CLI's `scaffoldAgentProject()` writes either a complete `blank` shape or a
complete weather `starter` shape. The source is not assembled from capability
contributions, and generated projects contain no focused test/eval file.
Studio has no creation RPC or interaction: it opens existing directories,
stores external trust in settings, auto-trusts only canonical-workspace source,
and stores project Threads separately under Desktop-owned app data.

## Evidence reviewed

- `AGENTS.md`, `LOOP_TASK.md`, `LOOP_PLAN.md`, `CONTEXT.md`, ADR 0001, current
  git status/history, package metadata, capability map, and the latest item-08
  blocker/decision/implementation logs.
- `packages/cli/src/scaffold.ts`, its tests and CLI parsing; the Runtime manifest
  and authored virtual-SDK compiler boundary; and every source/test file in
  `apps/example-agent`.
- Desktop composition, `ExternalAgentProjectManager`, project RPC/commands,
  welcome screen, Agents panel, and project registry/Thread ownership paths.
- Current repository search found no Studio project-creation command, request,
  dialog, shared scaffolder import, preset type, or generated test/eval schema.
- The `Agent Studio Roadmap` Loopany loop remains paused. No schedule, goal,
  enabled state, or task-file configuration was changed.

## External market scan

Access date: 2026-07-17.

Primary sources:

- Next.js `create-next-app`: https://nextjs.org/docs/app/api-reference/cli/create-next-app
- Vite Getting Started / `create-vite`: https://vite.dev/guide/
- shadcn CLI: https://ui.shadcn.com/docs/cli
- shadcn registry item schema: https://ui.shadcn.com/docs/registry/registry-item-json

Next separates an empty project from examples and records explicit defaults;
Vite exposes a bounded mutually exclusive template set; shadcn separates a
base/template preset from composable registry items, declares dependencies and
target paths, previews changes, and makes overwrite behavior explicit. Table
stakes are deterministic generation, named bounded inputs, explicit target and
collision behavior, declared contribution dependencies, and a non-interactive
form that matches the interactive surface.

The true local gap is not another example directory. It is one canonical base
plus shipped-capability contributions consumed identically by CLI and Studio,
with atomic all-or-nothing materialization and a generated acceptance case.
The sources do not answer LLM Space's portable-source ownership, trusted path,
Runtime virtual-SDK, or focused-test contract, so those product/architecture
choices cannot be copied from a competitor. No marketplace or community
template evidence is used to broaden V1.

## Capability-map freshness

- `Agent Definition And Runtime`: confirmed from item-05/item-08 compiler and
  artifact evidence; item 09 must only emit supported source contracts.
- `Agent Action Authoring`: confirmed for local tools and flat Streamable HTTP
  MCP connections; neither implies a preset taxonomy or default.
- `Agent Project Activation`: confirmed from source, tests, and current CEF
  evidence; it explicitly has no Desktop creation wizard and keeps portable
  source distinct from Desktop-owned registry/Thread data.
- `Canonical Agent Project Scaffolding`: added as confirmed blocked from current
  source evidence.
- A fresh CEF run is unnecessary for this blocker because the current rendered
  project surfaces were recently confirmed and source/RPC inspection proves no
  creation interaction exists. Any approved UI implementation must later use
  real Electrobun CEF and a product-design audit.

## Product north-star metric

- Name: generated-project build success rate.
- Why it matters: presets are useful only if every supported Studio/CLI output
  becomes a valid portable Agent without manual source or dependency repair.
- Baseline: both CLI shapes load in focused repository tests, but there is no
  Studio generator, no composable matrix, and no generated focused test/eval;
  shared generated-project success is therefore 0%.
- V1 target: 100% of the approved preset combinations generated through the
  shared scaffolder from both CLI and Studio build without edits and pass their
  generated focused case.
- Measurement: exhaustive preset-power-set fixtures at the shared public seam,
  independent CLI and Studio-Bun adapter tests, actual generated-project build
  and focused-case execution, real CEF creation audit, TypeScript, lint,
  non-packaging bundles/Vite, diff review, and Standards/Spec review.
- Guardrails: no marketplace, duplicated full templates, unshipped capability,
  secret value, silent overwrite/merge, source/Thread ownership collapse,
  Pi-message change, Electrobun packaging, signing, notarization, or release
  command.

## Candidate product opportunities

1. Main recommendation: approve one portable-source ownership and generation
   contract, then replace the two full CLI templates with a canonical base plus
   bounded shipped-capability contributions behind one node-safe atomic
   scaffolder shared by CLI and Desktop Bun.
2. Alternative: refactor only the CLI into presets and defer Studio. Rejected
   because it cannot satisfy item 09's shared-scaffolder Done-when clause and
   would likely freeze a CLI-only target/test contract before Studio ownership
   is resolved.
3. Alternative: treat checked-in example directories or remote repositories as
   templates. Deferred/rejected because it duplicates full templates, creates
   drift, and approaches the explicitly excluded marketplace instead of
   composing shipped capabilities.

## Main recommendation

Use one canonical base for manifest, Agent definition, instructions, and one
focused acceptance case. Model each approved shipped capability as a
deterministic contribution with declared files, dependencies, conflicts, and
acceptance expectations. The shared scaffolder should validate the complete
request, render it in a sibling staging directory, verify it, and publish the
whole project with one rename only after collision preflight. CLI flags and the
Studio interaction should be adapters over the same request/result types.

The preferred product direction is for Studio to create portable source in an
explicit user-selected parent directory, keep Desktop registry/Threads under
`LLM_SPACE_HOME`, and trust/open the new path only after successful publication.
This preserves the current source/data ownership split, but it is a new product
choice and is not approved merely by this recommendation.

## V1 capability definition

After approval, a user can name a new Agent Project, choose an approved bounded
set of shipped capabilities in either Studio or CLI, and receive the same
canonical source tree. Every supported combination is generated atomically,
builds without edits through the existing trusted compiler/CLI, and includes a
focused deterministic case proving its declared capability shape. Failure
leaves no partial project and does not alter an existing path.

Explicit non-goals: marketplace/community templates, remote downloads,
duplicated full project trees, capabilities not yet shipped, package-manager
choice, dependency upgrade UI, secrets, Git initialization, post-create source
mutation, item-10 Thread promotion, or generated live-provider/network tests.

Stop condition reached: implementing now would silently decide portable source
ownership, collision and rollback behavior, preset public API/defaults, and the
generated test/build dependency boundary.

## Acceptance and audit plan

After decisions are approved, acceptance must enumerate the complete supported
preset matrix and generate each combination through the shared seam into a
fresh temporary parent. It must prove stable bytes, path confinement, absent
target publication, collision refusal, injected failure rollback, build/load,
focused-case execution, CLI parsing/help, and Desktop RPC error mapping.

The real Electrobun CEF audit must cover the approved create entry point,
naming/path/preset selection, validation, progress, success/open transition,
cancel and failure states, keyboard/focus behavior, no overflow at 1280x800 and
900x700, no console errors, created filesystem contents, trust state, and the
separation of portable source from Desktop-owned Threads. Relevant Bun tests,
all TypeScript projects, lint, Runtime/CLI/Desktop non-packaging bundles,
renderer-only Vite, `git diff --check`, and two-axis review remain hard gates.

## Implementation plan and approval status

1. Resolve the four decision branches below one at a time and record the
   accepted contract in an ADR if it changes source/data ownership.
2. Move project materialization behind one node-safe shared API with a
   canonical base, contribution registry, deterministic request normalization,
   full collision preflight, sibling staging, verification, and whole-root
   publication.
3. Adapt CLI syntax/defaults and compatibility behavior to the approved preset
   contract without retaining duplicated template writers.
4. Add the approved Studio entry point and typed Bun RPC adapter; after create,
   apply the approved trust/open/Thread behavior without moving portable source
   into Desktop-owned data implicitly.
5. Add exhaustive combination, atomicity, CLI, Studio-Bun, generated build, and
   generated focused-case tests; perform real CEF acceptance and all repository
   gates; check item 09 only if its Done-when is fully demonstrated.

Approval status: the roadmap outcome is pre-approved, but product-code
implementation is blocked on four newly exposed material decisions:

1. Where Studio creates portable project source and who owns it.
2. Whether creation requires a wholly absent destination, may adopt an empty
   directory, or preserves non-conflicting existing files, and what atomic
   publication promises in each case.
3. Which shipped capabilities are public presets, their default combination,
   ordering/conflicts, and whether `blank`/`starter` remain aliases.
4. What files/dependencies make a generated focused case independently
   runnable and what exact command defines “builds without manual edits.”

## `$grill-me` requirements discussion

Invoked because these branches change the design tree. Codebase facts were
resolved locally rather than asked. The first one-question-at-a-time decision
is pending: portable source destination and ownership. No implementation may
start until all dependent branches, acceptance criteria, non-goals, and stop
conditions are confirmed, followed by approval of the consolidated plan and
the concrete Studio interaction.

## Work performed

- Reconciled the roadmap against the current CLI, Runtime compiler, example
  Agent, Desktop project manager/RPC/UI, capability map, and recent evidence.
- Completed the current primary-source market scan and formed one main
  recommendation plus two alternatives.
- Recorded the new capability boundary, roadmap blocker, and bounded operating
  memory. No product code, ADR decision, Loopany configuration, or release
  state changed.

## Verification and product-design audit results

No implementation was attempted, so product tests, TypeScript, lint, bundles,
and rendered UI audit are not applicable in this blocked pass. `git diff
--check` passes. The final documentation-only Standards review found no
repository-convention or architecture-boundary issue, and the Spec review
confirmed that the item remains unchecked with every unresolved Done-when
branch named. No Electrobun packaging, signing, notarization, patch-feed, or
release command ran.

## Review

The existing CLI writer cannot simply be imported by Desktop: it is owned by
the CLI package, encodes two full shapes, publishes only selected children into
an existing root, and has no generated acceptance contract. Moving it without
first resolving destinations and tests would only relocate ambiguity.

Creating silently inside `LLM_SPACE_HOME/workspace` would make portable source
look like Desktop-owned app data and auto-trust it; creating externally would
require an explicit user-selected destination and post-create trust/open
transition. Preserving existing directory contents also weakens whole-project
atomic publication. None is an implementation-only choice.

Final review confirms item 09 remains unchecked, the current Pi protocol and
project/Thread ownership split are preserved, and no generated build success
is claimed.

## Follow-up product bets

1. Complete the one-question-at-a-time item-09 `$grill-me` decision session.
2. Record an ADR if the accepted flow adds a durable portable-source ownership
   rule, then approve the exact implementation and Studio interaction plan.
3. Keep item 10 and the later Eval suite separate from this pass.

## Outcome

Blocked. Item 09 remains unchecked. Human approval is required for Studio
source destination/ownership, whole-project collision semantics, preset
taxonomy/defaults/compatibility, and the generated focused-test/build contract.
This pass stops without product code and does not begin item 10.
