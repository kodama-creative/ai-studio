# Canonical Agent Project Scaffolding V1

- Status: done
- Outcome: completed
- Roadmap item: 09

## Trigger

The user continued the bounded roadmap executor from the item-09 decision gate.
Implementation began on `develop` at `df13fdd`, synchronized with
`origin/develop`, with only item-09-owned worktree changes. The immediately
preceding blocker record is
`2026-07-17-141257-canonical-template-presets-blocker.md`. Items 01-08 and item
09's dependency, item 05, were complete. This pass did not begin item 10 or
change Loopany schedule, goal, enabled state, or task-file configuration.

## Product stage and evidence reviewed

LLM Space already had a portable Agent Project compiler, CLI-only hard-coded
starter writers, protected Desktop project trust/Threads, and OCI build
acceptance. The missing activation capability was one deterministic project
creation contract shared by CLI and Studio.

Evidence included `AGENTS.md`, `LOOP_TASK.md`, `LOOP_PLAN.md`, `CONTEXT.md`,
ADRs 0001-0005, current source and git state, the capability map, the latest
item-08/item-09 logs, CLI/Runtime/Desktop tests, current package scripts, and
the real Electrobun CEF renderer. The blocker log's source reconciliation and
market scan were re-used rather than repeated; ADR 0005 and the user's
one-question-at-a-time decisions resolved every formerly open branch.

## External market scan

Access date: 2026-07-17. Primary sources retained from the item-09 blocker:

- Next.js `create-next-app`:
  https://nextjs.org/docs/app/api-reference/cli/create-next-app
- Vite `create-vite`: https://vite.dev/guide/
- shadcn CLI: https://ui.shadcn.com/docs/cli
- shadcn registry schema:
  https://ui.shadcn.com/docs/registry/registry-item-json

Table stakes are deterministic named inputs, explicit defaults and collision
behavior, bounded capability/template choices, non-interactive parity, and
declared contribution content. The true LLM Space gap was not another example
directory but one canonical base plus shipped-capability contributions shared
by CLI and Studio while preserving user source ownership. These sources do not
settle LLM Space trust, Thread persistence, Runtime virtual SDK, or Eval
ownership; ADR 0005 resolves those locally. No marketplace evidence broadened
V1.

## Capability-map freshness

- `Agent Definition And Runtime`: confirmed; generated source uses only the
  shipped compiler contract.
- `Agent Action Authoring`: confirmed; V1 presets cover the shipped local tool,
  skill, and flat Streamable HTTP MCP connection boundaries only.
- `Agent Project Activation`: refreshed to confirmed creation plus open/trust.
- `Canonical Agent Project Scaffolding`: moved from confirmed blocked to
  confirmed shipped V1.
- Native picker completion remains evidence-limited because current macOS
  automation could open but not select from the system dialog.

## Product north-star metric

- Name: generated-project build success rate.
- Why it matters: a preset is useful only when CLI and Studio materialize the
  same valid portable Agent without manual source or dependency repair.
- Baseline: 0% shared Studio/CLI matrix; only two separate CLI template shapes
  existed and Studio could not create a project.
- V1 target: 100% of the eight supported preset combinations generated through
  the shared seam load and produce a valid OCI context without source edits.
- Measurement: exhaustive power-set generation, Runtime load and local action
  assertions, OCI context creation, CLI parsing, Desktop manager ownership and
  rollback fixtures, real CEF creation/Build audit, TypeScript, lint,
  non-packaging bundles/Vite, diff check, and two-axis review.
- Result: 8/8 combinations passed, so the measured V1 rate is 100%.
- Guardrails: no source overwrite/merge, secret copy, source/Thread ownership
  collapse, new Pi protocol, marketplace, unshipped preset, generated Eval
  protocol, Electrobun packaging, signing, notarization, or release command.

## Candidate opportunities and recommendation

1. Main recommendation: one Runtime Node scaffolder for a canonical base plus
   bounded shipped-capability presets, consumed identically by CLI and Desktop.
2. Rejected: refactor only CLI presets and defer Studio, because it would miss
   the shared-scaffolder activation job and freeze a CLI-only contract.
3. Deferred: use checked-in or remote repositories as templates, because that
   duplicates full trees, drifts, and approaches the excluded marketplace.

The main recommendation won because it is the smallest complete user outcome:
choose an explicit parent, create portable source once, inspect it immediately
in Build, and keep all trust/Thread state outside that source.

## V1 capability, non-goals, and acceptance plan

The canonical base always contains manifest, instructions, Agent model,
reasoning, and environment requirement. Users may compose `local-tool`,
`skill`, and `mcp-connection`; the first two default on, while MCP requires an
HTTP(S) URL and at least one exact allowlisted tool. CLI `--blank` remains an
empty-preset alias and explicit repeated `--preset` replaces defaults. Studio
offers Welcome, Agents sidebar, and Command Palette entry points, then opens
Build after auto-trust and default Project Thread creation.

