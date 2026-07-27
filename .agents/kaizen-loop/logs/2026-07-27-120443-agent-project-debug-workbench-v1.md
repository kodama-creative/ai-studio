# Agent Project Debug Workbench V1

- Status: done
- Outcome: Agent Project Debug Workbench V1 shipped locally
- Date: 2026-07-27

## Trigger and starting state

The owner asked whether LLM Space can build every core Eve capability, then
clarified the product boundary: Agent Project code is developed in VS Code,
Zed, or another external editor; Desktop displays source and owns debugging.
The starting branch was `develop` at `ce55772`, with only the existing roadmap
and capability-map review edits present. No product code was modified before
approval.

## Product stage and diagnosis

LLM Space is a development-stage local Agent Studio with a strong single-Agent
Runtime. Literal Eve parity is not the product goal. The current Project pane
mixes a small in-app editor with debugging, yet lacks the external-editor
handoff, actionable compiler diagnostics, and compiled artifact explanation
needed for the approved external-development workflow.

## Evidence reviewed

- Current Agent Project compiler, artifact, scaffold, external-project manager,
  typed RPC, Project pane, Thread sync flow, roadmap, and capability map.
- Fresh real CEF evidence from the immediately preceding core comparison at
  `audits/2026-07-26-232212-agent-build-core-review/`.
- Owner decisions from the `$grill-me` discussion: source is read-only after
  initial scaffolding; external editors own development; source watching drives
  validation; existing Threads never mutate implicitly.

## External comparison scan

Primary source: Eve `main@e40cce456284d901c73860c8e464b645d656bc01`,
accessed 2026-07-26 and re-used for this immediately consecutive scope decision:

- https://github.com/vercel/eve/blob/e40cce456284d901c73860c8e464b645d656bc01/docs/reference/project-layout.md
- https://github.com/vercel/eve/blob/e40cce456284d901c73860c8e464b645d656bc01/docs/agent-config.md
- https://github.com/vercel/eve/blob/e40cce456284d901c73860c8e464b645d656bc01/docs/guides/dynamic-capabilities.md

Source-first Agent frameworks expect users to work in a real editor and treat
validation/run surfaces as consumers of the project. The true missing product
job is therefore a reliable edit-to-debug handoff, not duplicating IDE source
authoring inside Desktop. Uncertainty remains around editors beyond the fixed
VS Code/Zed/Cursor V1 allowlist; arbitrary command configuration is excluded.

## Capability-map freshness

`Agent Build Authoring Workbench` was replaced by `Agent Project Debug
Workbench`, confirmed on 2026-07-27. The boundary now explicitly permits only
initial scaffolding and prohibits later Desktop source mutation. Static local
Subagents and portable Eval suites remain independent core source gaps.

## Product north-star metric

Name: **external edit-to-debug completion**.

Why: the Studio loop succeeds when an author can leave source development in a
real editor while Desktop continuously explains whether the project is runnable
and lets the author choose where to debug it.

Baseline: Desktop has no external-editor entry, collapses compiler failures into
aggregate text, exposes no compiled capability summary, and still owns a source
write RPC.

V1 target: from one Project-pane action, open the project or selected file in a
fixed supported editor; observe watcher-driven Building/Ready/Invalid state;
navigate path-specific diagnostics; inspect the safe artifact summary; then
open or create a Project Thread only by explicit user choice.

Measurement: focused manager/RPC/component tests plus real CEF flows covering
editor availability, read-only source, external file change, valid and invalid
diagnostics, artifact summary, project/file handoff, and Thread non-mutation.

Guardrails: no arbitrary shell command, no secret values, no source write RPC,
no automatic Thread creation/sync/reset/checkpoint movement, no page overflow,
no application console errors, preserved scaffolding, and unchanged Runtime
artifact contracts.

## Candidate opportunities

1. Main: Agent Project Debug Workbench V1.
2. Alternative: static local Subagents, deferred until the current source-to-
   debug loop is coherent.
3. Alternative: portable Eval suites, deferred until artifact and diagnostic
   inspection provide a stable host surface.

## Approved V1 and explicit non-goals

Approved behavior:

- keep one-time canonical Agent Project scaffolding;
- make Project source display read-only;
- add fixed VS Code/Zed/Cursor project and file handoff with remembered choice;
- retain Reveal in Finder;
- drive Building/Ready/Invalid and diagnostics from watched disk source;
- expose path-specific diagnostic navigation and a secret-safe compiled
  capability summary;
- retain current explicit Project Thread creation and Sync from Agent behavior.

Non-goals: in-app source editing, Add/Create/Rename/Delete, post-scaffold
templates, arbitrary editor commands, binary workspace authoring, dependency
management, Git, terminal, AI generation, Subagents, or Evals.

## Acceptance and implementation plan

1. Add Bun-owned fixed editor detection/opening plus preference persistence and
   typed RPC/client contracts.
2. Remove source writing from renderer and RPC; keep confined source reads.
3. Convert the Project pane to a read-only source inspector with editor actions.
4. Preserve structured diagnostics even when compilation is invalid and expose
   a safe artifact/capability summary.
5. Verify focused tests, all relevant TypeScript projects, lint, local suites,
   real CEF at 1280x800 and 900x700, product-design audit, and code review.

Stop if the implementation requires arbitrary command execution, source writes,
automatic Thread mutation, secret exposure, or a new language-server/IDE
architecture.

## `$grill-me` requirements discussion

Resolved: product boundary, one-time scaffolding exception, read-only source,
editor allowlist and remembered choice, watcher ownership, diagnostic states,
artifact summary boundary, and explicit Thread handoff. The earlier authoring
workbench proposal was withdrawn after the owner clarified that development
belongs in external editors. The revised scope was explicitly approved before
product-code changes.

## Work, verification, review, and outcome

Implemented a read-only Project inspector with fixed external-editor discovery,
launch, remembered preference, confined project/file targets, watcher build
states, path-specific diagnostics, and a secret-safe artifact summary. Removed
the source-write RPC, dirty-buffer coordinator, overwrite/conflict UI, and dirty
tab/quit guards.

Thread ownership was tightened after final Spec review: trust/import/scaffold
creates no Thread, opening a Project selects its inspector rather than the first
saved Thread, and watched source never changes a frozen Thread's prompt, tools,
connections, execution base, or selection. Only explicit New Thread and Sync
from Agent actions cross that boundary. Scaffolding also leaves editor handoff
explicit rather than launching an editor as a side effect.

Verification passed all TypeScript configurations, repository lint, renderer
Vite production build, all repository test files in isolated Bun processes, and
the opt-in real Docker acceptance (1 test, 42 assertions). Bun 1.3.14's
single-process `bun test` crashes after roughly 3.7 GiB RSS without an assertion
failure; per-file process isolation completed the same corpus successfully.

Real Electrobun CEF verification used an isolated temporary home and actual Bun
RPC. It covered no initial Thread, explicit New Thread plus model selector,
Ready artifact inspection, missing `instructions.md` Invalid diagnostics,
successful non-existing-file handoff to Zed with persisted preference,
watcher recovery to Ready, retention of exactly one user-created Thread, clean
application console, and zero document/body horizontal overflow. Existing audit
screenshots under
`audits/2026-07-27-122712-agent-project-debug-workbench-v1/` cover the required
1280×800 and 900×700 layouts.

Final parallel Standards and Spec reviews found the initial command, test
layout, memoization, automatic Thread selection, implicit Thread tool sync,
watch ordering, editor availability, and post-scaffold launch issues. Those
findings were corrected and re-reviewed before commit.