Explicit non-goals are marketplace/community templates, remote downloads,
duplicated full templates, package installation, Git setup, unshipped
capabilities, MCP auth/OAuth/stdio/network probing, secrets, directory
merge/overwrite, item-10 Thread promotion, and a generated test/Eval protocol.
Repository-owned conformance is the focused case until item 29 defines a
portable Eval contract.

Acceptance required all eight combinations, path/name/MCP validation,
concurrent collision refusal, stage cleanup, Runtime load, local action
execution, OCI context creation, CLI compatibility/error behavior, Desktop
source/trust/Thread separation and rollback, real CEF interaction/layout,
package gates, and final Standards/Spec review.

## Approval and `$grill-me` requirements discussion

The roadmap outcome was pre-approved. The required one-question-at-a-time
discussion resolved portable source ownership, absent-target publication,
preset set/order/defaults, CLI compatibility, MCP inputs, independent examples,
repository-owned tests, Studio entry points, dialog states, keyboard behavior,
success navigation, auto-trust/default Thread behavior, and explicit non-goals.
The user approved the consolidated plan and concrete Studio interaction before
product code changed. ADR 0005 records the accepted architecture and data
boundary. No new architecture, security, permission, persistence, or ownership
branch appeared during implementation.

## Work performed

- Added browser-safe canonical preset/config validation and the only Node
  `scaffoldAgentProject()` implementation under `@llm-space/runtime/node`.
- Replaced the CLI's duplicated `blank`/`starter` writer with shared scaffolding,
  mandatory destination, repeatable presets, `--blank`, and explicit MCP flags.
- Rendered a canonical base plus independent `echo`, `concise-response`, and
  MCP contributions in a private sibling stage; validated through Runtime,
  atomically reserved an absent target, and published the whole root once.
- Added exhaustive 8-combination generation/load/action/OCI conformance plus
  validation, concurrent-publisher, CLI parsing, and Desktop manager tests.
- Added typed Desktop RPC/client/Command flow and a lazy creation dialog at all
  three entry points. Success auto-trusts the generated path, creates the
  existing default Project Thread under `LLM_SPACE_HOME`, switches to Agents,
  and opens Build.
- Final review found and fixed two ADR-level edge cases: POSIX rename could
  replace a raced empty directory, and Desktop activation failure could leave
  published source. Atomic target reservation and bounded source/registry/
  Thread rollback now cover both without deleting a raced populated target.

## Verification and product-design audit

- Focused final acceptance: 32 tests, 187 assertions, all passing.
- Full repository: 233 tests total; 232 passed with 934 assertions. The sole
  failure is the Server test `aborts explicitly while observation disconnect
  remains passive`, timing out during shutdown. It was reproduced unchanged on
  clean fixed point `a1f84cb` in a detached temporary worktree after a frozen
  install, so LOOP_TASK classifies it as pre-existing unrelated debt rather
  than an item-09 regression.
- TypeScript: root, Runtime, Core, CLI, Server, example Agent, and Desktop all
  pass `tsc --noEmit`.
- Full repository lint and `git diff --check` pass.
- Non-packaging builds pass: Runtime browser root 2.61 KB, Runtime browser
  client 12.69 KB, CLI Bun bundle 15.49 MB, Server Bun bundle 5.60 MB, OCI
  bootstrap Bun bundle 5.61 MB, and renderer-only Vite. The existing
  non-failing large-chunk advisory remains.
- No Electrobun packaging, canary/stable build, DMG, patch-feed, signing,
  notarization, or release command ran.
- Current audit:
  `audits/2026-07-17-175010-canonical-agent-project/`. Accepted evidence is
  `05-created-project-build.png`, `06-create-dialog-900x700.png`,
  `07-mcp-dialog-900x700-scrolled.png`, `08-welcome-final-900x700.png`, and
  `audit-notes.md`.
- Real CEF at 1280×800 and 900×700 proved dialog defaults, accessible checkbox
  names, name autofocus/invalid state, Escape cancellation, conditional MCP
  fields/footer reachability, zero document overflow, no application console
  errors, real Bun RPC generation, separated filesystem ownership, and Build
  inspection. The system folder picker opened but could not be completed with
  available Accessibility automation; this is a documented supplementary
  evidence limit, not a product failure.

## Review

The fixed point was `df13fdd`. Final parallel review reports zero hard
Standards findings and zero Spec findings. Standards noted one judgement-only
Data Clump where the typed creation fields cross RPC/client/manager; retaining
the explicit typed boundary is smaller and clearer than adding another V1
wrapper. No architecture violation, regression, missing state, scope creep, or
remaining hard finding was found.

## Follow-up product bets

1. Begin item 10 only in a new bounded roadmap pass.
2. Keep portable Eval suites in item 29 rather than inventing generated tests.
3. Treat marketplace, dependency installation, remote templates, source
   adoption/merge, and MCP auth as separately approved future capabilities.

## Outcome

Completed. Generated-project build success moved from a 0% shared Studio/CLI
baseline to 8/8 supported combinations. Roadmap item 09 is checked, capability
boundaries are refreshed, and this pass ends before item 10.
